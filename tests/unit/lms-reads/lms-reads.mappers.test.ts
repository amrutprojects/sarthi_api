import {
  camelizeKeys,
  mapAttendance,
  mapBatch,
  mapCentre,
  mapDistrict,
  mapLiveSessions,
  mapSession,
  mapSummary,
  mapTrainer,
  mapTrack,
  readPage,
  toMeta,
} from '../../../src/modules/lms-reads/lms-reads.mappers';

/* Synthetic LMS answers in the /tenant/v1 wire shapes (lms-api docs/openapi/tenant-v1.json). */
describe('lms-reads mappers', () => {
  it('camelizes nested keys and keeps values', () => {
    expect(camelizeKeys({ learners_active: 3, by_centre: [{ centre_code: 'C1', attendance_percent: null }] })).toEqual({
      learnersActive: 3,
      byCentre: [{ centreCode: 'C1', attendancePercent: null }],
    });
  });

  it('maps LMS paging to the Panel meta', () => {
    const p = readPage({ items: [1, 2], page: 2, page_size: 10, total: 21 });
    expect(p).toEqual({ items: [1, 2], page: 2, pageSize: 10, total: 21 });
    expect(toMeta(p)).toEqual({ page: 2, limit: 10, total: 21, totalPages: 3 });
    expect(toMeta(readPage({}))).toEqual({ page: 1, limit: 1, total: 0, totalPages: 1 });
  });

  it('maps the summary', () => {
    const s = mapSummary({
      tenant: { tenant_code: 'AMRUT', name: 'Amrut' },
      entity: null,
      entities: [{ entity_code: 'E1', name: 'Entity 1' }, { name: 'no code' }],
      generated_at: '2026-11-21T07:00:00.000Z',
      learners: { total: 10, by_status: { ACTIVE: 8 } },
      batches: { total: 2 },
      centres_active: 3,
      trainers_active: 4,
      attendance: { sessions_scheduled: 5, records_marked: 40, attended: 30, attendance_percent: 75 },
      outcomes: { certificates_issued: 1 },
      by_centre: [{ centre_code: 'C1', learners: 5 }],
      by_track: [],
      by_batch: [{ batch_code: 'B1' }],
      extra_new_field: true,
    });
    expect(s).toEqual({
      tenant: { code: 'AMRUT', name: 'Amrut' },
      entity: null,
      entities: [{ code: 'E1', name: 'Entity 1' }],
      generatedAt: '2026-11-21T07:00:00.000Z',
      learners: { total: 10, byStatus: { ACTIVE: 8 } },
      batches: { total: 2 },
      centresActive: 3,
      trainersActive: 4,
      attendance: { sessionsScheduled: 5, recordsMarked: 40, attended: 30, attendancePercent: 75 },
      outcomes: { certificatesIssued: 1 },
      byCentre: [{ centreCode: 'C1', learners: 5 }],
      byTrack: [],
      byBatch: [{ batchCode: 'B1' }],
    });
  });

  it('tolerates an empty summary', () => {
    expect(mapSummary(null)).toMatchObject({ tenant: null, entities: [], centresActive: 0, attendance: { attendancePercent: null } });
  });

  it('maps a centre with the /lms/reference/centres field names', () => {
    expect(
      mapCentre({
        centre_code: 'NAG-01',
        name: 'Nagpur Centre',
        district_code: 'NAG',
        district_name: 'Nagpur',
        centre_type: 'ITI',
        status: 'ACTIVE',
        updated_at: '2026-11-20T00:00:00.000Z',
      }),
    ).toEqual({
      code: 'NAG-01',
      name: 'Nagpur Centre',
      districtCode: 'NAG',
      districtName: 'Nagpur',
      centreTypeName: 'ITI',
      status: 'ACTIVE',
      isActive: true,
      sourceUpdatedAt: '2026-11-20T00:00:00.000Z',
      entityCode: null,
      taluka: null,
      readinessStatus: null,
      maxSeating: null,
      computerSystems: null,
      tracksOffered: [],
      divisionCode: null,
      divisionName: null,
    });
    expect(mapCentre({ status: 'INACTIVE' }).isActive).toBe(false);
  });

  it('maps the entity-owned centre fields (ERD-1), null-safe', () => {
    expect(
      mapCentre({
        centre_code: 'NAG-01',
        entity_code: 'E1',
        taluka: 'Nagpur Urban',
        readiness_status: 'READY',
        max_seating: 40,
        computer_systems: 20,
        tracks_offered: ['T01', 7, 'T03'],
        division_code: 'NGP',
        division_name: 'Nagpur Division',
      }),
    ).toMatchObject({
      entityCode: 'E1',
      taluka: 'Nagpur Urban',
      readinessStatus: 'READY',
      maxSeating: 40,
      computerSystems: 20,
      tracksOffered: ['T01', 'T03'],
      divisionCode: 'NGP',
      divisionName: 'Nagpur Division',
    });
    expect(mapCentre({ max_seating: '40', tracks_offered: 'T01' })).toMatchObject({ maxSeating: null, tracksOffered: [] });
  });

  it('maps an entity-owned track', () => {
    expect(
      mapTrack({
        entity_code: 'E1',
        track_code: 'T03',
        name: 'Track three',
        name_mr: 'ट्रॅक तीन',
        sort_order: 3,
        status: 'ACTIVE',
        updated_at: '2026-11-23T00:00:00.000Z',
      }),
    ).toEqual({
      entityCode: 'E1',
      code: 'T03',
      name: 'Track three',
      nameMr: 'ट्रॅक तीन',
      sortOrder: 3,
      status: 'ACTIVE',
      isActive: true,
      updatedAt: '2026-11-23T00:00:00.000Z',
    });
    expect(mapTrack(null)).toEqual({
      entityCode: '',
      code: '',
      name: '',
      nameMr: null,
      sortOrder: null,
      status: '',
      isActive: false,
      updatedAt: null,
    });
  });

  it('maps an entity-owned district with its division', () => {
    expect(
      mapDistrict({
        entity_code: 'E1',
        district_code: 'NAG',
        name_en: 'Nagpur',
        name_mr: 'नागपूर',
        division_code: 'NGP',
        division_name: 'Nagpur Division',
        status: 'ACTIVE',
        updated_at: '2026-11-23T00:00:00.000Z',
      }),
    ).toEqual({
      entityCode: 'E1',
      code: 'NAG',
      nameEn: 'Nagpur',
      nameMr: 'नागपूर',
      divisionCode: 'NGP',
      divisionName: 'Nagpur Division',
      status: 'ACTIVE',
      isActive: true,
      updatedAt: '2026-11-23T00:00:00.000Z',
    });
    expect(mapDistrict({ status: 'INACTIVE' })).toMatchObject({ code: '', nameEn: '', divisionCode: null, isActive: false });
  });

  it('maps a batch', () => {
    expect(
      mapBatch({
        batch_id: 'b-1',
        batch_code: 'NAG-01-B3',
        entity_code: 'E1',
        course_code: 'AK-2026',
        centre_code: 'NAG-01',
        centre_name: 'Nagpur Centre',
        track_code: 'T03',
        start_date: '2026-12-01',
        end_date: null,
        delivery_mode: 'OFFLINE',
        status: 'ACTIVE',
        capacity: 30,
        learners_enrolled: 25,
        learners_active: 24,
        learners_completed: 0,
        learners_withdrawn: 1,
        updated_at: '2026-11-21T00:00:00.000Z',
      }),
    ).toEqual({
      id: 'b-1',
      code: 'NAG-01-B3',
      entityCode: 'E1',
      courseCode: 'AK-2026',
      centreCode: 'NAG-01',
      centreName: 'Nagpur Centre',
      trackCode: 'T03',
      startDate: '2026-12-01',
      endDate: null,
      deliveryMode: 'OFFLINE',
      status: 'ACTIVE',
      capacity: 30,
      learnersEnrolled: 25,
      learnersActive: 24,
      learnersCompleted: 0,
      learnersWithdrawn: 1,
      updatedAt: '2026-11-21T00:00:00.000Z',
    });
    expect(mapBatch({ capacity: 'x', learners_enrolled: 'y' })).toMatchObject({ capacity: null, learnersEnrolled: 0, code: '' });
  });

  it('maps a class session with its attendance counts', () => {
    expect(
      mapSession({
        session_id: 's-1',
        batch_code: 'B1',
        centre_code: 'C1',
        entity_code: 'E1',
        title: 'Intro',
        module_no: 1,
        starts_at: '2026-11-21T04:00:00.000Z',
        ends_at: '2026-11-21T06:00:00.000Z',
        delivery_mode: 'ONLINE',
        attendance_mode: 'SELF',
        status: 'HELD',
        trainer_code: 'TR-1',
        attendance_present: 20,
        attendance_late: 2,
        attendance_absent: 3,
        attendance_excused: 1,
        updated_at: '2026-11-21T06:10:00.000Z',
      }),
    ).toMatchObject({ id: 's-1', moduleNo: 1, attendance: { present: 20, late: 2, absent: 3, excused: 1 }, trainerCode: 'TR-1' });
  });

  it('maps the live sessions of a day (API-110)', () => {
    const r = mapLiveSessions({
      as_of: '2026-11-21T05:00:00.000Z',
      date: '2026-11-21',
      items: [
        {
          session_id: 's-1',
          lms_entity_id: 'internal-id',
          batch_code: 'B1',
          centre_code: 'C1',
          delivery_mode: 'OFFLINE',
          trainer_code: 'TR-1',
          trainer_name: 'Trainer One',
          topic: 'Lesson 1',
          starts_at: '2026-11-21T04:00:00.000Z',
          ends_at: '2026-11-21T06:00:00.000Z',
          status: 'SCHEDULED',
          in_progress: true,
          enrolled: 25,
          present: 20,
          late: 1,
        },
      ],
    });
    expect(r.asOf).toBe('2026-11-21T05:00:00.000Z');
    expect(r.items[0]).toEqual({
      id: 's-1',
      batchCode: 'B1',
      centreCode: 'C1',
      deliveryMode: 'OFFLINE',
      trainerCode: 'TR-1',
      trainerName: 'Trainer One',
      topic: 'Lesson 1',
      startsAt: '2026-11-21T04:00:00.000Z',
      endsAt: '2026-11-21T06:00:00.000Z',
      status: 'SCHEDULED',
      inProgress: true,
      enrolled: 25,
      present: 20,
      late: 1,
    });
  });

  it('maps a trainer without personal contact fields', () => {
    const t = mapTrainer({
      trainer_id: 't-1',
      trainer_code: 'TR-1',
      display_name: 'Trainer One',
      status: 'ACTIVE',
      entity_code: 'E1',
      centre_codes: ['C1', 5],
      batch_codes: ['B1'],
      updated_at: null,
      phone: '9999999999',
    });
    expect(t).toEqual({
      id: 't-1',
      code: 'TR-1',
      displayName: 'Trainer One',
      status: 'ACTIVE',
      entityCode: 'E1',
      centreCodes: ['C1'],
      batchCodes: ['B1'],
      updatedAt: null,
    });
  });

  it('maps attendance counts', () => {
    expect(
      mapAttendance({
        group_by: 'centre',
        date_from: '2026-10-22',
        date_to: '2026-11-21',
        items: [
          {
            code: 'C1',
            batches: 2,
            sessions_held: 10,
            present: 80,
            late: 5,
            absent: 10,
            excused: 2,
            self_check_ins: 40,
            geo_check_ins: 30,
            selfies: 20,
            group_photos: 4,
          },
        ],
      }),
    ).toEqual({
      groupBy: 'centre',
      dateFrom: '2026-10-22',
      dateTo: '2026-11-21',
      items: [
        {
          code: 'C1',
          batches: 2,
          sessionsHeld: 10,
          present: 80,
          late: 5,
          absent: 10,
          excused: 2,
          selfCheckIns: 40,
          geoCheckIns: 30,
          selfies: 20,
          groupPhotos: 4,
        },
      ],
    });
  });
});
