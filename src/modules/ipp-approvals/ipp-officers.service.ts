import type { Request } from 'express';
import { In, type EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { usableSql } from '../../database/base.repository';
import { AppError } from '../../shared/errors/app-error';
import { auditService } from '../audit';
import { P } from '../roles-permissions';
import { IPP_AUDIT, IPP_ERROR, SUPER_ROLES } from './ipp-approvals.constants';
import { UserDistrict } from './ipp-approvals.entity';

/*
 * The Divisional Officers and their districts (admin panel: IPP Officers). An officer is a user whose roles hold
 * ipp-approvals.division-officer. The Super Admin roles do not count, and neither does a user who holds one of them next to
 * an officer's role: they decide only at the Super Admin's level, so a district in their hands would wait for ever.
 */
export interface OfficerDto {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  districts: { id: string; name: string }[];
}
export interface OfficersDto {
  officers: OfficerDto[];
  withoutOfficer: { id: string; name: string; waiting: number }[];
}

/* Condition "u is a Divisional Officer" (users alias u); $1 = the permission, $2 = the Super Admin role codes. */
const IS_OFFICER = `
  u."isDelete" = false
  AND EXISTS (
    SELECT 1 FROM "user_roles" ur
      JOIN "roles" r ON r."id" = ur."roleId" AND ${usableSql('r')} AND r."code" <> ALL($2::varchar[])
      JOIN "role_permissions" rp ON rp."roleId" = r."id" AND rp."isDelete" = false
      JOIN "permissions" p ON p."id" = rp."permissionId" AND ${usableSql('p')} AND p."code" = $1
     WHERE ur."userId" = u."id" AND ur."isDelete" = false)
  AND NOT EXISTS (
    SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId" AND ${usableSql('r')} AND r."code" = ANY($2::varchar[])
     WHERE ur."userId" = u."id" AND ur."isDelete" = false)`;
const OFFICER_PARAMS: unknown[] = [P.IPP_APPROVALS_DIVISION_OFFICER, [...SUPER_ROLES]];

class IppOfficersService {
  async list(): Promise<OfficersDto> {
    const [officers, withoutOfficer] = await Promise.all([
      this.officers(AppDataSource.manager),
      AppDataSource.query(
        `SELECT d."id", d."name", count(*)::int AS "waiting"
           FROM "ipp_applications" a JOIN "ipp_batches" b ON b."id" = a."batchId" JOIN "districts" d ON d."id" = b."districtId"
          WHERE a."stage" = 'DIVISION'
            AND NOT EXISTS (
              SELECT 1 FROM "user_districts" ud JOIN "users" u ON u."id" = ud."userId"
               WHERE ud."districtId" = d."id" AND ud."isDelete" = false AND u."isActive" = true AND ${IS_OFFICER})
          GROUP BY d."id", d."name" ORDER BY lower(d."name"), d."id"`,
        OFFICER_PARAMS,
      ) as Promise<OfficersDto['withoutOfficer']>,
    ]);
    return { officers, withoutOfficer };
  }

  private officers(m: EntityManager, userId?: string): Promise<OfficerDto[]> {
    return m.query(
      `SELECT u."id", u."name", u."email", u."isActive",
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object('id', d."id", 'name', d."name") ORDER BY lower(d."name"), d."id")
                  FROM "user_districts" ud JOIN "districts" d ON d."id" = ud."districtId"
                 WHERE ud."userId" = u."id" AND ud."isDelete" = false), '[]'::jsonb) AS "districts"
         FROM "users" u WHERE ${IS_OFFICER} ${userId ? 'AND u."id" = $3::uuid' : ''}
        ORDER BY u."isActive" DESC, lower(u."name"), u."id"`,
      userId ? [...OFFICER_PARAMS, userId] : OFFICER_PARAMS,
    );
  }

  /* Replaces the officer's districts. */
  async setDistricts(req: Request, userId: string, districtIds: string[]): Promise<OfficerDto> {
    return AppDataSource.transaction(async (m) => {
      /* One change of an officer's districts at a time. */
      const users: unknown[] = await m.query(`SELECT 1 FROM "users" WHERE "id" = $1 AND "isDelete" = false FOR UPDATE`, [userId]);
      if (!users.length) throw AppError.notFound('User not found');
      const [officer] = await this.officers(m, userId);
      if (!officer) throw AppError.conflict('This user is not a Divisional Officer', IPP_ERROR.NOT_A_DIVISIONAL_OFFICER);

      /* A district the officer has already stays as it is, even when it was switched off since; a new one must be active. */
      const wanted = new Set(districtIds);
      const before = new Set(officer.districts.map((d) => d.id));
      const removed = [...before].filter((id) => !wanted.has(id));
      const added = districtIds.filter((id) => !before.has(id));
      const usable: { id: string }[] = await m.query(
        `SELECT "id" FROM "districts" WHERE "id" = ANY($1::uuid[]) AND "isDelete" = false AND "isActive" = true`,
        [added],
      );
      const known = new Set(usable.map((d) => d.id));
      const unknown = added.filter((id) => !known.has(id));
      if (unknown.length)
        throw AppError.validation(
          unknown.map((id) => ({ field: 'body.districtIds', message: `${id} is not an active district` })),
          'Unknown or inactive district',
        );

      const repo = m.getRepository(UserDistrict);
      if (removed.length) await repo.update({ userId, districtId: In(removed), isDelete: false }, { isDelete: true, isActive: false });
      if (added.length) await repo.insert(added.map((districtId) => ({ userId, districtId })));
      if (removed.length || added.length)
        await auditService.recordInTx(m, req, {
          action: IPP_AUDIT.OFFICER_DISTRICTS,
          resource: 'user',
          resourceId: userId,
          details: { added, removed },
        });
      const [after] = await this.officers(m, userId);
      return after;
    });
  }
}

export const ippOfficersService = new IppOfficersService();
