import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { getMetadataStorage } from 'class-validator';
import { AttendanceStatus, Role } from '@prisma/client';
import { LiveSessionsService } from '../src/live-sessions/live-sessions.service';
import { SaveSessionAttendanceDto } from '../src/live-sessions/dto/session-attendance.dto';

const validationPipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

const validateAttendance = (value: unknown) =>
    validationPipe.transform(value, { type: 'body', metatype: SaveSessionAttendanceDto });

const SESSION = {
    id: 'session-1',
    openingId: 'opening-1',
    titleAr: 'الجلسة الأولى',
    titleEn: 'Session 1',
    scheduledAt: new Date('2026-10-20T16:00:00.000Z'),
    durationMinutes: 90,
    meetLink: null,
};

function makeService(overrides: {
    enrollments?: any[];
    sessions?: any[];
    member?: any;
} = {}) {
    const writes: any[] = [];
    const audit: any[] = [];
    const enrollments = overrides.enrollments ?? [
        {
            id: 'enrollment-1',
            student: { id: 'student-1', email: 'student@example.com', metadata: { fullName: 'Nour Ali' } },
            attendance: [],
        },
    ];
    const sessions = overrides.sessions ?? [SESSION];
    const prisma: any = {
        liveSession: {
            findUnique: async ({ where }: any) => sessions.find((session) => session.id === where.id) ?? null,
            findMany: async () => sessions,
        },
        enrollment: {
            findFirst: async () => Object.prototype.hasOwnProperty.call(overrides, 'member')
                ? overrides.member
                : { id: 'enrollment-1' },
            findMany: async ({ where }: any) => {
                if (where.id?.in) return enrollments.filter((row) => where.id.in.includes(row.id));
                return enrollments;
            },
        },
        sessionAttendance: {
            upsert: async (args: any) => {
                writes.push(args);
                return args.create;
            },
        },
        $transaction: async (queries: Promise<unknown>[]) => Promise.all(queries),
    };
    const service = new LiveSessionsService(
        prisma,
        { assertCanManageOpening: async () => ({ id: 'opening-1' }) } as any,
        { logAction: async (...args: unknown[]) => audit.push(args) } as any,
    );
    return { service, writes, audit, prisma };
}

describe('session attendance', () => {
    test('attendance request uses nested validation metadata', () => {
        const metadata = getMetadataStorage().getTargetValidationMetadatas(SaveSessionAttendanceDto, '', true, false);
        assert.ok(metadata.length > 0);
    });

    test('valid statuses pass and unknown statuses or fields fail validation', async () => {
        const valid = await validateAttendance({
            records: [{ enrollmentId: '4a4b8f34-9299-4bf1-9e2f-582b65014c76', status: 'PRESENT' }],
        }) as SaveSessionAttendanceDto;
        assert.equal(valid.records[0].status, AttendanceStatus.PRESENT);

        await assert.rejects(
            () => validateAttendance({
                records: [{ enrollmentId: '4a4b8f34-9299-4bf1-9e2f-582b65014c76', status: 'MAYBE' }],
            }),
            BadRequestException,
        );
        await assert.rejects(
            () => validateAttendance({
                records: [{ enrollmentId: '4a4b8f34-9299-4bf1-9e2f-582b65014c76', status: 'PRESENT', admin: true }],
            }),
            BadRequestException,
        );
    });

    test('staff sees only approved roster entries and their saved attendance', async () => {
        const { service } = makeService({
            enrollments: [{
                id: 'enrollment-1',
                student: { id: 'student-1', email: 'student@example.com', metadata: { fullName: 'Nour Ali' } },
                attendance: [{ status: AttendanceStatus.LATE, note: 'Arrived after start', markedAt: new Date() }],
            }],
        });

        const roster = await service.listAttendance('opening-1', 'session-1', 'teacher-1', Role.INSTRUCTOR);
        assert.equal(roster.length, 1);
        assert.equal(roster[0].studentName, 'Nour Ali');
        assert.equal(roster[0].status, AttendanceStatus.LATE);
    });

    test('attendance records are saved with actor and audit context', async () => {
        const { service, writes, audit } = makeService();
        await service.saveAttendance('opening-1', 'session-1', [
            { enrollmentId: 'enrollment-1', status: AttendanceStatus.PRESENT },
        ], 'teacher-1', Role.INSTRUCTOR);

        assert.equal(writes.length, 1);
        assert.equal(writes[0].create.markedById, 'teacher-1');
        assert.equal(writes[0].create.status, AttendanceStatus.PRESENT);
        assert.equal(audit.length, 1);
    });

    test('duplicate enrollments in one update are rejected', async () => {
        const { service, writes } = makeService();
        const records = [
            { enrollmentId: 'enrollment-1', status: AttendanceStatus.PRESENT },
            { enrollmentId: 'enrollment-1', status: AttendanceStatus.ABSENT },
        ];
        await assert.rejects(
            () => service.saveAttendance('opening-1', 'session-1', records, 'teacher-1', Role.INSTRUCTOR),
            BadRequestException,
        );
        assert.equal(writes.length, 0);
    });

    test('a student outside this opening cannot be marked present', async () => {
        const { service, writes } = makeService({ enrollments: [] });
        await assert.rejects(
            () => service.saveAttendance('opening-1', 'session-1', [
                { enrollmentId: 'other-enrollment', status: AttendanceStatus.PRESENT },
            ], 'teacher-1', Role.INSTRUCTOR),
            BadRequestException,
        );
        assert.equal(writes.length, 0);
    });

    test('students can only read attendance for an approved enrollment in the opening', async () => {
        const { service } = makeService({ member: null });
        await assert.rejects(
            () => service.listMyAttendance('opening-1', 'student-1'),
            ForbiddenException,
        );
    });

    test('student history contains no other learner records', async () => {
        let sessionQuery: any;
        const { service, prisma } = makeService();
        prisma.liveSession.findMany = async (args: any) => {
            sessionQuery = args;
            return [{
                ...SESSION,
                attendance: [{ status: AttendanceStatus.EXCUSED, note: 'Approved', markedAt: new Date() }],
            }];
        };

        const history = await service.listMyAttendance('opening-1', 'student-1');
        assert.equal(history.length, 1);
        assert.equal(history[0].status, AttendanceStatus.EXCUSED);
        assert.equal(history[0].note, 'Approved');
        assert.deepEqual(sessionQuery.where, { openingId: 'opening-1' });
        assert.deepEqual(sessionQuery.select.attendance.where, { enrollmentId: 'enrollment-1' });
    });
});
