import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    ForbiddenException,
    UnauthorizedException,
    BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcryptjs';
import { generateSync, generateSecret } from 'otplib';
import { AuthService } from '../src/auth/auth.service';
import { StepUpGuard } from '../src/auth/guards/step-up.guard';
import { AdminBoundaryGuard } from '../src/auth/guards/admin-boundary.guard';
import { RolesGuard } from '../src/auth/guards/roles.guard';
import { PermissionsGuard } from '../src/auth/guards/permissions.guard';
import { Roles } from '../src/auth/decorators/roles.decorator';
import { RequirePermissions } from '../src/auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../src/auth/permissions/permissions';
import { corsOrigins } from '../src/common/cors-origins';

// AdminBoundaryGuard reads the secret at verify time.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-longer-than-32-chars-ok';

/**
 * Phase 5 (hardening) + Phase 6 (security tests) + Phase 7 (CORS allow-list)
 * for the boundary work. Every test drives the real guard/service with
 * doubles, so a future refactor that drops an enforcement step fails here
 * instead of in production.
 */

function makeAuthService(over: {
    user?: any;
    sign?: (p: any, o?: any) => string;
    verify?: (t: string) => any;
} = {}) {
    const secrets = new Map<string, string>();
    let stored: any = { ...(over.user ?? {}) };
    const encryption = {
        encrypt: (s: string) => {
            const key = `enc:${Math.random().toString(36).slice(2)}`;
            secrets.set(key, s);
            return key;
        },
        decrypt: (s: string) => secrets.get(s) ?? s,
    };
    const prisma = {
        user: {
            findUnique: async () => stored,
            update: async (a: any) => {
                stored = { ...stored, ...a.data };
                return stored;
            },
        },
        refreshToken: {
            create: async () => ({}),
            updateMany: async () => ({}),
            findUnique: async () => null,
        },
    };
    const svc = new AuthService(
        prisma as never,
        {
            sign: over.sign ?? (() => 'tok'),
            verify: over.verify ?? ((_t: string) => ({ sub: 'u1' })),
        } as never,
        { sendPasswordReset: async () => {}, sendEmailVerification: async () => {} } as never,
        encryption as never,
        { invalidate: async () => {} } as never,
    );
    return { svc, getStored: () => stored };
}

function fullUser(over: Record<string, unknown> = {}) {
    return {
        id: 'u1',
        email: 'admin@test.test',
        role: Role.ADMIN,
        passwordHash: '',
        mustChangePassword: false,
        twoFactorEnabled: false,
        twoFactorSecret: null,
        emailVerifiedAt: new Date(),
        language: 'ar',
        isActive: true,
        tokenVersion: 0,
        createdAt: new Date(),
        ...over,
    };
}

describe('PHASE 5: privileged roles (ADMIN/FINANCE) are forced to enable 2FA', () => {
    test('login for an ADMIN without 2FA returns a setup challenge, not tokens', async () => {
        const pwHash = await bcrypt.hash('pw', 4);
        const { svc } = makeAuthService({ user: fullUser({ passwordHash: pwHash }) });
        const out: any = await svc.login({ email: 'admin@test.test', password: 'pw' } as any);
        assert.equal(out.requiresTwoFactorSetup, true);
        assert.equal(typeof out.tempToken, 'string');
        assert.equal('access_token' in out, false, 'must not mint tokens while 2FA is off');
    });

    test('login for a FINANCE account without 2FA is gated the same way', async () => {
        const pwHash = await bcrypt.hash('pw', 4);
        const { svc } = makeAuthService({ user: fullUser({ role: Role.FINANCE, passwordHash: pwHash }) });
        const out: any = await svc.login({ email: 'admin@test.test', password: 'pw' } as any);
        assert.equal(out.requiresTwoFactorSetup, true);
    });

    test('an ADMIN that already has 2FA goes through the normal 2FA challenge', async () => {
        const pwHash = await bcrypt.hash('pw', 4);
        const { svc } = makeAuthService({
            user: fullUser({ passwordHash: pwHash, twoFactorEnabled: true }),
        });
        const out: any = await svc.login({ email: 'admin@test.test', password: 'pw' } as any);
        assert.equal(out.requiresTwoFactor, true);
        assert.equal(out.requiresTwoFactorSetup, undefined);
    });

    test('a STUDENT without 2FA still gets tokens (enforcement is admin-only)', async () => {
        const pwHash = await bcrypt.hash('pw', 4);
        const { svc } = makeAuthService({
            user: fullUser({ role: Role.STUDENT, passwordHash: pwHash }),
        });
        const out: any = await svc.login({ email: 'admin@test.test', password: 'pw' } as any);
        assert.equal(out.requiresTwoFactor, false);
        assert.equal(out.access_token, 'tok');
    });

    test('refresh refuses a privileged account that never enabled 2FA', async () => {
        const { svc } = makeAuthService({ user: fullUser() });
        (svc as any).prisma.refreshToken.findUnique = async () => ({
            id: 'r1',
            tokenHash: 'h',
            userId: 'u1',
            familyId: 'f1',
            revokedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
        });
        await assert.rejects(
            () => svc.refresh('raw-token'),
            (err: unknown) =>
                err instanceof UnauthorizedException && /two-factor/i.test(err.message),
        );
    });

    test('disable2FA is refused for ADMIN even with the right password', async () => {
        const pwHash = await bcrypt.hash('pw', 4);
        const { svc } = makeAuthService({
            user: fullUser({ passwordHash: pwHash, twoFactorEnabled: true }),
        });
        await assert.rejects(
            () => svc.disable2FA('u1', 'pw', '000000'),
            (err: unknown) =>
                err instanceof ForbiddenException && /cannot disable/i.test(err.message),
        );
    });
});

describe('PHASE 5: 2FA can be enrolled from the sign-in challenge (no session needed)', () => {
    const challengeVerify = (purpose = '2fa_setup') =>
        (_t: string) => ({ sub: 'u1', email: 'admin@test.test', role: Role.ADMIN, purpose });

    test('setup returns a secret; confirming a matching code enables 2FA and issues tokens', async () => {
        const { svc, getStored } = makeAuthService({ user: fullUser(), verify: challengeVerify() });
        const setup: any = await svc.setup2FA(undefined, 'challenge-token');
        assert.ok(setup.secret, 'a TOTP secret is returned');
        assert.ok(setup.qrDataUrl, 'a QR image is returned');

        const code = generateSync({ secret: setup.secret });
        const out: any = await svc.confirm2FA(undefined, code, 'challenge-token');
        assert.equal(getStored().twoFactorEnabled, true);
        assert.ok(getStored().twoFactorSecret, 'the (encrypted) secret is persisted');
        assert.equal(out.access_token, 'tok', 'challenge proves password + TOTP, so a session is issued');
        assert.equal(out.twoFactorEnabled, true);
    });

    test('confirm rejects the wrong code', async () => {
        const { svc } = makeAuthService({ user: fullUser(), verify: challengeVerify() });
        await svc.setup2FA(undefined, 'challenge-token');
        await assert.rejects(
            () => svc.confirm2FA(undefined, '000000', 'challenge-token'),
            (err: unknown) => err instanceof BadRequestException && /incorrect/i.test(err.message),
        );
    });

    test('a token meant for another flow cannot drive the setup', async () => {
        const { svc } = makeAuthService({ user: fullUser(), verify: challengeVerify('2fa') });
        await assert.rejects(
            () => svc.setup2FA(undefined, 'challenge-token'),
            (err: unknown) =>
                err instanceof UnauthorizedException && /invalid setup token/i.test(err.message),
        );
    });
});

describe('PHASE 5: StepUpGuard re-proves the caller for privileged mutations', () => {
    const makeGuard = (row: any) => {
        const encryption = {
            encrypt: (s: string) => `enc:${s}`,
            decrypt: (s: string) => s.replace(/^enc:/, ''),
        };
        return new StepUpGuard(
            { user: { findUnique: async () => row } } as never,
            encryption as never,
        );
    };
    const ctx = (over: { userId?: string; code?: string; header?: string } = {}) => {
        const req: any = {
            user: over.userId ? { userId: over.userId } : undefined,
            body: over.code !== undefined ? { stepupCode: over.code } : {},
            headers: over.header !== undefined ? { 'x-step-up-code': over.header } : {},
        };
        return { switchToHttp: () => ({ getRequest: () => req }) } as any;
    };

    const secret = generateSecret();
    const code = generateSync({ secret });

    test('passes with a valid fresh code (body)', async () => {
        const guard = makeGuard({ twoFactorEnabled: true, twoFactorSecret: `enc:${secret}` });
        assert.equal(await guard.canActivate(ctx({ userId: 'u1', code })), true);
    });

    test('reads the code from the header too', async () => {
        const guard = makeGuard({ twoFactorEnabled: true, twoFactorSecret: `enc:${secret}` });
        assert.equal(await guard.canActivate(ctx({ userId: 'u1', header: code })), true);
    });

    test('missing code is a 403 flagged stepUpRequired', async () => {
        const guard = makeGuard({ twoFactorEnabled: true, twoFactorSecret: `enc:${secret}` });
        await assert.rejects(
            () => guard.canActivate(ctx({ userId: 'u1' })),
            (err: unknown) =>
                err instanceof ForbiddenException &&
                (err.getResponse() as any).stepUpRequired === true,
        );
    });

    test('wrong code is likewise a flagged 403', async () => {
        const guard = makeGuard({ twoFactorEnabled: true, twoFactorSecret: `enc:${secret}` });
        await assert.rejects(
            () => guard.canActivate(ctx({ userId: 'u1', code: '000000' })),
            (err: unknown) =>
                err instanceof ForbiddenException &&
                (err.getResponse() as any).stepUpRequired === true,
        );
    });

    test('an actor without 2FA cannot step up', async () => {
        const guard = makeGuard({ twoFactorEnabled: false, twoFactorSecret: null });
        await assert.rejects(
            () => guard.canActivate(ctx({ userId: 'u1', code })),
            (err: unknown) =>
                err instanceof ForbiddenException &&
                (err.getResponse() as any).stepUpRequired === true,
        );
    });

    test('no authenticated caller is refused', async () => {
        const guard = makeGuard({ twoFactorEnabled: true });
        await assert.rejects(
            () => guard.canActivate(ctx({})),
            (err: unknown) => err instanceof UnauthorizedException,
        );
    });
});

describe('PHASE 6: the learner/admin boundary rejects every crossing shape', () => {
    const sign = (payload: Record<string, unknown>) =>
        jwt.sign(payload, process.env.JWT_SECRET!, { algorithm: 'HS256' });
    const guard = new AdminBoundaryGuard();
    const ctxFor = (path: string, token?: string) => {
        const req: any = {
            path,
            url: path,
            headers: token ? { authorization: `Bearer ${token}` } : {},
        };
        return { switchToHttp: () => ({ getRequest: () => req }) } as any;
    };

    test('an admin-audience token passes', () => {
        const tok = sign({ sub: 'a1', role: Role.ADMIN, aud: 'admin' });
        assert.equal(guard.canActivate(ctxFor('/api/admin/audit', tok)), true);
    });

    test('a learner-audience token is forbidden on /api/admin/*', () => {
        const tok = sign({ sub: 's1', role: Role.STUDENT, aud: 'learner' });
        assert.throws(
            () => guard.canActivate(ctxFor('/api/admin/audit', tok)),
            (err: unknown) => err instanceof ForbiddenException,
        );
    });

    test('single-purpose tokens are rejected as access tokens', () => {
        const purpose = sign({ sub: 'a1', purpose: '2fa' });
        assert.throws(
            () => guard.canActivate(ctxFor('/api/admin/audit', purpose)),
            (err: unknown) => err instanceof UnauthorizedException,
        );
        const ops = sign({ sub: 'a1', opsGrant: true });
        assert.throws(
            () => guard.canActivate(ctxFor('/api/admin/audit', ops)),
            (err: unknown) => err instanceof UnauthorizedException,
        );
    });

    test('no token at all is refused', () => {
        assert.throws(
            () => guard.canActivate(ctxFor('/api/admin/audit')),
            (err: unknown) => err instanceof UnauthorizedException,
        );
    });

    test('learner-prefixed paths are untouched by the boundary guard (prefix, not suffix)', () => {
        const tok = sign({ sub: 's1', role: Role.STUDENT, aud: 'learner' });
        assert.equal(guard.canActivate(ctxFor('/courses', tok)), true);
        // A naive "ends with admin" matcher would wrongly break this existing
        // learner route; the guard is deliberately prefix-based.
        assert.equal(guard.canActivate(ctxFor('/enrollments/admin/1', tok)), true);
    });
});

describe('PHASE 6: role + permission guards deny privilege escalation', () => {
    test('RolesGuard refuses a STUDENT on a finance-only route', () => {
        class FinanceRoute {
            @Roles(Role.FINANCE, Role.ADMIN)
            review() {}
        }
        const guard = new RolesGuard(new Reflector());
        const ctx = (role: string) =>
            ({
                getHandler: () => FinanceRoute.prototype.review,
                getClass: () => FinanceRoute,
                switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
            }) as any;
        assert.throws(
            () => guard.canActivate(ctx(Role.STUDENT)),
            (err: unknown) => err instanceof ForbiddenException,
        );
        assert.equal(guard.canActivate(ctx(Role.ADMIN)), true);
        assert.equal(guard.canActivate(ctx(Role.FINANCE)), true);
    });

    test('PermissionsGuard denies a missing permission and allows the grant', () => {
        class RefundReview {
            @RequirePermissions(PERMISSIONS.REFUNDS_REVIEW)
            review() {}
        }
        const guard = new PermissionsGuard(new Reflector());
        const ctx = (permissions?: string[]) =>
            ({
                getHandler: () => RefundReview.prototype.review,
                getClass: () => RefundReview,
                switchToHttp: () => ({
                    getRequest: () => ({ user: permissions ? { permissions } : {} }),
                }),
            }) as any;
        assert.throws(
            () => guard.canActivate(ctx([])),
            (err: unknown) => err instanceof ForbiddenException,
        );
        assert.equal(guard.canActivate(ctx([PERMISSIONS.REFUNDS_REVIEW])), true);
    });
});

describe('PHASE 7: CORS is an allow-list, not a single trusted origin', () => {
    const previousFrontend = process.env.FRONTEND_URL;
    const previousCors = process.env.CORS_ORIGINS;
    const previousAdminSurface = process.env.ADMIN_SURFACE;

    test('learner API allows its Render frontend and custom learner domains', () => {
        delete process.env.ADMIN_SURFACE;
        process.env.FRONTEND_URL = 'https://app.example.com';
        delete process.env.CORS_ORIGINS;
        assert.deepEqual(corsOrigins(), [
            'https://app.example.com',
            'https://laxalab.com',
            'https://www.laxalab.com',
        ]);
    });

    test('admin API only allows its configured frontend by default', () => {
        process.env.ADMIN_SURFACE = '1';
        process.env.FRONTEND_URL = 'https://admin.example.com';
        delete process.env.CORS_ORIGINS;
        assert.deepEqual(corsOrigins(), ['https://admin.example.com']);
    });

    test('CORS_ORIGINS adds origins and deduplicates', () => {
        delete process.env.ADMIN_SURFACE;
        process.env.FRONTEND_URL = 'https://app.example.com';
        process.env.CORS_ORIGINS =
            'https://admin.example.com, https://app.example.com, https://pay.example.com, https://laxalab.com';
        assert.deepEqual(corsOrigins(), [
            'https://app.example.com',
            'https://laxalab.com',
            'https://www.laxalab.com',
            'https://admin.example.com',
            'https://pay.example.com',
        ]);
    });

    test('an origin outside the list is never accepted', () => {
        delete process.env.ADMIN_SURFACE;
        process.env.FRONTEND_URL = 'https://learner.example.com';
        process.env.CORS_ORIGINS = 'https://learner.example.com';
        const list = corsOrigins();
        assert.ok(!list.includes('https://evil.example.com'), 'unknown origins never appear');
        assert.equal(list.length, 3, 'only configured Render and LaxaLab origins appear');
    });

    test('restores the environment', () => {
        if (previousFrontend === undefined) delete process.env.FRONTEND_URL;
        else process.env.FRONTEND_URL = previousFrontend;
        if (previousCors === undefined) delete process.env.CORS_ORIGINS;
        else process.env.CORS_ORIGINS = previousCors;
        if (previousAdminSurface === undefined) delete process.env.ADMIN_SURFACE;
        else process.env.ADMIN_SURFACE = previousAdminSurface;
        assert.ok(true);
    });
});