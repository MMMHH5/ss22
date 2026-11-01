import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CourseOpeningStatus, EnrollmentStatus, Role } from '@prisma/client';
import { CreateLearningPathDto, UpdateLearningPathDto } from './dto/learning-path.dto';

const courseSummarySelect = {
    id: true,
    titleAr: true,
    titleEn: true,
    excerptAr: true,
    excerptEn: true,
    descriptionAr: true,
    descriptionEn: true,
    categoryAr: true,
    categoryEn: true,
    level: true,
    contentType: true,
    language: true,
    hoursOfContent: true,
    durationAr: true,
    durationEn: true,
    syllabusAr: true,
    syllabusEn: true,
    coverImageUrl: true,
    _count: { select: { modules: true, objectives: true, audiences: true } },
};

const learningPathInclude = {
    courses: {
        include: {
            course: { select: courseSummarySelect },
        },
        orderBy: { orderIndex: 'asc' as const },
    },
    creator: { select: { id: true, email: true } },
};

const managementLearningPathInclude = {
    ...learningPathInclude,
    _count: { select: { enrollments: true } },
    courses: {
        include: {
            course: {
                select: {
                    ...courseSummarySelect,
                    openings: {
                        select: {
                            id: true,
                            status: true,
                            isPublished: true,
                            enrollmentDeadline: true,
                            maxStudents: true,
                            seatsTaken: true,
                        },
                    },
                },
            },
        },
        orderBy: { orderIndex: 'asc' as const },
    },
};

const STUDENT_ENROLLMENT_STATUSES = [
    EnrollmentStatus.PENDING,
    EnrollmentStatus.RESERVED,
    EnrollmentStatus.APPROVED,
];

@Injectable()
export class LearningPathsService {
    constructor(private prisma: PrismaService, private audit: AuditService) {}

    async createPath(dto: CreateLearningPathDto, creatorId: string) {
        if (!dto.titleAr?.trim() || !dto.titleEn?.trim()) throw new BadRequestException('Titles required');
        const courseIds = dto.courseIds ?? [];
        await this.assertCoursesExist(courseIds);
        if (dto.isPublished && courseIds.length === 0) {
            throw new BadRequestException('A learning path needs at least one course before publishing');
        }
        const path = await this.prisma.learningPath.create({
            data: {
                titleAr: dto.titleAr.trim(),
                titleEn: dto.titleEn.trim(),
                descriptionAr: dto.descriptionAr?.trim() || null,
                descriptionEn: dto.descriptionEn?.trim() || null,
                coverImageUrl: dto.coverImageUrl?.trim() || null,
                isPublished: dto.isPublished ?? false,
                creatorId,
                courses: {
                    create: courseIds.map((courseId, i) => ({ courseId, orderIndex: i })),
                },
            },
            include: learningPathInclude,
        });
        await this.audit.logAction(`Created learning path "${dto.titleAr}"`, undefined, creatorId);
        return path;
    }

    async listPaths(isPublished?: boolean) {
        if (isPublished === undefined) {
            const paths = await this.prisma.learningPath.findMany({
                include: managementLearningPathInclude,
                orderBy: { createdAt: 'desc' },
            });
            return paths.map((path) => ({
                ...path,
                courses: path.courses.map((item) => ({
                    ...item,
                    readiness: this.courseReadiness(item.course),
                })),
            }));
        }
        return this.prisma.learningPath.findMany({
            where: { isPublished },
            include: learningPathInclude,
            orderBy: { createdAt: 'desc' },
        });
    }

    async listCoursesForManagement() {
        const courses = await this.prisma.course.findMany({
            select: {
                ...courseSummarySelect,
                openings: {
                    select: {
                        id: true,
                        status: true,
                        isPublished: true,
                        enrollmentDeadline: true,
                        maxStudents: true,
                        seatsTaken: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        return courses.map((course) => ({
            ...course,
            readiness: this.courseReadiness(course),
        }));
    }

    async getPath(pathId: string) {
        const path = await this.prisma.learningPath.findUnique({
            where: { id: pathId },
            include: learningPathInclude,
        });
        if (!path) throw new NotFoundException('Learning path not found');
        return path;
    }

    async updatePath(pathId: string, dto: UpdateLearningPathDto, userId: string, userRole: Role) {
        const path = await this.prisma.learningPath.findUnique({
            where: { id: pathId },
            include: { _count: { select: { courses: true } } },
        });
        if (!path) throw new NotFoundException('Learning path not found');
        if (userRole !== Role.ADMIN && userRole !== Role.COURSE_MANAGER && path.creatorId !== userId) throw new ForbiddenException('Not allowed');
        if ((dto.titleAr != null && !dto.titleAr.trim()) || (dto.titleEn != null && !dto.titleEn.trim())) {
            throw new BadRequestException('Titles cannot be empty');
        }
        if (dto.courseIds !== undefined && !Array.isArray(dto.courseIds)) {
            throw new BadRequestException('Course IDs must be an array');
        }
        const courseIds = dto.courseIds;
        if (courseIds !== undefined) await this.assertCoursesExist(courseIds);
        const publishing = dto.isPublished ?? path.isPublished;
        const resultingCourseCount = courseIds?.length ?? path._count.courses;
        if (publishing && resultingCourseCount === 0) {
            throw new BadRequestException('A learning path needs at least one course before publishing');
        }

        return this.prisma.$transaction(async (tx) => {
            await tx.learningPath.update({
                where: { id: pathId },
                data: {
                    titleAr: dto.titleAr?.trim() || path.titleAr,
                    titleEn: dto.titleEn?.trim() || path.titleEn,
                    descriptionAr: dto.descriptionAr === undefined ? path.descriptionAr : dto.descriptionAr?.trim() || null,
                    descriptionEn: dto.descriptionEn === undefined ? path.descriptionEn : dto.descriptionEn?.trim() || null,
                    coverImageUrl: dto.coverImageUrl === undefined ? path.coverImageUrl : dto.coverImageUrl?.trim() || null,
                    isPublished: publishing,
                },
            });
            if (courseIds !== undefined) {
                await tx.learningPathCourse.deleteMany({ where: { pathId } });
                if (courseIds.length > 0) {
                    await tx.learningPathCourse.createMany({
                        data: courseIds.map((courseId, orderIndex) => ({ pathId, courseId, orderIndex })),
                    });
                }
            }
            return tx.learningPath.findUniqueOrThrow({
                where: { id: pathId },
                include: learningPathInclude,
            });
        });
    }

    async deletePath(pathId: string, userId: string, userRole: Role) {
        const path = await this.prisma.learningPath.findUnique({ where: { id: pathId } });
        if (!path) throw new NotFoundException('Learning path not found');
        if (userRole !== Role.ADMIN && userRole !== Role.COURSE_MANAGER && path.creatorId !== userId) throw new ForbiddenException('Not allowed');
        await this.prisma.learningPath.delete({ where: { id: pathId } });
        return { ok: true };
    }

    async enrollPath(pathId: string, userId: string) {
        const path = await this.getPath(pathId);
        if (!path.isPublished) throw new NotFoundException('Learning path not found');
        const existing = await this.prisma.learningPathEnrollment.findUnique({
            where: { pathId_studentId: { pathId, studentId: userId } },
            select: { id: true },
        });
        const pathEnrollment = await this.prisma.learningPathEnrollment.upsert({
            where: { pathId_studentId: { pathId, studentId: userId } },
            create: { pathId, studentId: userId },
            update: {},
        });

        const courses = await Promise.all(path.courses.map(async ({ course }) => {
            const [enrollment, openings] = await Promise.all([
                this.prisma.enrollment.findUnique({
                    where: { studentId_courseId: { studentId: userId, courseId: course.id } },
                    select: { status: true },
                }),
                this.prisma.courseOpening.findMany({
                    where: {
                        courseId: course.id,
                        isPublished: true,
                        status: { in: [CourseOpeningStatus.OPEN, CourseOpeningStatus.ANNOUNCEMENT] },
                    },
                    orderBy: { createdAt: 'desc' },
                    select: {
                        id: true,
                        status: true,
                        enrollmentDeadline: true,
                        maxStudents: true,
                        seatsTaken: true,
                    },
                }),
            ]);
            const alreadyEnrolled = enrollment && enrollment.status !== EnrollmentStatus.REJECTED
                && enrollment.status !== EnrollmentStatus.REVOKED;
            const registrationStatus = alreadyEnrolled
                ? 'already_enrolled'
                : this.openingAvailability(openings);
            return { courseId: course.id, registrationStatus, enrollmentStatus: enrollment?.status ?? null };
        }));

        if (!existing) {
            await this.audit.logAction(`Enrolled in learning path "${path.titleEn}"`, undefined, userId);
        }
        return {
            pathEnrollment,
            alreadyEnrolledInPath: !!existing,
            totalCourses: path.courses.length,
            courses,
        };
    }

    async getPublishedPath(pathId: string) {
        const path = await this.getPath(pathId);
        if (!path.isPublished) throw new NotFoundException('Learning path not found');
        return path;
    }

    async getStudentPaths(studentId: string) {
        const pathEnrollments = await this.prisma.learningPathEnrollment.findMany({
            where: { studentId, path: { isPublished: true } },
            include: {
                path: {
                    include: {
                        courses: {
                            include: {
                                course: {
                                    select: {
                                        ...courseSummarySelect,
                                        openings: {
                                            where: {
                                                isPublished: true,
                                                status: { in: [CourseOpeningStatus.OPEN, CourseOpeningStatus.ANNOUNCEMENT] },
                                            },
                                            select: {
                                                status: true,
                                                enrollmentDeadline: true,
                                                maxStudents: true,
                                                seatsTaken: true,
                                            },
                                        },
                                        enrollments: {
                                            where: { studentId },
                                            select: {
                                                id: true,
                                                status: true,
                                                lessonProgress: { select: { moduleId: true } },
                                            },
                                        },
                                    },
                                },
                            },
                            orderBy: { orderIndex: 'asc' },
                        },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        return pathEnrollments.map(({ path, ...pathEnrollment }) => {
            let totalLessons = 0;
            let completedLessons = 0;
            let totalProgressUnits = 0;
            let completedProgressUnits = 0;
            let completedCourses = 0;
            const courses = path.courses.map(({ course, ...pathCourse }) => {
                const enrollment = course.enrollments[0];
                const total = course._count.modules;
                const progressUnits = Math.max(total, 1);
                const completed = enrollment?.status === EnrollmentStatus.APPROVED
                    ? Math.min(enrollment.lessonProgress.length, total)
                    : 0;
                const isCompleted = !!enrollment
                    && enrollment.status === EnrollmentStatus.APPROVED
                    && total > 0
                    && completed >= total;
                totalLessons += total;
                completedLessons += completed;
                totalProgressUnits += progressUnits;
                completedProgressUnits += completed;
                if (isCompleted) completedCourses += 1;
                return {
                    ...pathCourse,
                    course: {
                        id: course.id,
                        titleAr: course.titleAr,
                        titleEn: course.titleEn,
                        coverImageUrl: course.coverImageUrl,
                    },
                    enrollmentStatus: enrollment?.status ?? null,
                    registrationStatus: enrollment
                        ? this.studentCourseStatus(enrollment.status)
                        : this.openingAvailability(course.openings),
                    completedLessons: completed,
                    totalLessons: total,
                    progressPercent: total > 0 ? Math.round((completed / total) * 100) : 0,
                    isCompleted,
                };
            });
            const totalCourses = courses.length;
            const isCompleted = totalCourses > 0 && completedCourses === totalCourses;
            return {
                ...path,
                path: {
                    id: path.id,
                    titleAr: path.titleAr,
                    titleEn: path.titleEn,
                    descriptionAr: path.descriptionAr,
                    descriptionEn: path.descriptionEn,
                    coverImageUrl: path.coverImageUrl,
                    courses,
                },
                courses,
                totalCourses,
                completedCourses,
                totalLessons,
                completedLessons,
                progressPercent: totalProgressUnits > 0 ? Math.round((completedProgressUnits / totalProgressUnits) * 100) : 0,
                isCompleted,
            };
        });
    }

    async getPathReport(pathId: string) {
        const path = await this.prisma.learningPath.findUnique({
            where: { id: pathId },
            include: managementLearningPathInclude,
        });
        if (!path) throw new NotFoundException('Learning path not found');

        const pathEnrollments = await this.prisma.learningPathEnrollment.findMany({
            where: { pathId },
            select: { studentId: true },
        });
        const studentIds = pathEnrollments.map(({ studentId }) => studentId);
        const courseIds = path.courses.map(({ courseId }) => courseId);
        const enrollments = studentIds.length === 0 || courseIds.length === 0
            ? []
            : await this.prisma.enrollment.findMany({
                where: {
                    studentId: { in: studentIds },
                    courseId: { in: courseIds },
                    status: { in: STUDENT_ENROLLMENT_STATUSES },
                },
                select: {
                    studentId: true,
                    courseId: true,
                    status: true,
                    lessonProgress: { select: { moduleId: true } },
                },
            });
        const enrollmentByStudentCourse = new Map(
            enrollments.map((enrollment) => [`${enrollment.studentId}:${enrollment.courseId}`, enrollment]),
        );
        const completedStudents = new Set<string>();
        let activeStudents = 0;
        for (const studentId of studentIds) {
            const studentCourses = path.courses.map(({ course }) => {
                const enrollment = enrollmentByStudentCourse.get(`${studentId}:${course.id}`);
                if (!enrollment || enrollment.status !== EnrollmentStatus.APPROVED) return false;
                return course._count.modules > 0 && enrollment.lessonProgress.length >= course._count.modules;
            });
            if (studentCourses.some((isComplete) => isComplete === false)
                && enrollments.some((enrollment) => enrollment.studentId === studentId)) {
                activeStudents += 1;
            }
            if (studentCourses.length > 0 && studentCourses.every(Boolean)) completedStudents.add(studentId);
        }

        return {
            path: {
                id: path.id,
                titleAr: path.titleAr,
                titleEn: path.titleEn,
                isPublished: path.isPublished,
            },
            learners: pathEnrollments.length,
            activeStudents,
            completedStudents: completedStudents.size,
            completionRate: pathEnrollments.length > 0
                ? Math.round((completedStudents.size / pathEnrollments.length) * 100)
                : 0,
            courses: path.courses.map(({ course }) => ({
                id: course.id,
                titleAr: course.titleAr,
                titleEn: course.titleEn,
                enrolledStudents: enrollments.filter((enrollment) => enrollment.courseId === course.id).length,
                totalLessons: course._count.modules,
                readiness: this.courseReadiness(course),
            })),
        };
    }

    private studentCourseStatus(status: EnrollmentStatus | null) {
        if (status === EnrollmentStatus.APPROVED) return 'approved';
        if (status === EnrollmentStatus.RESERVED) return 'reserved';
        if (status === EnrollmentStatus.PENDING) return 'pending';
        if (status === EnrollmentStatus.REJECTED) return 'rejected';
        if (status === EnrollmentStatus.REVOKED) return 'revoked';
        return 'not_enrolled';
    }

    private openingAvailability(openings: {
        status: CourseOpeningStatus;
        enrollmentDeadline: Date | null;
        maxStudents: number | null;
        seatsTaken: number;
    }[]) {
        const now = new Date();
        const openingsWithCapacity = openings.filter((opening) =>
            opening.maxStudents === null || opening.seatsTaken < opening.maxStudents,
        );
        if (openingsWithCapacity.some((opening) =>
            opening.status === CourseOpeningStatus.OPEN
            && (!opening.enrollmentDeadline || opening.enrollmentDeadline >= now),
        )) return 'open';
        if (openingsWithCapacity.some((opening) => opening.status === CourseOpeningStatus.ANNOUNCEMENT)) {
            return 'reservation';
        }
        if (openings.some((opening) =>
            opening.status === CourseOpeningStatus.OPEN
            && opening.enrollmentDeadline
            && opening.enrollmentDeadline < now,
        )) return 'deadline_passed';
        if (openings.length > 0) return 'full';
        return 'unavailable';
    }

    private courseReadiness(course: {
        descriptionAr: string | null;
        descriptionEn: string | null;
        excerptAr: string | null;
        excerptEn: string | null;
        categoryAr: string | null;
        categoryEn: string | null;
        level: string;
        contentType: string;
        language: string | null;
        coverImageUrl: string | null;
        syllabusAr: string | null;
        syllabusEn: string | null;
        hoursOfContent: number | null;
        durationAr: string | null;
        durationEn: string | null;
        _count: { modules: number; objectives: number; audiences: number };
        openings?: {
            status: CourseOpeningStatus;
            isPublished: boolean;
            enrollmentDeadline: Date | null;
            maxStudents: number | null;
            seatsTaken: number;
        }[];
    }) {
        const availableOpening = (course.openings ?? []).some((opening) =>
            opening.isPublished
            && opening.status === CourseOpeningStatus.OPEN
            && (!opening.enrollmentDeadline || opening.enrollmentDeadline >= new Date())
            && (opening.maxStudents === null || opening.seatsTaken < opening.maxStudents),
        );
        const checks = {
            excerpt: !!course.excerptAr?.trim() && !!course.excerptEn?.trim(),
            description: !!course.descriptionAr?.trim() && !!course.descriptionEn?.trim(),
            category: !!course.categoryAr?.trim() && !!course.categoryEn?.trim(),
            cover: !!course.coverImageUrl,
            objectives: course._count.objectives > 0,
            audience: course._count.audiences > 0,
            syllabus: !!course.syllabusAr?.trim() && !!course.syllabusEn?.trim(),
            structure: course._count.modules > 0,
            level: !!course.level,
            language: !!course.language?.trim(),
            contentType: !!course.contentType,
            duration: !!(course.hoursOfContent || course.durationAr?.trim() || course.durationEn?.trim()),
            opening: availableOpening,
        };
        const missing = Object.entries(checks).filter(([, complete]) => !complete).map(([key]) => key);
        const completed = Object.values(checks).filter(Boolean).length;
        return {
            checks,
            missing,
            percent: Math.round((completed / Object.keys(checks).length) * 100),
        };
    }

    private async assertCoursesExist(courseIds: string[]) {
        if (courseIds.length === 0) return;
        const courses = await this.prisma.course.findMany({
            where: { id: { in: courseIds } },
            select: { id: true },
        });
        if (courses.length !== courseIds.length) {
            throw new BadRequestException('One or more selected courses do not exist');
        }
    }
}
