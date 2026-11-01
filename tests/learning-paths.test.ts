import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CreateLearningPathDto, UpdateLearningPathDto } from '../src/learning-paths/dto/learning-path.dto';
import { LearningPathsService } from '../src/learning-paths/learning-paths.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';

const validationPipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

async function validate<T>(type: new () => T, value: unknown): Promise<T> {
    return validationPipe.transform(value, { type: 'body', metatype: type }) as Promise<T>;
}

describe('learning path payloads', () => {
    test('requires bilingual titles and accepts an ordered unique course list', async () => {
        await assert.rejects(() => validate(CreateLearningPathDto, { titleAr: 'مسار' }), BadRequestException);
        const path = await validate(CreateLearningPathDto, {
            titleAr: 'مسار',
            titleEn: 'Path',
            courseIds: ['course-1', 'course-2'],
            isPublished: true,
        });
        assert.deepEqual(path.courseIds, ['course-1', 'course-2']);
        assert.equal(path.isPublished, true);
    });

    test('rejects duplicate course IDs and allows partial updates', async () => {
        await assert.rejects(
            () => validate(CreateLearningPathDto, { titleAr: 'مسار', titleEn: 'Path', courseIds: ['course-1', 'course-1'] }),
            BadRequestException,
        );
        const patch = await validate(UpdateLearningPathDto, { courseIds: [] });
        assert.deepEqual(patch.courseIds, []);
        assert.equal(patch.titleAr, undefined);
    });
});

describe('learning path course order and publishing rules', () => {
    test('stores the selected course order when updating a path', async () => {
        let createdRelations: { pathId: string; courseId: string; orderIndex: number }[] = [];
        const prisma = {
            learningPath: {
                findUnique: async () => ({ id: 'path-1', creatorId: 'staff-1', isPublished: false, _count: { courses: 0 } }),
                update: async () => ({}),
                findUniqueOrThrow: async () => ({ id: 'path-1' }),
            },
            course: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id })) },
            learningPathCourse: {
                deleteMany: async () => ({ count: 0 }),
                createMany: async ({ data }: { data: typeof createdRelations }) => {
                    createdRelations = data;
                    return { count: data.length };
                },
            },
            $transaction: async (run: (tx: unknown) => unknown) => run(prisma),
        };
        const service = new LearningPathsService(prisma as unknown as PrismaService, {} as AuditService);

        await service.updatePath('path-1', { courseIds: ['course-2', 'course-1'] }, 'staff-1', Role.COURSE_MANAGER);

        assert.deepEqual(createdRelations, [
            { pathId: 'path-1', courseId: 'course-2', orderIndex: 0 },
            { pathId: 'path-1', courseId: 'course-1', orderIndex: 1 },
        ]);
    });

    test('refuses to publish paths with no courses', async () => {
        const prisma = {
            learningPath: {
                findUnique: async () => ({ id: 'path-1', creatorId: 'staff-1', isPublished: false, _count: { courses: 0 } }),
            },
            $transaction: async () => {
                throw new Error('transaction should not run');
            },
        };
        const service = new LearningPathsService(prisma as unknown as PrismaService, {} as AuditService);

        await assert.rejects(
            () => service.updatePath('path-1', { isPublished: true }, 'staff-1', Role.COURSE_MANAGER),
            BadRequestException,
        );
    });

    test('does not expose draft paths through the public details route', async () => {
        const prisma = {
            learningPath: {
                findUnique: async () => ({
                    id: 'path-1',
                    isPublished: false,
                    courses: [],
                    creator: null,
                }),
            },
        };
        const service = new LearningPathsService(prisma as unknown as PrismaService, {} as AuditService);

        await assert.rejects(() => service.getPublishedPath('path-1'), NotFoundException);
    });

    test('joins the learning path without bypassing course payments and reports real opening availability', async () => {
        let courseEnrollmentWrites = 0;
        const path = {
            id: 'path-1',
            titleEn: 'Path',
            isPublished: true,
            courses: [
                { course: { id: 'course-open' } },
                { course: { id: 'course-unavailable' } },
            ],
        };
        const prisma = {
            learningPath: { findUnique: async () => path },
            learningPathEnrollment: {
                findUnique: async () => null,
                upsert: async () => ({ id: 'path-enrollment-1' }),
            },
            enrollment: {
                findUnique: async () => null,
                create: async () => {
                    courseEnrollmentWrites += 1;
                    return {};
                },
            },
            courseOpening: {
                findMany: async ({ where }: { where: { courseId: string } }) => where.courseId === 'course-open'
                    ? [
                        { status: 'ANNOUNCEMENT', enrollmentDeadline: null, maxStudents: 10, seatsTaken: 1 },
                        { status: 'OPEN', enrollmentDeadline: null, maxStudents: 10, seatsTaken: 2 },
                    ]
                    : [],
            },
        };
        const audit = { logAction: async () => undefined };
        const service = new LearningPathsService(prisma as unknown as PrismaService, audit as unknown as AuditService);

        const result = await service.enrollPath('path-1', 'student-1');

        assert.deepEqual(result.courses, [
            { courseId: 'course-open', registrationStatus: 'open', enrollmentStatus: null },
            { courseId: 'course-unavailable', registrationStatus: 'unavailable', enrollmentStatus: null },
        ]);
        assert.equal(result.totalCourses, 2);
        assert.equal(courseEnrollmentWrites, 0, 'path membership must not create unpaid course enrollments');
    });

    test('returns a student learning-path progress summary from approved lesson completion', async () => {
        const path = {
            id: 'path-1',
            titleAr: 'مسار',
            titleEn: 'Path',
            descriptionAr: null,
            descriptionEn: null,
            coverImageUrl: null,
            courses: [
                {
                    id: 'path-course-1',
                    orderIndex: 0,
                    course: {
                        id: 'course-1',
                        titleAr: 'دورة ١',
                        titleEn: 'Course 1',
                        coverImageUrl: null,
                        _count: { modules: 2, objectives: 1 },
                        openings: [],
                        enrollments: [{
                            status: 'APPROVED',
                            lessonProgress: [{ moduleId: 'module-1' }],
                        }],
                    },
                },
                {
                    id: 'path-course-2',
                    orderIndex: 1,
                    course: {
                        id: 'course-2',
                        titleAr: 'دورة ٢',
                        titleEn: 'Course 2',
                        coverImageUrl: null,
                        _count: { modules: 1, objectives: 0 },
                        openings: [{ status: 'OPEN', enrollmentDeadline: null, maxStudents: null, seatsTaken: 0 }],
                        enrollments: [],
                    },
                },
            ],
        };
        const prisma = {
            learningPathEnrollment: {
                findMany: async () => [{ id: 'path-enrollment-1', pathId: 'path-1', studentId: 'student-1', createdAt: new Date(), updatedAt: new Date(), path }],
            },
        };
        const service = new LearningPathsService(prisma as unknown as PrismaService, {} as AuditService);

        const [progress] = await service.getStudentPaths('student-1');

        assert.equal(progress.totalLessons, 3);
        assert.equal(progress.completedLessons, 1);
        assert.equal(progress.progressPercent, 33);
        assert.equal(progress.completedCourses, 0);
        assert.equal(progress.path.courses[1].registrationStatus, 'open');
    });

    test('reports path enrollment, active learners, completions, and course readiness', async () => {
        const makeCourse = (id: string, modules: number) => ({
            id,
            titleAr: id,
            titleEn: id,
            excerptAr: 'Short summary',
            excerptEn: 'Short summary',
            descriptionAr: 'Course description',
            descriptionEn: 'Course description',
            categoryAr: 'Category',
            categoryEn: 'Category',
            level: 'BEGINNER',
            contentType: 'RECORDED',
            language: 'Arabic',
            coverImageUrl: '/cover.png',
            syllabusAr: 'Syllabus',
            syllabusEn: 'Syllabus',
            hoursOfContent: 4,
            durationAr: null,
            durationEn: null,
            _count: { modules, objectives: 1, audiences: 1 },
            openings: [{
                status: 'OPEN',
                isPublished: true,
                enrollmentDeadline: null,
                maxStudents: null,
                seatsTaken: 0,
            }],
        });
        const path = {
            id: 'path-1',
            titleAr: 'مسار',
            titleEn: 'Path',
            isPublished: true,
            courses: [
                { courseId: 'course-1', course: makeCourse('course-1', 2) },
                { courseId: 'course-2', course: makeCourse('course-2', 1) },
            ],
        };
        const prisma = {
            learningPath: { findUnique: async () => path },
            learningPathEnrollment: {
                findMany: async () => [{ studentId: 'student-active' }, { studentId: 'student-complete' }],
            },
            enrollment: {
                findMany: async () => [
                    { studentId: 'student-active', courseId: 'course-1', status: 'PENDING', lessonProgress: [] },
                    { studentId: 'student-complete', courseId: 'course-1', status: 'APPROVED', lessonProgress: [{ moduleId: 'm1' }, { moduleId: 'm2' }] },
                    { studentId: 'student-complete', courseId: 'course-2', status: 'APPROVED', lessonProgress: [{ moduleId: 'm3' }] },
                ],
            },
        };
        const service = new LearningPathsService(prisma as unknown as PrismaService, {} as AuditService);

        const report = await service.getPathReport('path-1');

        assert.equal(report.learners, 2);
        assert.equal(report.activeStudents, 1);
        assert.equal(report.completedStudents, 1);
        assert.equal(report.completionRate, 50);
        assert.equal(report.courses[0].readiness.percent, 100);
        assert.equal(report.courses[0].enrolledStudents, 2);
    });
});
