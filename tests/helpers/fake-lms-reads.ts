import http from 'http';
import type { AddressInfo } from 'net';
import express, { type Request, type Response } from 'express';

/*
 * In-process fake of the LMS tenant API reads (/tenant/v1: summary, centres, batches, sessions, live-sessions,
 * trainers, attendance) for the lms-reads route tests. Synthetic data only. It checks X-Api-Key like the LMS (401
 * EXTERNAL_KEY_INVALID) and answers in the LMS envelopes. `mode` simulates trouble: 'down' = 503, 'slow' = no answer
 * before the client's timeout, 'drop' = connection reset. Distinct from tests/helpers/fake-lms.ts (the student-sync
 * fake on the sync branch), so the two can live side by side.
 */
export const FAKE_LMS_KEY = 'fake-lms-reads-tenant-key-0123456789';

export type FakeLmsMode = 'ok' | 'down' | 'slow' | 'drop';

export interface FakeLmsReads {
  url: string;
  calls: { path: string; query: Record<string, unknown>; apiKey: string | undefined }[];
  mode: FakeLmsMode;
  /* M3: attendance items per group_by (wire rows); a group_by not listed gets the default NAG row. */
  attendanceItems: Partial<Record<string, unknown[]>>;
  /* M3: batch list override (wire rows); default [FAKE_DATA.batch]. */
  batchItems?: unknown[];
  close(): Promise<void>;
}

const page = (items: unknown[], req: Request) => ({
  items,
  page: Number(req.query.page ?? 1),
  page_size: Number(req.query.page_size ?? 50),
  total: items.length,
});

export const FAKE_DATA = {
  summary: {
    tenant: { tenant_code: 'AMRUT', name: 'Amrut (synthetic)' },
    entity: null,
    entities: [{ entity_code: 'SBX-08', name: 'Sandbox entity' }],
    generated_at: '2026-11-21T07:00:00.000Z',
    learners: { total: 25, active: 24 },
    batches: { total: 1, active: 1 },
    centres_active: 1,
    trainers_active: 1,
    attendance: { sessions_scheduled: 4, records_marked: 90, attended: 80, attendance_percent: 88.9 },
    outcomes: { certificates_issued: 0 },
    by_centre: [{ centre_code: 'NAG-01', learners: 25 }],
    by_track: [{ track_code: 'T03', learners: 25 }],
    by_batch: [{ batch_code: 'NAG-01-B3', learners: 25 }],
  },
  centre: {
    centre_code: 'NAG-01',
    name: 'Synthetic Centre',
    district_code: 'NAG',
    district_name: 'Nagpur',
    centre_type: 'ITI',
    status: 'ACTIVE',
    updated_at: '2026-11-20T00:00:00.000Z',
  },
  batch: {
    batch_id: '11111111-1111-4111-8111-111111111111',
    batch_code: 'NAG-01-B3',
    entity_code: 'SBX-08',
    course_code: 'AK-2026',
    centre_code: 'NAG-01',
    centre_name: 'Synthetic Centre',
    track_code: 'T03',
    start_date: '2026-11-01',
    end_date: null,
    delivery_mode: 'OFFLINE',
    status: 'ACTIVE',
    capacity: 30,
    learners_enrolled: 25,
    learners_active: 24,
    learners_completed: 0,
    learners_withdrawn: 1,
    updated_at: '2026-11-21T00:00:00.000Z',
  },
  session: {
    session_id: '22222222-2222-4222-8222-222222222222',
    batch_code: 'NAG-01-B3',
    centre_code: 'NAG-01',
    entity_code: 'SBX-08',
    title: 'Synthetic lesson',
    module_no: 1,
    starts_at: '2026-11-21T04:00:00.000Z',
    ends_at: '2026-11-21T06:00:00.000Z',
    delivery_mode: 'OFFLINE',
    attendance_mode: 'TRAINER',
    status: 'HELD',
    trainer_code: 'TR-1',
    attendance_present: 20,
    attendance_late: 2,
    attendance_absent: 3,
    attendance_excused: 0,
    updated_at: '2026-11-21T06:10:00.000Z',
  },
  trainer: {
    trainer_id: '33333333-3333-4333-8333-333333333333',
    trainer_code: 'TR-1',
    display_name: 'Synthetic Trainer',
    status: 'ACTIVE',
    entity_code: 'SBX-08',
    centre_codes: ['NAG-01'],
    batch_codes: ['NAG-01-B3'],
    updated_at: '2026-11-21T00:00:00.000Z',
  },
};

export async function startFakeLmsReads(): Promise<FakeLmsReads> {
  const app = express();
  const state: FakeLmsReads = { url: '', calls: [], mode: 'ok', attendanceItems: {}, close: async () => undefined };

  app.use('/tenant/v1', (req: Request, res: Response, next) => {
    state.calls.push({ path: req.path, query: { ...req.query }, apiKey: req.header('x-api-key') });
    res.setHeader('Cache-Control', 'no-store');
    if (state.mode === 'down') {
      res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'down', request_id: 'fake-rq-503' } });
      return;
    }
    if (state.mode === 'slow') return; /* never answers; the client times out */
    if (state.mode === 'drop') {
      req.socket.destroy();
      return;
    }
    if (req.header('x-api-key') !== FAKE_LMS_KEY) {
      res.status(401).json({ error: { code: 'EXTERNAL_KEY_INVALID', message: 'Invalid key', request_id: 'fake-rq-401' } });
      return;
    }
    next();
  });

  const r = express.Router();
  r.get('/summary', (req, res) => {
    if (req.query.entity_code && req.query.entity_code !== 'SBX-08') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown entity', request_id: 'fake-rq-404' } });
      return;
    }
    res.json(FAKE_DATA.summary);
  });
  r.get('/centres', (req, res) => res.json(page([FAKE_DATA.centre], req)));
  r.get('/batches', (req, res) => res.json(page(state.batchItems ?? [FAKE_DATA.batch], req)));
  r.get('/sessions', (req, res) => res.json(page([FAKE_DATA.session], req)));
  r.get('/trainers', (req, res) => res.json(page([FAKE_DATA.trainer], req)));
  r.get('/live-sessions', (req, res) =>
    res.json({
      as_of: '2026-11-21T05:00:00.000Z',
      date: String(req.query.date ?? '2026-11-21'),
      items: [
        {
          session_id: FAKE_DATA.session.session_id,
          lms_entity_id: '44444444-4444-4444-8444-444444444444',
          batch_code: 'NAG-01-B3',
          centre_code: 'NAG-01',
          delivery_mode: 'OFFLINE',
          trainer_code: 'TR-1',
          trainer_name: 'Synthetic Trainer',
          topic: 'Synthetic lesson',
          starts_at: '2026-11-21T04:00:00.000Z',
          ends_at: '2026-11-21T06:00:00.000Z',
          status: 'SCHEDULED',
          in_progress: true,
          enrolled: 25,
          present: 20,
          late: 2,
        },
      ],
    }),
  );
  r.get('/attendance', (req, res) =>
    res.json({
      group_by: String(req.query.group_by ?? 'district'),
      date_from: String(req.query.date_from ?? '2026-10-22'),
      date_to: String(req.query.date_to ?? '2026-11-21'),
      items: state.attendanceItems[String(req.query.group_by ?? 'district')] ?? [
        {
          code: 'NAG',
          batches: 1,
          sessions_held: 4,
          present: 80,
          late: 5,
          absent: 10,
          excused: 0,
          self_check_ins: 0,
          geo_check_ins: 0,
          selfies: 0,
          group_photos: 4,
        },
      ],
    }),
  );
  app.use('/tenant/v1', r);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  state.url = `http://127.0.0.1:${port}`;
  state.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return state;
}
