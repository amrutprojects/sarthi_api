import { z } from 'zod';
import { email } from './common.validator';

/* Login only checks shape; the password policy applies when passwords are set, not when they are tried. */
export const loginSchema = {
  body: z.object({
    email,
    password: z.string().min(1, 'Required').max(128),
  }).strict(),
};

export type LoginBody = z.infer<typeof loginSchema.body>;
