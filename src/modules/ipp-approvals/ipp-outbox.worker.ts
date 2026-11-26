import type { DataSource } from 'typeorm';
import { BACKOFF_SECONDS, OUTBOX_LOCK_KEY, SEND_MAX, type DecisionAction, type Stage } from './ipp-approvals.constants';
import { IppError, type DecisionCall, type IppClient } from './ipp-client';

/*
 * Sends the officers' decisions to IPP (contract ipp_backend/docs/SARTHI_LINK.md section 4): first come, first served per
 * application. A decision waits while an earlier one of the same application is not sent (pending or failed), so a call
 * carries at most one decision per application. IPP not reachable, 401, 408, 429, 5xx → tried again later (backoff); any
 * other answer, or a decision IPP refuses → FAILED, until somebody chooses Retry. A PostgreSQL advisory lock keeps one
 * cycle at a time across API instances. IPP does a decision once per id, so sending it twice is harmless.
 */
export interface OutboxLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface OutboxStats {
  ran: boolean;
  /* Why nothing was done: link off, or another instance is sending. */
  reason?: 'off' | 'locked';
  sent: number;
  failed: number;
  deferred: number;
}

export interface OutboxWorkerOptions {
  ds: DataSource;
  /* null = link off or not configured: decisions wait. */
  client: IppClient | null;
  log: OutboxLogger;
  /* Calls per cycle at most (the next cycle goes on). */
  maxCalls?: number;
}

interface DueRow {
  id: string;
  applicationId: string;
  action: DecisionAction;
  fromStage: Stage;
  toStage: Stage;
  reason: string | null;
  byName: string;
  byRole: string;
  decidedAt: Date;
}

/* Seconds to wait after the given number of tries. */
export const backoffSeconds = (attempts: number): number => BACKOFF_SECONDS[Math.min(Math.max(attempts, 1), BACKOFF_SECONDS.length) - 1];

/* Answers that mean "this call is malformed": one bad decision must not fail the others it was sent with. */
const MALFORMED = new Set([400, 413, 422]);

const toCall = (r: DueRow): DecisionCall => ({
  id: r.id,
  application_id: r.applicationId,
  action: r.action,
  from: r.fromStage,
  to: r.toStage,
  reason: r.reason,
  by: { name: r.byName, role: r.byRole },
  at: r.decidedAt.toISOString(),
});

export interface IppOutboxWorker {
  runCycle(): Promise<OutboxStats>;
}

export function createIppOutboxWorker({ ds, client, log, maxCalls = 50 }: OutboxWorkerOptions): IppOutboxWorker {
  /* The oldest decision of each application, when it is its turn. */
  const due = (): Promise<DueRow[]> =>
    ds.query(
      `SELECT d."id", d."applicationId", d."action", d."fromStage", d."toStage", d."reason", d."byName", d."byRole", d."decidedAt"
         FROM "ipp_decisions" d
        WHERE d."status" = 'PENDING' AND (d."nextAttemptAt" IS NULL OR d."nextAttemptAt" <= now())
          AND NOT EXISTS (
            SELECT 1 FROM "ipp_decisions" e WHERE e."applicationId" = d."applicationId" AND e."seq" < d."seq" AND e."status" <> 'SENT')
        ORDER BY d."seq" LIMIT ${SEND_MAX}`,
    );

  const markSent = (ids: string[]) =>
    ds.query(
      `UPDATE "ipp_decisions" SET "status" = 'SENT', "sentAt" = now(), "attempts" = "attempts" + 1, "nextAttemptAt" = NULL, "lastError" = NULL
        WHERE "id" = ANY($1::uuid[]) AND "status" = 'PENDING'`,
      [ids],
    );
  const markFailed = (ids: string[], error: string) =>
    ds.query(
      `UPDATE "ipp_decisions" SET "status" = 'FAILED', "attempts" = "attempts" + 1, "nextAttemptAt" = NULL, "lastError" = $2
        WHERE "id" = ANY($1::uuid[]) AND "status" = 'PENDING'`,
      [ids, error.slice(0, 300)],
    );
  const defer = async (ids: string[], error: string) => {
    /* The wait grows with the tries of each decision; the array holds the seconds after try 1, 2, … */
    await ds.query(
      `UPDATE "ipp_decisions" SET "attempts" = "attempts" + 1, "lastError" = $2,
              "nextAttemptAt" = now() + make_interval(secs => ($3::int[])[LEAST("attempts" + 1, $4::int)])
        WHERE "id" = ANY($1::uuid[]) AND "status" = 'PENDING'`,
      [ids, error.slice(0, 300), [...BACKOFF_SECONDS], BACKOFF_SECONDS.length],
    );
  };

  /* One call. False = stop the cycle (IPP cannot be used now). */
  async function send(api: IppClient, rows: DueRow[], stats: OutboxStats): Promise<boolean> {
    const ids = rows.map((r) => r.id);
    try {
      const results = new Map((await api.sendDecisions(rows.map(toCall))).map((r) => [r.id, r]));
      const sent = ids.filter((id) => results.get(id)?.ok === true);
      const unanswered = ids.filter((id) => !results.has(id));
      if (sent.length) await markSent(sent);
      for (const id of ids) {
        const r = results.get(id);
        if (!r || r.ok) continue;
        await markFailed([id], `IPP refused it: ${r.code}${r.stage ? ` (there the form is at ${r.stage})` : ''}`);
        stats.failed++;
      }
      if (unanswered.length) await defer(unanswered, 'IPP did not answer for this decision');
      stats.sent += sent.length;
      stats.deferred += unanswered.length;
      return true;
    } catch (err) {
      if (!(err instanceof IppError)) throw err;
      if (err.retryable) {
        await defer(ids, err.message);
        stats.deferred += ids.length;
        return false;
      }
      if (rows.length > 1 && err.status !== null && MALFORMED.has(err.status)) {
        for (const row of rows) if (!(await send(api, [row], stats))) return false;
        return true;
      }
      await markFailed(ids, err.message);
      stats.failed += ids.length;
      return true;
    }
  }

  return {
    async runCycle() {
      const stats: OutboxStats = { ran: true, sent: 0, failed: 0, deferred: 0 };
      if (!client) return { ...stats, ran: false, reason: 'off' };
      const qr = ds.createQueryRunner();
      await qr.connect();
      try {
        const [{ locked }] = (await qr.query(`SELECT pg_try_advisory_lock($1) AS "locked"`, [OUTBOX_LOCK_KEY])) as { locked: boolean }[];
        if (!locked) return { ...stats, ran: false, reason: 'locked' };
        try {
          for (let i = 0; i < maxCalls; i++) {
            const rows = await due();
            if (!rows.length || !(await send(client, rows, stats))) break;
          }
        } finally {
          await qr.query(`SELECT pg_advisory_unlock($1)`, [OUTBOX_LOCK_KEY]);
        }
      } finally {
        await qr.release();
      }
      if (stats.failed || stats.deferred) log.warn({ stats }, 'ipp link: decisions not taken by IPP');
      else if (stats.sent) log.info({ stats }, 'ipp link: decisions sent');
      return stats;
    },
  };
}
