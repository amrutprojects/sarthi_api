import type { Express } from 'express';
import {
  API,
  AppDataSource,
  actorWith,
  auth,
  request,
  setupTestApp,
  superAdmin,
  teardownTestApp,
  type TestActor,
} from '../../helpers/test-app';
import { MISSING_ID, VIEW_ONLY_CODES } from '../../cms/helpers';

let app: Express;
let admin: TestActor;
let viewer: TestActor;

const APPLY_CODES = ['cms-apply.view', 'cms-apply.create', 'cms-apply.update', 'cms-apply.delete'];
const ELIGIBILITY_CODES = ['cms-eligibility.view', 'cms-eligibility.create', 'cms-eligibility.update', 'cms-eligibility.delete'];
const ITEMS = `${API}/cms/apply/items`;
const SETTINGS = `${API}/cms/apply/settings`;
const PUBLIC = `${API}/public/apply`;
const ELIGIBILITY_ITEMS = `${API}/cms/eligibility/items`;
const ELIGIBILITY_PUBLIC = `${API}/public/eligibility`;

interface Bilingual {
  mr: string;
  en: string;
}

/* The page text the website showed before the page became CMS-managed, as the migration seeds it. */
const SEEDED_TEXT = {
  pageTitle: { mr: 'अर्ज कसा करावा', en: 'How to Apply' },
  pageSubtitle: { mr: 'नोंदणीपासून प्रवेशापर्यंतची संपूर्ण प्रक्रिया.', en: 'The complete process from registration to admission.' },
  noteTitle: { mr: 'महत्त्वाचे', en: 'Important' },
  noteBody: {
    mr: 'इच्छित बॅच सुरू होण्याच्या किमान 30 दिवस आधी अर्ज करावा.',
    en: 'Apply at least 30 days before the commencement of your desired batch.',
  },
  glanceHeading: { mr: 'लक्षात ठेवा', en: 'At a glance' },
  documentsHeading: { mr: 'आवश्यक कागदपत्रे', en: 'Documents to keep ready' },
  ctaText: {
    mr: 'अर्ज अधिकृत अमृत पोर्टलवर स्वीकारले जातात. नोंदणी करण्यासाठी खालील बटणावर क्लिक करा.',
    en: 'Applications are accepted on the official AMRUT portal. Use the button below to register.',
  },
  ctaLabel: { mr: 'Apply Now', en: 'Apply Now' },
  ctaUrl: 'https://app.mahaamrut.org.in/amrut-new/signup',
  /* The seeded hint line is blanked by the ApplyCtaHintOptional migration: nothing is printed under the button. */
  ctaHint: { mr: '', en: '' },
};

/* kalash.applySteps, verbatim: n → title, d → description. */
const SEEDED_STEPS = [
  {
    title: { mr: 'ऑनलाइन अर्ज', en: 'Online application' },
    description: {
      mr: 'इच्छित बॅचसाठी अमृत कलश पोर्टलवर ऑनलाइन अर्ज करा व पात्रतेच्या कागदपत्रांच्या स्कॅन प्रती अपलोड करा. पसंतीचे केंद्र निवडा.',
      en: 'Apply online on the AMRUT Kalash portal for your desired batch, upload scanned proofs of eligibility and indicate your preferred centre.',
    },
  },
  {
    title: { mr: 'स्थानिक मदत (ऐच्छिक)', en: 'Local support (optional)' },
    description: {
      mr: 'आवश्यक असल्यास जवळच्या अधिकृत अध्ययन केंद्राची (ALC) मदत घेता येईल.',
      en: 'Candidates may seek local support for the online application from a nearby Authorized Learning Centre (ALC).',
    },
  },
  {
    title: { mr: 'केंद्राकडून पडताळणी', en: 'Centre verification' },
    description: {
      mr: 'निवडलेले ALC उमेदवाराची माहिती व कागदपत्रे तपासून पात्रतेची पुष्टी करते.',
      en: "The selected ALC verifies the candidate's data and supporting documents and confirms eligibility.",
    },
  },
  {
    title: { mr: 'जिल्हा समन्वयक तपासणी', en: 'District coordinator review' },
    description: {
      mr: 'संबंधित जिल्हा/क्लस्टर समन्वयक आपल्या लॉगिनमधून प्रत्येक उमेदवाराची माहिती पडताळतो.',
      en: 'The respective district / cluster coordinator verifies each candidate from their login.',
    },
  },
  {
    title: { mr: 'अमृतकडून अंतिम मान्यता', en: 'Final approval by AMRUT' },
    description: {
      mr: 'अमृत प्राधिकरण आपल्या लॉगिनमधून उमेदवाराच्या तपशिलास अंतिम मान्यता देते.',
      en: 'AMRUT authorities give final approval to the candidate details from their login.',
    },
  },
  {
    title: { mr: 'अनामत रक्कम व प्रवेश', en: 'Security deposit & admission' },
    description: {
      mr: 'मान्यताप्राप्त उमेदवार संबंधित ALC मार्फत रु. २,०००/- ची परतावा योग्य अनामत रक्कम भरतो; त्यानंतर पहिल्या मॉड्यूलसाठी लॉगिन क्रेडेन्शियल्स दिली जातात.',
      en: 'The approved candidate pays a refundable security deposit of Rs. 2,000/- through the ALC, after which login credentials are issued for Module 1.',
    },
  },
];

/* The "At a glance" card as AtAGlance rendered it. */
const SEEDED_FACTS = [
  { label: { mr: 'अनामत रक्कम', en: 'Security deposit' }, value: { mr: '₹2,000 (परतावा योग्य)', en: '₹2,000 (refundable)' } },
  { label: { mr: 'परतावा', en: 'Refund' }, value: { mr: 'चौथे मॉड्यूल पूर्ण झाल्यावर', en: 'After completing Module 4' } },
  {
    label: { mr: 'लॉगिन', en: 'Login' },
    value: { mr: 'रक्कम भरल्यावर मॉड्यूल १ साठी दिले जाते', en: 'Issued for Module 1 after payment' },
  },
  {
    label: { mr: 'पडताळणी', en: 'Verification' },
    value: { mr: 'केंद्र → जिल्हा समन्वयक → अमृत', en: 'Centre → District coordinator → AMRUT' },
  },
];

/* The Eligibility page's seeded required documents (CmsEligibility migration), which the Apply page shows too. */
const SEEDED_DOCUMENTS = [
  { mr: 'आधार कार्ड', en: 'Aadhaar card' },
  { mr: 'महाराष्ट्र अधिवास दाखला', en: 'Maharashtra Domicile Certificate' },
  { mr: '१२ वी उत्तीर्ण / पदविका प्रमाणपत्र व गुणपत्रिका', en: '12th pass or Diploma certificate & marksheet' },
  { mr: 'जन्मतारीख व वयाचा पुरावा', en: 'Date of birth and age proof' },
  { mr: '१ वर्षाचा उत्पन्नाचा दाखला किंवा EWS प्रमाणपत्र', en: '1-year Income Certificate or EWS Certificate' },
  { mr: 'छायाचित्र व स्वाक्षरी', en: 'Photograph and signature' },
  { mr: 'जातीचा स्पष्ट उल्लेख असलेले शासकीय कागदपत्र', en: 'Government document clearly mentioning caste' },
];

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
  viewer = await actorWith(['cms-apply.view']);
});
afterAll(teardownTestApp);

let seq = 0;
/* A label unique to this run, so tests never collide with each other or with the seeded rows. */
const label = () => {
  seq += 1;
  return { mr: `चाचणी ${seq}`, en: `Test item ${seq}` };
};
const itemBody = (kind: 'STEP' | 'FACT', extra: Record<string, unknown> = {}) => ({
  kind,
  label: label(),
  value: { mr: `चाचणी मूल्य ${seq}`, en: `Test value ${seq}` },
  ...extra,
});
const stepBody = (extra: Record<string, unknown> = {}) => itemBody('STEP', extra);
const factBody = (extra: Record<string, unknown> = {}) => itemBody('FACT', extra);

interface Item {
  id: string;
  kind: 'STEP' | 'FACT';
  label: Bilingual;
  value: Bilingual;
  displayOrder: number;
  isActive: boolean;
}

async function makeItem(payload: Record<string, unknown>): Promise<Item> {
  const res = await request(app).post(ITEMS).set(auth(admin.token)).send(payload);
  if (res.status !== 201) throw new Error(`makeItem failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.data as Item;
}

type PublicPage = typeof SEEDED_TEXT & {
  steps: { title: Bilingual; description: Bilingual }[];
  facts: { label: Bilingual; value: Bilingual }[];
  documents: Bilingual[];
};

const publicPage = async (): Promise<PublicPage> => {
  const res = await request(app).get(PUBLIC);
  expect(res.status).toBe(200);
  return res.body.data as PublicPage;
};
const publicSteps = async () => (await publicPage()).steps.map((s) => s.title.en);
const publicFacts = async () => (await publicPage()).facts.map((f) => f.label.en);
const publicDocuments = async () => (await publicPage()).documents.map((d) => d.en);

/* What the Eligibility page lists as its required documents right now. */
const eligibilityDocuments = async (): Promise<Bilingual[]> => {
  const res = await request(app).get(ELIGIBILITY_PUBLIC);
  expect(res.status).toBe(200);
  return res.body.data.documents as Bilingual[];
};

/* The highest display order among the live rows of one kind. */
const maxOrder = async (kind: string): Promise<number> => {
  const res = await request(app).get(ITEMS).query({ kind, sortBy: 'displayOrder', sortOrder: 'desc', limit: 1 }).set(auth(admin.token));
  return res.body.data[0].displayOrder as number;
};

/* The audit actions recorded against one resource id, oldest first (the audit log lists newest first). */
const auditActions = async (resourceId: string): Promise<string[]> => {
  const res = await request(app).get(`${API}/audit-logs`).query({ resourceId, limit: 100 }).set(auth(admin.token));
  expect(res.status).toBe(200);
  return (res.body.data as { action: string }[]).map((l) => l.action).reverse();
};

describe('seeded content', () => {
  it('serves the page the website showed before, in order, without auth', async () => {
    const res = await request(app).get(PUBLIC);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      ...SEEDED_TEXT,
      steps: SEEDED_STEPS,
      facts: SEEDED_FACTS,
      /* Not a copy: exactly the list the Eligibility page shows, in its order. */
      documents: await eligibilityDocuments(),
    });

    /* Other test files may have added Eligibility documents; the seeded ones are all there, in their order. */
    const documents = res.body.data.documents as Bilingual[];
    expect(documents.filter((d) => SEEDED_DOCUMENTS.some((s) => s.en === d.en))).toEqual(SEEDED_DOCUMENTS);
  });

  it('lists the seeded rows for the admin, the "At a glance" rows first, each kind in display order', async () => {
    const res = await request(app).get(ITEMS).query({ limit: 100 }).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ total: 10 });
    expect(res.body.data.map((i: Item) => [i.kind, i.displayOrder])).toEqual([
      ...[1, 2, 3, 4].map((n) => ['FACT', n]),
      ...[1, 2, 3, 4, 5, 6].map((n) => ['STEP', n]),
    ]);
    expect(res.body.data[0]).toMatchObject({ kind: 'FACT', ...SEEDED_FACTS[0], isActive: true });
    expect(res.body.data[4]).toMatchObject({
      kind: 'STEP',
      label: SEEDED_STEPS[0].title,
      value: SEEDED_STEPS[0].description,
      isActive: true,
    });
  });
});

describe('Apply page text', () => {
  it('reads the settings row and replaces it, which the website then shows', async () => {
    const res = await request(app).get(SETTINGS).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ ...SEEDED_TEXT, id: expect.any(String) });

    const changed = {
      ...SEEDED_TEXT,
      pageTitle: { mr: 'नवीन शीर्षक', en: 'New title' },
      /* Line breaks typed in the admin form survive the round trip. */
      noteBody: { mr: 'पहिली ओळ\nदुसरी ओळ', en: 'First line\nSecond line' },
      ctaUrl: 'https://example.org/apply?batch=7',
    };
    try {
      const put = await request(app).put(SETTINGS).set(auth(admin.token)).send(changed);
      expect(put.status).toBe(200);
      expect(put.body.data).toMatchObject({ ...changed, id: res.body.data.id });
      expect(await publicPage()).toMatchObject(changed);
      expect(await auditActions(res.body.data.id)).toContain('cms.apply-settings.update');
    } finally {
      /* Put the seeded text back for the rest of the run. */
      expect((await request(app).put(SETTINGS).set(auth(admin.token)).send(SEEDED_TEXT)).status).toBe(200);
    }
    expect(await publicPage()).toMatchObject(SEEDED_TEXT);
  });

  it('trims the text and the portal link before storing them', async () => {
    try {
      const padded = {
        ...SEEDED_TEXT,
        ctaLabel: { mr: '  Apply Now ', en: ' Apply Now  ' },
        ctaUrl: `  ${SEEDED_TEXT.ctaUrl}  `,
      };
      const put = await request(app).put(SETTINGS).set(auth(admin.token)).send(padded);
      expect(put.status).toBe(200);
      expect(put.body.data).toMatchObject(SEEDED_TEXT);
    } finally {
      await request(app).put(SETTINGS).set(auth(admin.token)).send(SEEDED_TEXT);
    }
  });

  it('takes the button hint as optional: both languages filled, or both blank to show nothing', async () => {
    const filled = { mr: 'नवीन टॅबमध्ये उघडेल', en: 'Opens in a new tab' };
    const on = await request(app).put(SETTINGS).set(auth(admin.token)).send({ ...SEEDED_TEXT, ctaHint: filled });
    expect(on.status).toBe(200);
    expect((await publicPage()).ctaHint).toEqual(filled);

    const off = await request(app).put(SETTINGS).set(auth(admin.token)).send({ ...SEEDED_TEXT, ctaHint: { mr: '  ', en: '' } });
    expect(off.status).toBe(200);
    expect((await publicPage()).ctaHint).toEqual({ mr: '', en: '' });
  });

  it('rejects a missing half, a missing pair, overlong text and unknown fields (422)', async () => {
    const cases = [
      { ...SEEDED_TEXT, ctaHint: { mr: 'फक्त मराठी', en: '' } },
      { ...SEEDED_TEXT, pageTitle: { en: 'English only' } },
      { ...SEEDED_TEXT, glanceHeading: undefined },
      { ...SEEDED_TEXT, ctaLabel: { mr: 'अर्ज करा', en: 'x'.repeat(101) } },
      { ...SEEDED_TEXT, noteBody: { mr: 'सूचना', en: 'x'.repeat(2001) } },
      { ...SEEDED_TEXT, extra: true },
    ];
    for (const payload of cases) {
      expect((await request(app).put(SETTINGS).set(auth(admin.token)).send(payload)).status).toBe(422);
    }
    const res = await request(app)
      .put(SETTINGS)
      .set(auth(admin.token))
      .send({ ...SEEDED_TEXT, ctaHint: { mr: 'फक्त मराठी', en: '  ' } });
    expect(res.body.error.details).toEqual([expect.objectContaining({ field: 'body.ctaHint.en' })]);
    expect(await publicPage()).toMatchObject(SEEDED_TEXT);
  });

  it('requires an https portal link: missing, empty, non-https, malformed or overlong is a 422 naming ctaUrl', async () => {
    const cases: unknown[] = [
      undefined,
      null,
      '',
      '   ',
      'http://app.mahaamrut.org.in/amrut-new/signup',
      'HTTPS://app.mahaamrut.org.in/amrut-new/signup',
      'javascript:alert(1)',
      'app.mahaamrut.org.in/amrut-new/signup',
      'not a url',
      'https://',
      'https:// app.mahaamrut.org.in',
      'https://\napp.mahaamrut.org.in',
      `https://example.org/${'x'.repeat(500)}`,
      42,
    ];
    for (const ctaUrl of cases) {
      const res = await request(app)
        .put(SETTINGS)
        .set(auth(admin.token))
        .send({ ...SEEDED_TEXT, ctaUrl });
      expect(res.status).toBe(422);
      expect(res.body.error.details).toEqual([expect.objectContaining({ field: 'body.ctaUrl' })]);
    }
    expect((await publicPage()).ctaUrl).toBe(SEEDED_TEXT.ctaUrl);
  });
});

describe('Apply items CRUD', () => {
  it('creates a step, then gets, lists and publishes it', async () => {
    const res = await request(app).post(ITEMS).set(auth(admin.token)).send(stepBody());
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ kind: 'STEP', isActive: true, value: { en: expect.stringMatching(/^Test value/) } });

    const detail = await request(app).get(`${ITEMS}/${res.body.data.id}`).set(auth(admin.token));
    expect(detail.status).toBe(200);
    expect(detail.body.data).toEqual(res.body.data);

    const list = await request(app).get(ITEMS).query({ search: res.body.data.label.en }).set(auth(admin.token));
    expect(list.status).toBe(200);
    expect(list.body.data.map((i: Item) => i.id)).toEqual([res.body.data.id]);
    expect(list.body.meta).toMatchObject({ page: 1, total: 1 });

    const page = await publicPage();
    expect(page.steps.slice(0, SEEDED_STEPS.length)).toEqual(SEEDED_STEPS);
    expect(page.steps.at(-1)).toEqual({ title: res.body.data.label, description: res.body.data.value });
    expect(page.facts.map((f) => f.label.en)).not.toContain(res.body.data.label.en);
    expect(await auditActions(res.body.data.id)).toEqual(['cms.apply-item.create']);
  });

  it('creates an "At a glance" row and publishes it in the facts list', async () => {
    const res = await request(app).post(ITEMS).set(auth(admin.token)).send(factBody());
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ kind: 'FACT', isActive: true, value: { en: expect.stringMatching(/^Test value/) } });

    const page = await publicPage();
    expect(page.facts.at(-1)).toEqual({ label: res.body.data.label, value: res.body.data.value });
    expect(page.steps.map((s) => s.title.en)).not.toContain(res.body.data.label.en);
  });

  it('puts a new row at the end of its own kind when no order is given', async () => {
    const stepsMax = await maxOrder('STEP');
    const factsMax = await maxOrder('FACT');
    expect(stepsMax).not.toBe(factsMax);

    expect((await makeItem(stepBody())).displayOrder).toBe(stepsMax + 1);
    expect((await makeItem(factBody())).displayOrder).toBe(factsMax + 1);
    expect((await makeItem(factBody({ displayOrder: 2 }))).displayOrder).toBe(2);
  });

  it('never assigns an order past the 9999 the edit form accepts, and caps each kind on its own', async () => {
    const last = await makeItem(stepBody({ displayOrder: 9999 }));
    const next = await makeItem(stepBody());
    expect(next.displayOrder).toBe(9999);

    /* The row stays editable: its own order passes the update validator. */
    const edited = await request(app)
      .patch(`${ITEMS}/${next.id}`)
      .set(auth(admin.token))
      .send({ label: label(), displayOrder: next.displayOrder });
    expect(edited.status).toBe(200);

    /* A full list of steps does not push the facts along. */
    const factsMax = await maxOrder('FACT');
    const fact = await makeItem(factBody());
    expect(fact.displayOrder).toBe(factsMax + 1);

    for (const row of [last, next, fact]) await request(app).delete(`${ITEMS}/${row.id}`).set(auth(admin.token));
  });

  it('filters the list by kind and searches values as well as labels', async () => {
    for (const kind of ['STEP', 'FACT']) {
      const res = await request(app).get(ITEMS).query({ kind, limit: 100 }).set(auth(admin.token));
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data.every((i: Item) => i.kind === kind)).toBe(true);
    }

    const search = async (query: Record<string, string>) =>
      (await request(app).get(ITEMS).query(query).set(auth(admin.token))).body.data.map((i: Item) => i.label.en);
    /* A fact's value, a step's description, Marathi text. */
    expect(await search({ search: 'completing Module 4' })).toEqual(['Refund']);
    expect(await search({ search: 'cluster coordinator' })).toEqual(['District coordinator review']);
    expect(await search({ search: 'प्राधिकरण' })).toEqual(['Final approval by AMRUT']);
    /* The kind filter narrows a search; facts sort before steps. */
    expect(await search({ search: 'coordinator' })).toEqual(['Verification', 'District coordinator review']);
    expect(await search({ search: 'coordinator', kind: 'STEP' })).toEqual(['District coordinator review']);

    expect((await request(app).get(ITEMS).query({ kind: 'DOCUMENT' }).set(auth(admin.token))).status).toBe(422);
    expect((await request(app).get(ITEMS).query({ sortBy: 'valueEn' }).set(auth(admin.token))).status).toBe(422);
  });

  it('updates the label, value and order through PATCH and PUT', async () => {
    const item = await makeItem(stepBody());
    const patched = await request(app)
      .patch(`${ITEMS}/${item.id}`)
      .set(auth(admin.token))
      .send({ value: { mr: 'नवीन वर्णन', en: 'New description' }, displayOrder: 0 });
    expect(patched.status).toBe(200);
    expect(patched.body.data).toMatchObject({
      value: { mr: 'नवीन वर्णन', en: 'New description' },
      displayOrder: 0,
      kind: 'STEP',
      label: item.label,
    });

    const put = await request(app)
      .put(`${ITEMS}/${item.id}`)
      .set(auth(admin.token))
      .send({ label: { mr: 'बदललेली पायरी', en: 'Renamed step' } });
    expect(put.status).toBe(200);
    expect(put.body.data.label).toEqual({ mr: 'बदललेली पायरी', en: 'Renamed step' });

    /* Order 0 puts it ahead of every seeded step on the website. */
    expect((await publicPage()).steps[0]).toEqual({ title: put.body.data.label, description: { mr: 'नवीन वर्णन', en: 'New description' } });
    await request(app).delete(`${ITEMS}/${item.id}`).set(auth(admin.token));
    expect(await auditActions(item.id)).toEqual([
      'cms.apply-item.create',
      'cms.apply-item.update',
      'cms.apply-item.update',
      'cms.apply-item.delete',
    ]);
  });

  it('hides a deactivated row from the website and shows it again when activated', async () => {
    for (const payload of [stepBody(), factBody()]) {
      const item = await makeItem(payload);
      const published = item.kind === 'STEP' ? publicSteps : publicFacts;
      expect(await published()).toContain(item.label.en);

      const off = await request(app).patch(`${ITEMS}/${item.id}/status`).set(auth(admin.token)).send({ isActive: false });
      expect(off.status).toBe(200);
      expect(off.body.data.isActive).toBe(false);
      expect(await published()).not.toContain(item.label.en);
      /* Still in the admin list, ready to bring back. */
      expect((await request(app).get(`${ITEMS}/${item.id}`).set(auth(admin.token))).body.data.isActive).toBe(false);

      const on = await request(app).patch(`${ITEMS}/${item.id}/status`).set(auth(admin.token)).send({ isActive: true });
      expect(on.status).toBe(200);
      expect(await published()).toContain(item.label.en);
    }
  });

  it('creates a row inactive when asked, keeping it off the website', async () => {
    const item = await makeItem(factBody({ isActive: false }));
    expect(item.isActive).toBe(false);
    expect(await publicFacts()).not.toContain(item.label.en);
  });

  it('soft-deletes a row, then restores it inactive', async () => {
    const item = await makeItem(stepBody());
    const del = await request(app).delete(`${ITEMS}/${item.id}`).set(auth(admin.token));
    expect(del.status).toBe(200);
    expect((await request(app).get(`${ITEMS}/${item.id}`).set(auth(admin.token))).status).toBe(404);
    expect((await request(app).delete(`${ITEMS}/${item.id}`).set(auth(admin.token))).status).toBe(404);
    expect(await publicSteps()).not.toContain(item.label.en);

    const restored = await request(app).post(`${ITEMS}/${item.id}/restore`).set(auth(admin.token));
    expect(restored.status).toBe(200);
    expect(restored.body.data).toMatchObject({ id: item.id, isActive: false, kind: 'STEP', label: item.label });
    expect(await publicSteps()).not.toContain(item.label.en);

    /* A row that is not deleted cannot be restored. */
    expect((await request(app).post(`${ITEMS}/${item.id}/restore`).set(auth(admin.token))).status).toBe(409);
  });

  it('refuses to restore a row whose label has been taken meanwhile (409)', async () => {
    const item = await makeItem(factBody());
    await request(app).delete(`${ITEMS}/${item.id}`).set(auth(admin.token));
    await makeItem(factBody({ label: item.label }));
    expect((await request(app).post(`${ITEMS}/${item.id}/restore`).set(auth(admin.token))).status).toBe(409);
  });

  it('answers 404 for an unknown id', async () => {
    expect((await request(app).get(`${ITEMS}/${MISSING_ID}`).set(auth(admin.token))).status).toBe(404);
    expect((await request(app).patch(`${ITEMS}/${MISSING_ID}`).set(auth(admin.token)).send({ displayOrder: 1 })).status).toBe(404);
    expect((await request(app).put(`${ITEMS}/${MISSING_ID}`).set(auth(admin.token)).send({ displayOrder: 1 })).status).toBe(404);
    expect((await request(app).patch(`${ITEMS}/${MISSING_ID}/status`).set(auth(admin.token)).send({ isActive: false })).status).toBe(404);
    expect((await request(app).delete(`${ITEMS}/${MISSING_ID}`).set(auth(admin.token))).status).toBe(404);
    expect((await request(app).post(`${ITEMS}/${MISSING_ID}/restore`).set(auth(admin.token))).status).toBe(404);
  });
});

describe('Apply items: validation', () => {
  it('requires a value for both kinds (422 naming value)', async () => {
    for (const payload of [stepBody({ value: undefined }), factBody({ value: undefined }), factBody({ value: null })]) {
      const res = await request(app).post(ITEMS).set(auth(admin.token)).send(payload);
      expect(res.status).toBe(422);
      expect(res.body.error.details).toEqual([expect.objectContaining({ field: 'body.value' })]);
    }
  });

  it('does not let the kind be changed on update (422)', async () => {
    const item = await makeItem(stepBody());
    expect((await request(app).patch(`${ITEMS}/${item.id}`).set(auth(admin.token)).send({ kind: 'FACT' })).status).toBe(422);
    expect((await request(app).put(`${ITEMS}/${item.id}`).set(auth(admin.token)).send({ kind: 'FACT', label: label() })).status).toBe(422);
    expect((await request(app).get(`${ITEMS}/${item.id}`).set(auth(admin.token))).body.data).toMatchObject({
      kind: 'STEP',
      label: item.label,
    });
  });

  it('rejects missing halves, overlong text, a bad kind or order, unknown fields and an empty update (422)', async () => {
    const cases = [
      stepBody({ label: { mr: '', en: 'Only English' } }),
      stepBody({ value: { mr: 'फक्त मराठी', en: '   ' } }),
      factBody({ label: { mr: 'लेबल', en: 'x'.repeat(301) } }),
      factBody({ value: { mr: 'मूल्य', en: 'x'.repeat(2001) } }),
      stepBody({ kind: 'DOCUMENT' }),
      stepBody({ kind: undefined }),
      stepBody({ displayOrder: -1 }),
      factBody({ displayOrder: 10000 }),
      factBody({ displayOrder: 1.5 }),
      factBody({ extra: true }),
    ];
    for (const payload of cases) {
      expect((await request(app).post(ITEMS).set(auth(admin.token)).send(payload)).status).toBe(422);
    }
    const item = await makeItem(factBody());
    expect((await request(app).patch(`${ITEMS}/${item.id}`).set(auth(admin.token)).send({})).status).toBe(422);
    const halfValue = await request(app)
      .patch(`${ITEMS}/${item.id}`)
      .set(auth(admin.token))
      .send({ value: { mr: 'मूल्य', en: '' } });
    expect(halfValue.status).toBe(422);
    expect(halfValue.body.error.details).toEqual([expect.objectContaining({ field: 'body.value.en' })]);
  });

  it('accepts a value up to the 2000 characters the column holds', async () => {
    const item = await makeItem(stepBody({ value: { mr: 'म'.repeat(2000), en: 'x'.repeat(2000) } }));
    expect(item.value.en).toHaveLength(2000);
    await request(app).delete(`${ITEMS}/${item.id}`).set(auth(admin.token));
  });
});

describe('Apply items: duplicate labels', () => {
  it('rejects the same label twice within a kind, case-insensitively, in either language (409)', async () => {
    const first = await makeItem(stepBody());
    const sameEn = stepBody({ label: { mr: 'वेगळी पायरी', en: first.label.en.toUpperCase() } });
    expect((await request(app).post(ITEMS).set(auth(admin.token)).send(sameEn)).status).toBe(409);
    const sameMr = stepBody({ label: { mr: first.label.mr, en: 'A different step' } });
    expect((await request(app).post(ITEMS).set(auth(admin.token)).send(sameMr)).status).toBe(409);

    /* Seeded rows count too. */
    const seededStep = stepBody({ label: { mr: 'नवीन', en: 'ONLINE APPLICATION' } });
    expect((await request(app).post(ITEMS).set(auth(admin.token)).send(seededStep)).status).toBe(409);
    const seededFact = factBody({ label: { mr: 'परतावा', en: 'Something else' } });
    expect((await request(app).post(ITEMS).set(auth(admin.token)).send(seededFact)).status).toBe(409);
  });

  it('allows the same label once as a step and once as an "At a glance" row', async () => {
    const step = await makeItem(stepBody());
    const fact = await request(app)
      .post(ITEMS)
      .set(auth(admin.token))
      .send(factBody({ label: step.label }));
    expect(fact.status).toBe(201);
    expect(fact.body.data).toMatchObject({ kind: 'FACT', label: step.label });
  });

  it('rejects renaming a row to a label already in use in its kind (409)', async () => {
    const a = await makeItem(factBody());
    const b = await makeItem(factBody());
    expect((await request(app).patch(`${ITEMS}/${b.id}`).set(auth(admin.token)).send({ label: a.label })).status).toBe(409);
    /* Keeping its own label is not a clash. */
    expect((await request(app).patch(`${ITEMS}/${b.id}`).set(auth(admin.token)).send({ label: b.label })).status).toBe(200);
  });
});

describe('"Documents to keep ready" is the Eligibility page\'s list', () => {
  it('drops a deactivated Eligibility document from the Apply page too, and shows it again when reactivated', async () => {
    const found = await request(app).get(ELIGIBILITY_ITEMS).query({ kind: 'DOCUMENT', search: 'Aadhaar card' }).set(auth(admin.token));
    expect(found.status).toBe(200);
    const aadhaar = (found.body.data as Item[]).find((i) => i.label.en === 'Aadhaar card');
    expect(aadhaar).toMatchObject({ isActive: true });
    const id = aadhaar!.id;
    expect(await publicDocuments()).toContain('Aadhaar card');

    try {
      const off = await request(app).patch(`${ELIGIBILITY_ITEMS}/${id}/status`).set(auth(admin.token)).send({ isActive: false });
      expect(off.status).toBe(200);
      expect(await publicDocuments()).not.toContain('Aadhaar card');
      expect((await publicPage()).documents).toEqual(await eligibilityDocuments());
    } finally {
      /* Bring the seeded document back for the rest of the run. */
      const on = await request(app).patch(`${ELIGIBILITY_ITEMS}/${id}/status`).set(auth(admin.token)).send({ isActive: true });
      expect(on.status).toBe(200);
    }
    expect(await publicDocuments()).toContain('Aadhaar card');
    expect((await publicPage()).documents).toEqual(await eligibilityDocuments());
  });

  it('follows the Eligibility order, and a deleted Eligibility document leaves both pages', async () => {
    const created = await request(app)
      .post(ELIGIBILITY_ITEMS)
      .set(auth(admin.token))
      .send({ kind: 'DOCUMENT', label: { mr: 'अर्ज पानासाठी चाचणी कागदपत्र', en: 'Apply page test document' }, displayOrder: 0 });
    expect(created.status).toBe(201);
    try {
      const documents = (await publicPage()).documents;
      expect(documents[0]).toEqual({ mr: 'अर्ज पानासाठी चाचणी कागदपत्र', en: 'Apply page test document' });
      expect(documents).toEqual(await eligibilityDocuments());
    } finally {
      /* Soft-deleted: no longer a live Eligibility row, so the Eligibility tests see only their own rows. */
      expect((await request(app).delete(`${ELIGIBILITY_ITEMS}/${created.body.data.id}`).set(auth(admin.token))).status).toBe(200);
    }
    expect(await publicDocuments()).not.toContain('Apply page test document');
  });

  it('offers no way to edit the documents from the Apply page', async () => {
    const res = await request(app).post(ITEMS).set(auth(admin.token)).send({ kind: 'DOCUMENT', label: label() });
    expect(res.status).toBe(422);
  });
});

/* Raw SQL, bypassing the API: the migration's constraints hold on their own. Every statement fails, so nothing is left behind. */
describe('Apply page database constraints', () => {
  it('refuses a portal link that is not https with a host, and blank page text', async () => {
    const setUrl = (ctaUrl: string) =>
      AppDataSource.query(`UPDATE "apply_page_settings" SET "ctaUrl" = $1 WHERE "isDelete" = false`, [ctaUrl]);
    for (const ctaUrl of [
      'http://app.mahaamrut.org.in/amrut-new/signup',
      'https://',
      'https:// app.mahaamrut.org.in',
      'https:///amrut-new',
    ]) {
      await expect(setUrl(ctaUrl)).rejects.toThrow(/CHK_apply_page_settings_cta_url/);
    }
    /* The hint may be blank in both languages, never in one. */
    await expect(AppDataSource.query(`UPDATE "apply_page_settings" SET "ctaHintMr" = 'फक्त मराठी' WHERE "isDelete" = false`)).rejects.toThrow(
      /CHK_apply_page_settings_cta_hint_pair/,
    );
    expect(await publicPage()).toMatchObject(SEEDED_TEXT);
  });

  it('keeps the page text a single live row', async () => {
    const columns: { column_name: string }[] = await AppDataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'apply_page_settings' AND column_name <> 'id'`,
    );
    const list = columns.map((c) => `"${c.column_name}"`).join(', ');
    await expect(
      AppDataSource.query(`INSERT INTO "apply_page_settings" (${list}) SELECT ${list} FROM "apply_page_settings"`),
    ).rejects.toThrow(/UQ_apply_page_settings_singleton/);
  });

  it('checks the kind, non-blank text, the order and live-label uniqueness of the list rows', async () => {
    const insert = (kind: string, labelEn: string, valueEn: string, displayOrder: number) =>
      AppDataSource.query(
        `INSERT INTO "apply_page_items" ("kind", "labelMr", "labelEn", "valueMr", "valueEn", "displayOrder") VALUES ($1, $2, $3, $4, $5, $6)`,
        [kind, `डीबी ${labelEn}`, labelEn, 'मूल्य', valueEn, displayOrder],
      );
    await expect(insert('DOCUMENT', 'Db kind', 'Value', 1)).rejects.toThrow(/CHK_apply_page_items_kind/);
    await expect(insert('STEP', '   ', 'Value', 1)).rejects.toThrow(/CHK_apply_page_items_label_en/);
    await expect(insert('FACT', 'Db blank value', '   ', 1)).rejects.toThrow(/CHK_apply_page_items_value_en/);
    await expect(insert('FACT', 'Db order', 'Value', -1)).rejects.toThrow(/CHK_apply_page_items_order/);
    await expect(insert('STEP', 'ONLINE APPLICATION', 'Value', 1)).rejects.toThrow(/UQ_apply_page_items_label_en_active/);
  });
});

describe('Apply Page Management permissions', () => {
  it('needs a session for every admin route', async () => {
    expect((await request(app).get(ITEMS)).status).toBe(401);
    expect((await request(app).post(ITEMS).send(stepBody())).status).toBe(401);
    expect((await request(app).get(SETTINGS)).status).toBe(401);
    expect((await request(app).put(SETTINGS).send(SEEDED_TEXT)).status).toBe(401);
  });

  it('lets a view-only user read but not write', async () => {
    expect((await request(app).get(ITEMS).set(auth(viewer.token))).status).toBe(200);
    expect((await request(app).get(SETTINGS).set(auth(viewer.token))).status).toBe(200);
    expect((await request(app).post(ITEMS).set(auth(viewer.token)).send(stepBody())).status).toBe(403);
    expect((await request(app).put(SETTINGS).set(auth(viewer.token)).send(SEEDED_TEXT)).status).toBe(403);
    const item = await makeItem(factBody());
    expect((await request(app).get(`${ITEMS}/${item.id}`).set(auth(viewer.token))).status).toBe(200);
    expect((await request(app).patch(`${ITEMS}/${item.id}`).set(auth(viewer.token)).send({ displayOrder: 1 })).status).toBe(403);
    expect((await request(app).patch(`${ITEMS}/${item.id}/status`).set(auth(viewer.token)).send({ isActive: false })).status).toBe(403);
    expect((await request(app).delete(`${ITEMS}/${item.id}`).set(auth(viewer.token))).status).toBe(403);
    expect((await request(app).post(`${ITEMS}/${item.id}/restore`).set(auth(viewer.token))).status).toBe(403);
  });

  it('refuses a user without any Apply permission, Eligibility editors included', async () => {
    const outsider = await actorWith(VIEW_ONLY_CODES);
    expect((await request(app).get(ITEMS).set(auth(outsider.token))).status).toBe(403);
    expect((await request(app).get(SETTINGS).set(auth(outsider.token))).status).toBe(403);

    const eligibilityEditor = await actorWith(ELIGIBILITY_CODES);
    expect((await request(app).get(ITEMS).set(auth(eligibilityEditor.token))).status).toBe(403);
    expect((await request(app).put(SETTINGS).set(auth(eligibilityEditor.token)).send(SEEDED_TEXT)).status).toBe(403);
  });

  it('accepts a user holding exactly the Apply codes', async () => {
    const editor = await actorWith(APPLY_CODES);
    expect((await request(app).post(ITEMS).set(auth(editor.token)).send(stepBody())).status).toBe(201);
    expect((await request(app).put(SETTINGS).set(auth(editor.token)).send(SEEDED_TEXT)).status).toBe(200);
  });
});
