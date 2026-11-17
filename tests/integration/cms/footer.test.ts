import type { Express } from 'express';
import { AppDataSource, API, auth, request, setupTestApp, superAdmin, teardownTestApp, type TestActor } from '../../helpers/test-app';
import { seedFooter } from '../../../src/database/seeds/seed-footer';
import { FooterPartnerNameBilingual1798000000000 } from '../../../src/database/migrations/1798000000000-FooterPartnerNameBilingual';

/*
 * Footer — the implementation partner's name in Marathi and English (FooterPartnerNameBilingual).
 */
const ADMIN_URL = `${API}/cms/footer`;
const PUBLIC_URL = `${API}/public/footer`;

let app: Express;
let admin: TestActor;

interface Pair {
  mr: string;
  en: string;
}
interface AdminLink {
  kind: string;
  label: Pair;
  href: string | null;
  displayOrder: number;
  isActive: boolean;
}
interface AdminFooter {
  about: { heading: Pair; body: Pair; partnerLabel: Pair; partnerName: Pair };
  linkColumns: { heading: Pair; displayOrder: number; isActive: boolean; links: AdminLink[] }[];
  contact: { heading: Pair; address: Pair; email: string; phone: string; links: AdminLink[] };
  bottom: { copyright: Pair; disclaimer: Pair };
  updatedAt: string;
}

const SEEDED_PARTNER: Pair = { mr: 'सुमागो इन्फोटेक प्रा. लि.', en: 'SUMAGO INFOTECH PVT LTD' };

const adminFooter = async (): Promise<AdminFooter> =>
  (await request(app).get(ADMIN_URL).set(auth(admin.token)).expect(200)).body.data;

const link = ({ kind, label, href, displayOrder, isActive }: AdminLink) => ({ kind, label, href, displayOrder, isActive });

/* The admin shape trimmed to what the strict update schema accepts. */
const payloadOf = (f: AdminFooter) => ({
  about: f.about,
  linkColumns: f.linkColumns.map((c) => ({
    heading: c.heading,
    displayOrder: c.displayOrder,
    isActive: c.isActive,
    links: c.links.map(link),
  })),
  contact: { ...f.contact, links: f.contact.links.map(link) },
  bottom: f.bottom,
});

const partnerColumns = async () =>
  (await AppDataSource.query(`SELECT "partnerNameMr", "partnerNameEn" FROM "footer_settings" WHERE "isDelete" = false`))[0];

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
  await seedFooter(AppDataSource);
});
afterAll(teardownTestApp);

describe('Footer partner name', () => {
  it('is seeded in both languages and reaches the admin panel and the website as a pair', async () => {
    expect((await adminFooter()).about.partnerName).toEqual(SEEDED_PARTNER);
    const pub = (await request(app).get(PUBLIC_URL).expect(200)).body.data;
    expect(pub.about.partnerName).toEqual(SEEDED_PARTNER);
  });

  it('saves a Marathi and an English name, trimmed', async () => {
    const before = await adminFooter();
    const body = payloadOf(before);
    body.about = { ...body.about, partnerName: { mr: '  सीओईपी तंत्रज्ञान विद्यापीठ ', en: ' COEP Technological University  ' } };

    const res = await request(app).put(ADMIN_URL).set(auth(admin.token)).send(body);
    expect(res.status).toBe(200);
    expect(res.body.data.about.partnerName).toEqual({ mr: 'सीओईपी तंत्रज्ञान विद्यापीठ', en: 'COEP Technological University' });
    expect(await partnerColumns()).toEqual({ partnerNameMr: 'सीओईपी तंत्रज्ञान विद्यापीठ', partnerNameEn: 'COEP Technological University' });
    expect((await request(app).get(PUBLIC_URL).expect(200)).body.data.about.partnerName).toEqual({
      mr: 'सीओईपी तंत्रज्ञान विद्यापीठ',
      en: 'COEP Technological University',
    });
  });

  it('requires both halves, and no longer takes a single string', async () => {
    const body = payloadOf(await adminFooter());

    const blank = await request(app)
      .put(ADMIN_URL)
      .set(auth(admin.token))
      .send({ ...body, about: { ...body.about, partnerName: { mr: '   ', en: 'Partner' } } });
    expect(blank.status).toBe(422);
    expect(blank.body.error.details).toEqual([
      expect.objectContaining({ field: 'body.about.partnerName.mr', message: 'Partner name (Marathi) is required' }),
    ]);

    const single = await request(app)
      .put(ADMIN_URL)
      .set(auth(admin.token))
      .send({ ...body, about: { ...body.about, partnerName: 'Partner' } });
    expect(single.status).toBe(422);
    expect(single.body.error.details).toEqual([expect.objectContaining({ field: 'body.about.partnerName' })]);
  });
});

describe('FooterPartnerNameBilingual migration', () => {
  const migration = new FooterPartnerNameBilingual1798000000000();
  const run = async (step: 'up' | 'down') => {
    const qr = AppDataSource.createQueryRunner();
    try {
      await migration[step](qr);
    } finally {
      await qr.release();
    }
  };
  /* Back to the single column, with the given name in it, then forward again. */
  const migrateFrom = async (name: string) => {
    await run('down');
    await AppDataSource.query(`UPDATE "footer_settings" SET "partnerName" = $1`, [name]);
    await run('up');
  };

  afterAll(async () => {
    await AppDataSource.query(`UPDATE "footer_settings" SET "partnerNameMr" = $1, "partnerNameEn" = $2`, [
      SEEDED_PARTNER.mr,
      SEEDED_PARTNER.en,
    ]);
  });

  it('copies any other name into Marathi, so the website prints what it printed before', async () => {
    await migrateFrom('Another Partner Ltd');
    expect(await partnerColumns()).toEqual({ partnerNameMr: 'Another Partner Ltd', partnerNameEn: 'Another Partner Ltd' });
  });

  it('gives the two names in use their Marathi spelling', async () => {
    await migrateFrom('SUMAGO INFOTECH PVT LTD');
    expect(await partnerColumns()).toEqual({ partnerNameMr: SEEDED_PARTNER.mr, partnerNameEn: SEEDED_PARTNER.en });
    await migrateFrom('COEP Technological University');
    expect(await partnerColumns()).toEqual({
      partnerNameMr: 'सीओईपी तंत्रज्ञान विद्यापीठ',
      partnerNameEn: 'COEP Technological University',
    });
  });

  it('rejects a blank Marathi name at the database too', async () => {
    await expect(AppDataSource.query(`UPDATE "footer_settings" SET "partnerNameMr" = '  '`)).rejects.toThrow(
      /CHK_footer_settings_partner_name_mr/,
    );
  });
});
