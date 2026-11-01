import {
    Injectable,
    UnauthorizedException,
    ConflictException,
    ForbiddenException,
    BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { EncryptionService } from '../encryption/encryption.service';
import { getFrontendUrl } from '../common/frontend-url';
import { UserCacheService } from '../common/user-cache.service';
import { audienceForRole, permissionsForRole } from './permissions/permissions';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { generateSecret } from 'otplib';
import { verifyTotp } from '../common/totp';
import * as qrcode from 'qrcode';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import { Prisma, Role } from '@prisma/client';

export interface PublicUser {
    id: string;
    email: string;
    role: string;
    emailVerifiedAt: Date | null;
    twoFactorEnabled: boolean;
    language: string;
    isActive: boolean;
    createdAt: Date;
}

export type LoginResult =
    | { requiresTwoFactor: true; tempToken: string }
    | { requiresPasswordChange: true; tempToken: string }
    | { requiresTwoFactorSetup: true; tempToken: string }
    | { requiresTwoFactor: false; access_token: string; refresh_token: string; user: PublicUser };

@Injectable()
export class AuthService {
    constructor(
        private prisma: PrismaService,
        private jwtService: JwtService,
        private email: EmailService,
        private encryption: EncryptionService,
        private userCache: UserCacheService,
    ) {}

    private hashToken(token: string): string {
        return crypto.createHash('sha256').update(token).digest('hex');
    }

    private generateToken(): { raw: string; hash: string } {
        const raw = crypto.randomBytes(32).toString('hex');
        return { raw, hash: this.hashToken(raw) };
    }

    /**
     * Resolve who is configuring 2FA. Either an authenticated session supplies
     * `userId`, or the caller proves one-time knowledge of a legacy
     * `2fa_setup` challenge. A challenge for any other purpose
     * (2fa/pwd_change/ops) is rejected so a token cannot be re-purposed.
     */
    private resolveSetupIdentity(userId: string | undefined, tempToken?: string): { userId: string; fromChallenge: boolean } {
        if (tempToken) {
            let payload: any;
            try {
                payload = this.jwtService.verify(tempToken);
            } catch {
                throw new UnauthorizedException('Setup session expired. Please sign in again.');
            }
            if (payload.purpose !== '2fa_setup' || !payload.sub) {
                throw new UnauthorizedException('Invalid setup token');
            }
            return { userId: String(payload.sub), fromChallenge: true };
        }
        if (userId) {
            return { userId, fromChallenge: false };
        }
        throw new UnauthorizedException('Authentication required');
    }

    private appUrl(): string {
        return getFrontendUrl();
    }

    async register(dto: RegisterDto) {
        const existingUser = await this.prisma.user.findUnique({ where: { email: dto.email } });
        if (existingUser) throw new ConflictException('Email already in use');

        const hashedPassword = await bcrypt.hash(dto.password, 12);

        const metadata: Record<string, unknown> = {};
        if (dto.fullName) metadata.fullName = dto.fullName;
        if (dto.phone) metadata.phone = dto.phone;
        if (dto.gender) metadata.gender = dto.gender;
        if (dto.birthDate) metadata.birthDate = dto.birthDate;
        if (dto.university) metadata.university = dto.university;
        if (dto.specialty) metadata.specialty = dto.specialty;
        if (dto.studyStatus) metadata.studyStatus = dto.studyStatus;
        if (dto.studyLevel) metadata.studyLevel = dto.studyLevel;

        const user = await this.prisma.user.create({
            data: {
                email: dto.email,
                passwordHash: hashedPassword,
                role: 'STUDENT',
                metadata: Object.keys(metadata).length > 0 ? (metadata as Prisma.InputJsonObject) : undefined,
            },
        });

        await this.issueVerificationEmail(user.id, user.email);

        const tokens = await this.issueTokens(user.id, user.email, user.role, user.tokenVersion);
        return { ...tokens, user: this.publicUser(user) };
    }

    async login(dto: LoginDto): Promise<LoginResult> {
        const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
        if (!user) throw new UnauthorizedException('Invalid credentials');
        // Deliberately the same message and status as a wrong password. A
        // distinct "Account is suspended" reply — thrown before the bcrypt
        // comparison, so it was also the fast path — confirmed to anyone that
        // an address was registered and that it was disabled, which turns
        // /auth/login into an account-existence oracle. forgotPassword below
        // already returns {ok:true} unconditionally for the same reason.
        if (!user.isActive) throw new UnauthorizedException('Invalid credentials');

        const pwMatches = await bcrypt.compare(dto.password, user.passwordHash);
        if (!pwMatches) throw new UnauthorizedException('Invalid credentials');

        if (user.mustChangePassword) {
            const tempToken = this.jwtService.sign(
                { sub: user.id, email: user.email, role: user.role, purpose: 'pwd_change' },
                { expiresIn: '5m' }
            );
            return { requiresPasswordChange: true, tempToken };
        }

        if (user.twoFactorEnabled) {
            const tempToken = this.jwtService.sign(
                { sub: user.id, email: user.email, role: user.role, purpose: '2fa' },
                { expiresIn: '5m' }
            );
            return { requiresTwoFactor: true, tempToken };
        }

        const tokens = await this.issueTokens(user.id, user.email, user.role, user.tokenVersion);
        return { ...tokens, requiresTwoFactor: false, user: this.publicUser(user) };
    }

    async verify2FALogin(tempToken: string, code: string) {
        let payload: any;
        try {
            payload = this.jwtService.verify(tempToken);
        } catch {
            throw new UnauthorizedException('Two-factor session expired. Please sign in again.');
        }
        if (payload.purpose !== '2fa') throw new UnauthorizedException('Invalid two-factor token');

        const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
        if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
            throw new UnauthorizedException('Two-factor authentication is not enabled for this account');
        }
        const valid = await verifyTotp(code, this.encryption.decrypt(user.twoFactorSecret));
        if (!valid) throw new UnauthorizedException('Incorrect verification code');

        const tokens = await this.issueTokens(user.id, user.email, user.role, user.tokenVersion);
        return { ...tokens, user: this.publicUser(user) };
    }

    async changePasswordForced(tempToken: string, newPassword: string) {
        let payload: any;
        try {
            payload = this.jwtService.verify(tempToken);
        } catch {
            throw new UnauthorizedException('Password change session expired. Please sign in again.');
        }
        if (payload.purpose !== 'pwd_change') throw new UnauthorizedException('Invalid password change token');

        const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
        if (!user) throw new UnauthorizedException('User not found');
        if (!user.mustChangePassword) throw new BadRequestException('Password change is not required for this account');

        const hashed = await bcrypt.hash(newPassword, 12);

        await this.prisma.$transaction([
            this.prisma.user.update({
                where: { id: user.id },
                data: { passwordHash: hashed, mustChangePassword: false, tokenVersion: { increment: 1 } },
            }),
            this.prisma.refreshToken.updateMany({ where: { userId: user.id }, data: { revokedAt: new Date() } }),
        ]);
        await this.userCache.invalidate(user.id);

        return { ok: true };
    }

    private publicUser(user: { id: string; email: string; role: string; emailVerifiedAt: Date | null; twoFactorEnabled: boolean; language: string; isActive: boolean; createdAt: Date }) {
        return { id: user.id, email: user.email, role: user.role, emailVerifiedAt: user.emailVerifiedAt, twoFactorEnabled: user.twoFactorEnabled, language: user.language, isActive: user.isActive, createdAt: user.createdAt };
    }

    private async issueTokens(userId: string, email: string, role: string, tokenVersion: number) {
        // `aud` places the token on one side of the learner/admin boundary and
        // `permissions` mirrors the grant for the client's UI hints. Both are
        // advisory for the server: JwtStrategy re-derives permissions from the
        // CURRENT database role, so a token signed before a demotion or before
        // the permission map changed cannot carry that stale privilege into a
        // request. See docs/permission-map.md.
        const access_token = this.jwtService.sign({
            sub: userId,
            email,
            role,
            tv: tokenVersion,
            aud: audienceForRole(role),
            permissions: permissionsForRole(role),
        });
        const refresh = this.generateToken();
        await this.prisma.refreshToken.create({
            data: {
                tokenHash: refresh.hash,
                userId,
                // A fresh lineage per login. Rotations below keep this id, so a
                // replayed token can be traced to the family it belongs to.
                familyId: crypto.randomUUID(),
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
        });
        return { access_token, refresh_token: refresh.raw };
    }

    /**
     * Kill a refresh-token lineage and every access token alongside it.
     *
     * Called when a token that was already rotated comes back: the only way to
     * see one is that someone kept a copy, and we cannot tell whether it is the
     * attacker or the legitimate client, so both are sent back to the login
     * screen. Access tokens are covered by the tokenVersion bump; refresh tokens
     * by the family update. A row predating familyId has no family to scope to,
     * so the whole user is revoked rather than leaving the replay usable.
     */
    private async revokeFamily(familyId: string | null, userId: string): Promise<void> {
        await this.prisma.$transaction([
            this.prisma.refreshToken.updateMany({
                where: familyId ? { familyId } : { userId },
                data: { revokedAt: new Date() },
            }),
            this.prisma.user.update({
                where: { id: userId },
                data: { tokenVersion: { increment: 1 } },
            }),
        ]);
        await this.userCache.invalidate(userId);
    }

    async refresh(refreshToken: string) {
        const token = await this.prisma.refreshToken.findUnique({ where: { tokenHash: this.hashToken(refreshToken) } });

        // A row that exists but is already revoked is a replay: rotation revokes
        // the old row the moment it hands out the new one, so no legitimate
        // flow presents it again. Treat it as a compromise.
        if (token && token.revokedAt) {
            await this.revokeFamily(token.familyId, token.userId);
            throw new UnauthorizedException('Refresh token has already been used');
        }

        if (!token || token.expiresAt < new Date()) {
            throw new UnauthorizedException('Invalid or expired refresh token');
        }

        const user = await this.prisma.user.findUnique({ where: { id: token.userId } });
        if (!user || !user.isActive) throw new UnauthorizedException('Account not available');

        // Rotate the refresh token, keeping the family lineage intact.
        const newRefresh = this.generateToken();
        await this.prisma.$transaction([
            this.prisma.refreshToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } }),
            this.prisma.refreshToken.create({
                data: {
                    tokenHash: newRefresh.hash,
                    userId: user.id,
                    familyId: token.familyId,
                    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                },
            }),
        ]);

        // Same claims as issueTokens above -- refresh must not mint a weaker
        // (or differently shaped) token than login did.
        const access_token = this.jwtService.sign({
            sub: user.id,
            email: user.email,
            role: user.role,
            tv: user.tokenVersion,
            aud: audienceForRole(user.role),
            permissions: permissionsForRole(user.role),
        });
        return { access_token, refresh_token: newRefresh.raw };
    }

    async logout(userId: string, refreshToken?: string) {
        if (refreshToken) {
            await this.prisma.refreshToken.updateMany({
                where: { userId, tokenHash: this.hashToken(refreshToken) },
                data: { revokedAt: new Date() },
            });
        }
        // Revoking the refresh token alone left the access token that is already
        // in flight usable until it expired. Bumping tokenVersion invalidates
        // every access token for this user at once, and the cache invalidation
        // makes the new value visible on the very next request rather than after
        // the TTL.
        //
        // The scope is the user, not the device: other sessions lose their
        // access token too, but keep their refresh token, so they recover on the
        // next refresh rather than showing a login screen.
        await this.prisma.user.update({
            where: { id: userId },
            data: { tokenVersion: { increment: 1 } },
        });
        await this.userCache.invalidate(userId);
        return { ok: true };
    }

    async forgotPassword(email: string) {
        const user = await this.prisma.user.findUnique({ where: { email } });
        if (user) {
            const { raw, hash: tokenHash } = this.generateToken();
            await this.prisma.passwordResetToken.create({
                data: { tokenHash, userId: user.id, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
            });
            const resetUrl = `${this.appUrl()}/reset-password?token=${raw}`;
            await this.email.sendPasswordReset(user.email, resetUrl);
        }
        // Always respond OK to avoid user enumeration
        return { ok: true };
    }

    async resetPassword(token: string, newPassword: string) {
        const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: this.hashToken(token) } });
        if (!record || record.usedAt || record.expiresAt < new Date()) {
            throw new BadRequestException('Invalid or expired reset token');
        }

        const hashed = await bcrypt.hash(newPassword, 12);

        await this.prisma.$transaction([
            this.prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
            this.prisma.user.update({
                where: { id: record.userId },
                data: { passwordHash: hashed, mustChangePassword: false, tokenVersion: { increment: 1 } },
            }),
            this.prisma.refreshToken.updateMany({ where: { userId: record.userId }, data: { revokedAt: new Date() } }),
        ]);
        await this.userCache.invalidate(record.userId);

        return { ok: true };
    }

    async requestEmailVerification(userId: string, email: string) {
        const { raw, hash: tokenHash } = this.generateToken();
        await this.prisma.emailVerificationToken.create({
            data: { tokenHash, userId, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
        });
        const verifyUrl = `${this.appUrl()}/verify-email?token=${raw}`;
        await this.email.sendEmailVerification(email, verifyUrl);
        return { ok: true };
    }

    private async issueVerificationEmail(userId: string, email: string) {
        await this.requestEmailVerification(userId, email);
    }

    async verifyEmail(token: string, userId?: string) {
        const record = await this.prisma.emailVerificationToken.findUnique({ where: { tokenHash: this.hashToken(token) } });
        if (!record || record.usedAt || record.expiresAt < new Date()) {
            throw new BadRequestException('Invalid or expired verification token');
        }
        await this.prisma.$transaction([
            this.prisma.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
            this.prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
        ]);
        return { ok: true };
    }

    async setup2FA(userId: string | undefined, tempToken?: string) {
        const identity = this.resolveSetupIdentity(userId, tempToken);
        const user = await this.prisma.user.findUnique({ where: { id: identity.userId } });
        if (!user) throw new UnauthorizedException('User not found');

        const secret = generateSecret();
        const label = encodeURIComponent(`Laxalab:${user.email}`);
        const otpauth = `otpauth://totp/${label}?secret=${secret}&issuer=Laxalab&algorithm=SHA1&digits=6&period=30`;
        const qrDataUrl = await qrcode.toDataURL(otpauth);

        // Store the secret immediately so confirm can verify against it.
        // EncryptionService.encrypt() keeps the TOTP secret out of the DB in plaintext.
        await this.prisma.user.update({ where: { id: identity.userId }, data: { twoFactorSecret: this.encryption.encrypt(secret) } });

        return { secret, otpauth, qrDataUrl };
    }

    async confirm2FA(userId: string | undefined, code: string, tempToken?: string) {
        const identity = this.resolveSetupIdentity(userId, tempToken);
        const user = await this.prisma.user.findUnique({ where: { id: identity.userId } });
        if (!user || !user.twoFactorSecret) throw new BadRequestException('No pending 2FA setup');

        const valid = await verifyTotp(code, this.encryption.decrypt(user.twoFactorSecret));
        if (!valid) throw new BadRequestException('Incorrect verification code');

        await this.prisma.user.update({ where: { id: identity.userId }, data: { twoFactorEnabled: true } });

        // When the setup was started from the sign-in challenge, the password
        // was already proven at login and this code proves the second factor --
        // the same trust model as verify2FALogin -- so a full session is handed
        // out immediately. A user editing 2FA from an existing session keeps the
        // plain confirmation shape.
        if (identity.fromChallenge) {
            const tokens = await this.issueTokens(user.id, user.email, user.role, user.tokenVersion);
            return { ...tokens, user: this.publicUser(user), twoFactorEnabled: true };
        }
        return { ok: true, twoFactorEnabled: true };
    }

    async disable2FA(userId: string, password: string, code: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new UnauthorizedException('User not found');

        const pwMatches = await bcrypt.compare(password, user.passwordHash);
        if (!pwMatches) throw new BadRequestException('Password is incorrect');

        if (user.twoFactorEnabled) {
            if (!user.twoFactorSecret) throw new BadRequestException('Two-factor is not configured');
            const valid = await verifyTotp(code, this.encryption.decrypt(user.twoFactorSecret));
            if (!valid) throw new BadRequestException('Incorrect verification code');
        }

        await this.prisma.user.update({
            where: { id: userId },
            data: { twoFactorEnabled: false, twoFactorSecret: null },
        });
        return { ok: true, twoFactorEnabled: false };
    }

    async googleLogin(req: any): Promise<LoginResult> {
        if (!req.user) throw new UnauthorizedException('No user from google');

        const { email } = req.user;
        let user = await this.prisma.user.findUnique({ where: { email } });

        if (!user) {
            // Use a random bcrypt hash (not a sentinel string) to prevent timing-based user enumeration
            const randomHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
            user = await this.prisma.user.create({
                data: { email, passwordHash: randomHash, role: 'STUDENT', emailVerifiedAt: new Date() },
            });
        }

        if (!user.isActive) throw new ForbiddenException('Account is suspended');

        if (user.twoFactorEnabled) {
            const tempToken = this.jwtService.sign(
                { sub: user.id, email: user.email, role: user.role, purpose: '2fa' },
                { expiresIn: '5m' }
            );
            return { requiresTwoFactor: true, tempToken };
        }

        const tokens = await this.issueTokens(user.id, user.email, user.role, user.tokenVersion);
        return { ...tokens, requiresTwoFactor: false, user: this.publicUser(user) };
    }
}