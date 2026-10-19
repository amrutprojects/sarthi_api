import type { PublicRole, PublicUser } from '../auth';
import type { User } from './user.entity';

/* Strips passwordHash and soft-delete internals from API output. */
export function toPublicUser(u: User, roles?: PublicRole[]): PublicUser {
  const out: PublicUser = {
    id: u.id,
    name: u.name,
    email: u.email,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt ?? null,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
  if (roles) out.roles = roles;
  return out;
}
