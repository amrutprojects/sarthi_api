import { z } from 'zod';
import { PAGINATION } from '../constants/app.constants';
import type { PaginationMeta } from '../http/api-response';

/*
 * Shared list-query schema: page, limit, free-text search, sort field / order and an optional
 * active filter. Each resource narrows `sortBy` to a whitelist of its own columns.
 */
export const listQuerySchema = <S extends readonly [string, ...string[]]>(sortable: S) =>
  z.object({
    page: z.coerce.number().int().min(1).default(PAGINATION.DEFAULT_PAGE),
    limit: z.coerce.number().int().min(1).max(PAGINATION.MAX_LIMIT).default(PAGINATION.DEFAULT_LIMIT),
    search: z.string().trim().max(100).optional(),
    sortBy: z.enum(sortable).default(sortable[0]),
    sortOrder: z.enum(['ASC', 'DESC', 'asc', 'desc']).default('DESC').transform((v) => v.toUpperCase() as 'ASC' | 'DESC'),
    isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  });

export interface ListQuery<SortField extends string = string> {
  page: number;
  limit: number;
  search?: string;
  sortBy: SortField;
  sortOrder: 'ASC' | 'DESC';
  isActive?: boolean;
}

export interface Paginated<T> {
  items: T[];
  meta: PaginationMeta;
}

export const toSkipTake = (q: Pick<ListQuery, 'page' | 'limit'>) => ({ skip: (q.page - 1) * q.limit, take: q.limit });

export const buildMeta = (q: Pick<ListQuery, 'page' | 'limit'>, total: number): PaginationMeta => ({
  page: q.page,
  limit: q.limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / q.limit)),
});

/* Escape LIKE wildcards in user input so search text is matched literally. */
export const likePattern = (s: string) => `%${s.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
