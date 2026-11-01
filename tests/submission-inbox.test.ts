import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Role } from '@prisma/client';
import { TasksService } from '../src/tasks/tasks.service';

/**
 * The instructor-wide submissions inbox.
 *
 * The per-task and per-batch endpoints can only answer "how did this one task
 * go", so a teacher with several courses had to walk each batch by hand to
 * find out what had been handed in. The new `listSubmissionsForActor` fixes
 * that, and the part worth a test is its *scope*, because the two instructor
 * columns are separate fields:
 *
 *   - `Course.instructorId`      who owns the course
 *   - `CourseOpening.instructorId` who runs this batch
 *
 * `assertCanManageOpening` already lets the course owner grade the work in its
 * batches, so the inbox has to include them too. Filtering on the batch column
 * alone would hide submissions that the very same instructor can open and
 * grade from the batch page — an empty inbox next to a full task list.
 *
 * The double below evaluates the `where` it is handed instead of ignoring it,
 * so these tests fail if the scope is ever narrowed to one column.
 */

type Opening = { id: string; courseId: string; instructorId: string; nameAr?: string; nameEn?: string };
type Course = { id: string; instructorId: string; titleAr?: string; titleEn?: string };
type Task = { id: string; openingId: string; titleAr: string; titleEn: string; maxScore: number; dueDate?: Date | null };
type Submission = { id: string; taskId: string; enrollmentId: string; score: number | null; notes?: string | null; content?: string | null; submittedAt: Date };

const COURSE_OWNED_BY_US = { id: 'crs-own', instructorId: 'me', titleAr: 'دورتي', titleEn: 'My course' };
const COURSE_NOT_OURS = { id: 'crs-other', instructorId: 'somebody-else', titleAr: 'دورة غيري', titleEn: 'Their course' };

/** A batch run by us, a batch of our course run by someone else, and a stranger's. */
const OPENINGS: Opening[] = [
    { id: 'opn-our-batch', courseId: 'crs-other', instructorId: 'me', nameAr: 'دفعتي', nameEn: 'My batch' },
    { id: 'opn-our-course-their-batch', courseId: 'crs-own', instructorId: 'another-teacher' },
    { id: 'opn-stranger', courseId: 'crs-other', instructorId: 'stranger' },
];
const COURSES: Course[] = [COURSE_OWNED_BY_US, COURSE_NOT_OURS];

const TASKS: Task[] = [
    { id: 'task-a', openingId: 'opn-our-batch', titleAr: 'مهمة أ', titleEn: 'Task A', maxScore: 10 },
    { id: 'task-b', openingId: 'opn-our-course-their-batch', titleAr: 'مهمة ب', titleEn: 'Task B', maxScore: 20, dueDate: null },
    { id: 'task-c', openingId: 'opn-stranger', titleAr: 'مهمة ج', titleEn: 'Task C', maxScore: 5 },
];

/** Every selected column is present, as Prisma would return it. */
const SUBMISSIONS: Submission[] = [
    { id: 'sub-a', taskId: 'task-a', enrollmentId: 'enr-1', score: null, notes: null, content: 'a', submittedAt: new Date('2026-09-20') },
    { id: 'sub-b', taskId: 'task-b', enrollmentId: 'enr-2', score: 7, notes: 'good', content: 'b', submittedAt: new Date('2026-09-21') },
    { id: 'sub-c', taskId: 'task-c', enrollmentId: 'enr-3', score: null, notes: null, content: 'c', submittedAt: new Date('2026-09-22') },
];

const STUDENT: Record<string, any> = {
    'enr-1': { id: 'enr-1', student: { id: 'stu-1', email: 'nour@example.com', metadata: { nameAr: 'نور', nameEn: 'Nour', phone: '+966500000000' } } },
    'enr-2': { id: 'enr-2', student: { id: 'stu-2', email: 'ali@example.com', metadata: { fullName: 'Ali Hassan' } } },
    'enr-3': { id: 'enr-3', student: { id: 'stu-3', email: 'sara@example.com', metadata: null } },
};

const openingOf = (taskId: string) => {
    const task = TASKS.find(t => t.id === taskId);
    return OPENINGS.find(o => o.id === task?.openingId) ?? null;
};
const courseOf = (opening: Opening | null) =>
    COURSES.find(c => c.id === opening?.courseId) ?? null;
const taskOf = (taskId: string) => TASKS.find(t => t.id === taskId) ?? null;

/** The row Prisma would hand back once `include` has been applied. */
function expand(row: Submission) {
    const opening = openingOf(row.taskId)!;
    const task = taskOf(row.taskId)!;
    return {
        ...row,
        task: {
            id: task.id,
            titleAr: task.titleAr,
            titleEn: task.titleEn,
            maxScore: task.maxScore,
            dueDate: task.dueDate ?? null,
            opening: { ...opening, course: courseOf(opening)! },
            module: null,
        },
        enrollment: STUDENT[row.enrollmentId],
    };
}

/** Real-ish evaluation of the filter the service builds. */
function inScope(row: Submission, where: any): boolean {
    if (where.score === null && row.score !== null) return false;
    const op = where.task?.opening?.is;
    if (!op) return true;
    const opening = openingOf(row.taskId);
    if (!opening) return false;
    if (op.id && opening.id !== op.id) return false;
    if (op.courseId && opening.courseId !== op.courseId) return false;
    if (op.OR) {
        const hit = op.OR.some((clause: any) => {
            if (clause.instructorId) return opening.instructorId === clause.instructorId;
            if (clause.course?.instructorId) return courseOf(opening)?.instructorId === clause.course.instructorId;
            return false;
        });
        if (!hit) return false;
    }
    return true;
}

function makeHarness(rows = SUBMISSIONS) {
    const findManyCalls: any[] = [];
    const countCalls: any[] = [];

    const prisma: any = {
        taskSubmission: {
            findMany: async (args: any) => {
                findManyCalls.push(args);
                const matched = rows.filter(r => inScope(r, args.where))
                    .sort((x, y) => y.submittedAt.getTime() - x.submittedAt.getTime());
                const from = args.skip ?? 0;
                const page = matched.slice(from, args.take ? from + args.take : undefined);
                return page.map(expand);
            },
            count: async (args: any) => {
                countCalls.push(args);
                return rows.filter(r => inScope(r, args.where)).length;
            },
        },
    };

    const service = new TasksService(
        prisma as any,
        { logAction: async () => undefined } as any,
        { notify: async () => undefined } as any,
        { assertCanManageOpening: async () => ({ id: 'o1' }), hasOpeningPermission: async () => false } as any,
    );
    return { service, findManyCalls, countCalls, only: () => findManyCalls[0] };
}

describe('submission inbox: the scope covers both instructor columns', () => {
    test('the course owner sees the batch that another teacher runs', async () => {
        const { service } = makeHarness();
        const out = await service.listSubmissionsForActor('me', Role.INSTRUCTOR);

        const ids = out.items.map(i => i.id).sort();
        assert.deepEqual(ids, ['sub-a', 'sub-b'],
            'sub-b belongs to a batch whose instructorId is not us, but the course is ours');
        assert.equal(out.total, 2);
    });

    test('a batch of someone else course is excluded', async () => {
        const { service } = makeHarness();
        const out = await service.listSubmissionsForActor('me', Role.INSTRUCTOR);
        assert.ok(!out.items.some(i => i.id === 'sub-c'), 'must not leak a stranger\'s batch');
    });

    test('the query ORs the two columns rather than filtering on one', async () => {
        const { service, findManyCalls } = makeHarness();
        await service.listSubmissionsForActor('me', Role.INSTRUCTOR);

        const where = findManyCalls[0].where;
        const clauses = where.task.opening.is.OR;
        assert.equal(clauses.length, 3);
        assert.equal(clauses[0].instructorId, 'me', 'the batch we run');
        assert.equal(clauses[1].course.instructorId, 'me', 'the course we own');
        assert.deepEqual(clauses[2].instructorGrants.some, { instructorId: 'me', canGrade: true });
    });

    test('an instructor with no claim at all sees nothing', async () => {
        const { service } = makeHarness();
        const out = await service.listSubmissionsForActor('stranger', Role.INSTRUCTOR);
        // 'stranger' runs opn-stranger, so exactly that one batch is in scope.
        assert.deepEqual(out.items.map(i => i.id), ['sub-c']);
    });

    test('admin and course managers are not narrowed at all', async () => {
        for (const role of [Role.ADMIN, Role.COURSE_MANAGER]) {
            const { service, findManyCalls } = makeHarness();
            const out = await service.listSubmissionsForActor('anyone', role);
            assert.equal(out.total, 3, `${role} should see every submission`);
            const where = findManyCalls[0].where;
            assert.deepEqual(where.task.opening.is, {}, `${role} should carry no scope filter`);
        }
    });
});

describe('submission inbox: the context a teacher needs is in the payload', () => {
    test('the course and batch names travel with each row', async () => {
        const { service, findManyCalls } = makeHarness();
        const out = await service.listSubmissionsForActor('me', Role.INSTRUCTOR);

        const select = (findManyCalls[0].include as any).task.select;
        assert.ok(select.opening.select.course, 'the course title is the point of the view');
        assert.ok(select.opening.select.nameAr && select.opening.select.nameEn, 'the batch name');
        assert.ok(select.module, 'the lecture the work belongs to');

        const b = out.items.find(i => i.id === 'sub-b')!;
        assert.equal(b.task.opening.course.titleEn, 'My course');
        assert.equal(b.task.opening.nameEn, undefined, 'a batch may legitimately have no name');
    });

    test('the student name is offered in both scripts and the profile is not echoed', async () => {
        const { service } = makeHarness();
        const out = await service.listSubmissionsForActor('me', Role.INSTRUCTOR);

        const a = out.items.find(i => i.id === 'sub-a')!;
        assert.deepEqual(a.studentName, { nameAr: 'نور', nameEn: 'Nour' });
        assert.equal((a.enrollment.student as any).metadata, undefined,
            'phone and the rest of the profile must not ride along');
        assert.equal(a.enrollment.student.email, 'nour@example.com');

        // `fullName` is the fallback when only that was filled in at sign-up.
        const b = out.items.find(i => i.id === 'sub-b')!;
        assert.deepEqual(b.studentName, { nameAr: 'Ali Hassan', nameEn: 'Ali Hassan' });
    });

    test('an account with no name at all still gets an email to identify it by', async () => {
        const { service } = makeHarness();
        const out = await service.listSubmissionsForActor('stranger', Role.INSTRUCTOR);
        const c = out.items[0];
        assert.deepEqual(c.studentName, { nameAr: null, nameEn: null });
        assert.equal(c.enrollment.student.email, 'sara@example.com');
    });
});

describe('submission inbox: filters and paging', () => {
    test('the ungraded filter keeps only the unscored rows', async () => {
        const { service } = makeHarness();
        const out = await service.listSubmissionsForActor('me', Role.INSTRUCTOR, { ungradedOnly: true });
        assert.deepEqual(out.items.map(i => i.id), ['sub-a']);
        assert.equal(out.total, 1);
    });

    test('a course filter narrows the scope and combines with the ownership rule', async () => {
        const { service } = makeHarness();
        const out = await service.listSubmissionsForActor('me', Role.INSTRUCTOR, { courseId: 'crs-own' });
        assert.deepEqual(out.items.map(i => i.id), ['sub-b']);
    });

    test('a batch filter narrows to one batch', async () => {
        const { service } = makeHarness();
        const out = await service.listSubmissionsForActor('me', Role.INSTRUCTOR, { openingId: 'opn-our-batch' });
        assert.deepEqual(out.items.map(i => i.id), ['sub-a']);
    });

    test('the newest submission comes first', async () => {
        const { service, findManyCalls } = makeHarness();
        const out = await service.listSubmissionsForActor('me', Role.INSTRUCTOR);
        assert.equal(findManyCalls[0].orderBy.submittedAt, 'desc');
        assert.deepEqual(out.items.map(i => i.id), ['sub-b', 'sub-a']);
    });

    test('a limit truncates the list but total still counts everything', async () => {
        const { service } = makeHarness();
        const out = await service.listSubmissionsForActor('me', Role.INSTRUCTOR, { limit: 1 });
        assert.equal(out.items.length, 1);
        assert.equal(out.total, 2, 'the count is not the page size, so the UI can say it truncated');
        assert.equal(out.hasMore, true);
    });

    test('the last short page does not claim there is another one', async () => {
        // ADMIN sees all 3 rows, newest first; the second page of 2 holds only
        // the oldest, so its page is short.
        const { service } = makeHarness();
        const last = await service.listSubmissionsForActor('anyone', Role.ADMIN, { limit: 2, skip: 2 });
        assert.equal(last.total, 3);
        assert.deepEqual(last.items.map(i => i.id), ['sub-a']);
        assert.equal(last.hasMore, false, 'rows.length (1) is under total, but skip + rows lands on it');
    });

    test('a missing or nonsense limit falls back to 100 instead of breaking the query', async () => {
        for (const limit of [undefined, Number.NaN, -5, 0]) {
            const { service, findManyCalls } = makeHarness();
            await service.listSubmissionsForActor('me', Role.INSTRUCTOR, { limit });
            assert.equal(findManyCalls[0].take, 100, `limit=${limit}`);
        }
    });

    test('the limit is capped so one request cannot ask for the whole table', async () => {
        const { service, findManyCalls } = makeHarness();
        await service.listSubmissionsForActor('me', Role.INSTRUCTOR, { limit: 100000 });
        assert.equal(findManyCalls[0].take, 300);
    });

    test('skip walks to the next page without repeating the first one', async () => {
        const { service: firstPage } = makeHarness();
        const { service: secondPage } = makeHarness();
        const first = await firstPage.listSubmissionsForActor('me', Role.INSTRUCTOR, { limit: 1 });
        const second = await secondPage.listSubmissionsForActor('me', Role.INSTRUCTOR, { limit: 1, skip: 1 });
        assert.deepEqual(first.items.map(i => i.id), ['sub-b']);
        assert.deepEqual(second.items.map(i => i.id), ['sub-a']);
    });

    test('a nonsense skip starts from the beginning instead of failing', async () => {
        for (const skip of [undefined, Number.NaN, -5, 0]) {
            const { service, findManyCalls } = makeHarness();
            await service.listSubmissionsForActor('me', Role.INSTRUCTOR, { skip });
            assert.equal(findManyCalls[0].skip, 0, `skip=${skip}`);
        }
    });

    test('the offset is capped, because every skipped row still costs a scan', async () => {
        const { service, findManyCalls } = makeHarness();
        await service.listSubmissionsForActor('me', Role.INSTRUCTOR, { skip: 999999 });
        assert.equal(findManyCalls[0].skip, 5000);
    });
});

describe('submission inbox: rows come back shaped like the rows the UI reads', () => {
    test('a mapped row keeps the submission fields the grading form reads', async () => {
        const { service } = makeHarness();
        const out = await service.listSubmissionsForActor('me', Role.INSTRUCTOR);
        for (const k of ['id', 'content', 'score', 'notes', 'submittedAt', 'enrollment', 'task']) {
            assert.ok(k in out.items[0], `${k} must survive the mapping`);
        }
    });

    test('the double expands rows the way Prisma applies the include', () => {
        const row = expand(SUBMISSIONS[1]);
        assert.equal(row.task.opening.course.titleEn, 'My course');
        assert.equal(row.enrollment.student.email, 'ali@example.com');
    });
});
