import { AppDataSource } from '../../config/database.config';
import { env } from '../../config/env.config';
import { logger } from '../../observability/logger';
import { createLmsClient } from './lms-client';
import { createLmsSyncWorker, type LmsSyncWorker } from './lms-sync.worker';

/*
 * The process-wide sync worker, built from the environment (LMS_*), and the automatic trigger: a poller that runs one
 * cycle every LMS_SYNC_INTERVAL_SECONDS. Polling the students table is how new imports, approvals and edits reach
 * the LMS without any change to the import or approval code. The poller starts only when LMS_SYNC_ENABLED=true.
 */
let worker: LmsSyncWorker | null = null;
const log = logger.child({ component: 'lms-sync' });

export function getLmsSyncWorker(): LmsSyncWorker {
  if (!worker) {
    const client =
      env.LMS_SYNC_ENABLED && env.LMS_EXTERNAL_BASE_URL && env.LMS_TENANT_API_KEY
        ? createLmsClient({ baseUrl: env.LMS_EXTERNAL_BASE_URL, apiKey: env.LMS_TENANT_API_KEY, timeoutMs: env.LMS_HTTP_TIMEOUT_MS })
        : null;
    worker = createLmsSyncWorker({
      ds: AppDataSource,
      client,
      tenantCode: env.LMS_TENANT_CODE,
      batchSize: env.LMS_SYNC_BATCH_SIZE,
      log,
    });
  }
  return worker;
}

let timer: NodeJS.Timeout | null = null;
let running: Promise<unknown> | null = null;

/* Runs one cycle unless one is already running in this process (another instance is kept out by the advisory lock). */
export function triggerLmsSync(): Promise<unknown> {
  const w = getLmsSyncWorker();
  if (!w.enabled) return Promise.resolve();
  if (!running) {
    running = w
      .runCycle()
      .catch((err: unknown) =>
        log.error({ err: err instanceof Error ? { name: err.name, message: err.message } : 'error' }, 'lms sync: cycle failed'),
      )
      .finally(() => {
        running = null;
      });
  }
  return running;
}

export function startLmsSyncPoller(): void {
  if (timer || !getLmsSyncWorker().enabled) return;
  timer = setInterval(() => void triggerLmsSync(), env.LMS_SYNC_INTERVAL_SECONDS * 1000);
  timer.unref();
  log.info({ intervalSeconds: env.LMS_SYNC_INTERVAL_SECONDS, tenant: env.LMS_TENANT_CODE }, 'lms sync: poller started');
  void triggerLmsSync();
}

export async function stopLmsSyncPoller(): Promise<void> {
  if (timer) clearInterval(timer);
  timer = null;
  if (running) await running;
}
