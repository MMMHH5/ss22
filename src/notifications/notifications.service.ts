import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';

const DEFAULT_NOTIFICATION_PREFERENCES = {
    taskRemindersEnabled: true,
    sessionRemindersEnabled: true,
    instructorFollowUpEnabled: true,
};

interface NotifyInput {
    userId: string;
    type: string;
    titleAr: string;
    titleEn: string;
    bodyAr?: string;
    bodyEn?: string;
    data?: Record<string, unknown>;
    dedupeKey?: string;
    email?: { to: string; actionUrl?: string; actionLabelAr?: string; actionLabelEn?: string };
}

@Injectable()
export class NotificationsService {
    constructor(private prisma: PrismaService, private email: EmailService) {}

    async notify(input: NotifyInput) {
        const created = await this.prisma.notification.create({
            data: {
                userId: input.userId,
                type: input.type,
                titleAr: input.titleAr,
                titleEn: input.titleEn,
                bodyAr: input.bodyAr,
                bodyEn: input.bodyEn,
                data: (input.data ?? {}) as object,
                dedupeKey: input.dedupeKey,
            },
        });

        if (input.email?.to) {
            await this.email.sendLocalized(
                input.email.to,
                input.titleAr,
                input.bodyAr ?? '',
                input.titleEn,
                input.bodyEn ?? '',
                input.email.actionUrl,
                input.email.actionLabelAr,
                input.email.actionLabelEn,
            );
        }
        return created;
    }

    async notifyManyOnce(inputs: NotifyInput[]) {
        if (inputs.length === 0) return 0;
        const reminderTypes = new Set([
            'task.deadline-reminder',
            'session.reminder',
            'instructor.daily-follow-up',
        ]);
        const reminderInputs = inputs.filter((input) => reminderTypes.has(input.type));
        let eligibleInputs = inputs;
        if (reminderInputs.length > 0) {
            const preferences = await this.prisma.notificationPreference.findMany({
                where: { userId: { in: [...new Set(reminderInputs.map((input) => input.userId))] } },
            });
            const preferencesByUser = new Map(preferences.map((preference) => [preference.userId, preference]));
            eligibleInputs = inputs.filter((input) => {
                const preferences = preferencesByUser.get(input.userId);
                if (!preferences) return true;
                if (input.type === 'task.deadline-reminder') return preferences.taskRemindersEnabled;
                if (input.type === 'session.reminder') return preferences.sessionRemindersEnabled;
                if (input.type === 'instructor.daily-follow-up') return preferences.instructorFollowUpEnabled;
                return true;
            });
        }
        if (eligibleInputs.length === 0) return 0;
        const result = await this.prisma.notification.createMany({
            data: eligibleInputs.map((input) => ({
                userId: input.userId,
                type: input.type,
                titleAr: input.titleAr,
                titleEn: input.titleEn,
                bodyAr: input.bodyAr,
                bodyEn: input.bodyEn,
                data: (input.data ?? {}) as object,
                dedupeKey: input.dedupeKey,
            })),
            skipDuplicates: true,
        });
        return result.count;
    }

    async getPreferences(userId: string) {
        const preferences = await this.prisma.notificationPreference.findUnique({ where: { userId } });
        return preferences ?? { userId, ...DEFAULT_NOTIFICATION_PREFERENCES };
    }

    async updatePreferences(userId: string, preferences: UpdateNotificationPreferencesDto) {
        return this.prisma.notificationPreference.upsert({
            where: { userId },
            create: { userId, ...preferences },
            update: preferences,
        });
    }

    async list(userId: string) {
        return this.prisma.notification.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: 100,
        });
    }

    async unreadCount(userId: string) {
        return this.prisma.notification.count({ where: { userId, readAt: null } });
    }

    async markRead(userId: string, id: string) {
        return this.prisma.notification.updateMany({
            where: { id, userId },
            data: { readAt: new Date() },
        });
    }

    async markAllRead(userId: string) {
        return this.prisma.notification.updateMany({
            where: { userId, readAt: null },
            data: { readAt: new Date() },
        });
    }
}