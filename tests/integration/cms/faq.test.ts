import type { Express } from 'express';
import { API, actorWith, auth, request, setupTestApp, superAdmin, teardownTestApp, type TestActor } from '../../helpers/test-app';
import { MISSING_ID, VIEW_ONLY_CODES } from '../../cms/helpers';

let app: Express;
let admin: TestActor;
let viewer: TestActor;

const FAQ_CODES = ['cms-faqs.view', 'cms-faqs.create', 'cms-faqs.update', 'cms-faqs.delete'];

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
  viewer = await actorWith(['cms-faqs.view']);
});
afterAll(teardownTestApp);

let seq = 0;
/* A question unique to this run, so tests never collide with each other or with the seeded rows. */
const body = (extra: Record<string, unknown> = {}) => {
  seq += 1;
  return {
    question: { mr: `चाचणी प्रश्न ${seq}?`, en: `Test question ${seq}?` },
    answer: { mr: `चाचणी उत्तर ${seq}.`, en: `Test answer ${seq}.` },
    ...extra,
  };
};

async function makeFaq(extra: Record<string, unknown> = {}) {
  const res = await request(app).post(`${API}/cms/faqs`).set(auth(admin.token)).send(body(extra));
  if (res.status !== 201) throw new Error(`makeFaq failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.data as { id: string; question: { en: string }; displayOrder: number; isActive: boolean };
}

const publicQuestions = async (): Promise<string[]> => {
  const res = await request(app).get(`${API}/public/faqs`);
  expect(res.status).toBe(200);
  return (res.body.data as { question: { en: string } }[]).map((f) => f.question.en);
};

describe('seeded content', () => {
  it('serves the seven questions the website showed before, in order, without auth', async () => {
    const res = await request(app).get(`${API}/public/faqs`);
    expect(res.status).toBe(200);
    expect(res.body.data.slice(0, 7).map((f: { question: { en: string } }) => f.question.en)).toEqual([
      'What is Sarthi?',
      'How long does the programme take?',
      'What does it cost?',
      'What is the difference between offline and online training?',
      'What is the minimum attendance?',
      'How can a certificate be verified?',
      'Which domains can I choose in Module 3?',
    ]);
    expect(res.body.data[0]).toEqual({
      question: { mr: 'सारथी म्हणजे काय?', en: 'What is Sarthi?' },
      answer: expect.objectContaining({ mr: expect.any(String), en: expect.any(String) }),
    });
  });
});

describe('FAQ Management CRUD', () => {
  it('creates a FAQ at the end of the list, then gets and lists it', async () => {
    const res = await request(app).post(`${API}/cms/faqs`).set(auth(admin.token)).send(body());
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ isActive: true, question: { en: expect.stringMatching(/^Test question/) } });
    expect(res.body.data.displayOrder).toBeGreaterThanOrEqual(8);

    const detail = await request(app).get(`${API}/cms/faqs/${res.body.data.id}`).set(auth(admin.token));
    expect(detail.status).toBe(200);
    expect(detail.body.data.id).toBe(res.body.data.id);

    const list = await request(app).get(`${API}/cms/faqs`).query({ search: res.body.data.question.en }).set(auth(admin.token));
    expect(list.status).toBe(200);
    expect(list.body.data.map((f: { id: string }) => f.id)).toEqual([res.body.data.id]);
    expect(list.body.meta).toMatchObject({ page: 1, total: 1 });
  });

  it('updates the question, answer and order through PATCH and PUT', async () => {
    const faq = await makeFaq();
    const patched = await request(app)
      .patch(`${API}/cms/faqs/${faq.id}`)
      .set(auth(admin.token))
      .send({ answer: { mr: 'नवीन उत्तर', en: 'New answer' }, displayOrder: 0 });
    expect(patched.status).toBe(200);
    expect(patched.body.data).toMatchObject({ answer: { mr: 'नवीन उत्तर', en: 'New answer' }, displayOrder: 0 });

    const put = await request(app)
      .put(`${API}/cms/faqs/${faq.id}`)
      .set(auth(admin.token))
      .send({ question: { mr: 'बदललेला प्रश्न?', en: 'Renamed question?' } });
    expect(put.status).toBe(200);
    expect(put.body.data.question).toEqual({ mr: 'बदललेला प्रश्न?', en: 'Renamed question?' });

    /* Order 0 puts it ahead of every seeded question on the website. */
    expect((await publicQuestions())[0]).toBe('Renamed question?');
    await request(app).delete(`${API}/cms/faqs/${faq.id}`).set(auth(admin.token));
  });

  it('never assigns an order past the 9999 the edit form accepts', async () => {
    const last = await makeFaq({ displayOrder: 9999 });
    const next = await makeFaq();
    expect(next.displayOrder).toBe(9999);

    /* The row stays editable: its own order passes the update validator. */
    const edited = await request(app)
      .patch(`${API}/cms/faqs/${next.id}`)
      .set(auth(admin.token))
      .send({ answer: { mr: 'संपादित उत्तर', en: 'Edited answer' }, displayOrder: next.displayOrder });
    expect(edited.status).toBe(200);

    for (const row of [last, next]) await request(app).delete(`${API}/cms/faqs/${row.id}`).set(auth(admin.token));
  });

  it('hides a deactivated FAQ from the website and shows it again when activated', async () => {
    const faq = await makeFaq();
    expect(await publicQuestions()).toContain(faq.question.en);

    const off = await request(app).patch(`${API}/cms/faqs/${faq.id}/status`).set(auth(admin.token)).send({ isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.data.isActive).toBe(false);
    expect(await publicQuestions()).not.toContain(faq.question.en);

    await request(app).patch(`${API}/cms/faqs/${faq.id}/status`).set(auth(admin.token)).send({ isActive: true });
    expect(await publicQuestions()).toContain(faq.question.en);
  });

  it('soft-deletes a FAQ, then restores it inactive', async () => {
    const faq = await makeFaq();
    const del = await request(app).delete(`${API}/cms/faqs/${faq.id}`).set(auth(admin.token));
    expect(del.status).toBe(200);
    expect((await request(app).get(`${API}/cms/faqs/${faq.id}`).set(auth(admin.token))).status).toBe(404);
    expect(await publicQuestions()).not.toContain(faq.question.en);

    const restored = await request(app).post(`${API}/cms/faqs/${faq.id}/restore`).set(auth(admin.token));
    expect(restored.status).toBe(200);
    expect(restored.body.data.isActive).toBe(false);
  });

  it('rejects the same question twice, case-insensitively, in either language (409)', async () => {
    const first = body();
    expect((await request(app).post(`${API}/cms/faqs`).set(auth(admin.token)).send(first)).status).toBe(201);
    const sameEn = { ...body(), question: { mr: 'वेगळा प्रश्न?', en: first.question.en.toUpperCase() } };
    expect((await request(app).post(`${API}/cms/faqs`).set(auth(admin.token)).send(sameEn)).status).toBe(409);
    const sameMr = { ...body(), question: { mr: first.question.mr, en: 'A different question?' } };
    expect((await request(app).post(`${API}/cms/faqs`).set(auth(admin.token)).send(sameMr)).status).toBe(409);
  });

  it('rejects missing halves, overlong text, a negative order, unknown fields and an empty update (422)', async () => {
    const cases = [
      { ...body(), question: { mr: '', en: 'Only English?' } },
      { ...body(), answer: { mr: 'फक्त मराठी', en: '   ' } },
      { ...body(), question: { mr: 'प्रश्न?', en: 'x'.repeat(501) } },
      { ...body(), displayOrder: -1 },
      { ...body(), extra: true },
    ];
    for (const payload of cases) {
      expect((await request(app).post(`${API}/cms/faqs`).set(auth(admin.token)).send(payload)).status).toBe(422);
    }
    const faq = await makeFaq();
    expect((await request(app).patch(`${API}/cms/faqs/${faq.id}`).set(auth(admin.token)).send({})).status).toBe(422);
  });

  it('answers 404 for an unknown id', async () => {
    expect((await request(app).get(`${API}/cms/faqs/${MISSING_ID}`).set(auth(admin.token))).status).toBe(404);
    expect((await request(app).delete(`${API}/cms/faqs/${MISSING_ID}`).set(auth(admin.token))).status).toBe(404);
  });
});

describe('FAQ Management permissions', () => {
  it('needs a session for every admin route', async () => {
    expect((await request(app).get(`${API}/cms/faqs`)).status).toBe(401);
  });

  it('lets a view-only user read but not write', async () => {
    expect((await request(app).get(`${API}/cms/faqs`).set(auth(viewer.token))).status).toBe(200);
    expect((await request(app).post(`${API}/cms/faqs`).set(auth(viewer.token)).send(body())).status).toBe(403);
  });

  it('refuses a user without any FAQ permission', async () => {
    const outsider = await actorWith(VIEW_ONLY_CODES);
    expect((await request(app).get(`${API}/cms/faqs`).set(auth(outsider.token))).status).toBe(403);
  });

  it('accepts a user holding exactly the FAQ codes', async () => {
    const editor = await actorWith(FAQ_CODES);
    expect((await request(app).post(`${API}/cms/faqs`).set(auth(editor.token)).send(body())).status).toBe(201);
  });
});
