/*
 * Startup rule of the M1 Amrut → LMS link settings. Nothing about the Amrut tenant is preset: the LMS API host, the
 * tenant API key and the tenant code are entered by hand when the Amrut tenant is created in the LMS and the link is
 * set up. While the sync and the reads are off they may be empty. LMS_SYNC_ENABLED=true needs all three;
 * LMS_READS_ENABLED=true needs the host and the key (reads do not use the tenant code).
 * Pure (no environment read, no exit), so unit tests cover it directly. Messages name variables, never their values.
 */
export interface LmsLinkSettings {
  LMS_SYNC_ENABLED: boolean;
  LMS_READS_ENABLED?: boolean;
  LMS_EXTERNAL_BASE_URL?: string;
  LMS_TENANT_API_KEY?: string;
  LMS_TENANT_CODE?: string;
}

type LinkValue = 'LMS_EXTERNAL_BASE_URL' | 'LMS_TENANT_API_KEY' | 'LMS_TENANT_CODE';

export const LMS_SYNC_REQUIRED: readonly LinkValue[] = ['LMS_EXTERNAL_BASE_URL', 'LMS_TENANT_API_KEY', 'LMS_TENANT_CODE'];
export const LMS_READS_REQUIRED: readonly LinkValue[] = ['LMS_EXTERNAL_BASE_URL', 'LMS_TENANT_API_KEY'];

/* The configuration problems, one line each; empty = fine. */
export function lmsLinkConfigIssues(s: LmsLinkSettings): string[] {
  const issues: string[] = [];
  const check = (flag: string, required: readonly LinkValue[]) => {
    const missing = required.filter((k) => !s[k]);
    if (missing.length) issues.push(`${flag}=true needs ${missing.join(', ')} (enter the values set up for the Amrut tenant in the LMS)`);
  };
  if (s.LMS_SYNC_ENABLED) check('LMS_SYNC_ENABLED', LMS_SYNC_REQUIRED);
  if (s.LMS_READS_ENABLED) check('LMS_READS_ENABLED', LMS_READS_REQUIRED);
  return issues;
}
