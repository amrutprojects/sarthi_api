# ADR-0009: Keep TypeORM; database naming conventions

- Status: Accepted
- Date: 2026-10-19

## Context

The brief allows Prisma or TypeORM, used consistently. The backend already uses TypeORM 0.3 with explicit migrations, partial unique indexes, triggers and 140 passing tests.

## Decision

- Keep **TypeORM**. Migrations are hand-written or generated, then reviewed, and registered explicitly in `src/database/migrations/index.ts`; `synchronize` is always off.
- Naming: tables `snake_case`, plural (`users`, `role_permissions`, `import_rows`); columns `camelCase` in double quotes (matching entity properties); constraints and indexes prefixed `PK_`, `FK_`, `UQ_`, `IDX_`, `TRG_`.
- Common columns on every application table: `id uuid`, `createdAt`, `updatedAt` (`timestamptz`, trigger-maintained), `isDelete`, `isActive`.
- Uniqueness via partial unique indexes `WHERE "isDelete" = false`; foreign keys `ON DELETE RESTRICT` (application data is never physically deleted).

## Consequences

- Switching ORM later would be a large change; the repository layer keeps most queries in one place per module, which limits the blast radius.
