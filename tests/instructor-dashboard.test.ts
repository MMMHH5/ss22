import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AnalyticsService } from '../src/analytics/analytics.service';

function makeService(overrides: {
    openings?: any[];
    enrollments?: any[];
    tasks?: any[];
    submissionsByEnrollment?: any[];
    attendanceByEnrollment?: any[];
    ungradedCount?: number;
    sessions?: any[];
} = {}) {
    const calls: Array<{ model: string; args: any }> = [];
    const prisma: any = {
        courseOpening: {
            findMany: async (args: any) => {
                calls.push({ model: 'courseOpening', args });
                return overrides.openings ?? [];
            },
        },
        enrollment: {
            findMany: async (args: any) => {
                calls.push({ model: 'enrollment', args });
                return overrides.enrollments ?? [];
            },
        },
        courseTask: {
            findMany: async (args: any) => {
                calls.push({ model: 'courseTask', args });
                return overrides.tasks ?? [];
            },
        },
        taskSubmission: {
            count: async (args: any) => {
                calls.push({ model: 'taskSubmission', args });
                return overrides.ungradedCount ?? 0;
            },
            groupBy: async (args: any) => {
                calls.push({ model: 'taskSubmission.groupBy', args });
                return overrides.submissionsByEnrollment ?? [];
            },
        },
        sessionAttendance: {
            groupBy: async (args: any) => {
                calls.push({ model: 'sessionAttendance.groupBy', args });
                return overrides.attendanceByEnrollment ?? [];
            },
        },
        liveSession: {
            findMany: async (args: any) => {
                calls.push({ model: 'liveSession', args });
                return overrides.sessions ?? [];
            },
        },
    };
    return { service: new AnalyticsService(prisma), calls };
}

describe('instructor dashboard summary', () => {
    test('an instructor with no batches receives an empty summary without extra queries', async () => {
        const { service, calls } = makeService();
        const summary = await service.getInstructorDashboard('instructor-1');

        assert.deepEqual(summary, {
            openingCount: 0,
            activeOpeningCount: 0,
            approvedStudentCount: 0,
            ungradedSubmissionCount: 0,
            openings: [],
            openingReports: [],
            upcomingSessions: [],
        });
        assert.deepEqual(calls.map((call) => call.model), ['courseOpening']);
    });

    test('summary counts approved students, ungraded work, active batches and upcoming sessions', async () => {
        const openings = [
            { id: 'opening-1', status: 'STARTED', instructorId: 'instructor-1', instructorGrants: [], course: { id: 'course-1' } },
            { id: 'opening-2', status: 'ENDED', instructorId: 'instructor-1', instructorGrants: [], course: { id: 'course-2' } },
            { id: 'opening-3', status: 'OPEN', instructorId: 'instructor-1', instructorGrants: [], course: { id: 'course-3' } },
        ];
        const sessions = [{ id: 'session-1', opening: { id: 'opening-1' } }];
        const { service, calls } = makeService({
            openings,
            enrollments: Array.from({ length: 12 }, (_, index) => ({
                id: `enrollment-${index}`,
                openingId: openings[index % openings.length].id,
            })),
            ungradedCount: 4,
            sessions,
        });

        const summary = await service.getInstructorDashboard('instructor-1');
        assert.equal(summary.openingCount, 3);
        assert.equal(summary.activeOpeningCount, 2);
        assert.equal(summary.approvedStudentCount, 12);
        assert.equal(summary.ungradedSubmissionCount, 4);
        assert.deepEqual(summary.upcomingSessions, sessions);

        const openingQuery = calls.find((call) => call.model === 'courseOpening')!.args;
        assert.deepEqual(openingQuery.where, {
            OR: [
                { instructorId: 'instructor-1' },
                { instructorGrants: { some: { instructorId: 'instructor-1' } } },
            ],
        });
        const enrollmentQuery = calls.find((call) => call.model === 'enrollment')!.args;
        assert.deepEqual(enrollmentQuery.where, {
            openingId: { in: ['opening-1', 'opening-2', 'opening-3'] },
            status: 'APPROVED',
        });
        const sessionQuery = calls.find((call) => call.model === 'liveSession')!.args;
        assert.deepEqual(sessionQuery.orderBy, { scheduledAt: 'asc' });
        assert.equal(sessionQuery.take, 6);
        assert.ok(sessionQuery.where.scheduledAt.gte instanceof Date);
        assert.deepEqual(sessionQuery.where.opening.course, { contentType: 'LIVE' });
    });

    test('reports aggregate per-batch attendance and due-task completion and identify students needing follow-up', async () => {
        const openings = [
            { id: 'opening-1', status: 'STARTED', instructorId: 'instructor-1', instructorGrants: [], course: { id: 'course-1' } },
            { id: 'opening-2', status: 'OPEN', instructorId: 'instructor-1', instructorGrants: [], course: { id: 'course-2' } },
        ];
        const { service } = makeService({
            openings,
            enrollments: [
                { id: 'enrollment-1', openingId: 'opening-1' },
                { id: 'enrollment-2', openingId: 'opening-1' },
                { id: 'enrollment-3', openingId: 'opening-2' },
            ],
            tasks: [
                { id: 'task-1', openingId: 'opening-1' },
                { id: 'task-2', openingId: 'opening-1' },
            ],
            submissionsByEnrollment: [
                { enrollmentId: 'enrollment-1', _count: { _all: 1 } },
                { enrollmentId: 'enrollment-2', _count: { _all: 2 } },
            ],
            attendanceByEnrollment: [
                { enrollmentId: 'enrollment-1', status: 'PRESENT', _count: { _all: 1 } },
                { enrollmentId: 'enrollment-1', status: 'ABSENT', _count: { _all: 1 } },
                { enrollmentId: 'enrollment-2', status: 'LATE', _count: { _all: 1 } },
                { enrollmentId: 'enrollment-3', status: 'EXCUSED', _count: { _all: 1 } },
            ],
        });

        const summary = await service.getInstructorDashboard('instructor-1');
        assert.deepEqual(
            summary.openingReports.map((report: any) => ({
                id: report.id,
                approvedStudentCount: report.approvedStudentCount,
                attendanceRate: report.attendanceRate,
                taskSubmissionRate: report.taskSubmissionRate,
                needsFollowUpCount: report.needsFollowUpCount,
            })),
            [
                {
                    id: 'opening-1',
                    approvedStudentCount: 2,
                    attendanceRate: 67,
                    taskSubmissionRate: 75,
                    needsFollowUpCount: 1,
                },
                {
                    id: 'opening-2',
                    approvedStudentCount: 1,
                    attendanceRate: null,
                    taskSubmissionRate: null,
                    needsFollowUpCount: 0,
                },
            ],
        );
    });

    test('an assistant without analytics access does not receive cohort metrics but keeps granted session visibility', async () => {
        const { service, calls } = makeService({
            openings: [{
                id: 'opening-assistant',
                status: 'STARTED',
                instructorId: 'primary-1',
                instructorGrants: [{ canViewAnalytics: false, canManageSessions: true }],
                course: { id: 'course-1' },
            }],
            sessions: [{ id: 'session-visible', opening: { id: 'opening-assistant' } }],
        });

        const summary = await service.getInstructorDashboard('assistant-1');
        assert.equal(summary.openingCount, 1);
        assert.equal(summary.approvedStudentCount, 0);
        assert.deepEqual(summary.openingReports, []);
        assert.deepEqual(summary.upcomingSessions, [{ id: 'session-visible', opening: { id: 'opening-assistant' } }]);
        assert.equal(calls.some((call) => call.model === 'enrollment'), false);
        const sessionQuery = calls.find((call) => call.model === 'liveSession')!.args;
        assert.deepEqual(sessionQuery.where.openingId, { in: ['opening-assistant'] });
    });

    test('an assistant with analytics access sees only that batch report, not session controls', async () => {
        const { service, calls } = makeService({
            openings: [{
                id: 'opening-assistant',
                status: 'STARTED',
                instructorId: 'primary-1',
                instructorGrants: [{ canViewAnalytics: true, canManageSessions: false }],
                course: { id: 'course-1' },
            }],
            enrollments: [{ id: 'enrollment-1', openingId: 'opening-assistant' }],
        });

        const summary = await service.getInstructorDashboard('assistant-1');
        assert.equal(summary.approvedStudentCount, 1);
        assert.deepEqual(summary.openingReports.map((report: any) => report.id), ['opening-assistant']);
        assert.deepEqual(summary.upcomingSessions, []);
        assert.equal(calls.some((call) => call.model === 'liveSession'), false);
        const enrollmentQuery = calls.find((call) => call.model === 'enrollment')!.args;
        assert.deepEqual(enrollmentQuery.where.openingId, { in: ['opening-assistant'] });
    });
});
