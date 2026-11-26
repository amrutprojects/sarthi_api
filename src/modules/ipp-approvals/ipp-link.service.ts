import type { Request } from 'express';
import { AppDataSource } from '../../config/database.config';
import { auditService } from '../audit';
import type { DecisionAction, DecisionStatus, Stage } from './ipp-approvals.constants';
import { IPP_AUDIT, IPP_ERROR } from './ipp-approvals.constants';
import { IppError } from './ipp-client';
import { ippLink } from './ipp-link.settings';
import { ippClient, kickIppLink } from './ipp-outbox.runtime';
import { rowsOf } from './ipp-sql';

/* The link with IPP as System Settings shows it: what waits, what IPP refused, Retry and Test. */
type OpenStatus = Exclude<DecisionStatus, 'SENT'>;

export interface LinkItem {
  id: string;
  application: { id: string; registrationId: string; name: string };
  action: DecisionAction;
  from: Stage;
  to: Stage;
  status: OpenStatus;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  createdAt: string;
}
export interface LinkStatus {
  enabled: boolean;
  configured: boolean;
  host: string | null;
  lastSentAt: string | null;
  lastReceivedAt: string | null;
  pending: number;
  failed: number;
  items: LinkItem[];
}

const ITEMS_MAX = 100;
const iso = (v: Date | null): string | null => v?.toISOString() ?? null;

/* What to look at first, for the answers a wrong setting gives. */
function testMessage(err: IppError): string {
  if (err.code === IPP_ERROR.LINK_NOT_CONFIGURED) return `${err.message}: the link is not switched on in IPP`;
  if (err.status === 401) return `${err.message}: the secret is not the same on both sides, or a server's clock is wrong`;
  if (err.status === 404) return `${err.message}: check IPP_API_URL`;
  return err.message;
}

class IppLinkService {
  async status(): Promise<LinkStatus> {
    const link = ippLink();
    const [[counts], rows] = await Promise.all([
      AppDataSource.query(
        `SELECT (SELECT count(*)::int FROM "ipp_decisions" WHERE "status" = 'PENDING') AS "pending",
                (SELECT count(*)::int FROM "ipp_decisions" WHERE "status" = 'FAILED') AS "failed",
                (SELECT max("sentAt") FROM "ipp_decisions") AS "lastSentAt",
                (SELECT max("receivedAt") FROM "ipp_messages") AS "lastReceivedAt"`,
      ) as Promise<{ pending: number; failed: number; lastSentAt: Date | null; lastReceivedAt: Date | null }[]>,
      AppDataSource.query(
        `SELECT d."id", a."id" AS "applicationId", a."registrationId", a."name", d."action", d."fromStage", d."toStage", d."status",
                d."attempts", d."nextAttemptAt", d."lastError", d."createdAt"
           FROM "ipp_decisions" d JOIN "ipp_applications" a ON a."id" = d."applicationId"
          WHERE d."status" <> 'SENT' ORDER BY d."seq" LIMIT ${ITEMS_MAX}`,
      ) as Promise<
        {
          id: string;
          applicationId: string;
          registrationId: string;
          name: string;
          action: DecisionAction;
          fromStage: Stage;
          toStage: Stage;
          status: OpenStatus;
          attempts: number;
          nextAttemptAt: Date | null;
          lastError: string | null;
          createdAt: Date;
        }[]
      >,
    ]);
    return {
      enabled: link.enabled,
      configured: link.configured,
      host: link.host,
      lastSentAt: iso(counts.lastSentAt),
      lastReceivedAt: iso(counts.lastReceivedAt),
      pending: counts.pending,
      failed: counts.failed,
      items: rows.map((r) => ({
        id: r.id,
        application: { id: r.applicationId, registrationId: r.registrationId, name: r.name },
        action: r.action,
        from: r.fromStage,
        to: r.toStage,
        status: r.status,
        attempts: r.attempts,
        nextAttemptAt: iso(r.nextAttemptAt),
        lastError: r.lastError,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /* FAILED decisions back to PENDING, tried at once: the given ones, or all of them. */
  async retry(req: Request, ids?: string[]): Promise<{ retried: number }> {
    const retried = await AppDataSource.transaction(async (m) => {
      const rows = rowsOf<{ id: string }>(
        await m.query(
          `UPDATE "ipp_decisions" SET "status" = 'PENDING', "attempts" = 0, "nextAttemptAt" = NULL
            WHERE "status" = 'FAILED' AND ($1::uuid[] IS NULL OR "id" = ANY($1::uuid[])) RETURNING "id"`,
          [ids ?? null],
        ),
      );
      if (rows.length)
        await auditService.recordInTx(m, req, {
          action: IPP_AUDIT.LINK_RETRY,
          resource: 'ipp_decision',
          resourceId: null,
          details: { retried: rows.length, all: !ids },
        });
      return rows.length;
    });
    if (retried) kickIppLink();
    return { retried };
  }

  async test(): Promise<{ ok: boolean; message: string }> {
    const client = ippClient();
    if (!client) return { ok: false, message: 'The link with IPP is not configured on this server' };
    try {
      await client.ping();
      return { ok: true, message: 'IPP answered' };
    } catch (err) {
      if (!(err instanceof IppError)) throw err;
      return { ok: false, message: testMessage(err) };
    }
  }
}

export const ippLinkService = new IppLinkService();
