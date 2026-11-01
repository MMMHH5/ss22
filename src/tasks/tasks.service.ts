import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Role, Prisma } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { CoursesService } from '../courses/courses.service';

@Injectable()
export class TasksService {
    constructor(
        private prisma: PrismaService,
        private audit: AuditService,
        private notifications: NotificationsService,
        private courses: CoursesService,
    ) { }

    private async getTaskOrThrow(taskId: string) {
        const task = await this.prisma.courseTask.findUnique({ where: { id: taskId } });
        if (!task) throw new NotFoundException('Task not found');
        return task;
    }

    private async assertCanManageOpening(
        openingId: string,
        actorId: string,
        actorRole: Role,
        permission: 'canManageTasks' | 'canGrade' | Array<'canManageTasks' | 'canGrade'> = 'canManageTasks',
    ) {
        const opening = await this.prisma.courseOpening.findUnique({
            where: { id: openingId },
            select: { id: true, courseId: true },
        });
        if (!opening) throw new NotFoundException('Opening not found');
        if (actorRole === Role.INSTRUCTOR) {
            // The course's own instructor is a separate column from the batch's
            // instructor. Without this, the instructor of record was refused
            // "not allowed" when they tried to set the work for their own
            // course, and no task ever reached their students.
            const owns = await this.prisma.course.findFirst({
                where: { id: opening.courseId, instructorId: actorId },
                select: { id: true },
            });
            if (owns) return opening;
        }
        return this.courses.assertCanManageOpening(openingId, actorId, actorRole, permission);
    }

    private async hasGradeAccess(openingId: string, actorId: string, actorRole: Role) {
        if (actorRole === Role.ADMIN || actorRole === Role.COURSE_MANAGER) return true;
        if (actorRole !== Role.INSTRUCTOR) return false;
        if (await this.courses.hasOpeningPermission(openingId, actorId, actorRole, ['canGrade'])) return true;
        const opening = await this.prisma.courseOpening.findUnique({
            where: { id: openingId },
            select: { courseId: true },
        });
        if (!opening) return false;
        return !!(await this.prisma.course.findFirst({
            where: { id: opening.courseId, instructorId: actorId },
            select: { id: true },
        }));
    }

    /**
     * The student's enrollment for an opening.
     *
     * `Enrollment.openingId` is nullable and rows that predate the column were
     * never backfilled, so an approved student could be matched by nothing
     * here: no task list, and a 403 on submit. The enrollment's course still
     * identifies the batch, but only when the course has exactly one — with
     * several, attaching the student to the wrong one would expose another
     * cohort's work, so that case stays unresolved for a human to fix.
     */
    private async getEnrollmentId(studentId: string, openingId: string) {
        const enrollment = await this.prisma.enrollment.findFirst({
            where: { studentId, openingId, status: { in: ['APPROVED', 'PENDING', 'RESERVED'] } },
            orderBy: { createdAt: 'desc' },
        });
        if (enrollment) return enrollment.id;

        const opening = await this.prisma.courseOpening.findUnique({
            where: { id: openingId },
            select: { id: true, courseId: true },
        });
        if (!opening) return null;

        const [legacy] = await this.prisma.enrollment.findMany({
            where: { studentId, courseId: opening.courseId, openingId: null, status: { in: ['APPROVED', 'PENDING', 'RESERVED'] } },
            orderBy: { createdAt: 'desc' },
            take: 1,
        });
        if (!legacy) return null;

        const batches = await this.prisma.courseOpening.findMany({
            where: { courseId: opening.courseId },
            select: { id: true },
        });
        if (batches.length !== 1) return null;
        return legacy.id;
    }

    /**
     * The batch a student's enrollment points at, resolved the same way
     * `getEnrollmentId` does, so a student UI never has to guess an opening id
     * from an enrollment that may not have one.
     */
    async getStudentOpeningId(studentId: string, courseId: string): Promise<string | null> {
        const enrollment = await this.prisma.enrollment.findFirst({
            where: { studentId, courseId, status: { in: ['APPROVED', 'PENDING', 'RESERVED'] } },
            orderBy: { createdAt: 'desc' },
            select: { openingId: true },
        });
        if (!enrollment) return null;
        if (enrollment.openingId) return enrollment.openingId;

        const batches = await this.prisma.courseOpening.findMany({
            where: { courseId },
            select: { id: true },
        });
        return batches.length === 1 ? batches[0].id : null;
    }

    /** Ensure the target module belongs to the same course as the opening. */
    private async assertModuleBelongsToCourse(moduleId: string, openingId: string) {
        const [module, opening] = await Promise.all([
            this.prisma.module.findUnique({ where: { id: moduleId } }),
            this.prisma.courseOpening.findUnique({ where: { id: openingId } }),
        ]);
        if (!module) throw new BadRequestException('Module not found');
        if (!opening) throw new NotFoundException('Opening not found');
        if (module.courseId !== opening.courseId) {
            throw new BadRequestException('Module does not belong to this course');
        }
    }

    async createTask(openingId: string, dto: {
        titleAr: string;
        titleEn: string;
        descriptionAr?: string;
        descriptionEn?: string;
        dueDate?: string;
        maxScore?: number;
        moduleId?: string;
        attachmentUrl?: string;
        attachmentType?: string;
        links?: { url: string; labelAr?: string; labelEn?: string }[];
    }, actorId: string, actorRole: Role) {
        await this.assertCanManageOpening(openingId, actorId, actorRole);
        if (!dto.titleAr?.trim() || !dto.titleEn?.trim()) {
            throw new BadRequestException('titleAr and titleEn are required');
        }
        if (dto.maxScore != null && dto.maxScore <= 0) {
            throw new BadRequestException('Max score must be greater than 0');
        }
        if (dto.moduleId) {
            await this.assertModuleBelongsToCourse(dto.moduleId, openingId);
        }
        const task = await this.prisma.courseTask.create({
            data: {
                openingId,
                moduleId: dto.moduleId ?? null,
                titleAr: dto.titleAr.trim(),
                titleEn: dto.titleEn.trim(),
                descriptionAr: dto.descriptionAr?.trim() ? dto.descriptionAr.trim() : null,
                descriptionEn: dto.descriptionEn?.trim() ? dto.descriptionEn.trim() : null,
                dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
                maxScore: dto.maxScore ?? 100,
                attachmentUrl: dto.attachmentUrl ?? null,
                attachmentType: dto.attachmentType ?? null,
                links: dto.links?.length ? dto.links as any : undefined,
            },
        });
        await this.audit.logAction(`Created task "${dto.titleAr}" for Opening ${openingId}`, undefined, actorId);
        return task;
    }

    /**
     * A student's real name, for the instructor's submissions list.
     *
     * `User` has no name column: the name is whatever the person typed at
     * registration and it is kept in `metadata` (`fullName` / `nameAr` /
     * `nameEn`, the same place the CV and certificates read it from). Without
     * this the instructor's only identifier for a submission was the email
     * address, which is both unusable on a screen and an address the student
     * never agreed to be shown to a teacher. Only the name is derived; the rest
     * of `metadata` (phone, birth date, university) is not echoed.
     */
    private studentDisplayName(metadata: unknown): { nameAr: string | null; nameEn: string | null } {
        const md = (metadata ?? {}) as Record<string, unknown>;
        const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
        const fullName = str(md.fullName);
        return { nameAr: str(md.nameAr) ?? fullName, nameEn: str(md.nameEn) ?? fullName };
    }

    private decorateSubmission<T extends { enrollment: { student: { id: string; email: string; metadata: unknown } | null } }>(submission: T) {
        const student = submission.enrollment?.student ?? null;
        if (!student) return submission;
        return {
            ...submission,
            studentName: this.studentDisplayName(student.metadata).nameAr || this.studentDisplayName(student.metadata).nameEn,
            enrollment: { ...submission.enrollment, student: { id: student.id, email: student.email } },
        };
    }

    async listTasks(openingId: string, actorId: string, actorRole: Role) {
        const opening = await this.prisma.courseOpening.findUnique({ where: { id: openingId } });
        if (!opening) throw new NotFoundException('Opening not found');

        // Owning the course counts as teaching its batch, for the same reason
        // `assertCanManageOpening` allows it: the two instructor columns are not
        // the same field, and refusing the owner left the instructor staring at
        // an empty task list for their own course.
        const ownsCourse = actorRole === Role.INSTRUCTOR
            ? await this.prisma.course.findFirst({
                where: { id: opening.courseId, instructorId: actorId },
                select: { id: true },
            })
            : null;

        const hasDelegatedAccess = actorRole === Role.INSTRUCTOR
            ? await this.courses.hasOpeningPermission(openingId, actorId, actorRole, ['canManageTasks', 'canGrade'])
            : false;
        const isStaff = actorRole === Role.ADMIN || actorRole === Role.COURSE_MANAGER ||
            (actorRole === Role.INSTRUCTOR && (!!ownsCourse || hasDelegatedAccess));
        const canGrade = isStaff && await this.hasGradeAccess(openingId, actorId, actorRole);
        const isStudent = actorRole === Role.STUDENT;

        if (!isStaff && !isStudent) {
            throw new ForbiddenException('Not allowed to view tasks for this opening');
        }
        if (isStudent) {
            const enrollmentId = await this.getEnrollmentId(actorId, openingId);
            if (!enrollmentId) throw new ForbiddenException('You are not enrolled in this opening');
        }

        // Typed as a concrete shape rather than an inline ternary: the two
        // branches select different submission fields, and letting the ternary
        // stand lost `task.submissions` from the result type entirely. The
        // student select is spelled out inline because a shared `Prisma.UserSelect`
        // const does not satisfy the generated `UserDefaultArgs` here.
        const include = {
            module: { select: { id: true, titleAr: true, titleEn: true, orderIndex: true } },
            submissions: isStaff
                ? { include: { enrollment: { select: { id: true, student: { select: { id: true, email: true, metadata: true } } } } } }
                : { where: { enrollmentId: await this.getEnrollmentId(actorId, openingId) ?? '00000000' } },
        } satisfies Prisma.CourseTaskInclude;
        const tasks = await this.prisma.courseTask.findMany({
            where: { openingId },
            orderBy: [{ moduleId: 'asc' }, { createdAt: 'desc' }],
            include,
        });
        if (!isStaff) return tasks;
        return tasks.map(task => ({
            ...task,
            submissions: task.submissions.map((submission) => {
                const decorated = this.decorateSubmission(submission as any);
                if (canGrade) return decorated;
                const { score: _score, notes: _notes, ...withoutGrade } = decorated;
                return withoutGrade;
            }),
        }));
    }

    async getTaskRoster(openingId: string, actorId: string, actorRole: Role) {
        await this.assertCanManageOpening(openingId, actorId, actorRole, 'canManageTasks');
        return this.prisma.enrollment.findMany({
            where: { openingId, status: 'APPROVED' },
            orderBy: { createdAt: 'asc' },
            select: {
                id: true,
                student: { select: { id: true, email: true } },
            },
        });
    }

    async updateTask(taskId: string, dto: {
        titleAr?: string;
        titleEn?: string;
        descriptionAr?: string;
        descriptionEn?: string;
        dueDate?: string;
        maxScore?: number;
        moduleId?: string;
        attachmentUrl?: string;
        attachmentType?: string;
        links?: { url: string; labelAr?: string; labelEn?: string }[];
    }, actorId: string, actorRole: Role) {
        const task = await this.getTaskOrThrow(taskId);
        await this.assertCanManageOpening(task.openingId, actorId, actorRole);
        if (dto.maxScore != null && dto.maxScore <= 0) {
            throw new BadRequestException('Max score must be greater than 0');
        }
        if (dto.moduleId !== undefined) {
            if (dto.moduleId) {
                await this.assertModuleBelongsToCourse(dto.moduleId, task.openingId);
            }
        }
        const updated = await this.prisma.courseTask.update({
            where: { id: taskId },
            data: {
                titleAr: dto.titleAr?.trim() ?? task.titleAr,
                titleEn: dto.titleEn?.trim() ?? task.titleEn,
                descriptionAr: dto.descriptionAr?.trim() !== undefined
                    ? (dto.descriptionAr?.trim() || null)
                    : task.descriptionAr,
                descriptionEn: dto.descriptionEn?.trim() !== undefined
                    ? (dto.descriptionEn?.trim() || null)
                    : task.descriptionEn,
                dueDate: dto.dueDate !== undefined ? (dto.dueDate ? new Date(dto.dueDate) : null) : task.dueDate,
                maxScore: dto.maxScore ?? task.maxScore,
                moduleId: dto.moduleId !== undefined ? (dto.moduleId || null) : task.moduleId,
                attachmentUrl: dto.attachmentUrl !== undefined ? (dto.attachmentUrl || null) : task.attachmentUrl,
                attachmentType: dto.attachmentType !== undefined ? (dto.attachmentType || null) : task.attachmentType,
                links: dto.links !== undefined ? (dto.links?.length ? dto.links as any : null) : task.links,
            },
        });
        await this.audit.logAction(`Updated task ${taskId}`, undefined, actorId);
        return updated;
    }

    async deleteTask(taskId: string, actorId: string, actorRole: Role) {
        const task = await this.getTaskOrThrow(taskId);
        await this.assertCanManageOpening(task.openingId, actorId, actorRole);
        await this.audit.logAction(`Deleted task ${taskId} (Opening ${task.openingId})`, undefined, actorId);
        return this.prisma.courseTask.delete({ where: { id: taskId } });
    }

    // ---------- Submissions ----------

    /** Throws unless this student is enrolled in the task's opening. */
    async assertStudentCanSubmit(taskId: string, studentId: string) {
        const task = await this.getTaskOrThrow(taskId);
        const enrollmentId = await this.getEnrollmentId(studentId, task.openingId);
        if (!enrollmentId) throw new ForbiddenException('You are not enrolled in this opening');
        return enrollmentId;
    }

    async submitTask(taskId: string, studentId: string, dto: {
        content?: string;
        attachmentUrl?: string;
        attachmentName?: string;
        attachmentType?: string;
        attachmentSize?: number;
    }) {
        const task = await this.getTaskOrThrow(taskId);
        const enrollmentId = await this.getEnrollmentId(studentId, task.openingId);
        if (!enrollmentId) throw new ForbiddenException('You are not enrolled in this opening');

        // The stored URL is ours, not the caller's: a student could otherwise
        // point their submission at any path on the server, or at a file
        // another student uploaded, and the instructor would open it as if it
        // were their own work.
        const clearingFile = dto.attachmentUrl !== undefined
            && dto.attachmentUrl !== null
            && String(dto.attachmentUrl).trim() === '';
        const replacingFile = !!dto.attachmentUrl && !clearingFile;
        const attachment = replacingFile ? this.normalizeSubmittedAttachment(dto.attachmentUrl) : null;
        const submittedFile = attachment
            ? {
                attachmentUrl: attachment.url,
                attachmentName: this.sanitizeFileName(dto.attachmentName),
                attachmentType: dto.attachmentType?.slice(0, 120) ?? null,
                attachmentSize: Number.isFinite(dto.attachmentSize) ? Math.max(0, Math.trunc(dto.attachmentSize as number)) : null,
            }
            : { attachmentUrl: null, attachmentName: null, attachmentType: null, attachmentSize: null };

        const existing = await this.prisma.taskSubmission.findUnique({
            where: { taskId_enrollmentId: { taskId, enrollmentId } },
        });

        // A new file replaces the old one as a whole: keeping the previous
        // filename next to a new URL, or a URL with no name, would misdescribe
        // the work the instructor opens. Leaving the field out entirely keeps
        // the file already there, so adding a note does not silently drop it.
        const fileFields = replacingFile || clearingFile
            ? submittedFile
            : {
                attachmentUrl: existing?.attachmentUrl ?? null,
                attachmentName: existing?.attachmentName ?? null,
                attachmentType: existing?.attachmentType ?? null,
                attachmentSize: existing?.attachmentSize ?? null,
            };

        const submission = await this.prisma.taskSubmission.upsert({
            where: { taskId_enrollmentId: { taskId, enrollmentId } },
            update: {
                content: dto.content?.trim() ? dto.content.trim() : (existing?.content ?? null),
                ...fileFields,
                score: existing?.score ?? null,
                notes: existing?.notes ?? null,
            },
            create: {
                taskId,
                enrollmentId,
                content: dto.content?.trim() ? dto.content.trim() : null,
                ...submittedFile,
            },
        });
        await this.audit.logAction(`Student ${studentId} submitted Task ${taskId}`, undefined, studentId);
        return submission;
    }

    /**
     * Keep only paths produced by our own upload endpoint.
     *
     * `attachmentUrl` is accepted from the browser, so anything that is not a
     * `/uploads/tasks/...` path with a plain filename is rejected outright. The
     * `..` and encoding tricks that would climb out of the folder are refused by
     * the pattern itself, and the extension has to be one we wrote.
     */
    private normalizeSubmittedAttachment(url?: string): { url: string } | null {
        if (!url) return null;
        const value = url.trim();
        if (/^https?:\/\//i.test(value)) {
            // The upload response is a same-origin path; an absolute URL here
            // means the client is posting something we never issued.
            throw new BadRequestException('Attachment must be an uploaded file');
        }
        if (!/^\/uploads\/tasks\/[A-Za-z0-9._-]+$/.test(value) || value.includes('..')) {
            throw new BadRequestException('Attachment must be an uploaded file');
        }
        return { url: value };
    }

    /** A display name for the submitted file: no path separators, bounded. */
    private sanitizeFileName(name?: string): string | null {
        if (!name) return null;
        const base = name.replace(/\\/g, '/').split('/').pop() ?? '';
        const cleaned = base.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 200);
        return cleaned.length ? cleaned : null;
    }

    async getMySubmission(taskId: string, studentId: string) {
        await this.getTaskOrThrow(taskId);
        const enrollmentId = await this.getEnrollmentId(studentId, (await this.getTaskOrThrow(taskId)).openingId);
        if (!enrollmentId) throw new ForbiddenException('You are not enrolled in this opening');
        return this.prisma.taskSubmission.findUnique({
            where: { taskId_enrollmentId: { taskId, enrollmentId } },
        });
    }

    async getSubmissions(taskId: string, actorId: string, actorRole: Role) {
        const task = await this.getTaskOrThrow(taskId);
        await this.assertCanManageOpening(task.openingId, actorId, actorRole, ['canManageTasks', 'canGrade']);
        const rows = await this.prisma.taskSubmission.findMany({
            where: { taskId },
            include: { enrollment: { select: { id: true, student: { select: { id: true, email: true, metadata: true } } } } },
            orderBy: { submittedAt: 'desc' },
        });
        const canGrade = await this.hasGradeAccess(task.openingId, actorId, actorRole);
        return rows.map((row) => {
            const decorated = this.decorateSubmission(row as any);
            if (canGrade) return decorated;
            const { score: _score, notes: _notes, ...withoutGrade } = decorated;
            return withoutGrade;
        });
    }

    /**
     * Like `decorateSubmission`, but the name is returned in both scripts as a
     * `{ nameAr, nameEn }` pair instead of one Arabic-first string, so a caller
     * can resolve it with the same `pick(obj, 'name')` used for course and task
     * titles. The single `studentName` string of the per-task list stays
     * Arabic-first because that view is only ever reached from the Arabic UI.
     */
    private decorateInboxSubmission<T extends { enrollment: { student: { id: string; email: string; metadata: unknown } | null } | null }>(row: T) {
        const student = row.enrollment?.student ?? null;
        return {
            ...row,
            studentName: this.studentDisplayName(student?.metadata),
            enrollment: {
                ...row.enrollment,
                student: student ? { id: student.id, email: student.email } : null,
            },
        };
    }

    /**
     * Every submission across all the batches an actor teaches.
     *
     * `getSubmissions` and `listTasks` answer "how did this one task go" and
     * "what is in this one batch", so an instructor who owns several courses
     * could only see what had been handed in by walking each batch in turn.
     *
     * The scope deliberately ORs the two instructor columns. `CourseOpening`
     * has its own `instructorId` and `Course` has a separate one, and
     * `assertCanManageOpening` already lets the course's instructor of record
     * grade the work in its batches — so their submissions have to appear
     * here too, otherwise the same work is gradeable from the batch page but
     * invisible on the inbox it is supposed to be listed in. Filtering on
     * `CourseOpening.instructorId` alone is what makes this endpoint useless to
     * exactly the people who need it.
     */
    async listSubmissionsForActor(actorId: string, actorRole: Role, opts: {
        courseId?: string;
        openingId?: string;
        ungradedOnly?: boolean;
        limit?: number;
        skip?: number;
    } = {}) {
        const parsed = Number(opts.limit);
        const limit = Math.min(Math.max(Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 100, 1), 300);
        // Page through the pile rather than fetching the whole table. Deep
        // offsets get slower for every row skipped, so the window is bounded;
        // a teacher with more than this can narrow by course or batch instead.
        const parsedSkip = Number(opts.skip);
        const skip = Math.min(Number.isFinite(parsedSkip) && parsedSkip > 0 ? Math.trunc(parsedSkip) : 0, 5000);

        const opening: Prisma.CourseOpeningWhereInput = actorRole === Role.INSTRUCTOR
            ? {
                OR: [
                    { instructorId: actorId },
                    { course: { instructorId: actorId } },
                    { instructorGrants: { some: { instructorId: actorId, canGrade: true } } },
                ],
            }
            : {};
        if (opts.courseId) opening.courseId = opts.courseId;
        if (opts.openingId) opening.id = opts.openingId;

        const where: Prisma.TaskSubmissionWhereInput = {
            task: { opening: { is: opening } },
            ...(opts.ungradedOnly ? { score: null } : {}),
        };

        // The course and batch titles are the whole point of an aggregate view:
        // a submission row carries no readable context of its own, and the
        // per-task endpoints return only ids. `module` comes along for the same
        // reason — a teacher triaging a pile of work needs to know which
        // lecture it belongs to.
        const include = {
            task: {
                select: {
                    id: true,
                    titleAr: true,
                    titleEn: true,
                    descriptionAr: true,
                    descriptionEn: true,
                    dueDate: true,
                    maxScore: true,
                    opening: {
                        select: {
                            id: true,
                            nameAr: true,
                            nameEn: true,
                            status: true,
                            course: { select: { id: true, titleAr: true, titleEn: true } },
                        },
                    },
                    module: { select: { id: true, titleAr: true, titleEn: true } },
                },
            },
            enrollment: { select: { id: true, student: { select: { id: true, email: true, metadata: true } } } },
        } satisfies Prisma.TaskSubmissionInclude;

        const [rows, total] = await Promise.all([
            this.prisma.taskSubmission.findMany({ where, include, orderBy: { submittedAt: 'desc' }, take: limit, skip }),
            this.prisma.taskSubmission.count({ where }),
        ]);

        return {
            items: rows.map(row => this.decorateInboxSubmission(row)),
            total,
            // Offset-aware: on the last page `rows.length` is short, so comparing
            // it to `total` alone would claim there is more whenever the final
            // page happened to be smaller than `limit`.
            hasMore: skip + rows.length < total,
        };
    }

    /** A student's own task list for a course, batch resolved for them. */
    async listStudentCourseTasks(courseId: string, studentId: string) {
        const openingId = await this.getStudentOpeningId(studentId, courseId);
        if (!openingId) {
            // No batch recorded and more than one to choose from: say so rather
            // than returning a list that may belong to a different cohort.
            throw new ForbiddenException('Your enrollment is not linked to a batch yet');
        }
        return this.listTasks(openingId, studentId, Role.STUDENT);
    }

    async gradeSubmission(submissionId: string, actorId: string, actorRole: Role, score?: number, notes?: string) {
        const submission = await this.prisma.taskSubmission.findUnique({
            where: { id: submissionId },
            include: { task: true, enrollment: { select: { studentId: true } } },
        });
        if (!submission) throw new NotFoundException('Submission not found');
        await this.assertCanManageOpening(submission.task.openingId, actorId, actorRole, 'canGrade');
        if (score != null && (isNaN(score) || score < 0)) {
            throw new BadRequestException('Score must be a non-negative number');
        }
        // A mark above the task's maximum is not a rounding detail: it silently
        // inflates every average the platform shows, and the student sees an
        // impossible grade on the work they can actually open.
        if (score != null && score > submission.task.maxScore) {
            throw new BadRequestException(`Score cannot exceed the maximum of ${submission.task.maxScore}`);
        }
        const updated = await this.prisma.taskSubmission.update({
            where: { id: submissionId },
            data: {
                score: score != null ? score : submission.score,
                notes: notes !== undefined ? (notes.trim() ? notes.trim() : null) : submission.notes,
            },
        });
        await this.audit.logAction(`Graded submission ${submissionId} for Task ${submission.taskId}`, undefined, actorId);
        await this.notifications.notify({
            userId: submission.enrollment.studentId,
            type: 'task.graded',
            titleAr: 'تم تصحيح المهمة',
            titleEn: 'Assignment graded',
            bodyAr: score != null
                ? `تم تصحيح مهمتك في "${submission.task.titleAr}" والنتيجة: ${score} من ${submission.task.maxScore}`
                : `تم تصحيح مهمتك في "${submission.task.titleAr}"`,
            bodyEn: score != null
                ? `Your assignment "${submission.task.titleEn}" was graded with ${score} out of ${submission.task.maxScore}.`
                : `Your assignment "${submission.task.titleEn}" was reviewed.`,
            data: { submissionId, taskId: submission.taskId },
        }).catch(() => {});
        return updated;
    }
}