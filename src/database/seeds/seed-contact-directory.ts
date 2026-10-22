import type { DataSource, EntityManager } from 'typeorm';
import {
  ContactCoordinator,
  ContactCoordinatorDistrict,
  ContactDistrictOffice,
  ContactPageSettings,
} from '../../cms/contact/contact.model';
import { District } from '../../cms/masters/district/district.model';
import { State } from '../../cms/masters/state/state.model';

export interface ContactDirectorySeedSummary {
  stateCreated: boolean;
  districtsCreated: number;
  /* Website districts whose code is already used in the state by a district of another name. */
  districtsSkipped: string[];
  coordinatorsCreated: number;
  districtOfficesCreated: number;
}

/*
 * Initial content of the two Contact page sections "District / cluster coordinators" and
 * "District offices".
 *
 * The values below are exactly what the public site displayed before these sections became
 * CMS-managed (public-site/data/demo-data.ts: the 36 districts and the 5 coordinators), so seeding
 * changes nothing a visitor sees — it only moves the source of truth into the database. Phone
 * numbers are kept masked ("98XXX") exactly as the site shows them; an administrator replaces them
 * with real numbers in Contact Page Management.
 *
 * The site holds no Collectorate details (every field reads "to be supplied from official records"),
 * so each district gets an office entry with every field empty. The site renders that identically,
 * and the admin screen then lists all 36 districts ready to be filled in.
 */
const STATE = { name: 'Maharashtra', code: 'MH' };

/* [name, code], in the site's own order. */
const DISTRICTS: [string, string][] = [
  ['Nandurbar', 'NDB'],
  ['Dhule', 'DHU'],
  ['Jalgaon', 'JAL'],
  ['Buldhana', 'BUL'],
  ['Akola', 'AKO'],
  ['Amravati', 'AMR'],
  ['Nagpur', 'NAG'],
  ['Bhandara', 'BHA'],
  ['Gondia', 'GON'],
  ['Palghar', 'PAL'],
  ['Nashik', 'NAS'],
  ['Washim', 'WAS'],
  ['Yavatmal', 'YAV'],
  ['Wardha', 'WAR'],
  ['Chandrapur', 'CHA'],
  ['Gadchiroli', 'GAD'],
  ['Mumbai Suburban', 'MUS'],
  ['Thane', 'THA'],
  ['Chhatrapati Sambhajinagar', 'CSN'],
  ['Jalna', 'JLN'],
  ['Hingoli', 'HIN'],
  ['Parbhani', 'PAR'],
  ['Nanded', 'NAN'],
  ['Mumbai City', 'MUC'],
  ['Raigad', 'RAI'],
  ['Pune', 'PUN'],
  ['Ahilyanagar', 'AHL'],
  ['Beed', 'BEE'],
  ['Latur', 'LAT'],
  ['Dharashiv', 'DHA'],
  ['Ratnagiri', 'RAT'],
  ['Satara', 'SAT'],
  ['Solapur', 'SOL'],
  ['Sindhudurg', 'SIN'],
  ['Kolhapur', 'KOL'],
  ['Sangli', 'SAN'],
];

/* Districts are listed by the site's code; each code is one of DISTRICTS above. */
const COORDINATORS = [
  {
    name: 'Rajesh Kulkarni',
    phone: '+91 98XXX 41201',
    email: 'dc.west@sumago.demo',
    districts: ['PUN', 'SAT', 'KOL', 'SAN', 'SOL', 'RAT', 'SIN'],
  },
  {
    name: 'Sneha Deshmukh',
    phone: '+91 98XXX 41202',
    email: 'dc.north@sumago.demo',
    districts: ['NAS', 'AHL', 'JAL', 'DHU', 'NDB', 'PAL'],
  },
  {
    name: 'Amit Jadhav',
    phone: '+91 98XXX 41203',
    email: 'dc.konkan@sumago.demo',
    districts: ['THA', 'MUC', 'MUS', 'RAI'],
  },
  {
    name: 'Priya Shinde',
    phone: '+91 98XXX 41204',
    email: 'dc.marathwada@sumago.demo',
    districts: ['CSN', 'BEE', 'JLN', 'LAT', 'DHA', 'PAR', 'HIN', 'NAN'],
  },
  {
    name: 'Vikas Thorat',
    phone: '+91 98XXX 41205',
    email: 'dc.vidarbha@sumago.demo',
    districts: ['NAG', 'AMR', 'AKO', 'BUL', 'WAS', 'YAV', 'WAR', 'BHA', 'GON', 'GAD', 'CHA'],
  },
];

/* The live state, matched by name or code; created when neither exists. */
async function ensureState(m: EntityManager): Promise<{ state: State; created: boolean }> {
  const candidates = await m
    .getRepository(State)
    .createQueryBuilder('s')
    .where('s.isDelete = false')
    .andWhere('(lower(s.name) = lower(:name) OR s.code = :code)', STATE)
    .getMany();
  /* A name match wins over a code match. */
  const found = candidates.find((s) => s.name.toLowerCase() === STATE.name.toLowerCase()) ?? candidates[0];
  if (found) return { state: found, created: false };
  const repo = m.getRepository(State);
  return { state: await repo.save(repo.create(STATE)), created: true };
}

/*
 * Every website district, by its site code. A district already in the master is reused by name, so
 * one an administrator created with a different code (e.g. Nashik "NA") is linked rather than
 * duplicated; a missing one is created with the site's code.
 */
async function ensureDistricts(
  m: EntityManager,
  stateId: string,
): Promise<{ byCode: Map<string, District>; created: number; skipped: string[] }> {
  const repo = m.getRepository(District);
  const existing = await repo.find({ where: { stateId, isDelete: false } });
  const byName = new Map(existing.map((d) => [d.name.toLowerCase(), d]));
  const usedCodes = new Set(existing.map((d) => d.code));

  const byCode = new Map<string, District>();
  const skipped: string[] = [];
  let created = 0;
  for (const [name, code] of DISTRICTS) {
    const current = byName.get(name.toLowerCase());
    if (current) {
      byCode.set(code, current);
      continue;
    }
    if (usedCodes.has(code)) {
      skipped.push(`${name} (${code})`);
      continue;
    }
    const saved = await repo.save(repo.create({ stateId, name, code }));
    usedCodes.add(code);
    byCode.set(code, saved);
    created++;
  }
  return { byCode, created, skipped };
}

/*
 * Idempotent, and like the Contact page seed it never undoes an administrator's work: each section is
 * seeded only if it has NEVER had a row (soft-deleted rows included), so a list an administrator
 * deliberately emptied stays empty on the next `npm run seed`. Districts are only ever added, never
 * changed.
 *
 * Needs the Contact page settings row (seedContactPage) and runs in one transaction.
 */
export async function seedContactDirectory(ds: DataSource): Promise<ContactDirectorySeedSummary> {
  return ds.transaction(async (m: EntityManager) => {
    const summary: ContactDirectorySeedSummary = {
      stateCreated: false,
      districtsCreated: 0,
      districtsSkipped: [],
      coordinatorsCreated: 0,
      districtOfficesCreated: 0,
    };

    const settings = await m.getRepository(ContactPageSettings).findOne({ where: { isDelete: false } });
    if (!settings) return summary;

    const coordinatorRepo = m.getRepository(ContactCoordinator);
    const officeRepo = m.getRepository(ContactDistrictOffice);
    const seedCoordinators = (await coordinatorRepo.count({ where: { settingsId: settings.id } })) === 0;
    const seedOffices = (await officeRepo.count({ where: { settingsId: settings.id } })) === 0;
    if (!seedCoordinators && !seedOffices) return summary;

    const { state, created: stateCreated } = await ensureState(m);
    const { byCode, created, skipped } = await ensureDistricts(m, state.id);
    Object.assign(summary, { stateCreated, districtsCreated: created, districtsSkipped: skipped });

    if (seedCoordinators) {
      const linked = new Set<string>();
      for (const [index, c] of COORDINATORS.entries()) {
        const saved = await coordinatorRepo.save(
          coordinatorRepo.create({ settingsId: settings.id, name: c.name, phone: c.phone, email: c.email, displayOrder: index }),
        );
        /* A district belongs to one coordinator (UQ_contact_coordinator_districts_district). */
        const districtIds = c.districts
          .map((code) => byCode.get(code)?.id)
          .filter((id): id is string => Boolean(id) && !linked.has(id!));
        districtIds.forEach((id) => linked.add(id));
        if (districtIds.length) {
          await m
            .getRepository(ContactCoordinatorDistrict)
            .insert(districtIds.map((districtId, displayOrder) => ({ coordinatorId: saved.id, districtId, displayOrder })));
        }
        summary.coordinatorsCreated++;
      }
    }

    if (seedOffices) {
      const districtIds = [...new Set([...byCode.values()].map((d) => d.id))];
      if (districtIds.length) await officeRepo.insert(districtIds.map((districtId) => ({ settingsId: settings.id, districtId })));
      summary.districtOfficesCreated = districtIds.length;
    }

    return summary;
  });
}
