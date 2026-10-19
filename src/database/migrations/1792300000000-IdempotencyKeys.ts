import type { MigrationInterface, QueryRunner } from 'typeorm';

/* Stored responses for requests sent with an Idempotency-Key header (ADR-0005). */
export class IdempotencyKeys1792300000000 implements MigrationInterface {
  name = 'IdempotencyKeys1792300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "idempotency_keys" (
        "id"           uuid         NOT NULL DEFAULT gen_random_uuid(),
        "key"          varchar(100) NOT NULL,
        "userId"       uuid         NOT NULL,
        "method"       varchar(10)  NOT NULL,
        "path"         varchar(300) NOT NULL,
        "requestHash"  char(64)     NOT NULL,
        "statusCode"   integer      NULL,
        "responseBody" jsonb        NULL,
        "createdAt"    timestamptz  NOT NULL DEFAULT now(),
        "expiresAt"    timestamptz  NOT NULL,
        CONSTRAINT "PK_idempotency_keys" PRIMARY KEY ("id"),
        CONSTRAINT "FK_idempotency_keys_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_idempotency_keys_user_key" ON "idempotency_keys" ("userId", "key")`);
    await q.query(`CREATE INDEX "IDX_idempotency_keys_expiresAt" ON "idempotency_keys" ("expiresAt")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "idempotency_keys"`);
  }
}
