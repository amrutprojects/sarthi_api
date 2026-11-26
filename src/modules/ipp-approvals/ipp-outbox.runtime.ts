import { AppDataSource } from '../../config/database.config';
import { logger } from '../../observability/logger';
import { createIppClient, type IppClient } from './ipp-client';
import { ippLink } from './ipp-link.settings';
import { createIppOutboxWorker, type OutboxStats } from './ipp-outbox.worker';

/*
 * Starts the sending of decisions: at once after a decision is stored (kick), and every IPP_LINK_INTERVAL_SECONDS for
 * what has to be tried again. Neither does anything until the server has started the poller, or while the link is off.
 */
const log = logger.child({ component: 'ipp-link' });

/* null = link off or not configured. */
export function ippClient(): IppClient | null {
  const link = ippLink();
  return link.configured ? createIppClient({ baseUrl: link.baseUrl, secret: link.secret, timeoutMs: link.timeoutMs }) : null;
}

/* One cycle now (the poller, a kick, and the tests). */
export const runIppLinkCycle = (): Promise<OutboxStats> =>
  createIppOutboxWorker({ ds: AppDataSource, client: ippClient(), log }).runCycle();

let timer: NodeJS.Timeout | null = null;
let running: Promise<void> | null = null;
let again = false;

async function loop(): Promise<void> {
  do {
    again = false;
    try {
      await runIppLinkCycle();
    } catch (err) {
      log.error({ err: err instanceof Error ? { name: err.name, message: err.message } : 'error' }, 'ipp link: cycle failed');
    }
  } while (again && timer);
}

/* Sends what is waiting, unless this process is already sending: then it looks once more afterwards. */
export function kickIppLink(): void {
  if (!timer) return;
  if (running) {
    again = true;
    return;
  }
  running = loop().finally(() => {
    running = null;
  });
}

export function startIppLinkPoller(): void {
  const link = ippLink();
  if (timer || !link.configured) return;
  timer = setInterval(kickIppLink, link.intervalSeconds * 1000);
  timer.unref();
  log.info({ intervalSeconds: link.intervalSeconds, host: link.host }, 'ipp link: poller started');
  kickIppLink();
}

export async function stopIppLinkPoller(): Promise<void> {
  if (timer) clearInterval(timer);
  timer = null;
  if (running) await running;
}
