import { z } from 'zod';

export const uuid = z.string().uuid('Must be a valid UUID');
export const idParams = z.object({ id: uuid });
export const statusBody = z.object({ isActive: z.boolean() }).strict();

/* Password policy: 10–128 chars with upper, lower and a digit. */
export const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a digit');

export const email = z.string().trim().toLowerCase().email('Must be a valid email address').max(255);
export const name = z.string().trim().min(1, 'Required').max(150);
export const description = z.string().trim().max(1000).nullable().optional();
export const idList = (field: string) => z.array(uuid).max(500, `Too many ${field}`);
