import type { Express } from 'express';
import { API, actorWith, auth, request, setupTestApp, superAdmin, teardownTestApp, type TestActor } from '../../helpers/test-app';
import { MISSING_ID, VIEW_ONLY_CODES } from '../../cms/helpers';

let app: Express;
let admin: TestActor;
let viewer: TestActor;

const ELIGIBILITY_CODES = ['cms-eligibility.view', 'cms-eligibility.create', 'cms-eligibility.update', 'cms-eligibility.delete'];
const ITEMS = `${API}/cms/eligibility/items`;
const SETTINGS = `${API}/cms/eligibility/settings`;
const PUBLIC = `${API}/public/eligibility`;

/* The page text the website showed before the page became CMS-managed, as the migration seeds it. */
const SEEDED_TEXT = {
  pageTitle: { mr: 'पात्रता', en: 'Eligibility' },
  pageSubtitle: {
    mr: 'अमृत कलशसाठी पात्रता निकष व आवश्यक कागदपत्रे.',
    en: 'Eligibility criteria and required documents for AMRUT Kalash.',
  },
  criteriaHeading: { mr: 'पात्रता निकष', en: 'Eligibility criteria' },
  documentsHeading: { mr: 'आवश्यक कागदपत्रे', en: 'Required documents' },
  noteTitle: { mr: 'सूचना', en: 'Note' },
  noteBody: {
    mr: 'वरील निकष प्रसिद्ध योजना रचनेवर आधारित असून प्रात्यक्षिक आवृत्तीत ते बदलण्यायोग्य प्रणाली-मापदंड म्हणून ठेवले आहेत. अंतिम निकष अमृतच्या मान्यतेनुसार लागू होतील.',
    en: 'These criteria follow the published scheme structure and are held as configurable system parameters in this demo. Final criteria apply as approved by AMRUT.',
  },
  /* The seeded note is switched off by the EligibilityNoteSwitch migration: the website no longer shows it. */
  showNote: false,
};

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
  viewer = await actorWith(['cms-eligibility.view']);
});
afterAll(teardownTestApp);

let seq = 0;
/* A label unique to this run, so tests never collide with each other or with the seeded rows. */
const label = () => {
  seq += 1;
  return { mr: `चाचणी ${seq}`, en: `Test item ${seq}` };
};
const criterionBody = (extra: Record<string, unknown> = {}) => ({
  kind: 'CRITERION',
  label: label(),
  value: { mr: `चाचणी मूल्य ${seq}`, en: `Test value ${seq}` },
  ...extra,
});
const documentBody = (extra: Record<string, unknown> = {}) => ({ kind: 'DOCUMENT', label: label(), ...extra });

interface Item {
  id: string;
  kind: 'CRITERION' | 'DOCUMENT';
  label: { mr: string; en: string };
  value: { mr: string; en: string } | null;
  displayOrder: number;
  isActive: boolean;
}

async function makeItem(payload: Record<string, unknown>): Promise<Item> {
  const res = await request(app).post(ITEMS).set(auth(admin.token)).send(payload);
  if (res.status !== 201) throw new Error(`makeItem failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.data as Item;
}

const publicPage = async () => {
  const res = await request(app).get(PUBLIC);
  expect(res.status).toBe(200);
  return res.body.data as {
    criteria: { label: { en: string }; value: { en: string } }[];
    documents: { en: string }[];
  } & typeof SEEDED_TEXT;
};
const publicCriteria = async () => (await publicPage()).criteria.map((c) => c.label.en);
const publicDocuments = async () => (await publicPage()).documents.map((d) => d.en);

/* The highest display order among the live rows of one kind. */
const maxOrder = async (kind: string): Promise<number> => {
  const res = await request(app).get(ITEMS).query({ kind, sortBy: 'displayOrder', sortOrder: 'desc', limit: 1 }).set(auth(admin.token));
  return res.body.data[0].displayOrder as number;
};

describe('seeded content', () => {
  it('serves the page the website showed before, in order, without auth', async () => {
    const res = await request(app).get(PUBLIC);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      ...SEEDED_TEXT,
      criteria: [
        { label: { mr: 'वय', en: 'Age' }, value: { mr: '१८ ते ४५ वर्षे', en: '18 to 45 years' } },
        {
          label: { mr: 'शैक्षणिक पात्रता', en: 'Qualification' },
          value: { mr: '१२ वी उत्तीर्ण किंवा ३ वर्षांचा पदविका (पॉलिटेक्निक) उत्तीर्ण', en: '12th Pass or 3-year Polytechnic Diploma' },
        },
        {
          label: { mr: 'लक्षित गट', en: 'Target group' },
          value: {
            mr: 'खुल्या प्रवर्गातील आर्थिकदृष्ट्या दुर्बल घटक (अमृतचा लक्षित गट)',
            en: 'Economically Weaker Section from Open Category (AMRUT target group)',
          },
        },
        {
          label: { mr: 'कौटुंबिक उत्पन्न', en: 'Family income' },
          value: {
            mr: 'सर्व स्रोतांतून वार्षिक उत्पन्न रु. ८ लाखांपेक्षा कमी',
            en: 'Annual family income from all sources less than Rs. 8 Lakhs',
          },
        },
        {
          label: { mr: 'अधिवास', en: 'Domicile' },
          value: { mr: 'महाराष्ट्राचा अधिवास दाखला आवश्यक', en: 'Maharashtra Domicile Certificate required' },
        },
      ],
      documents: [
        { mr: 'आधार कार्ड', en: 'Aadhaar card' },
        { mr: 'महाराष्ट्र अधिवास दाखला', en: 'Maharashtra Domicile Certificate' },
        { mr: '१२ वी उत्तीर्ण / पदविका प्रमाणपत्र व गुणपत्रिका', en: '12th pass or Diploma certificate & marksheet' },
        { mr: 'जन्मतारीख व वयाचा पुरावा', en: 'Date of birth and age proof' },
        { mr: '१ वर्षाचा उत्पन्नाचा दाखला किंवा EWS प्रमाणपत्र', en: '1-year Income Certificate or EWS Certificate' },
        { mr: 'छायाचित्र व स्वाक्षरी', en: 'Photograph and signature' },
        { mr: 'जातीचा स्पष्ट उल्लेख असलेले शासकीय कागदपत्र', en: 'Government document clearly mentioning caste' },
      ],
    });
  });

  it('lists the seeded rows for the admin, criteria first, each kind in display order', async () => {
    const res = await request(app).get(ITEMS).query({ limit: 100 }).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ total: 12 });
    expect(res.body.data.map((i: Item) => [i.kind, i.displayOrder])).toEqual([
      ...[1, 2, 3, 4, 5].map((n) => ['CRITERION', n]),
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => ['DOCUMENT', n]),
    ]);
    expect(res.body.data[5]).toMatchObject({ kind: 'DOCUMENT', label: { en: 'Aadhaar card' }, value: null, isActive: true });
  });
});

describe('Eligibility page text', () => {
  it('reads the settings row and replaces it, which the website then shows', async () => {
    const res = await request(app).get(SETTINGS).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ ...SEEDED_TEXT, id: expect.any(String) });

    const changed = {
      ...SEEDED_TEXT,
      pageTitle: { mr: 'नवीन पात्रता', en: 'New eligibility' },
      noteBody: { mr: 'नवीन सूचना', en: 'New note' },
    };
    const put = await request(app).put(SETTINGS).set(auth(admin.token)).send(changed);
    expect(put.status).toBe(200);
    expect(put.body.data).toMatchObject({ ...changed, id: res.body.data.id });
    expect(await publicPage()).toMatchObject(changed);

    /* The note can be switched on and off; its text is kept either way. */
    const on = await request(app).put(SETTINGS).set(auth(admin.token)).send({ ...SEEDED_TEXT, showNote: true });
    expect(on.status).toBe(200);
    expect((await publicPage()).showNote).toBe(true);
    expect((await publicPage()).noteBody).toEqual(SEEDED_TEXT.noteBody);

    /* Put the seeded text back for the rest of the run. */
    expect((await request(app).put(SETTINGS).set(auth(admin.token)).send(SEEDED_TEXT)).status).toBe(200);
    expect(await publicPage()).toMatchObject(SEEDED_TEXT);
  });

  it('rejects a missing half, a missing pair, overlong text and unknown fields (422)', async () => {
    const cases = [
      { ...SEEDED_TEXT, noteBody: { mr: 'फक्त मराठी', en: '' } },
      { ...SEEDED_TEXT, pageTitle: { en: 'English only' } },
      { ...SEEDED_TEXT, noteTitle: undefined },
      { ...SEEDED_TEXT, showNote: undefined },
      { ...SEEDED_TEXT, showNote: 'yes' },
      { ...SEEDED_TEXT, pageSubtitle: { mr: 'उपशीर्षक', en: 'x'.repeat(501) } },
      { ...SEEDED_TEXT, extra: true },
    ];
    for (const payload of cases) {
      expect((await request(app).put(SETTINGS).set(auth(admin.token)).send(payload)).status).toBe(422);
    }
    const res = await request(app)
      .put(SETTINGS)
      .set(auth(admin.token))
      .send({ ...SEEDED_TEXT, noteBody: { mr: 'फक्त मराठी', en: '  ' } });
    expect(res.body.error.details).toEqual([expect.objectContaining({ field: 'body.noteBody.en' })]);
  });
});

describe('Eligibility items CRUD', () => {
  it('creates a criterion, then gets, lists and publishes it', async () => {
    const res = await request(app).post(ITEMS).set(auth(admin.token)).send(criterionBody());
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ kind: 'CRITERION', isActive: true, value: { en: expect.stringMatching(/^Test value/) } });

    const detail = await request(app).get(`${ITEMS}/${res.body.data.id}`).set(auth(admin.token));
    expect(detail.status).toBe(200);
    expect(detail.body.data).toEqual(res.body.data);

    const list = await request(app).get(ITEMS).query({ search: res.body.data.label.en }).set(auth(admin.token));
    expect(list.status).toBe(200);
    expect(list.body.data.map((i: Item) => i.id)).toEqual([res.body.data.id]);
    expect(list.body.meta).toMatchObject({ page: 1, total: 1 });

    const page = await publicPage();
    expect(page.criteria.at(-1)).toEqual({ label: res.body.data.label, value: res.body.data.value });
    expect(page.documents.map((d) => d.en)).not.toContain(res.body.data.label.en);
  });

  it('creates a document without a value and publishes it in the documents list', async () => {
    const res = await request(app).post(ITEMS).set(auth(admin.token)).send(documentBody());
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ kind: 'DOCUMENT', value: null, isActive: true });

    /* An explicit null is the same as no value. */
    const withNull = await request(app)
      .post(ITEMS)
      .set(auth(admin.token))
      .send(documentBody({ value: null }));
    expect(withNull.status).toBe(201);
    expect(withNull.body.data.value).toBeNull();

    expect(await publicDocuments()).toEqual(expect.arrayContaining([res.body.data.label.en, withNull.body.data.label.en]));
    expect(await publicCriteria()).not.toContain(res.body.data.label.en);
  });

  it('puts a new row at the end of its own kind when no order is given', async () => {
    const criteriaMax = await maxOrder('CRITERION');
    const documentsMax = await maxOrder('DOCUMENT');
    expect(criteriaMax).not.toBe(documentsMax);

    expect((await makeItem(criterionBody())).displayOrder).toBe(criteriaMax + 1);
    expect((await makeItem(documentBody())).displayOrder).toBe(documentsMax + 1);
    expect((await makeItem(documentBody({ displayOrder: 3 }))).displayOrder).toBe(3);
  });

  it('never assigns an order past the 9999 the edit form accepts', async () => {
    const last = await makeItem(documentBody({ displayOrder: 9999 }));
    const next = await makeItem(documentBody());
    expect(next.displayOrder).toBe(9999);

    /* The row stays editable: its own order passes the update validator. */
    const edited = await request(app)
      .patch(`${ITEMS}/${next.id}`)
      .set(auth(admin.token))
      .send({ label: label(), displayOrder: next.displayOrder });
    expect(edited.status).toBe(200);

    for (const row of [last, next]) await request(app).delete(`${ITEMS}/${row.id}`).set(auth(admin.token));
  });

  it('filters the list by kind and searches values as well as labels', async () => {
    const docs = await request(app).get(ITEMS).query({ kind: 'DOCUMENT', limit: 100 }).set(auth(admin.token));
    expect(docs.status).toBe(200);
    expect(docs.body.data.length).toBeGreaterThan(0);
    expect(docs.body.data.every((i: Item) => i.kind === 'DOCUMENT')).toBe(true);

    const byValue = await request(app).get(ITEMS).query({ search: '18 to 45' }).set(auth(admin.token));
    expect(byValue.body.data.map((i: Item) => i.label.en)).toEqual(['Age']);

    expect((await request(app).get(ITEMS).query({ kind: 'OTHER' }).set(auth(admin.token))).status).toBe(422);
    expect((await request(app).get(ITEMS).query({ sortBy: 'valueEn' }).set(auth(admin.token))).status).toBe(422);
  });

  it('updates the label, value and order through PATCH and PUT', async () => {
    const item = await makeItem(criterionBody());
    const patched = await request(app)
      .patch(`${ITEMS}/${item.id}`)
      .set(auth(admin.token))
      .send({ value: { mr: 'नवीन मूल्य', en: 'New value' }, displayOrder: 0 });
    expect(patched.status).toBe(200);
    expect(patched.body.data).toMatchObject({ value: { mr: 'नवीन मूल्य', en: 'New value' }, displayOrder: 0, kind: 'CRITERION' });

    const put = await request(app)
      .put(`${ITEMS}/${item.id}`)
      .set(auth(admin.token))
      .send({ label: { mr: 'बदललेला निकष', en: 'Renamed criterion' } });
    expect(put.status).toBe(200);
    expect(put.body.data.label).toEqual({ mr: 'बदललेला निकष', en: 'Renamed criterion' });

    /* Order 0 puts it ahead of every seeded criterion on the website. */
    expect((await publicPage()).criteria[0]).toEqual({ label: put.body.data.label, value: { mr: 'नवीन मूल्य', en: 'New value' } });
    await request(app).delete(`${ITEMS}/${item.id}`).set(auth(admin.token));
  });

  it('hides a deactivated row from the website and shows it again when activated', async () => {
    const item = await makeItem(criterionBody());
    expect(await publicCriteria()).toContain(item.label.en);

    const off = await request(app).patch(`${ITEMS}/${item.id}/status`).set(auth(admin.token)).send({ isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.data.isActive).toBe(false);
    expect(await publicCriteria()).not.toContain(item.label.en);

    await request(app).patch(`${ITEMS}/${item.id}/status`).set(auth(admin.token)).send({ isActive: true });
    expect(await publicCriteria()).toContain(item.label.en);
  });

  it('creates a row inactive when asked, keeping it off the website', async () => {
    const item = await makeItem(documentBody({ isActive: false }));
    expect(item.isActive).toBe(false);
    expect(await publicDocuments()).not.toContain(item.label.en);
  });

  it('soft-deletes a row, then restores it inactive', async () => {
    const item = await makeItem(documentBody());
    const del = await request(app).delete(`${ITEMS}/${item.id}`).set(auth(admin.token));
    expect(del.status).toBe(200);
    expect((await request(app).get(`${ITEMS}/${item.id}`).set(auth(admin.token))).status).toBe(404);
    expect(await publicDocuments()).not.toContain(item.label.en);

    const restored = await request(app).post(`${ITEMS}/${item.id}/restore`).set(auth(admin.token));
    expect(restored.status).toBe(200);
    expect(restored.body.data).toMatchObject({ id: item.id, isActive: false, kind: 'DOCUMENT' });

    /* A row that is not deleted cannot be restored. */
    expect((await request(app).post(`${ITEMS}/${item.id}/restore`).set(auth(admin.token))).status).toBe(409);
  });

  it('refuses to restore a row whose label has been taken meanwhile (409)', async () => {
    const item = await makeItem(criterionBody());
    await request(app).delete(`${ITEMS}/${item.id}`).set(auth(admin.token));
    await makeItem(criterionBody({ label: item.label }));
    expect((await request(app).post(`${ITEMS}/${item.id}/restore`).set(auth(admin.token))).status).toBe(409);
  });

  it('answers 404 for an unknown id', async () => {
    expect((await request(app).get(`${ITEMS}/${MISSING_ID}`).set(auth(admin.token))).status).toBe(404);
    expect((await request(app).patch(`${ITEMS}/${MISSING_ID}`).set(auth(admin.token)).send({ displayOrder: 1 })).status).toBe(404);
    expect((await request(app).delete(`${ITEMS}/${MISSING_ID}`).set(auth(admin.token))).status).toBe(404);
  });
});

describe('Eligibility items: value by kind', () => {
  it('rejects a criterion without a value and a document with one (422 naming value)', async () => {
    const cases = [
      criterionBody({ value: undefined }),
      criterionBody({ value: null }),
      documentBody({ value: { mr: 'मूल्य', en: 'Value' } }),
    ];
    for (const payload of cases) {
      const res = await request(app).post(ITEMS).set(auth(admin.token)).send(payload);
      expect(res.status).toBe(422);
      expect(res.body.error.details).toEqual([expect.objectContaining({ field: 'body.value' })]);
    }
  });

  it('refuses a value on a document and clearing a criterion value on update (400 naming value)', async () => {
    const doc = await makeItem(documentBody());
    const onDoc = await request(app)
      .patch(`${ITEMS}/${doc.id}`)
      .set(auth(admin.token))
      .send({ value: { mr: 'मूल्य', en: 'Value' } });
    expect(onDoc.status).toBe(400);
    expect(onDoc.body.error.details).toEqual([expect.objectContaining({ field: 'value' })]);

    const crit = await makeItem(criterionBody());
    const cleared = await request(app).patch(`${ITEMS}/${crit.id}`).set(auth(admin.token)).send({ value: null });
    expect(cleared.status).toBe(400);
    expect(cleared.body.error.details).toEqual([expect.objectContaining({ field: 'value' })]);
    expect((await request(app).get(`${ITEMS}/${crit.id}`).set(auth(admin.token))).body.data.value).toEqual(crit.value);
  });

  it('does not let the kind be changed on update (422)', async () => {
    const item = await makeItem(criterionBody());
    expect((await request(app).patch(`${ITEMS}/${item.id}`).set(auth(admin.token)).send({ kind: 'DOCUMENT' })).status).toBe(422);
  });

  it('rejects missing halves, overlong text, a bad kind or order, unknown fields and an empty update (422)', async () => {
    const cases = [
      criterionBody({ label: { mr: '', en: 'Only English' } }),
      criterionBody({ value: { mr: 'फक्त मराठी', en: '   ' } }),
      criterionBody({ label: { mr: 'निकष', en: 'x'.repeat(301) } }),
      criterionBody({ value: { mr: 'मूल्य', en: 'x'.repeat(1001) } }),
      criterionBody({ kind: 'OTHER' }),
      criterionBody({ displayOrder: -1 }),
      documentBody({ displayOrder: 10000 }),
      documentBody({ extra: true }),
    ];
    for (const payload of cases) {
      expect((await request(app).post(ITEMS).set(auth(admin.token)).send(payload)).status).toBe(422);
    }
    const item = await makeItem(documentBody());
    expect((await request(app).patch(`${ITEMS}/${item.id}`).set(auth(admin.token)).send({})).status).toBe(422);
  });
});

describe('Eligibility items: duplicate labels', () => {
  it('rejects the same label twice within a kind, case-insensitively, in either language (409)', async () => {
    const first = await makeItem(criterionBody());
    const sameEn = criterionBody({ label: { mr: 'वेगळा निकष', en: first.label.en.toUpperCase() } });
    expect((await request(app).post(ITEMS).set(auth(admin.token)).send(sameEn)).status).toBe(409);
    const sameMr = criterionBody({ label: { mr: first.label.mr, en: 'A different criterion' } });
    expect((await request(app).post(ITEMS).set(auth(admin.token)).send(sameMr)).status).toBe(409);

    /* Seeded rows count too. */
    expect(
      (
        await request(app)
          .post(ITEMS)
          .set(auth(admin.token))
          .send(documentBody({ label: { mr: 'नवीन', en: 'AADHAAR CARD' } }))
      ).status,
    ).toBe(409);
  });

  it('allows the same label once as a criterion and once as a document', async () => {
    const crit = await makeItem(criterionBody());
    const doc = await request(app)
      .post(ITEMS)
      .set(auth(admin.token))
      .send(documentBody({ label: crit.label }));
    expect(doc.status).toBe(201);
  });

  it('rejects renaming a row to a label already in use in its kind (409)', async () => {
    const a = await makeItem(documentBody());
    const b = await makeItem(documentBody());
    expect((await request(app).patch(`${ITEMS}/${b.id}`).set(auth(admin.token)).send({ label: a.label })).status).toBe(409);
    /* Keeping its own label is not a clash. */
    expect((await request(app).patch(`${ITEMS}/${b.id}`).set(auth(admin.token)).send({ label: b.label })).status).toBe(200);
  });
});

describe('Eligibility Page Management permissions', () => {
  it('needs a session for every admin route', async () => {
    expect((await request(app).get(ITEMS)).status).toBe(401);
    expect((await request(app).get(SETTINGS)).status).toBe(401);
    expect((await request(app).put(SETTINGS).send(SEEDED_TEXT)).status).toBe(401);
  });

  it('lets a view-only user read but not write', async () => {
    expect((await request(app).get(ITEMS).set(auth(viewer.token))).status).toBe(200);
    expect((await request(app).get(SETTINGS).set(auth(viewer.token))).status).toBe(200);
    expect((await request(app).post(ITEMS).set(auth(viewer.token)).send(criterionBody())).status).toBe(403);
    expect((await request(app).put(SETTINGS).set(auth(viewer.token)).send(SEEDED_TEXT)).status).toBe(403);
    const item = await makeItem(documentBody());
    expect((await request(app).patch(`${ITEMS}/${item.id}/status`).set(auth(viewer.token)).send({ isActive: false })).status).toBe(403);
    expect((await request(app).delete(`${ITEMS}/${item.id}`).set(auth(viewer.token))).status).toBe(403);
  });

  it('refuses a user without any Eligibility permission', async () => {
    const outsider = await actorWith(VIEW_ONLY_CODES);
    expect((await request(app).get(ITEMS).set(auth(outsider.token))).status).toBe(403);
    expect((await request(app).get(SETTINGS).set(auth(outsider.token))).status).toBe(403);
  });

  it('accepts a user holding exactly the Eligibility codes', async () => {
    const editor = await actorWith(ELIGIBILITY_CODES);
    expect((await request(app).post(ITEMS).set(auth(editor.token)).send(criterionBody())).status).toBe(201);
    expect((await request(app).put(SETTINGS).set(auth(editor.token)).send(SEEDED_TEXT)).status).toBe(200);
  });
});
