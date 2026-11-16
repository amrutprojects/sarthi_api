import type { Express } from 'express';
import { AppDataSource } from '../../src/config/database.config';
import { HTTP_STATUS } from '../../src/constants/api-response.constants';
import { AuditLog } from '../../src/database/entities';
import { MASTER_LIST, masterPermission, type MasterDefinition } from '../../src/modules/masters';
import { CASTE_LIST } from '../../src/modules/students/student.constants';
import { API, actorWith, request, resetData, setupTestApp, teardownTestApp } from '../helpers/test-app';

let app: Express;
beforeAll(async () => {
  app = await setupTestApp();
});
beforeEach(resetData);
afterAll(teardownTestApp);

let seq = 0;
/* Masters are not truncated between tests, so every value is unique to this run. */
const unique = () => `${Date.now().toString(36).slice(-5)}${++seq}`.toUpperCase();
const allCodes = (d: MasterDefinition) => (['view', 'create', 'update', 'status', 'delete'] as const).map((a) => masterPermission(d, a));

describe.each(MASTER_LIST)('$plural master (/$path)', (d) => {
  const URL = `${API}/${d.path}`;
  const auth = async (codes = allCodes(d)) => `Bearer ${(await actorWith(codes)).token}`;
  const payload = (over: Record<string, unknown> = {}) => {
    const u = unique();
    return { code: `T${u}`.slice(0, d.codeMax), name: `Test ${d.label} ${u}`, description: 'For tests', ...over };
  };

  it('creates, lists with paging / search / status filter / sort, gets and edits a record', async () => {
    const token = await auth();
    const created = await request(app)
      .post(URL)
      .set('Authorization', token)
      .send(payload({ code: ` t${unique()} `.slice(0, d.codeMax), ...(d.hasMandatory ? { isMandatory: true } : {}) }));
    expect(created.status).toBe(HTTP_STATUS.CREATED);
    expect(created.body).toMatchObject({ success: true, status: 201, data: { isActive: true, description: 'For tests' } });
    expect(created.body.data.code).toBe(created.body.data.code.toUpperCase());
    if (d.hasMandatory) expect(created.body.data.isMandatory).toBe(true);
    const id = created.body.data.id as string;

    const list = await request(app)
      .get(URL)
      .query({ page: 1, limit: 5, search: created.body.data.name, isActive: 'true', sortBy: 'name', sortOrder: 'asc' })
      .set('Authorization', token);
    expect(list.status).toBe(HTTP_STATUS.OK);
    expect(list.body.data.map((r: { id: string }) => r.id)).toEqual([id]);
    expect(list.body.meta).toMatchObject({ page: 1, limit: 5, total: 1, totalPages: 1 });

    const got = await request(app).get(`${URL}/${id}`).set('Authorization', token);
    expect(got.body.data).toMatchObject({ id, name: created.body.data.name });

    const edited = await request(app).patch(`${URL}/${id}`).set('Authorization', token).send({ name: `${created.body.data.name} edited` });
    expect(edited.status).toBe(HTTP_STATUS.OK);
    expect(edited.body.data.name).toMatch(/edited$/);

    const actions = (await AppDataSource.getRepository(AuditLog).find({ where: { resourceId: id } })).map((a) => a.action).sort();
    expect(actions).toEqual([`${d.audit}.create`, `${d.audit}.update`]);
  });

  it('activates / deactivates; editing never reactivates; options list only active, non-deleted records', async () => {
    const token = await auth();
    const { id, name } = (await request(app).post(URL).set('Authorization', token).send(payload())).body.data;
    const off = await request(app).patch(`${URL}/${id}/status`).set('Authorization', token).send({ isActive: false });
    expect(off.body).toMatchObject({ status: 200, message: `${d.label} deactivated`, data: { isActive: false } });

    const edited = await request(app).patch(`${URL}/${id}`).set('Authorization', token).send({ description: 'changed' });
    expect(edited.body.data.isActive).toBe(false);
    expect((await request(app).patch(`${URL}/${id}`).set('Authorization', token).send({ isActive: true })).status).toBe(
      HTTP_STATUS.UNPROCESSABLE_ENTITY,
    );

    const options = async () => ((await request(app).get(`${URL}/options`)).body.data as { name: string }[]).map((o) => o.name);
    expect(await options()).not.toContain(name);
    await request(app).patch(`${URL}/${id}/status`).set('Authorization', token).send({ isActive: true });
    expect(await options()).toContain(name);
    await request(app).delete(`${URL}/${id}`).set('Authorization', token);
    expect(await options()).not.toContain(name);
  });

  it('soft-deletes; deleted codes and names stay reserved; duplicates are refused', async () => {
    const token = await auth();
    const body = payload();
    const { id } = (await request(app).post(URL).set('Authorization', token).send(body)).body.data;

    const dupName = await request(app)
      .post(URL)
      .set('Authorization', token)
      .send(payload({ name: body.name.toUpperCase() }));
    expect(dupName.status).toBe(HTTP_STATUS.CONFLICT);

    const del = await request(app).delete(`${URL}/${id}`).set('Authorization', token);
    expect(del.body).toMatchObject({ success: true, status: 200, data: null });
    expect((await request(app).get(`${URL}/${id}`).set('Authorization', token)).status).toBe(HTTP_STATUS.NOT_FOUND);
    const [row] = await AppDataSource.query(`SELECT "isDelete", "isActive" FROM "${d.table}" WHERE "id" = $1`, [id]);
    expect(row).toEqual({ isDelete: true, isActive: false });

    for (const again of [payload({ code: body.code }), payload({ name: body.name })]) {
      const res = await request(app).post(URL).set('Authorization', token).send(again);
      expect(res.status).toBe(HTTP_STATUS.CONFLICT);
      expect(res.body.message).toMatch(/deleted record/);
    }
  });

  it('enforces each permission and validates input', async () => {
    const viewer = await auth([masterPermission(d, 'view')]);
    expect((await request(app).get(URL).set('Authorization', viewer)).status).toBe(HTTP_STATUS.OK);
    expect((await request(app).post(URL).set('Authorization', viewer).send(payload())).status).toBe(HTTP_STATUS.FORBIDDEN);
    expect((await request(app).get(URL)).status).toBe(HTTP_STATUS.UNAUTHORIZED);

    const creator = await auth([masterPermission(d, 'create')]);
    const { id } = (await request(app).post(URL).set('Authorization', creator).send(payload())).body.data;
    expect((await request(app).patch(`${URL}/${id}/status`).set('Authorization', creator).send({ isActive: false })).status).toBe(
      HTTP_STATUS.FORBIDDEN,
    );
    expect((await request(app).delete(`${URL}/${id}`).set('Authorization', creator)).status).toBe(HTTP_STATUS.FORBIDDEN);

    const bad = await request(app)
      .post(URL)
      .set('Authorization', creator)
      .send({ code: 'bad code!', name: '', extra: 1 });
    expect(bad.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
  });
});

describe('masters referenced by students', () => {
  it('cannot delete a region or document type a student uses, nor change its code', async () => {
    const regions = MASTER_LIST.find((d) => d.key === 'region')!;
    const token = `Bearer ${(await actorWith(allCodes(regions))).token}`;
    const [pune] = await AppDataSource.query(`SELECT "id" FROM "regions" WHERE "code" = 'PUN'`);
    const [pan] = await AppDataSource.query(`SELECT "id" FROM "document_types" WHERE "code" = 'PAN_CARD'`);
    await AppDataSource.query(
      `INSERT INTO "students" ("code", "sourceChecksum", "firstName", "lastName", "fatherName", "motherName", "currentAddress",
         "religion", "caste", "centreCode", "regionId", "trackSourceValue", "educationQualification", "externalStatus", "source", "documents")
       VALUES ('REG-TEST01', repeat('0', 64), 'A', 'B', 'C', 'D', 'E', 'हिंदू', 'ब्राह्मण', 'PUN', $1, 'T03', 'B.Com', 'PENDING', 'PUBLIC_REGISTRATION',
         jsonb_build_object('PAN_CARD', jsonb_build_object('supplied', false, 'barcode', null, 'documentTypeId', $2::text)))`,
      [pune.id, pan.id],
    );
    const del = await request(app).delete(`${API}/regions/${pune.id}`).set('Authorization', token);
    expect(del.status).toBe(HTTP_STATUS.CONFLICT);
    const recode = await request(app).patch(`${API}/regions/${pune.id}`).set('Authorization', token).send({ code: 'PNQ' });
    expect(recode.status).toBe(HTTP_STATUS.CONFLICT);
    const rename = await request(app).patch(`${API}/regions/${pune.id}`).set('Authorization', token).send({ description: 'District HQ' });
    expect(rename.status).toBe(HTTP_STATUS.OK);
    const docAdmin = `Bearer ${(await actorWith(allCodes(MASTER_LIST.find((d) => d.key === 'documentType')!))).token}`;
    expect((await request(app).delete(`${API}/document-types/${pan.id}`).set('Authorization', docAdmin)).status).toBe(HTTP_STATUS.CONFLICT);
    await AppDataSource.query(`UPDATE "regions" SET "description" = NULL WHERE "id" = $1`, [pune.id]);
  });

  it('seeds PAN, Aadhaar and LC document types', async () => {
    const res = await request(app).get(`${API}/document-types/options`);
    const byCode = new Map((res.body.data as { code: string; isMandatory: boolean }[]).map((t) => [t.code, t]));
    expect(byCode.get('PAN_CARD')).toMatchObject({ isMandatory: false });
    expect(byCode.get('AADHAAR_CARD')).toMatchObject({ isMandatory: true });
    expect(byCode.get('SCHOOL_LEAVING')).toMatchObject({ isMandatory: true });
  });
});

describe('the caste master: the official target-group list', () => {
  const castes = MASTER_LIST.find((d) => d.key === 'caste')!;
  const URL = `${API}/castes`;
  type Option = { id: string; code: string; name: string; nameEn: string | null };
  const options = async () => (await request(app).get(`${URL}/options`)).body.data as Option[];

  it('lists the 26 castes first, in the official order and spelling, with English names', async () => {
    /* Castes other tests create go to the end of the list (the next display order), so the first 26 are the list. */
    const first = (await options()).slice(0, CASTE_LIST.length);
    expect(first.map((o) => o.name)).toEqual(CASTE_LIST.map((c) => c.name));
    expect(first.map((o) => o.nameEn)).toEqual(CASTE_LIST.map((c) => c.nameEn));
  });

  it('keeps the castes outside the list, and the earlier spellings, out of the options', async () => {
    const names = (await options()).map((o) => o.name);
    for (const gone of ['मराठी', 'ठाकूर', 'गुजराथी', 'लोहाणा', 'सेनगुप्तर', 'कोमटी/वैश्य', 'हिंदू वेरशैव लिंगायत']) {
      expect(names).not.toContain(gone);
    }
    /* Inactive, not deleted: a student registered with one keeps the link. */
    const [row] = await AppDataSource.query(`SELECT "isActive", "isDelete" FROM "castes" WHERE "name" = 'मराठी'`);
    expect(row).toEqual({ isActive: false, isDelete: false });
  });

  it('stores an English name and a display order; a caste without one goes to the end', async () => {
    const token = `Bearer ${(await actorWith(allCodes(castes))).token}`;
    const u = unique();
    const appended = await request(app)
      .post(URL)
      .set('Authorization', token)
      .send({ code: `T${u}`, name: `Test caste ${u}` });
    expect(appended.status).toBe(HTTP_STATUS.CREATED);
    expect(appended.body.data).toMatchObject({ nameEn: null });
    expect(appended.body.data.displayOrder).toBeGreaterThan(CASTE_LIST.length);
    expect((await options()).at(-1)?.id).toBe(appended.body.data.id);

    const edited = await request(app)
      .patch(`${URL}/${appended.body.data.id}`)
      .set('Authorization', token)
      .send({ nameEn: '  Test   caste  ', displayOrder: 9999 });
    expect(edited.status).toBe(HTTP_STATUS.OK);
    expect(edited.body.data).toMatchObject({ nameEn: 'Test caste', displayOrder: 9999 });

    const list = await request(app).get(URL).query({ sortBy: 'displayOrder', sortOrder: 'asc', limit: 1 }).set('Authorization', token);
    expect(list.status).toBe(HTTP_STATUS.OK);
    expect(list.body.data[0]).toMatchObject({ name: CASTE_LIST[0]!.name, displayOrder: 1 });

    expect(
      (await request(app).patch(`${URL}/${appended.body.data.id}`).set('Authorization', token).send({ displayOrder: -1 })).status,
    ).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    await request(app).delete(`${URL}/${appended.body.data.id}`).set('Authorization', token);
  });

  it('gives no other master an English name or a display order', async () => {
    const regions = MASTER_LIST.find((d) => d.key === 'region')!;
    const token = `Bearer ${(await actorWith(allCodes(regions))).token}`;
    const u = unique();
    const res = await request(app)
      .post(`${API}/regions`)
      .set('Authorization', token)
      .send({ code: `R${u}`.slice(0, 10), name: `Region ${u}`, nameEn: 'X' });
    expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect((await request(app).get(`${API}/regions`).query({ sortBy: 'displayOrder' }).set('Authorization', token)).status).toBe(
      HTTP_STATUS.UNPROCESSABLE_ENTITY,
    );
    const option = (await request(app).get(`${API}/regions/options`)).body.data[0];
    expect(option).not.toHaveProperty('nameEn');
  });
});
