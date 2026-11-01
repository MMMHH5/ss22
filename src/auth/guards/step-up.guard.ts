import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../../encryption/encryption.service';
import { verifyTotp } from '../../common/totp';

/**
 * Step-up authentication for privileged mutations (refund decisions,
 * certificate revocation/re-issue, payment-gateway changes). RolesGuard and
 * PermissionsGuard prove WHAT role may act; this proves WHO is acting right
 * now, by re-presenting a fresh TOTP code pinned to the caller's own 2FA
 * secret.
 *
 * Rules:
 *  - The actor must have 2FA enabled with a stored secret. Disabling 2FA does
 *    not bypass this gate; privileged actions remain unavailable until it is
 *    enabled again.
 *  - The code is read from `x-step-up-code` (header) or `stepupCode` (body).
 *  - Every failure is a 403 with `stepUpRequired: true` so the frontend API
 *    layer can prompt for a code and transparently retry the identical request.
 *
 * Must run after JwtAuthGuard (it reads `req.user`).
 */
@Injectable()
export class StepUpGuard implements CanActivate {
    constructor(
        private readonly prisma: PrismaService,
        private readonly encryption: EncryptionService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context
            .switchToHttp()
            .getRequest<Request & { user?: { userId?: string; id?: string } }>();
        const userId = req.user?.userId ?? req.user?.id;
        if (!userId) throw new UnauthorizedException('Authentication required');

        const row = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { twoFactorEnabled: true, twoFactorSecret: true },
        });
        if (!row) throw new UnauthorizedException('Account not found');

        if (!row.twoFactorEnabled || !row.twoFactorSecret) {
            throw new ForbiddenException({
                statusCode: 403,
                message: 'A two-factor code is required for this action',
                stepUpRequired: true,
            });
        }

        const body = (req.body ?? {}) as { stepupCode?: unknown };
        const headerCode =
            typeof req.headers['x-step-up-code'] === 'string'
                ? (req.headers['x-step-up-code'] as string)
                : undefined;
        const rawCode = body.stepupCode ?? headerCode;

        if (typeof rawCode !== 'string' || !rawCode.trim()) {
            throw new ForbiddenException({
                statusCode: 403,
                message: 'A two-factor step-up code is required',
                stepUpRequired: true,
            });
        }

        const valid = await verifyTotp(rawCode.replace(/\D/g, ''), this.encryption.decrypt(row.twoFactorSecret));
        if (!valid) {
            throw new ForbiddenException({
                statusCode: 403,
                message: 'Invalid step-up code',
                stepUpRequired: true,
            });
        }

        return true;
    }
}