import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';
import { resolveClassroom } from '../common/classroom';

@Injectable()
export class AnalyticsService {
    constructor(private prisma: PrismaService) {}

    private async assertEnrolled(userId: string, courseId: string) {
        const enrollment = await this.prisma.enrollment.findFirst({
            where: { studentId: userId, courseId, status: { in: ['APPROVED', 'RESERVED'] } },
            select: { id: true },
        });
        if (!enrollment) {
            throw new ForbiddenException('You are not enrolled in this course');
        }
    }

    async startSession(userId: string, courseId: string, moduleId?: string) {
        await this.assertEnrolled(userId, courseId);
        const session = await this.prisma.learningSession.create({
            data: { userId, courseId, moduleId: moduleId || null, durationSec: 0 },
        });
        return session;
    }

    async heartbeat(sessionId: string, userId: string) {
        const session = await this.prisma.learningSession.findFirst({ where: { id: sessionId, userId } });
        if (!session) throw new NotFoundException('Session not found');
        const now = new Date();
        const elapsed = Math.floor((now.getTime() - session.lastHeartbeat.getTime()) / 1000);
        const updated = await this.prisma.learningSession.updateMany({
            where: { id: sessionId, userId },
            data: { lastHeartbeat: now, durationSec: session.durationSec + Math.min(elapsed, 120) },
        });
        if (updated.count === 0) throw new NotFoundException('Session not found');
        return this.prisma.learningSession.findUnique({ where: { id: sessionId } });
    }

    async getStudentAnalytics(userId: string) {
        const sessions = await this.prisma.learningSession.findMany({
            where: { userId },
            include: { course: { select: { id: true, titleAr: true, titleEn: true } } },
            orderBy: { startedAt: 'desc' },
        });
        const totalSeconds = sessions.reduce((sum, s) => sum + s.durationSec, 0);
        const totalHours = Math.round(totalSeconds / 3600 * 10) / 10;
        const totalMinutes = Math.round(totalSeconds / 60);

        const coursesStudied = new Set(sessions.map(s => s.courseId)).size;

        const enrollments = await this.prisma.enrollment.findMany({
            where: { studentId: userId, status: 'APPROVED' },
            include: {
                course: { select: { id: true, titleAr: true, titleEn: true } },
                opening: { select: { id: true, status: true } },
            },
        });

        const coursesInProgress = enrollments.filter(e => e.opening?.status !== 'ENDED').length;
        const coursesCompleted = enrollments.filter(e => e.opening?.status === 'ENDED').length;

        const byCourse = enrollments.map(e => {
            const courseSessions = sessions.filter(s => s.courseId === e.course.id);
            const totalSec = courseSessions.reduce((sum, s) => sum + s.durationSec, 0);
            return {
                courseId: e.course.id,
                courseTitleAr: e.course.titleAr,
                courseTitleEn: e.course.titleEn,
                totalMinutes: Math.round(totalSec / 60),
                sessionsCount: courseSessions.length,
                isCompleted: e.opening?.status === 'ENDED',
            };
        });

        const points = await this.prisma.userPoints.findUnique({ where: { userId } });
        const pointLogs = await this.prisma.pointLog.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: 30,
        });

        return {
            totalHours,
            totalMinutes,
            coursesStudied,
            coursesInProgress,
            coursesCompleted,
            byCourse,
            points: points?.points || 0,
            level: points?.level || 1,
            streak: points?.streak || 0,
            recentActivity: pointLogs,
        };
    }

    async getStudentDashboard(userId: string) {
        const now = new Date();
        const enrollments = await this.prisma.enrollment.findMany({
            where: { studentId: userId },
            orderBy: { createdAt: 'desc' },
            include: {
                course: {
                    select: {
                        id: true,
                        titleAr: true,
                        titleEn: true,
                        contentType: true,
                        _count: { select: { modules: true } },
                    },
                },
                opening: {
                    select: {
                        id: true,
                        status: true,
                        nameAr: true,
                        nameEn: true,
                        deliveryMode: true,
                        meetLink: true,
                        liveSessions: {
                            orderBy: { scheduledAt: 'asc' },
                            select: {
                                id: true,
                                titleAr: true,
                                titleEn: true,
                                scheduledAt: true,
                                durationMinutes: true,
                                meetLink: true,
                            },
                        },
                    },
                },
                _count: { select: { lessonProgress: true } },
            },
        });

        const approved = enrollments.filter((enrollment) => enrollment.status === 'APPROVED');
        const legacyCourseIds = [...new Set(
            approved
                .filter((enrollment) => !enrollment.openingId)
                .map((enrollment) => enrollment.courseId),
        )];
        const legacyOpenings = legacyCourseIds.length
            ? await this.prisma.courseOpening.findMany({
                where: { courseId: { in: legacyCourseIds } },
                select: {
                    id: true,
                    courseId: true,
                    nameAr: true,
                    nameEn: true,
                    status: true,
                    deliveryMode: true,
                    meetLink: true,
                    liveSessions: {
                        orderBy: { scheduledAt: 'asc' },
                        select: {
                            id: true,
                            titleAr: true,
                            titleEn: true,
                            scheduledAt: true,
                            durationMinutes: true,
                            meetLink: true,
                        },
                    },
                },
            })
            : [];
        const legacyByCourse = new Map<string, typeof legacyOpenings>();
        for (const opening of legacyOpenings) {
            legacyByCourse.set(opening.courseId, [...(legacyByCourse.get(opening.courseId) ?? []), opening]);
        }

        const approvedWithOpening = approved.map((enrollment) => ({
            enrollment,
            opening: enrollment.opening ?? (
                legacyByCourse.get(enrollment.courseId)?.length === 1
                    ? legacyByCourse.get(enrollment.courseId)![0]
                    : null
            ),
        }));
        const openingIds = [...new Set(
            approvedWithOpening
                .map(({ opening }) => opening?.id)
                .filter((id): id is string => !!id),
        )];
        const enrollmentIds = approved.map((enrollment) => enrollment.id);
        const enrollmentIdsByOpening = new Map<string, Set<string>>();
        for (const { enrollment, opening } of approvedWithOpening) {
            if (!opening) continue;
            const openingEnrollmentIds = enrollmentIdsByOpening.get(opening.id) ?? new Set<string>();
            openingEnrollmentIds.add(enrollment.id);
            enrollmentIdsByOpening.set(opening.id, openingEnrollmentIds);
        }
        const tasks = openingIds.length && enrollmentIds.length
            ? await this.prisma.courseTask.findMany({
                where: { openingId: { in: openingIds } },
                orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
                include: {
                    opening: {
                        select: {
                            id: true,
                            nameAr: true,
                            nameEn: true,
                            course: { select: { id: true, titleAr: true, titleEn: true } },
                        },
                    },
                    submissions: {
                        where: { enrollmentId: { in: enrollmentIds } },
                        select: { enrollmentId: true, submittedAt: true, score: true },
                    },
                },
            })
            : [];

        const courseRows = approvedWithOpening.map(({ enrollment, opening }) => {
            const totalModules = enrollment.course._count.modules;
            const completedModules = enrollment._count.lessonProgress;
            return {
                id: enrollment.id,
                courseId: enrollment.course.id,
                titleAr: enrollment.course.titleAr,
                titleEn: enrollment.course.titleEn,
                openingId: opening?.id ?? null,
                openingNameAr: opening?.nameAr ?? null,
                openingNameEn: opening?.nameEn ?? null,
                openingStatus: opening?.status ?? null,
                progressPercent: totalModules
                    ? Math.min(100, Math.round((completedModules / totalModules) * 100))
                    : null,
            };
        });

        const sessions = approvedWithOpening.flatMap(({ enrollment, opening }) => {
            if (!opening || enrollment.course.contentType !== 'LIVE') return [];
            const classroom = resolveClassroom(enrollment.status, opening, opening.liveSessions);
            return classroom.liveSessions
                .filter((session) => {
                    const endsAt = session.durationMinutes
                        ? session.scheduledAt.getTime() + session.durationMinutes * 60_000
                        : session.scheduledAt.getTime();
                    return endsAt >= now.getTime();
                })
                .map((session) => ({
                    ...session,
                    courseId: enrollment.course.id,
                    courseTitleAr: enrollment.course.titleAr,
                    courseTitleEn: enrollment.course.titleEn,
                    openingId: opening.id,
                    openingNameAr: opening.nameAr,
                    openingNameEn: opening.nameEn,
                }));
        }).sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

        const actionableTasks = tasks.flatMap((task) => {
            const openingEnrollmentIds = enrollmentIdsByOpening.get(task.opening.id);
            if (task.submissions.some((submission) => openingEnrollmentIds?.has(submission.enrollmentId))) return [];
            return [{
                id: task.id,
                titleAr: task.titleAr,
                titleEn: task.titleEn,
                dueDate: task.dueDate,
                isOverdue: !!task.dueDate && task.dueDate.getTime() < now.getTime(),
                maxScore: task.maxScore,
                courseId: task.opening.course.id,
                courseTitleAr: task.opening.course.titleAr,
                courseTitleEn: task.opening.course.titleEn,
                openingId: task.opening.id,
                openingNameAr: task.opening.nameAr,
                openingNameEn: task.opening.nameEn,
            }];
        }).sort((a, b) => {
            if (!a.dueDate) return b.dueDate ? 1 : 0;
            if (!b.dueDate) return -1;
            return a.dueDate.getTime() - b.dueDate.getTime();
        });
        const overdueTaskCount = actionableTasks.filter((task) =>
            task.dueDate && task.dueDate.getTime() < now.getTime(),
        ).length;
        const pendingGradingCount = tasks.filter((task) =>
            task.submissions.some((submission) =>
                enrollmentIdsByOpening.get(task.opening.id)?.has(submission.enrollmentId) &&
                submission.score === null,
            ),
        ).length;

        return {
            summary: {
                activeCourseCount: courseRows.filter((course) => course.openingStatus !== 'ENDED').length,
                completedCourseCount: courseRows.filter((course) => course.openingStatus === 'ENDED').length,
                pendingTaskCount: actionableTasks.length,
                overdueTaskCount,
                pendingGradingCount,
            },
            courses: courseRows,
            tasks: actionableTasks.slice(0, 5),
            upcomingSessions: sessions.slice(0, 5),
        };
    }

    async getCourseAnalytics(courseId: string, userId: string, role: Role) {
        const adminOrManager = role === Role.ADMIN || role === Role.COURSE_MANAGER;
        if (!adminOrManager) {
            const owned = await this.prisma.course.findFirst({
                where: { id: courseId, instructorId: userId },
                select: { id: true },
            });
            if (!owned) throw new ForbiddenException('You do not own this course');
        }

        const enrollments = await this.prisma.enrollment.findMany({
            where: { courseId, status: 'APPROVED' },
        });
        const sessions = await this.prisma.learningSession.findMany({ where: { courseId } });
        const totalStudents = enrollments.length;
        const totalMinutes = sessions.reduce((sum, s) => sum + s.durationSec, 0) / 60;
        const avgMinutesPerStudent = totalStudents > 0 ? Math.round(totalMinutes / totalStudents) : 0;

        const completedModules = await this.prisma.lessonProgress.count({
            where: { enrollment: { courseId } },
        });

        return {
            totalStudents,
            totalMinutes: Math.round(totalMinutes),
            avgMinutesPerStudent,
            completedModules,
            totalSessions: sessions.length,
        };
    }

    async getInstructorDashboard(userId: string) {
        const openings = await this.prisma.courseOpening.findMany({
            where: {
                OR: [
                    { instructorId: userId },
                    { instructorGrants: { some: { instructorId: userId } } },
                ],
            },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                nameAr: true,
                nameEn: true,
                status: true,
                startDate: true,
                endDate: true,
                instructorId: true,
                instructorGrants: {
                    where: { instructorId: userId },
                    select: { canViewAnalytics: true, canManageSessions: true },
                },
                course: { select: { id: true, titleAr: true, titleEn: true } },
            },
        });
        const openingIds = openings.map((opening) => opening.id);
        if (openingIds.length === 0) {
            return {
                openingCount: 0,
                activeOpeningCount: 0,
                approvedStudentCount: 0,
                ungradedSubmissionCount: 0,
                openings: [],
                openingReports: [],
                upcomingSessions: [],
            };
        }

        const reportableOpenings = openings.filter((opening) =>
            opening.instructorId === userId || opening.instructorGrants?.[0]?.canViewAnalytics,
        );
        const analyticsOpeningIds = reportableOpenings.map((opening) => opening.id);
        const sessionOpeningIds = openings
            .filter((opening) => opening.instructorId === userId || opening.instructorGrants?.[0]?.canManageSessions)
            .map((opening) => opening.id);
        const now = new Date();
        const [enrollments, dueTasks, submissionsByEnrollment, attendanceByEnrollment, ungradedSubmissionCount, upcomingSessions] = await Promise.all([
            analyticsOpeningIds.length
                ? this.prisma.enrollment.findMany({
                    where: { openingId: { in: analyticsOpeningIds }, status: 'APPROVED' },
                    select: { id: true, openingId: true },
                })
                : Promise.resolve([]),
            analyticsOpeningIds.length
                ? this.prisma.courseTask.findMany({
                    where: {
                        openingId: { in: analyticsOpeningIds },
                        OR: [{ dueDate: null }, { dueDate: { lte: now } }],
                    },
                    select: { id: true, openingId: true },
                })
                : Promise.resolve([]),
            analyticsOpeningIds.length
                ? this.prisma.taskSubmission.groupBy({
                    by: ['enrollmentId'],
                    where: {
                        task: {
                            openingId: { in: analyticsOpeningIds },
                            OR: [{ dueDate: null }, { dueDate: { lte: now } }],
                        },
                        enrollment: { openingId: { in: analyticsOpeningIds }, status: 'APPROVED' },
                    },
                    _count: { _all: true },
                })
                : Promise.resolve([]),
            analyticsOpeningIds.length
                ? this.prisma.sessionAttendance.groupBy({
                    by: ['enrollmentId', 'status'],
                    where: {
                        session: { openingId: { in: analyticsOpeningIds } },
                        enrollment: { openingId: { in: analyticsOpeningIds }, status: 'APPROVED' },
                    },
                    _count: { _all: true },
                })
                : Promise.resolve([]),
            analyticsOpeningIds.length
                ? this.prisma.taskSubmission.count({
                    where: { score: null, task: { openingId: { in: analyticsOpeningIds } } },
                })
                : Promise.resolve(0),
            sessionOpeningIds.length
                ? this.prisma.liveSession.findMany({
                where: {
                    openingId: { in: sessionOpeningIds },
                    scheduledAt: { gte: now },
                    opening: { course: { contentType: 'LIVE' } },
                },
                orderBy: { scheduledAt: 'asc' },
                take: 6,
                select: {
                    id: true,
                    titleAr: true,
                    titleEn: true,
                    scheduledAt: true,
                    durationMinutes: true,
                    opening: {
                        select: {
                            id: true,
                            nameAr: true,
                            nameEn: true,
                            course: { select: { id: true, titleAr: true, titleEn: true } },
                        },
                    },
                },
            })
                : Promise.resolve([]),
        ]);

        const dueTaskCounts = new Map<string, number>();
        for (const task of dueTasks) {
            dueTaskCounts.set(task.openingId, (dueTaskCounts.get(task.openingId) ?? 0) + 1);
        }

        const submittedTaskCounts = new Map<string, number>();
        for (const submission of submissionsByEnrollment) {
            submittedTaskCounts.set(submission.enrollmentId, submission._count._all);
        }

        const attendanceByStudent = new Map<string, Map<string, number>>();
        for (const record of attendanceByEnrollment) {
            const counts = attendanceByStudent.get(record.enrollmentId) ?? new Map<string, number>();
            counts.set(record.status, record._count._all);
            attendanceByStudent.set(record.enrollmentId, counts);
        }

        const openingReports = reportableOpenings.slice(0, 6).map((opening) => {
            const openingEnrollments = enrollments.filter((enrollment) => enrollment.openingId === opening.id);
            const openingTasks = dueTaskCounts.get(opening.id) ?? 0;
            const submitted = openingEnrollments.reduce(
                (sum, enrollment) => sum + (submittedTaskCounts.get(enrollment.id) ?? 0),
                0,
            );
            const expectedSubmissions = openingEnrollments.length * openingTasks;
            let attended = 0;
            let attendanceDenominator = 0;
            const needsFollowUp = openingEnrollments.filter((enrollment) => {
                const studentAttendance = attendanceByStudent.get(enrollment.id);
                const present = studentAttendance?.get('PRESENT') ?? 0;
                const late = studentAttendance?.get('LATE') ?? 0;
                const absent = studentAttendance?.get('ABSENT') ?? 0;
                attended += present + late;
                attendanceDenominator += present + late + absent;
                return absent > 0 || (openingTasks > 0 && (submittedTaskCounts.get(enrollment.id) ?? 0) < openingTasks);
            });
            return {
                ...opening,
                approvedStudentCount: openingEnrollments.length,
                attendanceRate: attendanceDenominator
                    ? Math.round((attended / attendanceDenominator) * 100)
                    : null,
                taskSubmissionRate: expectedSubmissions
                    ? Math.min(100, Math.round((submitted / expectedSubmissions) * 100))
                    : null,
                needsFollowUpCount: needsFollowUp.length,
            };
        });

        const visibleOpenings = openings.slice(0, 6).map(({ instructorGrants: _grants, instructorId: _instructorId, ...opening }) => opening);
        return {
            openingCount: openings.length,
            activeOpeningCount: openings.filter((opening) => opening.status === 'STARTED' || opening.status === 'OPEN').length,
            approvedStudentCount: enrollments.length,
            ungradedSubmissionCount,
            openings: visibleOpenings,
            openingReports,
            upcomingSessions,
        };
    }

    async getStudentCourseAnalytics(userId: string, courseId: string) {
        await this.assertEnrolled(userId, courseId);

        const sessions = await this.prisma.learningSession.findMany({
            where: { userId, courseId },
            orderBy: { startedAt: 'asc' },
        });
        const totalSeconds = sessions.reduce((sum, s) => sum + s.durationSec, 0);

        const moduleProgress = await this.prisma.lessonProgress.findMany({
            where: { enrollment: { studentId: userId, courseId } },
            include: { module: { select: { id: true, titleAr: true, titleEn: true, orderIndex: true } } },
        });

        return {
            totalMinutes: Math.round(totalSeconds / 60),
            sessionsCount: sessions.length,
            moduleProgress: moduleProgress.map(p => ({
                moduleId: p.module.id,
                moduleTitleAr: p.module.titleAr,
                moduleTitleEn: p.module.titleEn,
                completed: true,
            })),
        };
    }
}
