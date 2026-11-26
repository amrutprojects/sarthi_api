/*
 * Startup rule of the link with IPP (src/modules/ipp-approvals, contract ipp_backend/docs/SARTHI_LINK.md section 5).
 * While the link is off everything may be empty: officers read and decide, the decisions wait. IPP_LINK_ENABLED=true needs
 * the address of IPP's API and the shared secret. Pure (no environment read, no exit), so unit tests cover it directly.
 * Messages name variables, never their values.
 */
export interface IppLinkSettings {
  IPP_LINK_ENABLED: boolean;
  IPP_API_URL?: string;
  IPP_LINK_SECRET?: string;
}

export const IPP_LINK_SECRET_MIN = 32;

/* The configuration problems, one line each; empty = fine. */
export function ippLinkConfigIssues(s: IppLinkSettings): string[] {
  if (!s.IPP_LINK_ENABLED) return [];
  const issues: string[] = [];
  if (!s.IPP_API_URL) issues.push('IPP_LINK_ENABLED=true needs IPP_API_URL (where the API of IPP answers, e.g. https://…/api/v1)');
  if (!s.IPP_LINK_SECRET) issues.push('IPP_LINK_ENABLED=true needs IPP_LINK_SECRET (the same value as in IPP)');
  else if (s.IPP_LINK_SECRET.length < IPP_LINK_SECRET_MIN)
    issues.push(`IPP_LINK_SECRET must be at least ${IPP_LINK_SECRET_MIN} characters`);
  return issues;
}

/* The link can be used: on, with everything it needs. */
export const ippLinkConfigured = (s: IppLinkSettings): boolean => s.IPP_LINK_ENABLED && ippLinkConfigIssues(s).length === 0;
