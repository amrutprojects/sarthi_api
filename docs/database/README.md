# Database

PostgreSQL 14+, accessed only by this API through TypeORM ([ADR-0009](../architecture/adr/0009-typeorm-and-database-conventions.md)).

## Conventions

- Tables `snake_case` plural; columns `camelCase` (quoted); constraints `PK_`, `FK_`, `UQ_`, `IDX_`, triggers `TRG_`.
- Every application table: `id uuid DEFAULT gen_random_uuid()`, `createdAt`/`updatedAt timestamptz` (trigger keeps `updatedAt`), `isDelete boolean`, `isActive boolean`.
- Soft delete only. Uniqueness is a partial unique index `WHERE "isDelete" = false`, so deleted rows keep history without blocking re-creation. Foreign keys `ON DELETE RESTRICT`.
- Timestamps in UTC (`timestamptz`; the connection runs in UTC).
- Protected values (Aadhaar) are stored encrypted (`bytea`, AES-256-GCM), with a keyed blind index for matching and the last four digits for display.

## Tables

| Table | Module | Notes |
|---|---|---|
| `users` | users | Accounts; `passwordHash` (bcrypt) never selected by default |
| `roles`, `permissions`, `role_permissions`, `user_roles` | roles-permissions | RBAC; assignments soft-deleted on revoke |
| `role_menu_visibility` | roles-permissions | Per-role hidden menus (no row = visible) |
| `audit_logs` | audit | Append-only (trigger blocks UPDATE/DELETE) |
| `revoked_tokens` | auth | Logged-out token and session ids until expiry (technical, purged) |
| `idempotency_keys` | shared | Stored responses for `Idempotency-Key` requests, 24 h |
| `import_batches`, `import_rows` | students | Student import pipeline |
| `students` | students | Approved-student register (created only by import finalisation) |
| `student_documents` | students | Document files: staged per import row, then per student (file metadata, sha256, storage key) |
| `typeorm_migrations` | — | Applied migrations |

## Migrations

```bash
npm run migration:create -- src/database/migrations/<timestamp>-<Name>
npm run migration:generate -- src/database/migrations/<timestamp>-<Name>   # from entity changes; always review
npm run migration:run
npm run migration:revert      # last migration only; check its down() first
npm run migration:show
```

Register every new migration in `src/database/migrations/index.ts`. Never edit a migration that has run in a shared environment — add a new one. Prefer additive, backward-compatible changes (add columns nullable or with defaults; backfill; then tighten) so the previous app version keeps working during a deploy.

## Integrity checks

- `npm run test:db` rebuilds the test schema from all migrations on every run, so a broken migration fails the build.
- `tests/integration/database` checks the common columns, soft-delete behaviour, partial unique indexes, the `updatedAt` trigger and the append-only audit log.

## Seeds

`npm run seed` is idempotent: it upserts the permission catalogue, creates missing roles with their default permissions, keeps Super Admin's grants complete, and translates retired permission codes once. Customised roles are not overwritten.

### Deploy / production: what a live migrate + seed creates (23 Nov 2026)

`npm run seed` reads `NODE_ENV` (`src/database/seeds/seed-profile.ts`, pinned by
`tests/unit/config/seed-live-install.test.ts`). On a **local** install (`development`, `test`) it seeds everything,
as before. On a **hosted** install (`staging`, `production`) it seeds:

- the RBAC catalogue, roles and grants (`seedRbac`) and the reference masters (`seedMasters`: regions, castes,
  document types, the starter education list);
- the website's real texts, each only on its first run (all-or-nothing; an existing section is never rewritten):
  Contact page, footer, Modules page, Programme section and page, home hero, Board, Advisory Committee heading,
  Ecosystem, AMRUT Schemes, About AMRUT, announcements label, Top Bar, Brand Bar; the Contact directory's state,
  36 districts and empty district-office entries;
- the EDP panel admin only when `EDP_ADMIN_EMAIL` / `EDP_ADMIN_PASSWORD` are set.

It leaves out the website's former demo-dataset content, and logs the list: the five district / cluster coordinators
(made-up names, masked phones, `@sumago.demo` e-mails), the ten "approved training centres", the four AMRUT's Impact
figures (the section is created hidden and empty, for an administrator to fill in and switch on) and the
implementation partner's placeholder e-mail `programme@sumago.demo` (left empty).

Still inserted by **migrations** on every install (applied migrations are never edited, so a fix needs a new migration
and the user's approval): the Live Dashboard figures of `1797600000000-CmsLiveDashboard` (from the demo dataset; its
"DEMO ENVIRONMENT" disclaimer is removed by `1797900000000-RemoveDemoWording`) and the ten demo training centres of
`1798300000000-ContactTrainingCentres` (on databases that already had the Contact page). Everything else migrations
insert is reference or system data: training-centre types, technology tracks, regions / castes / document types,
LMS form fields, programme elective domains, FAQ, eligibility and apply-page texts, nav menu, quick actions, page banners.
No Amrut tenant, LMS key or LMS link is seeded or migrated in.
