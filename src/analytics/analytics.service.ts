import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';

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
