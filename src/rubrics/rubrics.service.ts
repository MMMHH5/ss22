import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { GamificationService } from '../gamification/gamification.service';
import { Role } from '@prisma/client';
import { CoursesService } from '../courses/courses.service';

@Injectable()
export class RubricsService {
    constructor(
        private prisma: PrismaService,
        private audit: AuditService,
        private gamification: GamificationService,
        private courses: CoursesService,
    ) {}

    async createRubric(taskId: string, dto: { titleAr: string; titleEn: string; criteria: { titleAr: string; titleEn: string; descriptionAr?: string; descriptionEn?: string; maxScore: number }[] }, userId: string, userRole: Role) {
        const task = await this.prisma.courseTask.findUnique({ where: { id: taskId } });
        if (!task) throw new NotFoundException('Task not found');
        if (userRole === Role.INSTRUCTOR) {
            await this.courses.assertCanManageOpening(
                task.openingId,
                userId,
                userRole,
                ['canManageTasks', 'canGrade'],
            );
        }
        const existing = await this.prisma.rubric.findUnique({ where: { taskId } });
        if (existing) throw new BadRequestException('Task already has a rubric');
        const rubric = await this.prisma.rubric.create({
            data: {
                taskId,
                titleAr: dto.titleAr.trim(),
                titleEn: dto.titleEn.trim(),
                criteria: {
                    create: dto.criteria.map((c, i) => ({
                        titleAr: c.titleAr.trim(),
                        titleEn: c.titleEn.trim(),
                        descriptionAr: c.descriptionAr || null,
                        descriptionEn: c.descriptionEn || null,
                        maxScore: c.maxScore || 10,
                        orderIndex: i,
                    })),
                },
            },
            include: { criteria: { orderBy: { orderIndex: 'asc' } } },
        });
        await this.audit.logAction(`Created rubric for task ${taskId}`, undefined, userId);
        return rubric;
    }

    async getRubric(taskId: string) {
        const rubric = await this.prisma.rubric.findUnique({
            where: { taskId },
            include: { criteria: { orderBy: { orderIndex: 'asc' } } },
        });
        if (!rubric) throw new NotFoundException('Rubric not found');
        return rubric;
    }

    async submitReview(rubricId: string, submissionId: string, reviewerId: string, dto: { scores: { criterionId: string; score: number; commentAr?: string; commentEn?: string }[]; commentAr?: string; commentEn?: string }) {
        const rubric = await this.prisma.rubric.findUnique({ where: { id: rubricId } });
        if (!rubric) throw new NotFoundException('Rubric not found');
        const submission = await this.prisma.taskSubmission.findUnique({
            where: { id: submissionId },
            include: { enrollment: { select: { studentId: true, courseId: true, status: true } } },
        });
        if (!submission) throw new NotFoundException('Submission not found');
        // Three separate holes, in order of severity.
        //
        // The submission must belong to the task this rubric grades. Any
        // student could otherwise POST any submission id in the platform with
        // any rubric id and score a stranger's work.
        if (submission.taskId !== rubric.taskId) {
            throw new NotFoundException('Submission not found for this task');
        }
        // The self-review guard compared `TaskSubmission.enrollmentId` (which
        // references Enrollment.id) against `reviewerId` (a User.id). Two
        // different tables, so the comparison was never true and students
        // could grade their own work. Resolved through the relation.
        if (submission.enrollment.studentId === reviewerId) {
            throw new ForbiddenException('Cannot review your own submission');
        }
        // A review only counts if the reviewer is actually enrolled in the same
        // course. Without this, any valid student token was enough.
        if (submission.enrollment.status !== 'APPROVED') {
            throw new ForbiddenException('Only approved students may review');
        }
        const reviewerEnrollment = await this.prisma.enrollment.findFirst({
            where: { courseId: submission.enrollment.courseId, studentId: reviewerId, status: 'APPROVED' },
            select: { id: true },
        });
        if (!reviewerEnrollment) throw new ForbiddenException('Not enrolled in this course');

        // The score is derived from the criteria the rubric actually defines,
        // and each one is clamped to its own maximum. Previously it was an
        // attacker-controlled sum with no range check, so a peer could hand
        // out arbitrary marks.
        const criteria = await this.prisma.rubricCriterion.findMany({
            where: { rubricId },
            select: { id: true, maxScore: true },
        });
        const byId = new Map(criteria.map((c) => [c.id, c.maxScore]));
        for (const s of dto.scores ?? []) {
            if (!byId.has(s.criterionId)) throw new BadRequestException('Unknown criterion for this rubric');
        }
        const totalScore = (dto.scores ?? []).reduce(
            (sum, s) => sum + Math.max(0, Math.min(Number(s.score) || 0, byId.get(s.criterionId) ?? 0)),
            0,
        );
        const existing = await this.prisma.peerReview.findUnique({
            where: { rubricId_submissionId_reviewerId: { rubricId, submissionId, reviewerId } },
        });
        if (existing) throw new BadRequestException('Already reviewed this submission');
        const review = await this.prisma.peerReview.create({
            data: {
                rubricId,
                submissionId,
                reviewerId,
                score: totalScore,
                commentAr: dto.commentAr || null,
                commentEn: dto.commentEn || null,
                status: 'completed',
                criterionScores: {
                    create: (dto.scores ?? []).map(s => ({
                        criterionId: s.criterionId,
                        score: Math.max(0, Math.min(Number(s.score) || 0, byId.get(s.criterionId) ?? 0)),
                        commentAr: s.commentAr || null,
                        commentEn: s.commentEn || null,
                    })),
                },
            },
            include: { criterionScores: { include: { criterion: true } } },
        });
        await this.audit.logAction(`Peer review submitted for submission ${submissionId}`, undefined, reviewerId);
        this.gamification.addPoints(reviewerId, 'peer_review').catch(() => {});
        return review;
    }

    async getReviewsForSubmission(submissionId: string, actorId: string, actorRole: Role) {
        const submission = await this.prisma.taskSubmission.findUnique({
            where: { id: submissionId },
            include: { enrollment: { select: { studentId: true, courseId: true } }, task: { select: { openingId: true } } },
        });
        if (!submission) throw new NotFoundException('Submission not found');
        // Reviews carry reviewer emails and free-text comments, so this used to
        // let any authenticated user read another student's feedback by
        // iterating submission ids. Staff may always; the owner may read their
        // own.
        if (actorRole === Role.ADMIN || actorRole === Role.COURSE_MANAGER) {
            // oversight
        } else if (actorRole === Role.INSTRUCTOR) {
            await this.courses.assertCanManageOpening(
                submission.task.openingId,
                actorId,
                actorRole,
                'canGrade',
            );
        } else if (submission.enrollment.studentId === actorId) {
            // own submission
        } else {
            throw new ForbiddenException('Not your submission');
        }
        const reviews = await this.prisma.peerReview.findMany({
            where: { submissionId },
            include: {
                reviewer: { select: { id: true, email: true } },
                criterionScores: { include: { criterion: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
        const avgScore = reviews.length > 0 ? reviews.reduce((s, r) => s + (r.score || 0), 0) / reviews.length : 0;
        return { reviews, averageScore: Math.round(avgScore * 10) / 10, count: reviews.length };
    }

    async assignRandomReviews(rubricId: string, countPerSubmission: number, actorId: string, actorRole: Role) {
        const rubric = await this.prisma.rubric.findUnique({ where: { id: rubricId }, include: { task: true } });
        if (!rubric) throw new NotFoundException('Rubric not found');
        if (actorRole === Role.INSTRUCTOR) {
            await this.courses.assertCanManageOpening(
                rubric.task.openingId,
                actorId,
                actorRole,
                'canGrade',
            );
        }
        const submissions = await this.prisma.taskSubmission.findMany({ where: { taskId: rubric.taskId } });
        if (submissions.length < 2) throw new BadRequestException('Need at least 2 submissions');
        const assigned: { submissionId: string; reviewerId: string }[] = [];
        for (const sub of submissions) {
            const otherSubs = submissions.filter(s => s.id !== sub.id);
            const shuffled = otherSubs.sort(() => Math.random() - 0.5).slice(0, countPerSubmission);
            for (const other of shuffled) {
                const existing = await this.prisma.peerReview.findUnique({
                    where: { rubricId_submissionId_reviewerId: { rubricId, submissionId: other.id, reviewerId: sub.enrollmentId } },
                }).catch(() => null);
                if (!existing) {
                    assigned.push({ submissionId: other.id, reviewerId: sub.enrollmentId });
                }
            }
        }
        return { assigned, total: assigned.length };
    }
}
