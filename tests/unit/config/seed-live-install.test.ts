/*
 * "No test data on a live server" (23 Nov 2026): on a staging or production install the seed run leaves out the
 * website's former demo-dataset content (seed-profile.ts). The four affected seeds run against a recording fake
 * EntityManager, once with the hosted options and once with the local ones, so the rows each writes are pinned
 * without a database.
 */
import type { DataSource } from 'typeorm';
import { seedAmrutImpact } from '../../../src/database/seeds/seed-amrut-impact';
import { seedContactDirectory } from '../../../src/database/seeds/seed-contact-directory';
import { organizationsFor, seedContactPage } from '../../../src/database/seeds/seed-contact-page';
import { seedContactTrainingCentres } from '../../../src/database/seeds/seed-contact-training-centres';
import { demoContentSkipped, isLocalInstall, seedOptionsFor, type SeedOptions } from '../../../src/database/seeds/seed-profile';

type Row = Record<string, unknown>;

/* An in-memory store per entity class, enough for what these seeds read and write. */
function fakeDataSource() {
  const tables = new Map<string, Row[]>();
  let next = 0;
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };
  const manager = {
    getRepository(entity: { name: string }) {
      const rows = table(entity.name);
      return {
        create: (row: Row) => ({ ...row }),
        save: async (row: Row) => {
          const saved = { id: `id-${++next}`, isDelete: false, ...row };
          rows.push(saved);
          return saved;
        },
        insert: async (input: Row | Row[]) => {
          for (const row of Array.isArray(input) ? input : [input]) rows.push({ id: `id-${++next}`, isDelete: false, ...row });
        },
        findOne: async () => rows[0] ?? null,
        find: async () => [...rows],
        count: async () => rows.length,
        createQueryBuilder: () => {
          const builder = { where: () => builder, andWhere: () => builder, getMany: async () => [...rows] };
          return builder;
        },
      };
    },
  };
  const ds = { transaction: async <T>(work: (m: typeof manager) => Promise<T>) => work(manager) } as unknown as DataSource;
  return { ds, tables };
}

async function runContactAndImpactSeeds(options: SeedOptions) {
  const { ds, tables } = fakeDataSource();
  await seedContactPage(ds, options);
  await seedContactDirectory(ds, options);
  await seedContactTrainingCentres(ds, options);
  await seedAmrutImpact(ds, options);
  const count = (name: string) => tables.get(name)?.length ?? 0;
  return { tables, count };
}

describe('seed profile', () => {
  it('treats development, test and unset as local, staging and production as hosted', () => {
    expect(isLocalInstall('development')).toBe(true);
    expect(isLocalInstall('test')).toBe(true);
    expect(isLocalInstall(undefined)).toBe(true);
    expect(isLocalInstall('staging')).toBe(false);
    expect(isLocalInstall('production')).toBe(false);
    expect(seedOptionsFor('production')).toEqual({ demoContent: false });
    expect(demoContentSkipped(seedOptionsFor('development'))).toEqual([]);
    expect(demoContentSkipped(seedOptionsFor('production'))).toHaveLength(4);
  });
});

describe.each(['production', 'staging'])('NODE_ENV=%s seed run', (nodeEnv) => {
  const options = seedOptionsFor(nodeEnv);

  it('writes no demo coordinator, training centre or impact figure, and no .demo e-mail', async () => {
    const { tables, count } = await runContactAndImpactSeeds(options);
    expect(count('ContactCoordinator')).toBe(0);
    expect(count('ContactCoordinatorDistrict')).toBe(0);
    expect(count('ContactTrainingCentre')).toBe(0);
    expect(count('ImpactStat')).toBe(0);
    expect(tables.get('ImpactSection')).toEqual([expect.objectContaining({ showSection: false })]);
    const everything = JSON.stringify([...tables.values()]);
    expect(everything).not.toMatch(/\.demo\b/);
    expect(everything).not.toMatch(/98XXX/);
  });

  it('still writes the real content: the page, its organisations, the state, the 36 districts and their offices', async () => {
    const { count } = await runContactAndImpactSeeds(options);
    expect(count('ContactPageSettings')).toBe(1);
    expect(count('ContactOrganization')).toBe(2);
    expect(count('State')).toBe(1);
    expect(count('District')).toBe(36);
    expect(count('ContactDistrictOffice')).toBe(36);
    expect(organizationsFor(options).find((o) => o.orgType === 'IMPLEMENTATION_PARTNER')?.email).toBeNull();
  });
});

describe('local seed run (development / test)', () => {
  it('keeps today’s content, demo dataset included', async () => {
    const { count } = await runContactAndImpactSeeds(seedOptionsFor('development'));
    expect(count('ContactCoordinator')).toBe(5);
    expect(count('ContactTrainingCentre')).toBe(10);
    expect(count('ImpactStat')).toBe(4);
    expect(organizationsFor(seedOptionsFor('test')).find((o) => o.orgType === 'IMPLEMENTATION_PARTNER')?.email).toBe(
      'programme@sumago.demo',
    );
  });
});
