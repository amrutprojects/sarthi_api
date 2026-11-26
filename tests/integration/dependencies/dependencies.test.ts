import { randomUUID } from 'crypto';
import type { Express } from 'express';
import { assertNoDependencies, dependencyKinds, findDependencies } from '../../../src/shared/dependencies/dependencies';
import { divisionalOfficer, restoreLink, seedDistricts, signedIn, submit, switchLink, wireApplication, wireBatch } from '../../helpers/ipp';
import {
  actorWith,
  API,
  AppDataSource,
  auth,
  createRoleWith,
  createUser,
  request,
  setupTestApp,
  superAdmin,
  teardownTestApp,
  type TestActor,
} from '../../helpers/test-app';

/*
 * The delete-dependency rule across the application (src/shared/dependencies): every kind of record is registered and
 * its checks run against the real schema; a user who decided candidate forms cannot be deleted (the COEP example);
 * GET /dependencies/:kind/:id answers the delete dialog; roles and districts are refused while used.
 */
let app: Express;
let admin: TestActor;
let districts: Record<'PUN' | 'NAS' | 'THA', string>;

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
  districts = await seedDistricts();
  switchLink(true);
});
afterAll(async () => {
  restoreLink();
  await teardownTestApp();
});

const check = (kind: string, id: string, token = admin.token) => request(app).get(`${API}/dependencies/${kind}/${id}`).set(auth(token));
const approve = (who: TestActor, id: string) =>
  request(app).post(`${API}/ipp-approvals/applications/${id}/approve`).set(auth(who.token)).send({ reason: 'Documents match the originals' });
const reject = (who: TestActor, id: string) =>
  request(app).post(`${API}/ipp-approvals/applications/${id}/reject`).set(auth(who.token)).send({ reason: 'The photo is not clear' });

/* Every delete of the application; a new delete registers its kind and is added here. */
const KINDS = [
  'user', 'role', 'permission', 'student',
  'region', 'caste', 'document-type', 'education',
  'department', 'college', 'centre', 'centre-type', 'training-centre', 'centre-location', 'centre-infrastructure',
  'batch', 'batch-assignment', 'document',
  'lms-entity', 'lms-course', 'lms-course-module', 'lms-calendar', 'lms-track-variant', 'lms-form-field',
  'lms-track-variant-phases', 'lms-track-variant-track-modules', 'lms-track-variant-learning-components',
  'lms-track-variant-oft-cards', 'lms-track-variant-assessment-components', 'lms-track-variant-readiness-gates',
  'state', 'district', 'taluka',
  'about-fact', 'about-card', 'advisory-member', 'advisory-group', 'announcement', 'apply-item', 'board-member',
  'contact-coordinator', 'contact-district-office', 'contact-training-centre', 'ecosystem-programme', 'eligibility-item',
  'faq', 'impact-stat', 'live-dashboard-card', 'live-dashboard-stat', 'quick-action', 'scheme', 'top-bar-link',
]; // prettier-ignore

describe('every kind of record', () => {
  it('is registered once, with a delete permission that exists', async () => {
    expect(dependencyKinds().map((k) => k.kind).sort()).toEqual([...KINDS].sort());
    const codes = new Set(((await AppDataSource.query(`SELECT "code" FROM "permissions"`)) as { code: string }[]).map((r) => r.code));
    for (const k of dependencyKinds()) for (const p of [k.permission].flat()) expect([k.kind, codes.has(p)]).toEqual([k.kind, true]);
  });

  it('runs its lock and every rule against the schema (tables, columns and JSON keys exist)', async () => {
    for (const def of dependencyKinds()) {
      await AppDataSource.transaction(async (m) => {
        await expect(assertNoDependencies(def, randomUUID(), m)).resolves.toBeUndefined();
      });
      expect(await findDependencies(def, randomUUID())).toEqual([]);
    }
  });
});

describe('a user who decided candidate forms (the COEP example)', () => {
  it('cannot be deleted; the dialog check and the delete say why; nothing is changed', async () => {
    const pune = await divisionalOfficer([districts.PUN], 'Officer Pune');
    const coep = await signedIn(['COEP'], 'Officer COEP');
    const [first, second] = await submit(app, wireBatch(), [wireApplication(), wireApplication()]);
    expect((await approve(pune, first)).status).toBe(200);
    expect((await approve(coep, first)).status).toBe(200);
    expect((await reject(pune, second)).status).toBe(200);

    const coepMessage =
      'Unable to delete this user because they are associated with existing candidate application approvals (1). ' +
      'This user cannot be deleted while these dependencies exist. Deactivate the account instead.';
    const asked = await check('user', coep.user.id);
    expect(asked.status).toBe(200);
    expect(asked.body.data).toEqual({
      kind: 'user',
      id: coep.user.id,
      deletable: false,
      message: coepMessage,
      dependencies: [{ label: 'candidate application approvals', count: 1 }],
    });
    const del = await request(app).delete(`${API}/users/${coep.user.id}`).set(auth(admin.token));
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('HAS_DEPENDENCIES');
    expect(del.body.message).toBe(coepMessage);
    expect((await request(app).get(`${API}/users/${coep.user.id}`).set(auth(admin.token))).status).toBe(200);

    /* The Divisional Officer: an approval, a rejection, and the district they are mapped to. */
    const officer = await check('user', pune.user.id);
    expect(officer.body.data.dependencies).toEqual([
      { label: 'candidate application approvals', count: 1 },
      { label: 'candidate application rejections', count: 1 },
      { label: 'Divisional Officer district mappings', count: 1 },
    ]);
    expect(officer.body.data.message).toContain(
      'associated with existing candidate application approvals (1), candidate application rejections (1) and Divisional Officer district mappings (1).',
    );
    expect((await request(app).delete(`${API}/users/${pune.user.id}`).set(auth(admin.token))).status).toBe(409);
  });

  it('a COEP officer who decided nothing is deleted as before', async () => {
    const unused = await createUser({ roleCodes: ['COEP'] });
    expect((await check('user', unused.id)).body.data).toEqual({ kind: 'user', id: unused.id, deletable: true, message: null, dependencies: [] });
    expect((await request(app).delete(`${API}/users/${unused.id}`).set(auth(admin.token))).status).toBe(200);
  });
});

describe('GET /dependencies/:kind/:id', () => {
  it('needs a session and the delete permission of that kind', async () => {
    const id = randomUUID();
    expect((await request(app).get(`${API}/dependencies/user/${id}`)).status).toBe(401);
    const viewer = await actorWith(['users.view']);
    const denied = await check('user', id, viewer.token);
    expect(denied.status).toBe(403);
    const deleter = await actorWith(['users.delete']);
    expect((await check('user', id, deleter.token)).body.data.deletable).toBe(true);
    /* The user-delete permission says nothing about districts. */
    expect((await check('district', districts.THA, deleter.token)).status).toBe(403);
  });

  it('answers 404 for an unknown kind and 422 for an id that is not a uuid', async () => {
    expect((await check('spaceship', randomUUID())).status).toBe(404);
    expect((await check('user', 'not-a-uuid')).status).toBe(422);
  });
});

describe('roles and districts', () => {
  it('a role held by a live user cannot be deleted; held only by a deleted user, it can', async () => {
    const role = await createRoleWith(['users.view']);
    const holder = await createUser({ roleCodes: [role.code] });
    const del = await request(app).delete(`${API}/roles/${role.id}`).set(auth(admin.token));
    expect(del.status).toBe(409);
    expect(del.body.message).toBe(
      'Unable to delete this role because it is associated with existing user role assignments (1). ' +
        'This role cannot be deleted while these dependencies exist. Remove the role from those users first.',
    );
    expect((await request(app).delete(`${API}/users/${holder.id}`).set(auth(admin.token))).status).toBe(200);
    expect((await check('role', role.id)).body.data.deletable).toBe(true);
    expect((await request(app).delete(`${API}/roles/${role.id}`).set(auth(admin.token))).status).toBe(200);
  });

  it('a district with IPP batches and a Divisional Officer is refused; an unused district is deleted', async () => {
    const del = await request(app).delete(`${API}/cms/districts/${districts.PUN}`).set(auth(admin.token));
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('HAS_DEPENDENCIES');
    expect(del.body.message).toContain('IPP candidate batches (1)');
    expect(del.body.message).toContain('Divisional Officer district mappings (1)');
    expect((await request(app).delete(`${API}/cms/districts/${districts.THA}`).set(auth(admin.token))).status).toBe(200);
  });
});
