import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as jwt from 'jsonwebtoken';
import { surfaceGate, readClaims } from '../src/common/surface-gate';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-longer-than-32-chars-ok';

/**
 * Phase 8 — the server-side half of the origin split. The gate decides which
 * audience a host serves before any controller, guard or database read runs:
 * the admin host only ever answers admin sessions, and (once enabled) the
 * public host never answers one. Every test drives the real middleware.
 */

const SECRET = process.env.JWT_SECRET!;
const SAVED: Record<string, string | undefined> = {};

function saveEnv(keys: string[]) {
    for (const k of keys) SAVED[k] = process.env[k];
}
function restoreEnv() {
    for (const [k, v] of Object.entries(SAVED)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
        delete SAVED[k];
    }
}

function token(claims: Record<string, unknown>) {
    return jwt.sign(claims, SECRET, { algorithm: 'HS256', expiresIn: '10m' });
}

function call(opts: { path: string; method?: string; bearer?: string }) {
    let status = 0;
    let body: any = null;
    let passed = false;
    const req: any = {
        path: opts.path,
        method: opts.method || 'GET',
        headers: opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : {},
    };
    const res: any = {
        status(s: number) {
            status = s;
            return this;
        },
        json(b: any) {
            body = b;
            return this;
        },
    };
    surfaceGate(req, res, () => { passed = true; });
    return { status, body, passed };
}

beforeEach(() => saveEnv(['ADMIN_SURFACE', 'DENY_ADMIN_AUD']));
afterEach(restoreEnv);

describe('ADMIN_SURFACE=1 (admin host)', () => {
    test('an anonymous request to a platform route is refused', () => {
        process.env.ADMIN_SURFACE = '1';
        const r = call({ path: '/courses' });
        assert.equal(r.passed, false);
        assert.equal(r.status, 403);
        assert.match(r.body.message, /admin sessions only/i);
    });

    test('a learner-audience token is refused', () => {
        process.env.ADMIN_SURFACE = '1';
        const r = call({ path: '/courses', bearer: token({ sub: 's1', aud: 'learner' }) });
        assert.equal(r.status, 403);
        assert.equal(r.passed, false);
    });

    test('an admin-audience token reaches the app', () => {
        process.env.ADMIN_SURFACE = '1';
        const r = call({ path: '/api/admin/users', bearer: token({ sub: 'a1', aud: 'admin' }) });
        assert.equal(r.passed, true);
        assert.equal(r.status, 0);
    });

    test('an operations grant reaches the app', () => {
        process.env.ADMIN_SURFACE = '1';
        const r = call({ path: '/operations', bearer: token({ sub: 'a1', opsGrant: true, kv: 1 }) });
        assert.equal(r.passed, true);
    });

    test('the handshake stays open without a token', () => {
        process.env.ADMIN_SURFACE = '1';
        for (const path of [
            '/auth/login',
            '/auth/refresh',
            '/auth/2fa/setup',
            '/auth/change-password',
            '/auth/google',
            '/auth/google/callback',
            '/health',
            '/socket.io/',
        ]) {
            assert.equal(call({ path }).passed, true, `${path} must be reachable anonymously`);
        }
    });

    test('anonymous client tracking is open only for its POST endpoint', () => {
        process.env.ADMIN_SURFACE = '1';
        assert.equal(call({ path: '/operations/track', method: 'POST' }).passed, true);
        assert.equal(call({ path: '/operations/track', method: 'GET' }).status, 403);
        assert.equal(call({ path: '/operations' }).status, 403);
        assert.equal(call({ path: '/operations/track/extra', method: 'POST' }).status, 403);
    });

    test('registration is NOT part of the handshake', () => {
        process.env.ADMIN_SURFACE = '1';
        assert.equal(call({ path: '/auth/register' }).status, 403);
    });

    test('a stale token answers 401 so the refresh interceptor can renew it', () => {
        process.env.ADMIN_SURFACE = '1';
        const r = call({ path: '/courses', bearer: 'not-a-jwt' });
        assert.equal(r.status, 401);
        assert.equal(r.passed, false);
    });

    test('a stale token on an open path still passes', () => {
        process.env.ADMIN_SURFACE = '1';
        assert.equal(call({ path: '/auth/login', bearer: 'not-a-jwt' }).passed, true);
    });

    test('the public host (flag unset) behaves as before: everything passes the gate', () => {
        const r = call({ path: '/courses', bearer: token({ sub: 'a1', aud: 'admin' }) });
        assert.equal(r.passed, true);
    });
});

describe('DENY_ADMIN_AUD=1 (public host closes the loop)', () => {
    test('an admin token is refused on the public host', () => {
        process.env.DENY_ADMIN_AUD = '1';
        const r = call({ path: '/api/admin/users', bearer: token({ sub: 'a1', aud: 'admin' }) });
        assert.equal(r.status, 403);
        assert.equal(r.passed, false);
        assert.match(r.body.message, /admin host/i);
    });

    test('a learner token still passes', () => {
        process.env.DENY_ADMIN_AUD = '1';
        assert.equal(call({ path: '/courses', bearer: token({ sub: 's1', aud: 'learner' }) }).passed, true);
    });

    test('an operations grant still passes', () => {
        process.env.DENY_ADMIN_AUD = '1';
        assert.equal(call({ path: '/operations', bearer: token({ sub: 'a1', opsGrant: true, kv: 1 }) }).passed, true);
    });

    test('an invalid token falls through to the guards instead of being gate-denied', () => {
        process.env.DENY_ADMIN_AUD = '1';
        assert.equal(call({ path: '/courses', bearer: 'garbage' }).passed, true);
    });

    test('the handshake stays open on the public host', () => {
        process.env.DENY_ADMIN_AUD = '1';
        assert.equal(call({ path: '/auth/login' }).passed, true);
    });
});

describe('readClaims', () => {
    test('distinguishes absent, invalid and valid', () => {
        assert.equal(readClaims({ headers: {} } as any).state, 'absent');
        assert.equal(readClaims({ headers: { authorization: 'Bearer zzz' } } as any).state, 'invalid');
        const ok = readClaims({ headers: { authorization: `Bearer ${token({ sub: 'x' })}` } } as any);
        assert.equal(ok.state, 'ok');
        assert.equal((ok as any).payload.sub, 'x');
    });

    test('a token signed with a different secret is invalid, not absent', () => {
        const foreign = jwt.sign({ sub: 'evil' }, 'another-secret-entirely-32-chars', { algorithm: 'HS256' });
        assert.equal(readClaims({ headers: { authorization: `Bearer ${foreign}` } } as any).state, 'invalid');
    });
});
