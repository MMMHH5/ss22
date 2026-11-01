import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Role } from '@prisma/client';
import { TasksService } from '../src/tasks/tasks.service';

/**
 * The assignment flow, end to end at the service level.
 *
 * Two things were broken and neither was visible from the UI as a crash:
 *
 *  1. The instructor of record could not manage the tasks of their own course.
 *     `Course.instructorId` and `CourseOpening.instructorId` are separate
 *     columns, and every check keyed on the batch one only — so creating the
 *     task returned 403, the student panel stayed empty, and it read as "the
 *     assignment feature does not work".
 *  2. Students whose enrollment predates `Enrollment.openingId` (nullable, added
 *     without a backfill) matched no enrollment, so the task list was refused
 *     and submitting returned 403 as well.
 *
 * A submitted file was also impossible: `attachmentUrl` existed on the model
 * but nothing could ever produce one, and it was accepted from the browser
 * unchecked, so a student could point their submission at any path on the
 * server. These tests drive the real service against a recording double.
 */

type Rec = { model: string; op: string; args: any };

function makeHarness(h: {
    openings?: any[];
    courses?: any[];
    enrollments?: any[];
    tasks?: any[];
    submissions?: any[];
    studentRows?: any[];
}) {
    const calls: Rec[] = [];
    const openings = h.openings ?? [];
    const courses = h.courses ?? [];
    const enrollments = h.enrollments ?? [];
    const tasks = h.tasks ?? [];
    const submissions = h.submissions ?? [];
    const writes: any[] = [];

    const prisma: any = {
        courseOpening: {
            findUnique: async (args: any) => {
                calls.push({ model: 'courseOpening', op: 'findUnique', args });
                return openings.find(o => o.id === args?.where?.id) ?? null;
            },
            findMany: async (args: any) => {
                calls.push({ model: 'courseOpening', op: 'findMany', args });
                const courseIds = args?.where?.courseId?.in;
                if (!courseIds) return openings;
                return openings.filter(o => courseIds.includes(o.courseId));
            },
        },
        course: {
            findFirst: async (args: any) => {
                calls.push({ model: 'course', op: 'findFirst', args });
                return courses.find(c => c.id === args?.where?.id && c.instructorId === args?.where?.instructorId) ?? null;
            },
        },
        enrollment: {
            findFirst: async (args: any) => {
                calls.push({ model: 'enrollment', op: 'findFirst', args });
                const w = args?.where ?? {};
                return enrollments.find(e =>
                    (!w.studentId || e.studentId === w.studentId) &&
                    (!w.courseId || e.courseId === w.courseId) &&
                    (w.openingId === undefined || e.openingId === w.openingId) &&
                    (!w.openingId || e.openingId === w.openingId)
                ) ?? null;
            },
            findMany: async (args: any) => {
                calls.push({ model: 'enrollment', op: 'findMany', args });
                const w = args?.where ?? {};
                let rows = enrollments;
                if (w.studentId) rows = rows.filter(e => e.studentId === w.studentId);
                if (w.courseId) rows = rows.filter(e => e.courseId === w.courseId);
                if (w.openingId === null) rows = rows.filter(e => e.openingId == null);
                else if (w.openingId) rows = rows.filter(e => e.openingId === w.openingId);
                return rows;
            },
        },
        courseTask: {
            create: async (args: any) => {
                calls.push({ model: 'courseTask', op: 'create', args });
                writes.push({ op: 'create', args });
                return { id: 'task-1', maxScore: 100, ...args.data };
            },
            findUnique: async (args: any) => {
                calls.push({ model: 'courseTask', op: 'findUnique', args });
                return tasks.find(t => t.id === args?.where?.id) ?? null;
            },
            findMany: async (args: any) => {
                calls.push({ model: 'courseTask', op: 'findMany', args });
                return tasks.filter(t => t.openingId === args?.where?.openingId);
            },
        },
        module: { findUnique: async () => ({ id: 'mod-1', courseId: 'crs-1' }) },
        taskSubmission: {
            findUnique: async (args: any) => {
                calls.push({ model: 'taskSubmission', op: 'findUnique', args });
                const withTask = (s: any) => (args?.include?.task
                    ? { ...s, task: tasks.find(t => t.id === s.taskId) }
                    : s);
                if (args?.where?.id) {
                    const hit = submissions.find(s => s.id === args.where.id);
                    return hit ? withTask(hit) : null;
                }
                const k = args?.where?.taskId_enrollmentId;
                const found = submissions.find(s => s.taskId === k?.taskId && s.enrollmentId === k?.enrollmentId);
                return found ? withTask(found) : null;
            },
            findMany: async (args: any) => {
                calls.push({ model: 'taskSubmission', op: 'findMany', args });
                return submissions.filter(s => s.taskId === args?.where?.taskId);
            },
            upsert: async (args: any) => {
                calls.push({ model: 'taskSubmission', op: 'upsert', args });
                writes.push({ op: 'upsert', args });
                return { id: 'sub-1', ...(args.create ?? {}), ...(args.update ?? {}) };
            },
            update: async (args: any) => {
                calls.push({ model: 'taskSubmission', op: 'update', args });
                writes.push({ op: 'update', args });
                return { id: 'sub-1', ...submissions[0], ...(args.data ?? {}) };
            },
        },
    };

    const service = new TasksService(
        prisma as any,
        { logAction: async () => undefined } as any,
        { notify: async () => undefined } as any,
        {
            assertCanManageOpening: async (_openingId: string, actorId: string) => {
                if (actorId !== 'owner') throw new Error('Not allowed to manage tasks');
                return { id: 'opn-1' };
            },
            hasOpeningPermission: async () => false,
        } as any,
    );
    return { service, calls, writes, prisma };
}

const COURSE = { id: 'crs-1', instructorId: 'owner' };
const BATCH_OWNED_BY_SOMEONE_ELSE = { id: 'opn-1', courseId: 'crs-1', instructorId: 'other-teacher' };

describe('assignment: the instructor of record can set the work for their own course', () => {
    test('a task is created for a batch run by another instructor by the course owner', async () => {
        const { service } = makeHarness({
            courses: [COURSE],
            openings: [BATCH_OWNED_BY_SOMEONE_ELSE],
        });

        const task = await service.createTask('opn-1', {
            titleAr: 'تمرين أول', titleEn: 'First exercise', maxScore: 20,
        }, 'owner', Role.INSTRUCTOR);

        assert.equal(task.id, 'task-1');
    });

    test('an unrelated instructor is still refused', async () => {
        const { service } = makeHarness({
            courses: [COURSE],
            openings: [BATCH_OWNED_BY_SOMEONE_ELSE],
        });

        await assert.rejects(
            () => service.createTask('opn-1', { titleAr: 'x', titleEn: 'x' }, 'stranger', Role.INSTRUCTOR),
            /not allowed to manage tasks/i,
        );
    });

    test('the owner sees the task list of a batch that is not assigned to them', async () => {
        const { service } = makeHarness({
            courses: [COURSE],
            openings: [BATCH_OWNED_BY_SOMEONE_ELSE],
            tasks: [{ id: 'task-1', openingId: 'opn-1', titleAr: 'م', titleEn: 't', maxScore: 10, submissions: [] }],
        });

        const tasks = await service.listTasks('opn-1', 'owner', Role.INSTRUCTOR);
        assert.equal(tasks.length, 1);
    });
});

describe('assignment: a student whose batch was never recorded still gets their work', () => {
    test('the task list resolves to the only batch of the course', async () => {
        const { service } = makeHarness({
            courses: [COURSE],
            openings: [BATCH_OWNED_BY_SOMEONE_ELSE],
            enrollments: [{ id: 'enr-1', studentId: 'stu-1', courseId: 'crs-1', openingId: null, status: 'APPROVED' }],
            tasks: [{ id: 'task-1', openingId: 'opn-1', titleAr: 'م', titleEn: 't', maxScore: 10, submissions: [] }],
        });

        const tasks = await service.listStudentCourseTasks('crs-1', 'stu-1');
        assert.equal(tasks.length, 1, 'the approved student should see the assignment');
    });

    test('submitting against that same batch is allowed', async () => {
        const { service, writes } = makeHarness({
            courses: [COURSE],
            openings: [BATCH_OWNED_BY_SOMEONE_ELSE],
            enrollments: [{ id: 'enr-1', studentId: 'stu-1', courseId: 'crs-1', openingId: null, status: 'APPROVED' }],
            tasks: [{ id: 'task-1', openingId: 'opn-1', titleAr: 'م', titleEn: 't', maxScore: 10 }],
        });

        await service.submitTask('task-1', 'stu-1', { content: 'done' });
        assert.equal(writes.length, 1);
        assert.equal(writes[0].args.create.enrollmentId, 'enr-1');
    });

    test('with two batches the student is refused rather than shown another cohort', async () => {
        const { service } = makeHarness({
            courses: [COURSE],
            openings: [BATCH_OWNED_BY_SOMEONE_ELSE, { id: 'opn-2', courseId: 'crs-1', instructorId: 'other-teacher' }],
            enrollments: [{ id: 'enr-1', studentId: 'stu-1', courseId: 'crs-1', openingId: null, status: 'APPROVED' }],
        });

        await assert.rejects(() => service.listStudentCourseTasks('crs-1', 'stu-1'), /not linked to a batch/i);
    });
});

describe('assignment: a student can submit a file of any type', () => {
    test('an uploaded file is stored with the name, type and size the instructor needs', async () => {
        const { service, writes } = makeHarness({
            courses: [COURSE],
            openings: [BATCH_OWNED_BY_SOMEONE_ELSE],
            enrollments: [{ id: 'enr-1', studentId: 'stu-1', courseId: 'crs-1', openingId: 'opn-1', status: 'APPROVED' }],
            tasks: [{ id: 'task-1', openingId: 'opn-1', titleAr: 'م', titleEn: 't', maxScore: 10 }],
        });

        const saved = await service.submitTask('task-1', 'stu-1', {
            content: 'attached',
            attachmentUrl: '/uploads/tasks/submission-123.zip',
            attachmentName: 'my solution.zip',
            attachmentType: 'application/zip',
            attachmentSize: 2048,
        });

        assert.equal(saved.attachmentUrl, '/uploads/tasks/submission-123.zip');
        assert.equal(saved.attachmentName, 'my solution.zip');
        assert.equal(saved.attachmentType, 'application/zip');
        assert.equal(saved.attachmentSize, 2048);
        assert.equal(writes[0].args.create.content, 'attached');
    });

    test('a path the server never issued is refused', async () => {
        const { service } = makeHarness({
            courses: [COURSE],
            openings: [BATCH_OWNED_BY_SOMEONE_ELSE],
            enrollments: [{ id: 'enr-1', studentId: 'stu-1', courseId: 'crs-1', openingId: 'opn-1', status: 'APPROVED' }],
            tasks: [{ id: 'task-1', openingId: 'opn-1', titleAr: 'م', titleEn: 't', maxScore: 10 }],
        });

        for (const bad of [
            '/etc/passwd',
            '/uploads/chat/secret.pdf',
            '/uploads/tasks/../../../etc/passwd',
            'https://evil.example.com/x.pdf',
        ]) {
            await assert.rejects(
                () => service.submitTask('task-1', 'stu-1', { attachmentUrl: bad }),
                /uploaded file/i,
                `should refuse ${bad}`,
            );
        }
    });

    test('a file name is reduced to its base name', async () => {
        const { service } = makeHarness({
            courses: [COURSE],
            openings: [BATCH_OWNED_BY_SOMEONE_ELSE],
            enrollments: [{ id: 'enr-1', studentId: 'stu-1', courseId: 'crs-1', openingId: 'opn-1', status: 'APPROVED' }],
            tasks: [{ id: 'task-1', openingId: 'opn-1', titleAr: 'م', titleEn: 't', maxScore: 10 }],
        });

        const saved = await service.submitTask('task-1', 'stu-1', {
            attachmentUrl: '/uploads/tasks/submission-9.pdf',
            attachmentName: '../../etc/passwd',
        });
        assert.equal(saved.attachmentName, 'passwd');
    });

    test('adding a note does not drop the file already submitted', async () => {
        const { service, writes } = makeHarness({
            courses: [COURSE],
            openings: [BATCH_OWNED_BY_SOMEONE_ELSE],
            enrollments: [{ id: 'enr-1', studentId: 'stu-1', courseId: 'crs-1', openingId: 'opn-1', status: 'APPROVED' }],
            tasks: [{ id: 'task-1', openingId: 'opn-1', titleAr: 'م', titleEn: 't', maxScore: 10 }],
            submissions: [{
                id: 'sub-1', taskId: 'task-1', enrollmentId: 'enr-1',
                attachmentUrl: '/uploads/tasks/submission-1.pdf',
                attachmentName: 'report.pdf', attachmentType: 'application/pdf', attachmentSize: 10,
            }],
        });

        await service.submitTask('task-1', 'stu-1', { content: 'see attached' });
        const update = writes[0].args.update;
        assert.equal(update.attachmentUrl, '/uploads/tasks/submission-1.pdf');
        assert.equal(update.attachmentName, 'report.pdf');
    });
});

describe('assignment: the instructor sees who submitted what, and can grade it', () => {
    const graded = {
        courses: [COURSE],
        openings: [BATCH_OWNED_BY_SOMEONE_ELSE],
        tasks: [{ id: 'task-1', openingId: 'opn-1', titleAr: 'مهمة', titleEn: 'Task', maxScore: 10 }],
        submissions: [{
            id: 'sub-1',
            taskId: 'task-1',
            enrollmentId: 'enr-1',
            score: null,
            notes: null,
            enrollment: { id: 'enr-1', student: { id: 'stu-1', email: 's@example.com', metadata: { fullName: 'Nour Ali' } } },
        }],
    };

    test('a submission carries the student name, not only an email', async () => {
        const { service } = makeHarness(graded);
        const rows = await service.getSubmissions('task-1', 'owner', Role.INSTRUCTOR);
        assert.equal(rows[0].studentName, 'Nour Ali');
        // The private part of the profile must not ride along with the name.
        assert.equal((rows[0].enrollment.student as any).metadata, undefined);
    });

    test('a score above the task maximum is refused', async () => {
        const { service } = makeHarness({
            ...graded,
            tasks: [{ id: 'task-1', openingId: 'opn-1', titleAr: 'م', titleEn: 't', maxScore: 10 }],
        });

        await assert.rejects(
            () => service.gradeSubmission('sub-1', 'owner', Role.INSTRUCTOR, 25),
            /cannot exceed/i,
        );
    });

    test('a score within the maximum is stored with the note', async () => {
        const { service, writes } = makeHarness({
            ...graded,
            tasks: [{ id: 'task-1', openingId: 'opn-1', titleAr: 'م', titleEn: 't', maxScore: 10 }],
        });

        await service.gradeSubmission('sub-1', 'owner', Role.INSTRUCTOR, 8, 'good work');
        const data = writes.at(-1)!.args.data;
        assert.equal(data.score, 8);
        assert.equal(data.notes, 'good work');
    });
});
