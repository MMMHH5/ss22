import { createInterface, emitKeypressEvents } from 'node:readline';
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import Redis from 'ioredis';

const ADMIN_EMAIL = 'admin@laxalab.com';

function promptLine(question: string): Promise<string> {
    const readline = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        readline.question(question, (answer) => {
            readline.close();
            resolve(answer);
        });
    });
}

function promptHidden(question: string): Promise<string> {
    const input = process.stdin;
    if (!input.isTTY || !input.setRawMode) {
        return Promise.reject(new Error('Run this command in an interactive terminal so secrets can be entered without echo.'));
    }

    emitKeypressEvents(input);
    process.stdout.write(question);

    return new Promise((resolve, reject) => {
        let value = '';
        const finish = (error?: Error) => {
            input.removeListener('keypress', onKeypress);
            input.setRawMode(false);
            input.pause();
            process.stdout.write('\n');
            if (error) reject(error);
            else resolve(value);
        };
        const onKeypress = (sequence: string, key: { name?: string; ctrl?: boolean }) => {
            if (key.ctrl && key.name === 'c') {
                finish(new Error('Bootstrap cancelled.'));
            } else if (key.name === 'return' || key.name === 'enter') {
                finish();
            } else if (key.name === 'backspace') {
                value = value.slice(0, -1);
            } else if (!key.ctrl && sequence && !/[\u0000-\u001f\u007f]/.test(sequence)) {
                value += sequence;
            }
        };

        input.on('keypress', onKeypress);
        input.setRawMode(true);
        input.resume();
    });
}

function validateRenderDatabaseUrl(value: string): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error('The database URL is not valid.');
    }

    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname.endsWith('.render.com')) {
        throw new Error('Use the external PostgreSQL URL for laxalab-postgres from Render.');
    }
    return value;
}

function validateRenderRedisUrl(value: string): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error('The Redis URL is not valid.');
    }

    if (!['redis:', 'rediss:'].includes(url.protocol) || !url.hostname.endsWith('.render.com')) {
        throw new Error('Use the external Redis URL for laxalab-redis from Render.');
    }
    return value;
}

async function invalidateCachedUser(redisUrl: string, userId: string): Promise<void> {
    const redis = new Redis(redisUrl, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 5000,
    });

    try {
        await redis.connect();
        await redis.del(`auth:user:${userId}`);
        await redis.quit();
    } catch (error) {
        redis.disconnect();
        throw new Error(`Account was updated, but its cached identity could not be cleared: ${String(error)}`);
    }
}

async function main(): Promise<void> {
    console.log(`One-time provisioning for ${ADMIN_EMAIL}. No other accounts will be changed.`);

    const databaseUrl = validateRenderDatabaseUrl(
        await promptHidden('Render external PostgreSQL URL (input hidden): '),
    );
    const confirmation = await promptLine(`Type ${ADMIN_EMAIL} to authorize this operation: `);
    if (confirmation !== ADMIN_EMAIL) {
        console.log('Confirmation did not match; no changes were made.');
        return;
    }

    process.env.DATABASE_URL = databaseUrl;
    const prisma = new PrismaClient();
    try {
        const existing = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
        const action = existing ? 'RESET' : 'CREATE';
        const actionConfirmation = await promptLine(
            `This will ${action.toLowerCase()} the admin account. Type "${action} ${ADMIN_EMAIL}" to continue: `,
        );
        if (actionConfirmation !== `${action} ${ADMIN_EMAIL}`) {
            console.log('Confirmation did not match; no changes were made.');
            return;
        }

        const redisUrl = existing
            ? validateRenderRedisUrl(await promptHidden('Render external Redis URL (input hidden): '))
            : undefined;

        const password = await promptHidden('Enter a new admin password (minimum 12 characters, input hidden): ');
        const passwordConfirmation = await promptHidden('Confirm the new admin password: ');
        if (password !== passwordConfirmation) {
            throw new Error('The passwords do not match.');
        }
        if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
            throw new Error('Password must be at least 12 characters and no more than 72 UTF-8 bytes.');
        }

        const passwordHash = await bcrypt.hash(password, 12);
        const user = await prisma.$transaction(async (transaction) => {
            const current = await transaction.user.findUnique({ where: { email: ADMIN_EMAIL } });
            if (Boolean(current) !== Boolean(existing)) {
                throw new Error('The admin account changed while bootstrap was in progress; run the command again.');
            }
            if (current) {
                const updated = await transaction.user.update({
                    where: { id: current.id },
                    data: {
                        role: Role.ADMIN,
                        isActive: true,
                        passwordHash,
                        mustChangePassword: true,
                        twoFactorSecret: null,
                        twoFactorEnabled: false,
                        tokenVersion: { increment: 1 },
                    },
                });
                await transaction.refreshToken.updateMany({
                    where: { userId: current.id },
                    data: { revokedAt: new Date() },
                });
                return updated;
            }

            return transaction.user.create({
                data: {
                    email: ADMIN_EMAIL,
                    passwordHash,
                    role: Role.ADMIN,
                    mustChangePassword: true,
                },
            });
        });

        if (redisUrl) {
            await invalidateCachedUser(redisUrl, user.id);
        }

        console.log(`Admin account ${action === 'CREATE' ? 'created' : 'reset'} successfully.`);
        console.log('Sign in at https://laxalab-web-admin.onrender.com; you will be prompted to change the password and configure 2FA.');
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error: unknown) => {
    console.error(`Admin bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
});
