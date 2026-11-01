import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { NotificationAutomationService } from '../src/notifications/notification-automation.service';
import { NotificationsService } from '../src/notifications/notifications.service';

describe('automated learning notifications', () => {
    test('reminds only approved students without submissions about upcoming tasks and sessions', async () => {
        const calls: Array<{ model: string; args: any }> = [];
        const prisma: any = {
            courseTask: {
                findMany: async (args: any) => {
                    calls.push({ model: 'courseTask', args });
                    return [{
                        id: 'task-1',
                        titleAr: 'واجب',
                        titleEn: 'Assignment',
                        dueDate: new Date('2026-11-01T16:00:00.000Z'),
                        openingId: 'opening-1',
                        opening: {
                            enrollments: [
                                { id: 'enrollment-1', studentId: 'student-1' },
                                { id: 'enrollment-2', studentId: 'student-2' },
                            ],
                        },
                    }];
                },
            },
            taskSubmission: {
                findMany: async (args: any) => {
                    calls.push({ model: 'taskSubmission', args });
                    if (args.where.score === null) return [];
                    return [{ taskId: 'task-1', enrollmentId: 'enrollment-1' }];
                },
                groupBy: async (args: any) => {
                    calls.push({ model: 'taskSubmission.groupBy', args });
                    return [];
                },
            },
            liveSession: {
                findMany: async (args: any) => {
                    calls.push({ model: 'liveSession', args });
                    return [{
                        id: 'session-1',
                        titleAr: 'جلسة',
                        titleEn: 'Session',
                        scheduledAt: new Date('2026-11-01T15:00:00.000Z'),
                        openingId: 'opening-1',
                        opening: {
                            enrollments: [
                                { studentId: 'student-1' },
                                { studentId: 'student-2' },
                            ],
                        },
                    }];
                },
            },
            sessionAttendance: {
                findMany: async () => [],
                groupBy: async () => [],
            },
        };
        const sent: any[][] = [];
        const notifications = {
            notifyManyOnce: async (inputs: any[]) => {
                sent.push(inputs);
                return inputs.length;
            },
        };
        const service = new NotificationAutomationService(prisma, notifications as any);

        await service.runDailyReminders(new Date('2026-11-01T04:30:00.000Z'));

        const taskNotifications = sent.find((batch) => batch.some((item) => item.type === 'task.deadline-reminder'))!;
        assert.deepEqual(taskNotifications.map((item) => item.userId), ['student-2']);
        assert.match(taskNotifications[0].dedupeKey, /^task-deadline:task-1:student-2:/);
        const sessionNotifications = sent.find((batch) => batch.some((item) => item.type === 'session.reminder'))!;
        assert.deepEqual(sessionNotifications.map((item) => item.userId), ['student-1', 'student-2']);
        assert.ok(sessionNotifications.every((item) => item.dedupeKey.startsWith('session-reminder:session-1:')));
        const tasksQuery = calls.find((call) => call.model === 'courseTask')!.args;
        assert.equal(tasksQuery.where.dueDate.gte.toISOString(), '2026-11-01T04:30:00.000Z');
        assert.equal(tasksQuery.where.dueDate.lte.toISOString(), '2026-11-02T04:30:00.000Z');
    });

    test('sends daily follow-up counts to primary and capability-authorized assistant instructors', async () => {
        const prisma: any = {
            courseTask: {
                findMany: async (args: any) => args.where.id ? [
                    {
                        id: 'task-1',
                        opening: {
                            instructorId: 'primary-1',
                            instructorGrants: [{ instructorId: 'grader-1' }],
                        },
                    },
                    {
                        id: 'task-2',
                        opening: {
                            instructorId: 'primary-2',
                            instructorGrants: [],
                        },
                    },
                ] : [],
            },
            taskSubmission: {
                findMany: async () => [],
                groupBy: async () => [
                    { taskId: 'task-1', _count: { _all: 2 } },
                    { taskId: 'task-2', _count: { _all: 1 } },
                ],
            },
            sessionAttendance: {
                findMany: async () => [],
                groupBy: async () => [{
                    sessionId: 'session-1',
                    _count: { _all: 2 },
                }],
            },
            liveSession: {
                findMany: async (args: any) => args.where.id ? [{
                    id: 'session-1',
                    opening: {
                        instructorId: 'primary-1',
                        instructorGrants: [{ instructorId: 'session-helper' }],
                    },
                }] : [],
            },
        };
        const sent: any[][] = [];
        const notifications = {
            notifyManyOnce: async (inputs: any[]) => {
                sent.push(inputs);
                return inputs.length;
            },
        };
        const service = new NotificationAutomationService(prisma, notifications as any);

        await service.runDailyReminders(new Date('2026-11-01T04:30:00.000Z'));

        const digest = sent.find((batch) => batch.some((item) => item.type === 'instructor.daily-follow-up'))!;
        const byUser = new Map(digest.map((item) => [item.userId, item]));
        assert.equal(byUser.size, 4);
        assert.deepEqual(byUser.get('primary-1')?.data, { ungradedSubmissionCount: 2, absenceCount: 2 });
        assert.deepEqual(byUser.get('grader-1')?.data, { ungradedSubmissionCount: 2, absenceCount: 0 });
        assert.deepEqual(byUser.get('session-helper')?.data, { ungradedSubmissionCount: 0, absenceCount: 2 });
        assert.deepEqual(byUser.get('primary-2')?.data, { ungradedSubmissionCount: 1, absenceCount: 0 });
        assert.ok(digest.every((item) => item.dedupeKey.includes('2026-11-01')));
    });

    test('skips creating notifications when there is no reminder work', async () => {
        const prisma: any = {
            courseTask: { findMany: async () => [] },
            taskSubmission: {
                findMany: async () => [],
                groupBy: async () => [],
            },
            liveSession: { findMany: async () => [] },
            sessionAttendance: {
                findMany: async () => [],
                groupBy: async () => [],
            },
        };
        let callCount = 0;
        const notifications = {
            notifyManyOnce: async (inputs: any[]) => {
                callCount += inputs.length;
                return inputs.length;
            },
        };
        const service = new NotificationAutomationService(prisma, notifications as any);

        await service.runDailyReminders(new Date('2026-11-01T04:30:00.000Z'));

        assert.equal(callCount, 0);
    });

    test('uses the database unique key to suppress duplicate delivery across API instances', async () => {
        let args: any;
        const prisma: any = {
            notificationPreference: {
                findMany: async () => [],
            },
            notification: {
                createMany: async (input: any) => {
                    args = input;
                    return { count: 0 };
                },
            },
        };
        const service = new NotificationsService(prisma, {} as any);

        const created = await service.notifyManyOnce([{
            userId: 'student-1',
            type: 'session.reminder',
            titleAr: 'جلسة قريبة',
            titleEn: 'Upcoming session',
            dedupeKey: 'session-reminder:session-1:student-1',
        }]);

        assert.equal(created, 0);
        assert.equal(args.skipDuplicates, true);
        assert.equal(args.data[0].dedupeKey, 'session-reminder:session-1:student-1');
    });

    test('respects per-user reminder preferences without suppressing other notification categories', async () => {
        let createdData: any[] = [];
        const prisma: any = {
            notificationPreference: {
                findMany: async () => [
                    {
                        userId: 'student-1',
                        taskRemindersEnabled: false,
                        sessionRemindersEnabled: true,
                        instructorFollowUpEnabled: false,
                    },
                ],
            },
            notification: {
                createMany: async ({ data }: any) => {
                    createdData = data;
                    return { count: data.length };
                },
            },
        };
        const service = new NotificationsService(prisma, {} as any);

        const created = await service.notifyManyOnce([
            { userId: 'student-1', type: 'task.deadline-reminder', titleAr: 'واجب', titleEn: 'Task' },
            { userId: 'student-1', type: 'session.reminder', titleAr: 'جلسة', titleEn: 'Session' },
            { userId: 'student-2', type: 'task.deadline-reminder', titleAr: 'واجب', titleEn: 'Task' },
            { userId: 'student-1', type: 'other.notification', titleAr: 'أخرى', titleEn: 'Other' },
            { userId: 'student-1', type: 'instructor.daily-follow-up', titleAr: 'ملخص', titleEn: 'Summary' },
        ]);

        assert.equal(created, 3);
        assert.deepEqual(createdData.map((item) => item.type), [
            'session.reminder',
            'task.deadline-reminder',
            'other.notification',
        ]);
    });

    test('returns enabled defaults and updates only the selected preference fields', async () => {
        let upsertArgs: any;
        const prisma: any = {
            notificationPreference: {
                findUnique: async () => null,
                upsert: async (args: any) => {
                    upsertArgs = args;
                    return { userId: 'student-1', ...args.create };
                },
            },
        };
        const service = new NotificationsService(prisma, {} as any);

        assert.deepEqual(await service.getPreferences('student-1'), {
            userId: 'student-1',
            taskRemindersEnabled: true,
            sessionRemindersEnabled: true,
            instructorFollowUpEnabled: true,
        });
        await service.updatePreferences('student-1', { taskRemindersEnabled: false });

        assert.deepEqual(upsertArgs.create, { userId: 'student-1', taskRemindersEnabled: false });
        assert.deepEqual(upsertArgs.update, { taskRemindersEnabled: false });
    });
});
