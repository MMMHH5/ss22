import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';

/**
 * Phase 8 — origin split for the two administrative surfaces.
 *
 * The platform runs on one database but TWO API hostnames:
 *
 *   - PUBLIC (default): the learner/instructor API. `ADMIN_SURFACE` unset.
 *   - ADMIN (`ADMIN_SURFACE=1`): serves only sessions whose access token
 *     carries `aud: admin` (or an operations grant). Everything else is
 *     refused before any controller, guard or database read runs.
 *
 * The public surface may additionally be told to refuse admin sessions
 * (`DENY_ADMIN_AUD=1`) once the admin UI has moved to its own origin, which
 * closes the loop: an admin token is only ever useful against the admin host,
 * and a learner token only against the public host.
 *
 * CORS (allow-list, Phase 7) is the browser-side half of the same wall; this
 * gate is the server-side half, so it holds for curl and non-browser clients
 * too.
 */

/** Paths every surface serves without a session. */
const ALWAYS_OPEN = ['/health', '/socket.io'];

/** What a browser may call before it owns any token. */
const AUTH_OPEN = [
    '/auth/login',
    '/auth/refresh',
    '/auth/2fa/',
    '/auth/change-password',
    '/auth/forgot-password',
    '/auth/reset-password',
    '/auth/google',
];

export type Claims =
    | { state: 'ok'; payload: Record<string, unknown> }
    | { state: 'invalid' }
    | { state: 'absent' };

/** Verify the bearer token. Invalid and absent are different answers on purpose. */
export function readClaims(req: Request): Claims {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return { state: 'absent' };
    const secret = process.env.JWT_SECRET;
    if (!secret) return { state: 'absent' };
    try {
        return { state: 'ok', payload: jwt.verify(header.slice(7), secret, { algorithms: ['HS256'] }) as Record<string, unknown> };
    } catch {
        return { state: 'invalid' };
    }
}

function isOpen(path: string, prefix: string): boolean {
    return path === prefix || path.startsWith(prefix);
}

function deny(res: Response, message: string): void {
    res.status(403).json({ statusCode: 403, error: 'Forbidden', message });
}

export function surfaceGate(req: Request, res: Response, next: NextFunction): void {
    const path = req.path;

    if (process.env.ADMIN_SURFACE === '1') {
        if (req.method === 'POST' && path === '/operations/track') {
            next();
            return;
        }
        if ([...ALWAYS_OPEN, ...AUTH_OPEN].some((p) => isOpen(path, p))) {
            next();
            return;
        }
        const claims = readClaims(req);
        if (claims.state === 'ok' && (claims.payload.aud === 'admin' || claims.payload.opsGrant === true)) {
            next();
            return;
        }
        if (claims.state === 'invalid') {
            // 401, not 403: the session is stale, and the frontend's refresh
            // interceptor only renews on 401. A 403 here would surface as a
            // dead session instead of a silent refresh.
            res.status(401).json({ statusCode: 401, error: 'Unauthorized', message: 'Unauthorized' });
            return;
        }
        deny(res, 'This host serves admin sessions only.');
        return;
    }

    if (process.env.DENY_ADMIN_AUD === '1') {
        const claims = readClaims(req);
        if (claims.state === 'ok' && claims.payload.aud === 'admin') {
            deny(res, 'Admin sessions are served by the admin host.');
            return;
        }
    }

    next();
}
