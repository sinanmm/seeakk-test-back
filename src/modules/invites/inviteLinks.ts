import type { Request } from 'express';
import { getPublicFrontendUrl } from '../../config/publicUrls';
import { InviteError } from './invite.errors';

const trimTrailingSlashes = (value: string): string => value.trim().replace(/\/+$/, '');

const isHttpOrigin = (value: string): boolean => /^https?:\/\//i.test(value);

/**
 * Absolute URL for password setup / invite acceptance (`/invite/accept?token=…`).
 * Uses server FRONTEND_URL, or the admin UI origin when provided.
 */
export const buildInviteAcceptUrl = (rawToken: string, preferredBase?: string | null): string => {
  const token = rawToken.trim();
  if (!token) {
    throw new InviteError('Invite token is missing.', 500, 'INVITE_LINK_CONFIG');
  }

  const base = trimTrailingSlashes(preferredBase || getPublicFrontendUrl());
  if (!base || !isHttpOrigin(base)) {
    throw new InviteError(
      'Cannot build invite link. Set FRONTEND_URL on the server or open the admin app from your production domain.',
      503,
      'INVITE_LINK_CONFIG',
    );
  }

  return `${base}/invite/accept?token=${encodeURIComponent(token)}`;
};

/** Prefer the browser Origin/Referer so copied links match the admin UI the user is on. */
export const resolveAdminFrontendOrigin = (req: Pick<Request, 'headers'>): string | null => {
  const origin = req.headers.origin?.trim();
  if (origin && isHttpOrigin(origin)) {
    return trimTrailingSlashes(origin);
  }

  const referer = req.headers.referer?.trim();
  if (referer) {
    try {
      const parsed = new URL(referer);
      if (isHttpOrigin(parsed.origin)) {
        return trimTrailingSlashes(parsed.origin);
      }
    } catch {
      // ignore invalid referer
    }
  }

  return null;
};
