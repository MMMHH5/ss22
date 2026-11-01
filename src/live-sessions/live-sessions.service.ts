import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CoursesService } from '../courses/courses.service';
import { AuditService } from '../audit/audit.service';
import { Role } from '@prisma/client';
import { normalizeMeetLink } from '../common/meeting-links';
import { assertLiveSessionsAllowed } from '../common/course-content-type';
import { CreateLiveSessionDto } from './dto/live-session.dto';
import { UpdateLiveSessionDto } from './dto/update-live-session.dto';
import { SessionAttendanceEntryDto } from './dto/session-attendance.dto';

const SESSION_SELECT = {
    id: true,
    titleAr: true,
    titleEn: true,
    scheduledAt: true,
    durationMinutes: true,
    meetLink: true,
    createdAt: true,
    updatedAt: true,
} as const;

/**
 * The weekly meeting schedule of one batch.
 *
 * A session's room is optional: when it is empty the student's link comes from
 * the batch's own `meetLink`, which is how a recurring Google Meet is reused.
 * The link is only ever handed out through `resolveClassroom`, so adding a
 * session cannot become a way around the APPROVED-only rule.
 */
@Injectable()
export class LiveSessionsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly courses: CoursesService,
        private readonly audit: AuditService,
    ) { }

    async listForStaff(openingId: string, actorId: string, actorRole: any) {
        await this.courses.assertCanManageOpening(openingId, actorId, actorRole, 'canManageSessions');
        return this.prisma.liveSession.findMany({
            where: { openingId },
            orderBy: { scheduledAt: 'asc' },
            select: SESSION_SELECT,
        });
    }

    async create(openingId: string, dto: CreateLiveSessionDto, actorId: string, actorRole: any) {
        const opening = await this.courses.assertCanManageOpening(openingId, actorId, actorRole, 'canManageSessions');
        await this.assertCourseIsLive(opening.courseId);

        const scheduledAt = new Date(dto.scheduledAt);
        const created = await this.prisma.liveSession.create({
            data: {
                openingId,
                titleAr: dto.titleAr.trim(),
                titleEn: dto.titleEn.trim(),
                scheduledAt,
                durationMinutes: dto.durationMinutes ?? null,
                // `undefined` (field omitted) keeps whatever is stored; `null` or
                // "" clears it back to inheriting the batch link.
                meetLink: normalizeMeetLink(dto.meetLink) ?? null,
            },
            select: SESSION_SELECT,
        });

        await this.audit.logAction(
            `Live session ${created.id} scheduled for opening ${openingId} at ${scheduledAt.toISOString()}`,
            undefined,
            actorId,
        );
        return created;
    }

    async update(
        openingId: string,
        sessionId: string,
        dto: UpdateLiveSessionDto,
        actorId: string,
        actorRole: any,
    ) {
        await this.courses.assertCanManageOpening(openingId, actorId, actorRole, 'canManageSessions');
        const existing = await this.assertBelongsToOpening(sessionId, openingId);

        const data: Record<string, unknown> = {};
        if (dto.titleAr !== undefined) data.titleAr = dto.titleAr.trim();
        if (dto.titleEn !== undefined) data.titleEn = dto.titleEn.trim();
        if (dto.scheduledAt !== undefined) data.scheduledAt = new Date(dto.scheduledAt);
        if (dto.durationMinutes !== undefined) data.durationMinutes = dto.durationMinutes ?? null;
        if (dto.meetLink !== undefined) data.meetLink = normalizeMeetLink(dto.meetLink) ?? null;

        const updated = await this.prisma.liveSession.update({
            where: { id: existing.id },
            data,
            select: SESSION_SELECT,
        });

        await this.audit.logAction(`Live session ${existing.id} updated`, undefined, actorId);
        return updated;
    }

    async remove(openingId: string, sessionId: string, actorId: string, actorRole: any) {
        await this.courses.assertCanManageOpening(openingId, actorId, actorRole, 'canManageSessions');
        const existing = await this.assertBelongsToOpening(sessionId, openingId);

        await this.prisma.liveSession.delete({ where: { id: existing.id } });
        await this.audit.logAction(`Live session ${existing.id} removed`, undefined, actorId);
        return { id: existing.id };
    }

    async listAttendance(openingId: string, sessionId: string, actorId: string, actorRole: Role) {
        await this.courses.assertCanManageOpening(openingId, actorId, actorRole, 'canManageSessions');
        await this.assertBelongsToOpening(sessionId, openingId);
        const enrollments = await this.prisma.enrollment.findMany({
            where: { openingId, status: 'APPROVED' },
            orderBy: { createdAt: 'asc' },
            select: {
                id: true,
                student: { select: { id: true, email: true, metadata: true } },
                attendance: {
                    where: { sessionId },
                    select: { status: true, note: true, markedAt: true },
                    take: 1,
                },
            },
        });

        return enrollments.map((enrollment) => {
            const metadata = (enrollment.student.metadata ?? {}) as Record<string, unknown>;
            const name = [metadata.nameAr, metadata.nameEn, metadata.fullName]
                .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
            const record = enrollment.attendance[0];
            return {
                enrollmentId: enrollment.id,
                studentId: enrollment.student.id,
                studentName: name?.trim() ?? null,
                email: enrollment.student.email,
                status: record?.status ?? null,
                note: record?.note ?? null,
                markedAt: record?.markedAt ?? null,
            };
        });
    }

    async saveAttendance(
        openingId: string,
        sessionId: string,
        records: SessionAttendanceEntryDto[],
        actorId: string,
        actorRole: Role,
    ) {
        await this.courses.assertCanManageOpening(openingId, actorId, actorRole, 'canManageSessions');
        await this.assertBelongsToOpening(sessionId, openingId);

        const enrollmentIds = records.map((record) => record.enrollmentId);
        if (new Set(enrollmentIds).size !== enrollmentIds.length) {
            throw new BadRequestException('An enrollment can only appear once per attendance update');
        }

        const enrollments = await this.prisma.enrollment.findMany({
            where: { id: { in: enrollmentIds }, openingId, status: 'APPROVED' },
            select: { id: true },
        });
        if (enrollments.length !== enrollmentIds.length) {
            throw new BadRequestException('Attendance can only be recorded for approved students in this batch');
        }

        await this.prisma.$transaction(
            records.map((record) => {
                const note = record.note?.trim() || null;
                return this.prisma.sessionAttendance.upsert({
                    where: {
                        sessionId_enrollmentId: { sessionId, enrollmentId: record.enrollmentId },
                    },
                    create: {
                        sessionId,
                        enrollmentId: record.enrollmentId,
                        status: record.status,
                        note,
                        markedById: actorId,
                    },
                    update: {
                        status: record.status,
                        note,
                        markedById: actorId,
                        markedAt: new Date(),
                    },
                });
            }),
        );
        await this.audit.logAction(
            `Attendance recorded for ${records.length} student(s) in session ${sessionId}`,
            undefined,
            actorId,
        );
        return this.listAttendance(openingId, sessionId, actorId, actorRole);
    }

    async listMyAttendance(openingId: string, studentId: string) {
        const enrollment = await this.prisma.enrollment.findFirst({
            where: { openingId, studentId, status: 'APPROVED' },
            select: { id: true },
        });
        if (!enrollment) throw new ForbiddenException('You are not enrolled in this opening');

        const sessions = await this.prisma.liveSession.findMany({
            where: { openingId },
            orderBy: { scheduledAt: 'asc' },
            select: {
                id: true,
                titleAr: true,
                titleEn: true,
                scheduledAt: true,
                durationMinutes: true,
                attendance: {
                    where: { enrollmentId: enrollment.id },
                    select: { status: true, note: true, markedAt: true },
                    take: 1,
                },
            },
        });
        return sessions.map(({ attendance, ...session }) => ({
            ...session,
            ...(attendance[0] ?? { status: null, note: null, markedAt: null }),
        }));
    }

    /**
     * A meeting schedule only makes sense for a course taught live; a
     * pre-recorded one has no sessions to schedule. Checked on create (and on
     * the course type change) so the two never drift apart.
     */
    private async assertCourseIsLive(courseId: string) {
        const course = await this.prisma.course.findUnique({
            where: { id: courseId },
            select: { contentType: true },
        });
        assertLiveSessionsAllowed(course?.contentType);
    }

    /**
     * A session is addressed inside its batch, so the id has to belong to the
     * batch in the path. Without this, an instructor of batch A could edit (or
     * delete) a session of batch B by passing B's session id under A's URL.
     */
    private async assertBelongsToOpening(sessionId: string, openingId: string) {
        const session = await this.prisma.liveSession.findUnique({ where: { id: sessionId } });
        if (!session || session.openingId !== openingId) {
            throw new NotFoundException('Session not found in this opening');
        }
        return session;
    }
}