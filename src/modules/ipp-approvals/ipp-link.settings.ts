import { env } from '../../config/env.config';
import { ippLinkConfigured } from '../../config/ipp-link-config';
import { HTTP_STATUS } from '../../constants/api-response.constants';
import { AppError } from '../../shared/errors/app-error';
import { IPP_ERROR } from './ipp-approvals.constants';

export interface IppLink {
  /* IPP_LINK_ENABLED. */
  enabled: boolean;
  /* On, with everything it needs. */
  configured: boolean;
  /* Where IPP's API answers, without a trailing slash; '' = not entered. */
  baseUrl: string;
  /* Host of the address, for the admin panel; null = not entered. */
  host: string | null;
  secret: string;
  timeoutMs: number;
  intervalSeconds: number;
}

/* The settings of the link, read when used. */
export function ippLink(): IppLink {
  const baseUrl = (env.IPP_API_URL ?? '').replace(/\/+$/, '');
  return {
    enabled: env.IPP_LINK_ENABLED,
    configured: ippLinkConfigured(env),
    baseUrl,
    host: baseUrl ? new URL(baseUrl).host : null,
    secret: env.IPP_LINK_SECRET ?? '',
    timeoutMs: env.IPP_HTTP_TIMEOUT_MS,
    intervalSeconds: env.IPP_LINK_INTERVAL_SECONDS,
  };
}

export const linkNotConfigured = () =>
  new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, 'The link with IPP is not configured', IPP_ERROR.LINK_NOT_CONFIGURED);
