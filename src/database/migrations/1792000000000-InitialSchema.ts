import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Initial schema: users, roles, permissions, user_roles, role_permissions, audit_logs, revoked_tokens.
 *
 * Every application table carries the common fields (id UUID, createdAt / updatedAt TIMESTAMPTZ,
 * isDelete, isActive). Uniqueness is enforced with PARTIAL unique indexes over non-deleted rows,
 * so soft-deleted records keep their history without blocking a new record with the same code/email.
 * Foreign keys use RESTRICT: rows are soft-deleted, never physically removed by the application.
 */
export class InitialSchema1792000000000 implements MigrationInterface {
  name = 'InitialSchema1792000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    /* Common columns, written once and reused for every application table. */
    const base = `
      "id"        uuid        NOT NULL DEFAULT gen_random_uuid(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "isDelete"  boolean     NOT NULL DEFAULT false,
      "isActive"  boolean     NOT NULL DEFAULT true`;

    await q.query(`
      CREATE TABLE "users" (${base},
        "name"         varchar(150) NOT NULL,
        "email"        varchar(255) NOT NULL,
        "passwordHash" varchar(255) NOT NULL,
        "lastLoginAt"  timestamptz  NULL,
        CONSTRAINT "PK_users" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_users_email_lower" CHECK ("email" = lower("email"))
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_users_email_active" ON "users" ("email") WHERE "isDelete" = false`);

    await q.query(`
      CREATE TABLE "roles" (${base},
        "name"        varchar(100) NOT NULL,
        "code"        varchar(64)  NOT NULL,
        "description" text         NULL,
        "isSystem"    boolean      NOT NULL DEFAULT false,
        CONSTRAINT "PK_roles" PRIMARY KEY ("id")
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_roles_code_active" ON "roles" ("code") WHERE "isDelete" = false`);

    await q.query(`
      CREATE TABLE "permissions" (${base},
        "name"        varchar(150) NOT NULL,
        "code"        varchar(100) NOT NULL,
        "module"      varchar(64)  NOT NULL,
        "description" text         NULL,
        CONSTRAINT "PK_permissions" PRIMARY KEY ("id")
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_permissions_code_active" ON "permissions" ("code") WHERE "isDelete" = false`);
    await q.query(`CREATE INDEX "IDX_permissions_module" ON "permissions" ("module")`);

    await q.query(`
      CREATE TABLE "user_roles" (${base},
        "userId"       uuid NOT NULL,
        "roleId"       uuid NOT NULL,
        "assignedById" uuid NULL,
        CONSTRAINT "PK_user_roles" PRIMARY KEY ("id"),
        CONSTRAINT "FK_user_roles_user"       FOREIGN KEY ("userId")       REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_user_roles_role"       FOREIGN KEY ("roleId")       REFERENCES "roles"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_user_roles_assignedBy" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_user_roles_active" ON "user_roles" ("userId", "roleId") WHERE "isDelete" = false`);
    await q.query(`CREATE INDEX "IDX_user_roles_roleId" ON "user_roles" ("roleId")`);

    await q.query(`
      CREATE TABLE "role_permissions" (${base},
        "roleId"       uuid NOT NULL,
        "permissionId" uuid NOT NULL,
        "assignedById" uuid NULL,
        CONSTRAINT "PK_role_permissions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_role_permissions_role"       FOREIGN KEY ("roleId")       REFERENCES "roles"("id")       ON DELETE RESTRICT,
        CONSTRAINT "FK_role_permissions_permission" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_role_permissions_assignedBy" FOREIGN KEY ("assignedById") REFERENCES "users"("id")       ON DELETE SET NULL
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_role_permissions_active" ON "role_permissions" ("roleId", "permissionId") WHERE "isDelete" = false`,
    );
    await q.query(`CREATE INDEX "IDX_role_permissions_permissionId" ON "role_permissions" ("permissionId")`);

    await q.query(`
      CREATE TABLE "audit_logs" (
        "id"          uuid         NOT NULL DEFAULT gen_random_uuid(),
        "createdAt"   timestamptz  NOT NULL DEFAULT now(),
        "actorUserId" uuid         NULL,
        "action"      varchar(100) NOT NULL,
        "resource"    varchar(64)  NOT NULL,
        "resourceId"  varchar(100) NULL,
        "requestId"   varchar(100) NULL,
        "outcome"     varchar(16)  NOT NULL,
        "ipAddress"   varchar(64)  NULL,
        "details"     jsonb        NULL,
        CONSTRAINT "PK_audit_logs" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_audit_logs_outcome" CHECK ("outcome" IN ('SUCCESS', 'FAILURE', 'DENIED')),
        CONSTRAINT "FK_audit_logs_actor" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL
      )`);
    await q.query(`CREATE INDEX "IDX_audit_logs_actor" ON "audit_logs" ("actorUserId")`);
    await q.query(`CREATE INDEX "IDX_audit_logs_resource" ON "audit_logs" ("resource", "resourceId")`);
    await q.query(`CREATE INDEX "IDX_audit_logs_createdAt" ON "audit_logs" ("createdAt")`);

    await q.query(`
      CREATE TABLE "revoked_tokens" (
        "jti"       uuid        NOT NULL,
        "userId"    uuid        NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_revoked_tokens" PRIMARY KEY ("jti"),
        CONSTRAINT "FK_revoked_tokens_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )`);
    await q.query(`CREATE INDEX "IDX_revoked_tokens_expiresAt" ON "revoked_tokens" ("expiresAt")`);

    /* Keep updatedAt correct even for bulk / raw SQL updates that bypass TypeORM. */
    await q.query(`
      CREATE OR REPLACE FUNCTION "set_updated_at"() RETURNS trigger AS $$
      BEGIN
        NEW."updatedAt" := now();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    for (const t of ['users', 'roles', 'permissions', 'user_roles', 'role_permissions']) {
      await q.query(`CREATE TRIGGER "TRG_${t}_updated_at" BEFORE UPDATE ON "${t}" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);
    }

    /* Audit log is append-only: block UPDATE and DELETE at the database level. */
    await q.query(`
      CREATE OR REPLACE FUNCTION "audit_logs_immutable"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'audit_logs is append-only';
      END;
      $$ LANGUAGE plpgsql`);
    await q.query(
      `CREATE TRIGGER "TRG_audit_logs_immutable" BEFORE UPDATE OR DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION "audit_logs_immutable"()`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "revoked_tokens"`);
    await q.query(`DROP TRIGGER IF EXISTS "TRG_audit_logs_immutable" ON "audit_logs"`);
    await q.query(`DROP TABLE IF EXISTS "audit_logs"`);
    await q.query(`DROP FUNCTION IF EXISTS "audit_logs_immutable"()`);
    await q.query(`DROP TABLE IF EXISTS "role_permissions"`);
    await q.query(`DROP TABLE IF EXISTS "user_roles"`);
    await q.query(`DROP TABLE IF EXISTS "permissions"`);
    await q.query(`DROP TABLE IF EXISTS "roles"`);
    await q.query(`DROP TABLE IF EXISTS "users"`);
    await q.query(`DROP FUNCTION IF EXISTS "set_updated_at"()`);
  }
}
