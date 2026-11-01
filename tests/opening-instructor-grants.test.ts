import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CoursesService } from '../src/courses/courses.service';

function makeService(options: { grants?: Record<string, unknown>[]; instructors?: string[] } = {}) {
    const calls: Array<{ model: string; args: any }> = [];
    const prisma: any = {
        courseOpening: {
            findUnique: async (args: any) => {
                calls.push({ model: 'courseOpening', args });
                return {
                    id: 'opening-1',
                    instructorId: 'primary-1',
                    ...(args.include ? { instructorGrants: options.grants ?? [] } : {}),
                };
            },
        },
        openingInstructorGrant: {
            findMany: async (args: any) => {
                calls.push({ model: 'openingInstructorGrant.findMany', args });
                return [];
            },
            deleteMany: async (args: any) => {
                calls.push({ model: 'openingInstructorGrant.deleteMany', args });
                return { count: 0 };
            },
            createMany: async (args: any) => {
                calls.push({ model: 'openingInstructorGrant.createMany', args });
                return { count: args.data.length };
            },
        },
        user: {
            findMany: async (args: any) => {
                calls.push({ model: 'user.findMany', args });
                const requested = args.where.id.in as string[];
                const allowed = options.instructors ?? requested;
                return requested.filter((id) => allowed.includes(id)).map((id) => ({ id }));
            },
        },
        $transaction: async (callback: (tx: any) => Promise<void>) => callback(prisma),
    };
    const service = new CoursesService(
        prisma,
        { logAction: async () => undefined } as any,
        {} as any,
        {} as any,
    );
    return { service, calls };
}

describe('opening-scoped instructor permissions', () => {
    test('a secondary instructor receives only the explicitly granted capabilities', async () => {
        const { service } = makeService({
            grants: [{ instructorId: 'assistant-1', canManageSessions: true }],
        });

        await service.assertCanManageOpening('opening-1', 'assistant-1', Role.INSTRUCTOR, 'canManageSessions');
        await assert.rejects(
            () => service.assertCanManageOpening('opening-1', 'assistant-1', Role.INSTRUCTOR, 'canGrade'),
            (error: unknown) => error instanceof ForbiddenException,
        );
    });

    test('the primary instructor keeps full access without a grant row', async () => {
        const { service } = makeService();

        await service.assertCanManageOpening('opening-1', 'primary-1', Role.INSTRUCTOR, 'canGrade');
        await service.assertCanManageOpening('opening-1', 'primary-1', Role.INSTRUCTOR);
    });

    test('an unassigned instructor is denied and staff retains oversight', async () => {
        const { service } = makeService();

        await assert.rejects(
            () => service.assertCanManageOpening('opening-1', 'other-1', Role.INSTRUCTOR, 'canReadContent'),
            (error: unknown) => error instanceof ForbiddenException,
        );
        await service.assertCanManageOpening('opening-1', 'manager-1', Role.COURSE_MANAGER, 'canGrade');
    });

    test('replacing assistant assignments validates instructor roles and records the granting manager', async () => {
        const { service, calls } = makeService();
        const grant = {
            instructorId: 'assistant-1',
            canReadContent: true,
            canManageTasks: false,
            canGrade: true,
            canManageSessions: false,
            canManageAnnouncements: false,
            canViewAnalytics: true,
        };

        await service.setOpeningInstructorGrants('opening-1', [grant], 'manager-1');

        const create = calls.find((call) => call.model === 'openingInstructorGrant.createMany')!;
        assert.deepEqual(create.args.data, [{ ...grant, openingId: 'opening-1', grantedById: 'manager-1' }]);
        assert.deepEqual(calls.find((call) => call.model === 'openingInstructorGrant.deleteMany')!.args, {
            where: { openingId: 'opening-1' },
        });
    });

    test('the primary instructor cannot also be assigned as an assistant', async () => {
        const { service } = makeService();
        await assert.rejects(
            () => service.setOpeningInstructorGrants('opening-1', [{
                instructorId: 'primary-1',
                canReadContent: true,
                canManageTasks: false,
                canGrade: false,
                canManageSessions: false,
                canManageAnnouncements: false,
                canViewAnalytics: false,
            }], 'manager-1'),
            (error: unknown) => error instanceof BadRequestException,
        );
    });

    test('a user without the instructor role cannot be granted batch access', async () => {
        const { service } = makeService({ instructors: [] });
        await assert.rejects(
            () => service.setOpeningInstructorGrants('opening-1', [{
                instructorId: 'student-1',
                canReadContent: true,
                canManageTasks: false,
                canGrade: false,
                canManageSessions: false,
                canManageAnnouncements: false,
                canViewAnalytics: false,
            }], 'manager-1'),
            (error: unknown) => error instanceof BadRequestException,
        );
    });
});
