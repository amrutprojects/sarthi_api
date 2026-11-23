/*
 * Which seed content an install receives (23 Nov 2026, "no test data on a live server").
 *
 * A LOCAL install (NODE_ENV development or test) gets everything, as before. Any other install —
 * staging or production — gets the RBAC catalogue, the reference masters and the website's real
 * texts, but none of the content that came from the website's former demo dataset:
 *
 *   - the five district / cluster coordinators (made-up names, masked phones, `@sumago.demo` e-mails);
 *   - the ten "approved training centres" (made-up centres and managers, masked phones);
 *   - the four AMRUT's Impact figures (computed from the demo dataset): the section is created
 *     hidden and empty, for an administrator to fill in and switch on;
 *   - the implementation partner's placeholder e-mail `programme@sumago.demo` (left empty).
 *
 * Pure: no configuration is read here, so tests can call it with any value.
 */
export type SeedNodeEnv = 'development' | 'test' | 'staging' | 'production';

export interface SeedOptions {
  /* True: also seed the website's former demo-dataset content (local installs only). */
  demoContent: boolean;
}

const LOCAL_NODE_ENVS: readonly string[] = ['development', 'test'];

export function isLocalInstall(nodeEnv: string | undefined): boolean {
  return LOCAL_NODE_ENVS.includes((nodeEnv ?? 'development').trim() || 'development');
}

export function seedOptionsFor(nodeEnv: string | undefined): SeedOptions {
  return { demoContent: isLocalInstall(nodeEnv) };
}

/* What a call with these options leaves out, for the seed run's log. */
export function demoContentSkipped(options: SeedOptions): string[] {
  if (options.demoContent) return [];
  return [
    'contact coordinators (demo dataset)',
    'contact training centres (demo dataset)',
    "AMRUT's Impact figures (demo dataset; section created hidden and empty)",
    'implementation partner placeholder e-mail (programme@sumago.demo)',
  ];
}

/* Defaults keep today's behaviour for every existing caller (tests, scripts). */
export const LOCAL_SEED_OPTIONS: SeedOptions = Object.freeze({ demoContent: true });
