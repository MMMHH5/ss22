import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AnalyticsService } from '../src/analytics/analytics.service';

describe('student dashboard overview', () => {
    test('summarizes enrolled courses, actionable tasks, grading, and authorized upcoming sessions', async () => {
        const now = Date.now();
        const onlineEnrollment = {
            id: 'enrollment-online',
            courseId: 'course-online',
            openingId: 'opening-online',
            status: 'APPROVED',
            course: {
                id: 'course-online',
                titleAr: 'دورة مباشرة',
                titleEn: 'Live course',
                contentType: 'LIVE',
                _count: { modules: 4 },
            },
            opening: {
                id: 'opening-online',
                status: 'STARTED',
                nameAr: 'الدفعة الأولى',
                nameEn: 'Cohort one',
                deliveryMode: 'ONLINE',
                meetLink: 'https://example.test/online-room',
                liveSessions: [
                    {
                        id: 'future-online-session',
                        titleAr: 'جلسة قادمة',
                        titleEn: 'Upcoming session',
                        scheduledAt: new Date(now + 60 * 60_000),
                        durationMinutes: 60,
                        meetLink: null,
                    },
                    {
                        id: 'past-online-session',
                        titleAr: 'جلسة سابقة',
                        titleEn: 'Past session',
                        scheduledAt: new Date(now - 2 * 60 * 60_000),
                        durationMinutes: 60,
                        meetLink: null,
                    },
                ],
            },
            _count: { lessonProgress: 2 },
        };
        const inPersonEnrollment = {
            id: 'enrollment-in-person',
            courseId: 'course-in-person',
            openingId: 'opening-in-person',
            status: 'APPROVED',
            course: {
                id: 'course-in-person',
                titleAr: 'دورة حضورية',
                titleEn: 'In-person course',
                contentType: 'LIVE',
                _count: { modules: 2 },
            },
            opening: {
                id: 'opening-in-person',
                status: 'STARTED',
                nameAr: 'دفعة حضورية',
                nameEn: 'In-person cohort',
                deliveryMode: 'IN_PERSON',
                meetLink: 'https://example.test/private-room',
                liveSessions: [{
                    id: 'future-in-person-session',
                    titleAr: 'جلسة حضورية',
                    titleEn: 'In-person session',
                    scheduledAt: new Date(now + 2 * 60 * 60_000),
                    durationMinutes: 60,
                    meetLink: 'https://example.test/private-session-room',
                }],
            },
            _count: { lessonProgress: 1 },
        };
        const endedEnrollment = {
            id: 'enrollment-ended',
            courseId: 'course-ended',
            openingId: 'opening-ended',
            status: 'APPROVED',
            course: {
                id: 'course-ended',
                titleAr: 'دورة منتهية',
                titleEn: 'Completed course',
                contentType: 'RECORDED',
                _count: { modules: 2 },
            },
            opening: {
                id: 'opening-ended',
                status: 'ENDED',
                nameAr: 'دفعة منتهية',
                nameEn: 'Ended cohort',
                deliveryMode: null,
                meetLink: null,
                liveSessions: [],
            },
            _count: { lessonProgress: 2 },
        };
        const tasks = [
            {
                id: 'task-overdue',
                titleAr: 'مهمة متأخرة',
                titleEn: 'Overdue task',
                dueDate: new Date(now - 60_000),
                maxScore: 100,
                opening: {
                    id: 'opening-online',
                    nameAr: 'الدفعة الأولى',
                    nameEn: 'Cohort one',
                    course: { id: 'course-online', titleAr: 'دورة مباشرة', titleEn: 'Live course' },
                },
                submissions: [],
            },
            {
                id: 'task-upcoming',
                titleAr: 'مهمة قادمة',
                titleEn: 'Upcoming task',
                dueDate: new Date(now + 24 * 60 * 60_000),
                maxScore: 100,
                opening: {
                    id: 'opening-online',
                    nameAr: 'الدفعة الأولى',
                    nameEn: 'Cohort one',
                    course: { id: 'course-online', titleAr: 'دورة مباشرة', titleEn: 'Live course' },
                },
                submissions: [],
            },
            {
                id: 'task-no-deadline',
                titleAr: 'مهمة بلا موعد',
                titleEn: 'Task without deadline',
                dueDate: null,
                maxScore: 100,
                opening: {
                    id: 'opening-in-person',
                    nameAr: 'دفعة حضورية',
                    nameEn: 'In-person cohort',
                    course: { id: 'course-in-person', titleAr: 'دورة حضورية', titleEn: 'In-person course' },
                },
                submissions: [],
            },
            {
                id: 'task-submitted',
                titleAr: 'مهمة مسلّمة',
                titleEn: 'Submitted task',
                dueDate: new Date(now + 24 * 60 * 60_000),
                maxScore: 100,
                opening: {
                    id: 'opening-in-person',
                    nameAr: 'دفعة حضورية',
                    nameEn: 'In-person cohort',
                    course: { id: 'course-in-person', titleAr: 'دورة حضورية', titleEn: 'In-person course' },
                },
                submissions: [{ enrollmentId: 'enrollment-in-person', score: 85 }],
            },
            {
                id: 'task-awaiting-grade',
                titleAr: 'مهمة بانتظار التصحيح',
                titleEn: 'Task awaiting grade',
                dueDate: null,
                maxScore: 100,
                opening: {
                    id: 'opening-online',
                    nameAr: 'الدفعة الأولى',
                    nameEn: 'Cohort one',
                    course: { id: 'course-online', titleAr: 'دورة مباشرة', titleEn: 'Live course' },
                },
                submissions: [{ enrollmentId: 'enrollment-online', score: null }],
            },
        ];
        const prisma: any = {
            enrollment: {
                findMany: async () => [onlineEnrollment, inPersonEnrollment, endedEnrollment, {
                    ...onlineEnrollment,
                    id: 'enrollment-pending',
                    status: 'PENDING',
                    openingId: 'opening-pending',
                }],
            },
            courseOpening: { findMany: async () => [] },
            courseTask: { findMany: async () => tasks },
        };
        const service = new AnalyticsService(prisma);

        const dashboard = await service.getStudentDashboard('student-1');

        assert.deepEqual(dashboard.summary, {
            activeCourseCount: 2,
            completedCourseCount: 1,
            pendingTaskCount: 3,
            overdueTaskCount: 1,
            pendingGradingCount: 1,
        });
        assert.equal(dashboard.courses.find((course) => course.courseId === 'course-online')?.progressPercent, 50);
        assert.deepEqual(dashboard.tasks.map((task) => task.id), [
            'task-overdue',
            'task-upcoming',
            'task-no-deadline',
        ]);
        assert.equal(dashboard.tasks[0].isOverdue, true);
        assert.deepEqual(dashboard.upcomingSessions.map((session) => session.id), [
            'future-online-session',
            'future-in-person-session',
        ]);
        assert.equal(dashboard.upcomingSessions[0].meetLink, 'https://example.test/online-room');
        assert.equal(dashboard.upcomingSessions[1].meetLink, null);
    });
});
