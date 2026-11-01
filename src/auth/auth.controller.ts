import { Controller, Post, Body, HttpCode, HttpStatus, Get, UseGuards, Req, Res, Request } from '@nestjs/common';
import { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard';
import { getFrontendUrl } from '../common/frontend-url';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @ApiOperation({ summary: 'Register a new user' })
    @ApiResponse({ status: 201, description: 'User successfully created.' })
    @ApiResponse({ status: 409, description: 'Email already exists.' })
    @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 registrations per minute
    @Post('register')
    async register(@Body() registerDto: RegisterDto) {
        return this.authService.register(registerDto);
    }

    @ApiOperation({ summary: 'Login user and return JWT (returns two-factor challenge when enabled)' })
    @ApiResponse({ status: 200, description: 'User successfully logged in.' })
    @ApiResponse({ status: 401, description: 'Invalid credentials.' })
    @HttpCode(HttpStatus.OK)
    @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 login attempts per minute
    @Post('login')
    async login(@Body() loginDto: LoginDto) {
        return this.authService.login(loginDto);
    }

    @ApiOperation({ summary: 'Complete two-factor sign in with a verification code' })
    @HttpCode(HttpStatus.OK)
    @Throttle({ default: { limit: 10, ttl: 900000 } }) // 10 OTP attempts per 15 min (anti brute-force)
    @Post('2fa/verify-login')
    async verifyTwoFactor(@Body('tempToken') tempToken: string, @Body('code') code: string) {
        return this.authService.verify2FALogin(tempToken, code);
    }

    @ApiOperation({ summary: 'Set a new password when the account requires it (issued via login)' })
    @ApiResponse({ status: 200, description: 'Password changed successfully.' })
    @ApiResponse({ status: 401, description: 'Invalid or expired password-change token.' })
    @HttpCode(HttpStatus.OK)
    @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 changes per minute
    @Post('change-password')
    async changePassword(@Body() dto: ChangePasswordDto) {
        return this.authService.changePasswordForced(dto.tempToken, dto.newPassword);
    }

    @ApiOperation({ summary: 'Request a password reset email' })
    @HttpCode(HttpStatus.OK)
    @Throttle({ default: { limit: 3, ttl: 900000 } }) // 3 requests per 15 minutes
    @Post('forgot-password')
    async forgotPassword(@Body() dto: ForgotPasswordDto) {
        return this.authService.forgotPassword(dto.email);
    }

    @ApiOperation({ summary: 'Reset the password using a reset token' })
    @HttpCode(HttpStatus.OK)
    @Throttle({ default: { limit: 3, ttl: 900000 } }) // 3 attempts per 15 minutes
    @Post('reset-password')
    async resetPassword(@Body() dto: ResetPasswordDto) {
        return this.authService.resetPassword(dto.token, dto.newPassword);
    }

    @ApiOperation({ summary: 'Verify an email address using a token' })
    @HttpCode(HttpStatus.OK)
    @Post('verify-email')
    async verifyEmail(@Body() dto: VerifyEmailDto) {
        return this.authService.verifyEmail(dto.token);
    }

    @ApiOperation({ summary: 'Rotate a refresh token and issue a new access token' })
    @HttpCode(HttpStatus.OK)
    @Post('refresh')
    async refresh(@Body() dto: RefreshTokenDto) {
        return this.authService.refresh(dto.refreshToken);
    }

    @ApiOperation({ summary: 'Revoke a refresh token (sign out)' })
    @HttpCode(HttpStatus.OK)
    @Post('logout')
    @UseGuards(JwtAuthGuard)
    async logout(@Request() req: any, @Body('refreshToken') refreshToken?: string) {
        return this.authService.logout(req.user.userId, refreshToken);
    }

    // ---------- Authenticated 2FA management ----------

    @ApiOperation({ summary: 'Begin 2FA setup (returns secret + QR code)' })
    @ApiBearerAuth('JWT-auth')
    @Post('2fa/setup')
    @UseGuards(OptionalJwtAuthGuard)
    async setup2FA(@Request() req: any, @Body('tempToken') tempToken?: string) {
        // Identity comes from the Bearer session when present, otherwise from a
        // `2fa_setup` challenge so a privileged account that has not finished
        // the enforced enrollment can set itself up without a full session.
        return this.authService.setup2FA(req.user?.userId, tempToken);
    }

    @ApiOperation({ summary: 'Confirm and enable 2FA with a verification code' })
    @ApiBearerAuth('JWT-auth')
    @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 attempts per minute
    @Post('2fa/confirm')
    @UseGuards(OptionalJwtAuthGuard)
    async confirm2FA(@Request() req: any, @Body('code') code: string, @Body('tempToken') tempToken?: string) {
        return this.authService.confirm2FA(req.user?.userId, code, tempToken);
    }

    @ApiOperation({ summary: 'Disable 2FA (requires password + current code)' })
    @ApiBearerAuth('JWT-auth')
    @Post('2fa/disable')
    @UseGuards(JwtAuthGuard)
    async disable2FA(@Request() req: any, @Body('password') password: string, @Body('code') code: string) {
        return this.authService.disable2FA(req.user.userId, password, code);
    }

    @ApiOperation({ summary: 'Resend the email verification link' })
    @ApiBearerAuth('JWT-auth')
    @Post('resend-verification')
    @UseGuards(JwtAuthGuard)
    async resendVerification(@Request() req: any) {
        return this.authService.requestEmailVerification(req.user.userId, req.user.email);
    }

    @ApiOperation({ summary: 'Initiate Google Auth' })
    @Get('google')
    @UseGuards(AuthGuard('google'))
    async googleAuth(@Req() req: Request) {
        // Guard redirects
    }

    @ApiOperation({ summary: 'Google Auth Callback' })
    @Get('google/callback')
    @UseGuards(AuthGuard('google'))
    async googleAuthRedirect(@Req() req: Request, @Res() res: Response) {
        const result = await this.authService.googleLogin(req);
        const frontendUrl = getFrontendUrl();
        // Use hash fragments (#) instead of query params (?) to prevent tokens
        // from being logged in browser history, server logs, referrer headers, etc.
        if ('access_token' in result) {
            return res.redirect(
                `${frontendUrl}/auth/success#token=${encodeURIComponent(result.access_token)}&refresh=${encodeURIComponent(result.refresh_token)}`
            );
        }
        if ('requiresTwoFactor' in result && result.requiresTwoFactor) {
            return res.redirect(`${frontendUrl}/auth/success#twoFactor=1&tempToken=${encodeURIComponent(result.tempToken)}`);
        }
        // Privileged roles must enroll in 2FA even when they arrive via Google.
        if ('requiresTwoFactorSetup' in result && result.requiresTwoFactorSetup) {
            return res.redirect(
                `${frontendUrl}/auth/success#twoFactorSetup=1&tempToken=${encodeURIComponent(result.tempToken)}`
            );
        }
        // Google-created accounts have no password, so a forced password change
        // never applies to them; fall back to sign-in just in case.
        return res.redirect(`${frontendUrl}/login`);
    }
}