'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
    Users, CalendarClock, BookOpen, CreditCard, Search,
    Info, Megaphone, Unlock, Play, Flag, CheckCircle, XCircle, Clock,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n-context';
import { useFetchData } from '@/lib/useFetchData';
import { Badge, type Tone } from '@/app/dashboard/admin/components';

type EnrollmentStatus = 'PENDING' | 'APPROVED' | 'RESERVED' | 'REJECTED' | 'REVOKED';
type OpeningStatus = 'DRAFT' | 'ANNOUNCEMENT' | 'OPEN' | 'STARTED' | 'ENDED';

const ALL_STATUSES: EnrollmentStatus[] = ['APPROVED', 'PENDING', 'RESERVED', 'REJECTED', 'REVOKED'];

interface RosterOpening {
    id: string;
    status?: string | null;
    isPublished?: boolean;
    nameAr?: string | null;
    nameEn?: string | null;
    price?: string | null;
}

interface RosterPayment {
    id: string;
    status: string;
    amount?: string | null;
    method?: string | null;
    gatewayId?: string | null;
    paidAt?: string | null;
    createdAt: string;
}

interface RosterEnrollment {
    id: string;
    status: EnrollmentStatus;
    createdAt: string;
    updatedAt: string;
    financeOfficerNotes?: string | null;
    student: { id: string; email: string };
    opening?: RosterOpening | null;
    payment?: RosterPayment | null;
}

interface CourseRoster {
    course: { id: string; titleAr?: string | null; titleEn?: string | null };
    counts: Record<EnrollmentStatus, number>;
    total: number;
    enrollments: RosterEnrollment[];
}

interface CourseLessonDetail {
    id: string;
    titleAr: string;
    titleEn: string;
    descriptionAr?: string | null;
    descriptionEn?: string | null;
    videoUrl?: string | null;
    durationMinutes?: number | null;
    outcomes?: { descriptionAr?: string | null; descriptionEn?: string | null }[];
    files?: { url: string; nameAr?: string | null; nameEn?: string | null }[] | null;
    links?: { url: string; labelAr?: string | null; labelEn?: string | null }[] | null;
}

/** Mirror of the Course scalars + collection relations from GET /courses/:id. */
interface CourseDetail {
    id: string;
    titleAr?: string | null;
    titleEn?: string | null;
    excerptAr?: string | null;
    excerptEn?: string | null;
    descriptionAr?: string | null;
    descriptionEn?: string | null;
    syllabusAr?: string | null;
    syllabusEn?: string | null;
    durationAr?: string | null;
    durationEn?: string | null;
    contentType?: string | null;
    categoryAr?: string | null;
    categoryEn?: string | null;
    level?: string | null;
    language?: string | null;
    hoursOfContent?: number | null;
    coverImageUrl?: string | null;
    introVideoUrl?: string | null;
    videoFileUrl?: string | null;
    createdAt?: string | null;
    certificateIssued?: boolean | null;
    quizzesIncluded?: boolean | null;
    projectsIncluded?: boolean | null;
    assignmentsIncluded?: boolean | null;
    liveSessionsIncluded?: boolean | null;
    downloadableResources?: boolean | null;
    lifetimeAccess?: boolean | null;
    communityAccess?: boolean | null;
    instructor?: { id: string; email: string } | null;
    openings?: {
        id: string;
        status?: string | null;
        isPublished?: boolean;
        nameAr?: string | null;
        nameEn?: string | null;
        startDate?: string | null;
        endDate?: string | null;
        enrollmentDeadline?: string | null;
        price: string;
        priceOld?: string | null;
        maxStudents?: number | null;
        instructor?: { email: string } | null;
        _count?: { enrollments?: number };
    }[];
    objectives?: { objectiveAr?: string | null; objectiveEn?: string | null }[];
    prerequisites?: { prerequisiteAr?: string | null; prerequisiteEn?: string | null }[];
    audiences?: { audienceAr?: string | null; audienceEn?: string | null }[];
    faqs?: { questionAr?: string | null; questionEn?: string | null; answerAr?: string | null; answerEn?: string | null }[];
    gallery?: { url: string; altAr?: string | null; altEn?: string | null }[];
    modules?: CourseLessonDetail[];
    chapters?: { id: string; titleAr: string; titleEn: string; modules?: CourseLessonDetail[] }[];
    _count?: { enrollments?: number; modules?: number };
}

const ENROLLMENT_TONE: Record<EnrollmentStatus, Tone> = {
    APPROVED: 'green',
    PENDING: 'amber',
    RESERVED: 'blue',
    REJECTED: 'red',
    REVOKED: 'gray',
};

const OPENING_TONE: Record<OpeningStatus, Tone> = {
    DRAFT: 'gray',
    ANNOUNCEMENT: 'purple',
    OPEN: 'green',
    STARTED: 'teal',
    ENDED: 'gray',
};

/** Forward transition available from each opening state (mirrors the backend guards). */
const OPENING_ACTIONS: Record<OpeningStatus, { action: string; icon: typeof Megaphone; tone: string; labelKey: string }[]> = {
    DRAFT: [{ action: 'announcement', icon: Megaphone, tone: 'text-brand-navy dark:text-brand-navy-light', labelKey: 'manageCourses.action_announce_tooltip' }],
    ANNOUNCEMENT: [{ action: 'open', icon: Unlock, tone: 'text-emerald-600 dark:text-emerald-400', labelKey: 'manageCourses.action_open_tooltip' }],
    OPEN: [{ action: 'start', icon: Play, tone: 'text-teal-600 dark:text-teal-400', labelKey: 'manageCourses.action_start_tooltip' }],
    STARTED: [{ action: 'end', icon: Flag, tone: 'text-red-600 dark:text-red-400', labelKey: 'manageCourses.action_end_tooltip' }],
    ENDED: [],
};

const PAYMENT_TONE: Record<string, Tone> = {
    PAID: 'green',
    PENDING: 'amber',
    REJECTED: 'red',
    REFUNDED: 'purple',
    FAILED: 'red',
    CANCELLED: 'gray',
};

function LessonDetails({
    lesson,
    index,
    pick,
    t,
}: {
    lesson: CourseLessonDetail;
    index: number;
    pick: (obj: unknown, field: string) => string | undefined;
    t: (key: string) => string;
}) {
    const files = lesson.files ?? [];
    const links = lesson.links ?? [];

    return (
        <article className="rounded-lg border border-gray-200 p-3 dark:border-white/10">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <h6 className="text-sm font-bold text-brand-navy dark:text-gray-100">
                    {index}. {pick(lesson, 'title')}
                </h6>
                <div className="flex flex-wrap gap-2 text-[10px] font-bold text-gray-500 dark:text-gray-400">
                    {lesson.durationMinutes != null && <span>{lesson.durationMinutes} {t('admin.panel_lesson_duration')}</span>}
                </div>
            </div>
            {pick(lesson, 'description') && (
                <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-gray-600 dark:text-gray-300">{pick(lesson, 'description')}</p>
            )}
            {lesson.videoUrl && (
                <a href={lesson.videoUrl} target="_blank" rel="noreferrer" className="mt-2 block break-all text-xs font-bold text-brand-navy-light underline dark:text-brand-gold-light">
                    {t('courseDetail.video_lesson')}: {lesson.videoUrl}
                </a>
            )}
            {(lesson.outcomes?.length ?? 0) > 0 && (
                <div className="mt-3">
                    <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-gray-500">{t('admin.panel_lesson_outcomes')}</p>
                    <ul className="space-y-1">
                        {lesson.outcomes?.map((outcome, outcomeIndex) => (
                            <li key={outcomeIndex} className="text-xs text-gray-600 dark:text-gray-300">{pick(outcome, 'description')}</li>
                        ))}
                    </ul>
                </div>
            )}
            {(files.length > 0 || links.length > 0) && (
                <div className="mt-3 flex flex-wrap gap-2">
                    {files.map((file, fileIndex) => (
                        <a key={`file-${fileIndex}`} href={file.url} target="_blank" rel="noreferrer" className="max-w-full truncate rounded-md bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-brand-navy-light underline dark:bg-white/5 dark:text-brand-gold-light">
                            {pick(file, 'name') || file.url}
                        </a>
                    ))}
                    {links.map((link, linkIndex) => (
                        <a key={`link-${linkIndex}`} href={link.url} target="_blank" rel="noreferrer" className="max-w-full truncate rounded-md bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-brand-navy-light underline dark:bg-white/5 dark:text-brand-gold-light">
                            {pick(link, 'label') || link.url}
                        </a>
                    ))}
                </div>
            )}
        </article>
    );
}

export default function CourseAdminPanel({ courseId }: { courseId: string }) {
    const { t, pick, locale } = useI18n();
    const [statusFilter, setStatusFilter] = useState<'ALL' | EnrollmentStatus>('ALL');
    const [studentQuery, setStudentQuery] = useState('');

    // Both requests are deferred until the panel is actually mounted, so
    // listing a page of courses does not fan out into N detail calls.
    const { data: course, loading: courseLoading, error: courseError } = useFetchData<CourseDetail>(`/courses/${courseId}?includeUnpublished=true`);
    const { data: roster, loading: rosterLoading, error: rosterError } = useFetchData<CourseRoster>(`/enrollments/course/${courseId}`);

    const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB') : '—');
    const fmtNum = (n: number) => new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-US').format(n);

    const openings = useMemo(
        () => [...(course?.openings ?? [])].sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? '')),
        [course?.openings],
    );

    const visibleStudents = useMemo(() => {
        const rows = roster?.enrollments ?? [];
        const q = studentQuery.trim().toLowerCase();
        return rows.filter((e) => {
            if (statusFilter !== 'ALL' && e.status !== statusFilter) return false;
            if (!q) return true;
            return (e.student?.email || '').toLowerCase().includes(q)
                || (pick(e.opening, 'name') || '').toLowerCase().includes(q);
        });
    }, [roster?.enrollments, statusFilter, studentQuery, pick]);

    const counts = roster?.counts;
    const totalStudents = roster?.total ?? 0;

    // A reserved seat that has not been paid for is the thing an admin most
    // needs to spot, so it is called out separately from the other chips.
    const reservedUnpaid = (roster?.enrollments ?? []).filter(e => e.status === 'RESERVED').length;

    if (courseLoading) {
        return <div className="p-6 text-sm font-bold text-gray-500 dark:text-gray-400">{t('admin.loading_courses')}</div>;
    }
    if (courseError) {
        return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">{courseError}</div>;
    }

    return (
        <div className="space-y-6">
            {/* ---- Details ---- */}
            <section className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <div className="lg:col-span-2 space-y-4">
                    <div className="admin-card p-5 space-y-3">
                        <h4 className="flex items-center gap-2 text-sm font-black text-brand-navy dark:text-white">
                            <Info size={16} className="text-brand-gold" /> {t('admin.panel_details')}
                        </h4>
                        <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2.5 text-sm">
                            {[
                                { k: 'admin.col_category', v: pick(course, 'category') },
                                { k: 'admin.col_level', v: course?.level ? t(`course.level_${String(course.level).toLowerCase()}`) : null },
                                { k: 'courseDetail.language_label', v: course?.language },
                                { k: 'courseDetail.hours_label', v: course?.hoursOfContent ? `${course.hoursOfContent}` : null },
                                { k: 'createCourse.duration_label', v: pick(course, 'duration') },
                                { k: 'createCourse.content_type_label', v: course?.contentType ? t(`createCourse.content_type_${course.contentType.toLowerCase()}`) : null },
                                { k: 'course.modules', v: course?._count?.modules },
                                { k: 'admin.col_instructor', v: course?.instructor?.email },
                                { k: 'admin.col_joined', v: course?.createdAt ? fmtDate(course.createdAt) : null },
                                { k: 'admin.panel_batch_count', v: openings.length },
                                { k: 'admin.col_enrollments', v: totalStudents },
                                { k: 'admin.panel_gallery_count', v: course?.gallery?.length },
                                { k: 'admin.panel_faq_count', v: course?.faqs?.length },
                            ].map((row) => (
                                <div key={row.k}>
                                    <dt className="text-[11px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">{t(row.k)}</dt>
                                    <dd className="font-bold text-brand-navy dark:text-gray-200 truncate">{row.v ?? '—'}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>

                    {[
                        { key: 'excerpt', label: t('admin.panel_excerpt'), value: pick(course, 'excerpt') },
                        { key: 'description', label: t('courseDetail.about_heading'), value: pick(course, 'description') },
                        { key: 'syllabus', label: t('courseDetail.syllabus_heading'), value: pick(course, 'syllabus') },
                    ].filter(s => s.value).map((s) => (
                        <div key={s.key} className="admin-card p-5">
                            <h4 className="mb-2 text-sm font-black text-brand-navy dark:text-white">{s.label}</h4>
                            <p className="text-sm leading-relaxed whitespace-pre-wrap text-gray-600 dark:text-gray-300">{s.value}</p>
                        </div>
                    ))}

                    {([
                        { label: t('courseDetail.learn_heading'), rows: course?.objectives, key: 'objective' as const, icon: CheckCircle },
                        { label: t('courseDetail.prereq_heading'), rows: course?.prerequisites, key: 'prerequisite' as const, icon: CheckCircle },
                        { label: t('courseDetail.audience_heading'), rows: course?.audiences, key: 'audience' as const, icon: Users },
                    ]).filter(g => (g.rows?.length ?? 0) > 0).map((g) => (
                        <div key={g.key} className="admin-card p-5">
                            <h4 className="mb-3 text-sm font-black text-brand-navy dark:text-white">{g.label}</h4>
                            <ul className="grid sm:grid-cols-2 gap-2">
                                {(g.rows ?? []).map((r, i) => (
                                    <li key={i} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300">
                                        <g.icon size={14} className="mt-0.5 shrink-0 text-brand-gold" />
                                        {pick(r, g.key)}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}

                    {(course?.coverImageUrl || course?.introVideoUrl || course?.videoFileUrl) && (
                        <div className="admin-card p-5 space-y-3">
                            <h4 className="text-sm font-black text-brand-navy dark:text-white">{t('admin.panel_media')}</h4>
                            {course.coverImageUrl && (
                                <a href={course.coverImageUrl} target="_blank" rel="noreferrer" className="block break-all text-sm font-bold text-brand-navy-light underline dark:text-brand-gold-light">
                                    {t('createCourse.cover_label')}: {course.coverImageUrl}
                                </a>
                            )}
                            {course.introVideoUrl && (
                                <a href={course.introVideoUrl} target="_blank" rel="noreferrer" className="block break-all text-sm font-bold text-brand-navy-light underline dark:text-brand-gold-light">
                                    {t('createCourse.intro_video_url_label')}: {course.introVideoUrl}
                                </a>
                            )}
                            {course.videoFileUrl && (
                                <a href={course.videoFileUrl} target="_blank" rel="noreferrer" className="block break-all text-sm font-bold text-brand-navy-light underline dark:text-brand-gold-light">
                                    {t('createCourse.video_file_label')}: {course.videoFileUrl}
                                </a>
                            )}
                        </div>
                    )}

                    {((course?.chapters?.length ?? 0) > 0 || (course?.modules?.length ?? 0) > 0) && (
                        <div className="admin-card p-5 space-y-4">
                            <h4 className="text-sm font-black text-brand-navy dark:text-white">{t('admin.panel_course_content')}</h4>
                            {(course?.chapters?.length ?? 0) > 0 ? course?.chapters?.map((chapter, chapterIndex) => (
                                <div key={chapter.id} className="rounded-xl border border-gray-200 p-4 dark:border-white/10">
                                    <h5 className="mb-3 text-sm font-black text-brand-navy dark:text-white">
                                        {chapterIndex + 1}. {pick(chapter, 'title')}
                                    </h5>
                                    <div className="space-y-3">
                                        {(chapter.modules ?? []).map((lesson, lessonIndex) => (
                                            <LessonDetails key={lesson.id} lesson={lesson} index={lessonIndex + 1} pick={pick} t={t} />
                                        ))}
                                    </div>
                                </div>
                            )) : (
                                <div className="space-y-3">
                                    {(course?.modules ?? []).map((lesson, lessonIndex) => (
                                        <LessonDetails key={lesson.id} lesson={lesson} index={lessonIndex + 1} pick={pick} t={t} />
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {(course?.faqs?.length ?? 0) > 0 && (
                        <div className="admin-card p-5 space-y-3">
                            <h4 className="text-sm font-black text-brand-navy dark:text-white">{t('admin.panel_faqs')}</h4>
                            {course?.faqs?.map((faq, index) => (
                                <details key={index} className="rounded-xl border border-gray-200 p-3 dark:border-white/10">
                                    <summary className="cursor-pointer text-sm font-bold text-brand-navy dark:text-white">{pick(faq, 'question')}</summary>
                                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-600 dark:text-gray-300">{pick(faq, 'answer')}</p>
                                </details>
                            ))}
                        </div>
                    )}

                    {(course?.gallery?.length ?? 0) > 0 && (
                        <div className="admin-card p-5 space-y-3">
                            <h4 className="text-sm font-black text-brand-navy dark:text-white">{t('admin.panel_gallery')}</h4>
                            <div className="grid gap-2 sm:grid-cols-2">
                                {course?.gallery?.map((image, index) => (
                                    <a key={index} href={image.url} target="_blank" rel="noreferrer" className="truncate rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-brand-navy-light underline dark:border-white/10 dark:text-brand-gold-light">
                                        {pick(image, 'alt') || image.url}
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* ---- Per-status summary ---- */}
                <div className="space-y-3">
                    <div className="admin-card p-5">
                        <h4 className="mb-3 flex items-center gap-2 text-sm font-black text-brand-navy dark:text-white">
                            <Users size={16} className="text-brand-gold" /> {t('admin.panel_students')}
                        </h4>
                        {rosterLoading ? (
                            <p className="text-sm text-gray-500 dark:text-gray-400">{t('common.loading')}</p>
                        ) : rosterError ? (
                            <p role="alert" className="text-sm text-red-600 dark:text-red-400">{rosterError}</p>
                        ) : (
                            <ul className="space-y-2">
                                {ALL_STATUSES.map((s) => (
                                    <li key={s} className="flex items-center justify-between gap-2 text-sm">
                                        <Badge tone={ENROLLMENT_TONE[s]} dot>{t(`statuses.${s.toLowerCase()}`)}</Badge>
                                        <span className="font-black text-brand-navy dark:text-white">{fmtNum(counts?.[s] ?? 0)}</span>
                                    </li>
                                ))}
                                <li className="flex items-center justify-between gap-2 border-t border-gray-200 dark:border-white/10 pt-2 text-sm font-black">
                                    <span className="text-brand-navy dark:text-white">{t('admin.panel_total')}</span>
                                    <span className="text-brand-gold-dark dark:text-brand-gold-light">{fmtNum(totalStudents)}</span>
                                </li>
                            </ul>
                        )}
                        {reservedUnpaid > 0 && (
                            <p className="mt-4 flex items-start gap-2 rounded-xl bg-brand-gold/10 p-3 text-xs font-bold text-brand-navy dark:text-brand-gold-light">
                                <Clock size={14} className="mt-0.5 shrink-0" />
                                {t('admin.panel_reserved_unpaid').replace('{n}', fmtNum(reservedUnpaid))}
                            </p>
                        )}
                    </div>

                    <div className="admin-card p-5">
                        <h4 className="mb-3 text-sm font-black text-brand-navy dark:text-white">{t('admin.panel_included')}</h4>
                        <ul className="space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
                            {([
                                ['certificateIssued', t('courseDetail.certificate_label')],
                                ['quizzesIncluded', t('createCourse.feat_quizzes')],
                                ['projectsIncluded', t('createCourse.feat_projects')],
                                ['assignmentsIncluded', t('createCourse.feat_assignments')],
                                ['liveSessionsIncluded', t('createCourse.feat_live_sessions')],
                                ['downloadableResources', t('createCourse.feat_downloadable')],
                                ['lifetimeAccess', t('createCourse.feat_lifetime')],
                                ['communityAccess', t('createCourse.feat_community')],
                            ] as const).map(([key, label]) => (
                                <li key={key} className="flex items-center gap-2">
                                    {course?.[key]
                                        ? <CheckCircle size={14} className="shrink-0 text-emerald-500" />
                                        : <XCircle size={14} className="shrink-0 text-gray-300 dark:text-gray-600" />}
                                    <span className={course?.[key] ? '' : 'opacity-50'}>{label}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </section>

            {/* ---- Openings, every state ---- */}
            <section>
                <h4 className="mb-3 flex items-center gap-2 text-sm font-black text-brand-navy dark:text-white">
                    <CalendarClock size={16} className="text-brand-gold" /> {t('admin.panel_openings')}
                </h4>
                {openings.length === 0 ? (
                    <p className="admin-card p-5 text-sm text-gray-500 dark:text-gray-400">{t('manageCourses.no_openings')}</p>
                ) : (
                    <div className="admin-table-wrap">
                        <table className="admin-table text-left">
                            <thead>
                                <tr>
                                    <th>{t('admin.col_batch')}</th>
                                    <th>{t('manageCourses.col_status')}</th>
                                    <th>{t('admin.col_dates')}</th>
                                    <th>{t('admin.col_deadline')}</th>
                                    <th>{t('manageCourses.col_price')}</th>
                                    <th>{t('admin.col_seats')}</th>
                                    <th>{t('admin.col_enrollments')}</th>
                                    <th>{t('admin.col_instructor')}</th>
                                    <th className="text-right">{t('manageCourses.col_actions')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-white/5">
                                {openings.map((o) => {
                                    const st = (o.status || 'DRAFT') as OpeningStatus;
                                    const taken = o._count?.enrollments ?? 0;
                                    const seats = o.maxStudents ? `${taken}/${o.maxStudents}` : `${taken}`;
                                    return (
                                        <tr key={o.id} className="text-sm">
                                            <td className="p-3.5 font-bold text-brand-navy dark:text-gray-200">
                                                {pick(o, 'name') || t('manageCourses.opening_default')}
                                                {o.isPublished
                                                    ? <span className="ms-2 text-[10px] font-black text-emerald-600 dark:text-emerald-400">{t('admin.published_short')}</span>
                                                    : <span className="ms-2 text-[10px] font-black text-brand-gold-dark dark:text-brand-gold-light">{t('admin.draft_tag')}</span>}
                                            </td>
                                            <td className="p-3.5">
                                                <Badge tone={OPENING_TONE[st] ?? 'gray'} dot>{t(`manageCourses.status_${st.toLowerCase()}`)}</Badge>
                                            </td>
                                            <td className="p-3.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{fmtDate(o.startDate)} → {fmtDate(o.endDate)}</td>
                                            <td className="p-3.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{fmtDate(o.enrollmentDeadline)}</td>
                                            <td className="p-3.5 font-black text-emerald-600 dark:text-emerald-400">
                                                ${o.price}
                                                {o.priceOld && <span className="ms-1.5 text-xs font-normal text-gray-400 line-through">${o.priceOld}</span>}
                                            </td>
                                            <td className="p-3.5 text-gray-500 dark:text-gray-400">{seats}</td>
                                            <td className="p-3.5 text-gray-500 dark:text-gray-400">{taken}</td>
                                            <td className="p-3.5 text-gray-500 dark:text-gray-400 max-w-[160px] truncate">{o.instructor?.email || '—'}</td>
                                            <td className="p-3.5 text-right whitespace-nowrap">
                                                {OPENING_ACTIONS[st]?.map(({ action, icon: Icon, tone, labelKey }) => (
                                                    <span key={action} className="tooltip" title={t(labelKey)}>
                                                        <Link
                                                            href={`/dashboard/admin/openings?focus=${o.id}`}
                                                            className={`admin-action-btn ${tone} hover:bg-black/5 dark:hover:bg-white/10`}
                                                            aria-label={t(labelKey)}
                                                        >
                                                            <Icon size={16} />
                                                        </Link>
                                                    </span>
                                                ))}
                                                <Link href={`/dashboard/courses/open/${courseId}?edit=${o.id}`} className="tooltip" title={t('manageCourses.edit_opening_tooltip')}>
                                                    <span className="admin-action-btn text-brand-navy dark:text-brand-navy-light hover:bg-brand-navy/10 dark:hover:bg-brand-navy-light/10">
                                                        <BookOpen size={16} />
                                                    </span>
                                                </Link>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            {/* ---- Students, every status ---- */}
            <section>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <h4 className="flex items-center gap-2 text-sm font-black text-brand-navy dark:text-white">
                        <Users size={16} className="text-brand-gold" /> {t('admin.panel_students')}
                    </h4>
                    <div className="relative">
                        <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400" />
                        <input
                            value={studentQuery}
                            onChange={e => setStudentQuery(e.target.value)}
                            placeholder={t('admin.panel_search_students')}
                            className="ps-9 pe-3 py-2 border border-gray-300 dark:border-white/10 rounded-xl text-sm w-full sm:w-56 bg-white dark:bg-brand-navy-dark text-brand-navy dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:ring-2 focus:ring-brand-gold outline-none transition"
                        />
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 mb-3">
                    <button
                        type="button"
                        onClick={() => setStatusFilter('ALL')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer ${statusFilter === 'ALL'
                            ? 'bg-gradient-to-r from-brand-gold to-brand-gold-dark text-black'
                            : 'bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-white/10'}`}
                    >
                        {t('admin.filter_all')} · {fmtNum(totalStudents)}
                    </button>
                    {ALL_STATUSES.map((s) => (
                        <button
                            key={s}
                            type="button"
                            onClick={() => setStatusFilter(s)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer ${statusFilter === s
                                ? 'bg-gradient-to-r from-brand-gold to-brand-gold-dark text-black'
                                : 'bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-white/10'}`}
                        >
                            {t(`statuses.${s.toLowerCase()}`)} · {fmtNum(counts?.[s] ?? 0)}
                        </button>
                    ))}
                </div>

                {rosterLoading ? (
                    <p className="admin-card p-5 text-sm text-gray-500 dark:text-gray-400">{t('common.loading')}</p>
                ) : visibleStudents.length === 0 ? (
                    <p className="admin-card p-5 text-sm text-gray-500 dark:text-gray-400">
                        {totalStudents === 0 ? t('roster.no_students') : t('admin.panel_no_match')}
                    </p>
                ) : (
                    <div className="admin-table-wrap">
                        <table className="admin-table text-left">
                            <thead>
                                <tr>
                                    <th>{t('admin.col_email')}</th>
                                    <th>{t('roster.col_status')}</th>
                                    <th>{t('admin.col_batch')}</th>
                                    <th>{t('admin.panel_payment')}</th>
                                    <th>{t('roster.registered_on')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-white/5">
                                {visibleStudents.map((e) => (
                                    <tr key={e.id} className="text-sm">
                                        <td className="p-3.5 font-bold text-brand-navy dark:text-gray-200" dir="ltr">{e.student?.email}</td>
                                        <td className="p-3.5"><Badge tone={ENROLLMENT_TONE[e.status]} dot>{t(`statuses.${e.status.toLowerCase()}`)}</Badge></td>
                                        <td className="p-3.5 text-gray-500 dark:text-gray-400">
                                            {pick(e.opening, 'name') || t('admin.panel_no_batch')}
                                        </td>
                                        <td className="p-3.5">
                                            {e.payment ? (
                                                <span className="inline-flex items-center gap-2">
                                                    <Badge tone={PAYMENT_TONE[e.payment.status] ?? 'gray'} dot>
                                                        {t(`statuses.${e.payment.status.toLowerCase()}`)}
                                                    </Badge>
                                                    {e.payment.amount && <span className="text-gray-500 dark:text-gray-400">${e.payment.amount}</span>}
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1.5 text-gray-400 dark:text-gray-500">
                                                    <CreditCard size={14} /> {t('admin.panel_no_payment')}
                                                </span>
                                            )}
                                        </td>
                                        <td className="p-3.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{fmtDate(e.createdAt)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </div>
    );
}
