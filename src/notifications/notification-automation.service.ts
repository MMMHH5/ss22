import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

const DAY_MS = 24 * 60 * 60 * 1000;

type FollowUpCounts = { ungraded: number; absences: number };

@Injectable()
export class NotificationAutomationService {
    private readonly logger = new Logger(NotificationAutomationService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly notifications: NotificationsService,
    ) {}

    onApplicationBootstrap() {
        void this.runStartupCatchUp().catch((error) => {
            this.logger.error('Startup learning reminder catch-up failed', error);
        });
    }

    @Cron('0 8 * * *', { timeZone: 'Asia/Riyadh' })
    async runDailyReminders(now = new Date()) {
        const until = new Date(now.getTime() + DAY_MS);
        const since = new Date(now.getTime() - DAY_MS);
        try {
            await Promise.all([
                this.remindStudentsAboutTasks(now, until),
                this.remindStudentsAboutSessions(now, until),
                this.notifyInstructorsAboutFollowUps(since, now),
            ]);
        } catch (error) {
            this.logger.error('Daily learning reminders failed', error);
            throw error;
        }
    }

    private async runStartupCatchUp() {
        const now = new Date();
        const until = new Date(now.getTime() + DAY_MS);
        await Promise.all([
            this.remindStudentsAboutTasks(now, until),
            this.remindStudentsAboutSessions(now, until),
        ]);
        const hour = Number(new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Riyadh',
            hour: '2-digit',
            hourCycle: 'h23',
        }).format(now));
        if (hour >= 8) {
            await this.notifyInstructorsAboutFollowUps(new Date(now.getTime() - DAY_MS), now);
        }
    }

    private async remindStudentsAboutTasks(now: Date, until: Date) {
        const tasks = await this.prisma.courseTask.findMany({
            where: {
                dueDate: { gte: now, lte: until },
                opening: { enrollments: { some: { status: 'APPROVED' } } },
            },
            select: {
                id: true,
                titleAr: true,
                titleEn: true,
                dueDate: true,
                openingId: true,
                opening: {
                    select: {
                        enrollments: {
                            where: { status: 'APPROVED' },
                            select: { id: true, studentId: true },
                        },
                    },
                },
            },
        });
        if (tasks.length === 0) return;

        const taskIds = tasks.map((task) => task.id);
        const enrollmentIds = tasks.flatMap((task) => task.opening.enrollments.map((enrollment) => enrollment.id));
        const submissions = await this.prisma.taskSubmission.findMany({
            where: {
                taskId: { in: taskIds },
                enrollmentId: { in: enrollmentIds },
            },
            select: { taskId: true, enrollmentId: true },
        });
        const submitted = new Set(submissions.map((submission) => `${submission.taskId}:${submission.enrollmentId}`));
        const reminders = tasks.flatMap((task) => task.opening.enrollments
            .filter((enrollment) => !submitted.has(`${task.id}:${enrollment.id}`))
            .map((enrollment) => {
                const due = task.dueDate!;
                return {
                    userId: enrollment.studentId,
                    type: 'task.deadline-reminder',
                    titleAr: 'موعد تسليم واجب قريب',
                    titleEn: 'Assignment due soon',
                    bodyAr: `تبقى أقل من 24 ساعة على موعد تسليم "${task.titleAr}".`,
                    bodyEn: `The deadline for "${task.titleEn}" is within the next 24 hours.`,
                    data: { taskId: task.id, openingId: task.openingId, dueDate: due.toISOString() },
                    dedupeKey: `task-deadline:${task.id}:${enrollment.studentId}:${due.toISOString()}`,
                };
            }));
        await this.notifications.notifyManyOnce(reminders);
    }

    private async remindStudentsAboutSessions(now: Date, until: Date) {
        const sessions = await this.prisma.liveSession.findMany({
            where: { scheduledAt: { gte: now, lte: until } },
            select: {
                id: true,
                titleAr: true,
                titleEn: true,
                scheduledAt: true,
                openingId: true,
                opening: {
                    select: {
                        courseId: true,
                        enrollments: {
                            where: { status: 'APPROVED' },
                            select: { studentId: true },
                        },
                    },
                },
            },
        });
        const reminders = sessions.flatMap((session) => session.opening.enrollments.map((enrollment) => ({
            userId: enrollment.studentId,
            type: 'session.reminder',
            titleAr: 'جلسة تعليمية قريبة',
            titleEn: 'Upcoming learning session',
            bodyAr: `تبدأ جلسة "${session.titleAr}" خلال 24 ساعة.`,
            bodyEn: `The session "${session.titleEn}" starts within the next 24 hours.`,
            data: {
                sessionId: session.id,
                openingId: session.openingId,
                courseId: session.opening.courseId,
                scheduledAt: session.scheduledAt.toISOString(),
            },
            dedupeKey: `session-reminder:${session.id}:${enrollment.studentId}:${session.scheduledAt.toISOString()}`,
        })));
        await this.notifications.notifyManyOnce(reminders);
    }

    private async notifyInstructorsAboutFollowUps(since: Date, now: Date) {
        const [ungradedByTask, absencesBySession] = await Promise.all([
            this.prisma.taskSubmission.groupBy({
                by: ['taskId'],
                where: { score: null, enrollment: { status: 'APPROVED' } },
                _count: { _all: true },
            }),
            this.prisma.sessionAttendance.groupBy({
                by: ['sessionId'],
                where: {
                    status: 'ABSENT',
                    markedAt: { gte: since, lte: now },
                    enrollment: { status: 'APPROVED' },
                },
                _count: { _all: true },
            }),
        ]);
        const [tasks, sessions] = await Promise.all([
            ungradedByTask.length
                ? this.prisma.courseTask.findMany({
                    where: { id: { in: ungradedByTask.map((group) => group.taskId) } },
                    select: {
                        id: true,
                        opening: {
                            select: {
                                instructorId: true,
                                instructorGrants: {
                                    where: { canGrade: true },
                                    select: { instructorId: true },
                                },
                            },
                        },
                    },
                })
                : Promise.resolve([]),
            absencesBySession.length
                ? this.prisma.liveSession.findMany({
                    where: { id: { in: absencesBySession.map((group) => group.sessionId) } },
                    select: {
                        id: true,
                        opening: {
                            select: {
                                instructorId: true,
                                instructorGrants: {
                                    where: { OR: [{ canManageSessions: true }, { canViewAnalytics: true }] },
                                    select: { instructorId: true },
                                },
                            },
                        },
                    },
                })
                : Promise.resolve([]),
        ]);
        const taskById = new Map(tasks.map((task) => [task.id, task]));
        const sessionById = new Map(sessions.map((session) => [session.id, session]));
        const counts = new Map<string, FollowUpCounts>();
        const increment = (userId: string, field: keyof FollowUpCounts, amount: number) => {
            const count = counts.get(userId) ?? { ungraded: 0, absences: 0 };
            count[field] += amount;
            counts.set(userId, count);
        };
        for (const group of ungradedByTask) {
            const opening = taskById.get(group.taskId)?.opening;
            if (!opening) continue;
            increment(opening.instructorId, 'ungraded', group._count._all);
            for (const grant of opening.instructorGrants) increment(grant.instructorId, 'ungraded', group._count._all);
        }
        for (const group of absencesBySession) {
            const opening = sessionById.get(group.sessionId)?.opening;
            if (!opening) continue;
            increment(opening.instructorId, 'absences', group._count._all);
            for (const grant of opening.instructorGrants) increment(grant.instructorId, 'absences', group._count._all);
        }

        const dateKey = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Riyadh',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(now);
        const reminders = [...counts].map(([userId, count]) => ({
            userId,
            type: 'instructor.daily-follow-up',
            titleAr: 'ملخص متابعة الدفعات',
            titleEn: 'Daily batch follow-up',
            bodyAr: `لديك ${count.ungraded} واجبًا بانتظار التصحيح و${count.absences} حالة غياب مسجلة خلال آخر 24 ساعة.`,
            bodyEn: `You have ${count.ungraded} assignment(s) awaiting grading and ${count.absences} recorded absence(s) in the last 24 hours.`,
            data: { ungradedSubmissionCount: count.ungraded, absenceCount: count.absences },
            dedupeKey: `instructor-follow-up:${dateKey}:${userId}`,
        }));
        await this.notifications.notifyManyOnce(reminders);
    }
}
