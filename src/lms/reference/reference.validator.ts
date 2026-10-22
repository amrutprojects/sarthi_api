import { z } from 'zod';
import { uuid } from '../../shared/validation/common.validation';
import { listQueryAscSchema } from '../../shared/utils/pagination';

/*
 * Reference Data is read-only, so the only inputs are list queries: page, limit (≤ 100), search, sortBy from a
 * whitelist, sortOrder (ascending by default) and the isActive filter. The first sortable field is the default.
 */
export const listReferenceDistrictsSchema = {
  query: listQueryAscSchema(['name', 'code', 'stateName', 'updatedAt'] as const),
};

export const listReferenceCentresSchema = {
  query: listQueryAscSchema(['name', 'code', 'districtName', 'centreTypeName', 'talukaName', 'updatedAt'] as const),
};

/* Tracks read in the Admin Panel's order (sortOrder, T01 → T12) unless another column is chosen. */
export const listReferenceTracksSchema = {
  query: listQueryAscSchema(['sortOrder', 'code', 'name', 'updatedAt'] as const),
};

/* Dropdown feeds: optionally only the centres / tracks enabled for one LMS entity. */
export const referenceOptionsSchema = {
  query: z.object({ entityId: uuid.optional() }).strict(),
};

export type ListReferenceDistrictsQuery = z.infer<typeof listReferenceDistrictsSchema.query>;
export type ReferenceOptionsQuery = z.infer<typeof referenceOptionsSchema.query>;
export type ListReferenceCentresQuery = z.infer<typeof listReferenceCentresSchema.query>;
export type ListReferenceTracksQuery = z.infer<typeof listReferenceTracksSchema.query>;
