"use client";

import Link from 'next/link';
import { useMemo } from 'react';
import { useFetchData } from '@/lib/useFetchData';
import { useI18n } from '@/lib/i18n-context';
import {
    AlertCircle, ArrowLeft, ArrowRight, BookOpen, CalendarDays, CheckCircle2,
    ClipboardList, Clock, GraduationCap, Loader, Video,
} from 'lucide-react';

interface DashboardCourse {
    id: string;
    courseId: string;
    titleAr: string;
    titleEn: string;
    openingId: string | null;
    openingNameAr?: string | null;
    openingNameEn?: string | null;
    openingStatus?: string | null;
    progressPercent: number | null;
}

interface DashboardTask {
    id: string;
    titleAr: string;
    titleEn: string;
    dueDate: string | null;
    isOverdue: boolean;
    maxScore: number;
    courseId: string;
    courseTitleAr: string;
    courseTitleEn: string;
    openingId: string;
    openingNameAr?: string | null;
    openingNameEn?: string | null;
}

interface DashboardSession {
    id: string;
    titleAr: string;
    titleEn: string;
    scheduledAt: string;
    durationMinutes?: number | null;
    meetLink?: string | null;
    courseId: string;
    courseTitleAr: string;
    courseTitleEn: string;
    openingId: string;
    openingNameAr?: string | null;
    openingNameEn?: string | null;
}

interface StudentDashboardData {
    summary: {
        activeCourseCount: number;
        completedCourseCount: number;
        pendingTaskCount: number;
        overdueTaskCount: number;
        pendingGradingCount: number;
    };
    courses: DashboardCourse[];
    tasks: DashboardTask[];
    upcomingSessions: DashboardSession[];
}

export default function StudentDashboardOverview() {
    const { data, loading, error, refetch } = useFetchData<StudentDashboardData>('/analytics/student-dashboard');
    const { t, pick, locale } = useI18n();
    const isAr = locale === 'ar';
    const Arrow = isAr ? ArrowLeft : ArrowRight;
    const activeCourses = useMemo(
        () => (data?.courses ?? []).filter((course) => course.openingStatus !== 'ENDED'),
        [data?.courses],
    );
    const formatDate = (value: string) => new Date(value).toLocaleString(isAr ? 'ar-SA' : 'en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });

    if (loading) {
        return (
            <section aria-label={t('studentHome.heading')} className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
                    {[0, 1, 2, 3].map((item) => (
                        <div key={item} className="h-24 animate-pulse rounded-2xl bg-gray-200 dark:bg-white/5" />
                    ))}
                </div>
                <div className="flex items-center justify-center py-8 text-gray-500 dark:text-gray-400">
                    <Loader size={22} className="me-2 animate-spin text-brand-gold-dark dark:text-brand-gold-light" />
                    {t('common.loading')}
                </div>
            </section>
        );
    }

    if (error || !data) {
        return (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm font-semibold text-red-600 dark:text-red-400">
                <span className="flex min-w-0 items-center gap-2">
                    <AlertCircle size={18} className="shrink-0" />
                    {error || t('studentHome.load_failed')}
                </span>
                <button onClick={() => void refetch()} className="rounded-lg border border-red-500/20 px-3 py-2 font-bold hover:bg-red-500/10">
                    {t('studentHome.retry')}
                </button>
            </div>
        );
    }

    const metrics = [
        { label: t('studentHome.active_courses'), value: data.summary.activeCourseCount, icon: BookOpen, color: 'text-brand-gold-light' },
        { label: t('studentHome.tasks_to_do'), value: data.summary.pendingTaskCount, icon: ClipboardList, color: 'text-sky-300' },
        { label: t('studentHome.overdue_tasks'), value: data.summary.overdueTaskCount, icon: AlertCircle, color: data.summary.overdueTaskCount ? 'text-red-400' : 'text-emerald-300' },
        { label: t('studentHome.waiting_grades'), value: data.summary.pendingGradingCount, icon: GraduationCap, color: 'text-violet-300' },
    ];

    return (
        <section aria-label={t('studentHome.heading')} className="min-w-0 space-y-5 sm:space-y-6">
            <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
                {metrics.map(({ label, value, icon: Icon, color }) => (
                    <div key={label} className="min-w-0 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-white/5 dark:bg-brand-navy-dark sm:p-4">
                        <div className="mb-2 flex items-center gap-2">
                            <Icon size={17} className={`shrink-0 ${color}`} />
                            <p className="min-w-0 text-[11px] font-bold leading-snug text-gray-500 dark:text-gray-400 sm:text-xs">{label}</p>
                        </div>
                        <p className="text-2xl font-black tabular-nums text-brand-navy dark:text-white">{value}</p>
                    </div>
                ))}
            </div>

            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
                <section className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/5 dark:bg-brand-navy-dark sm:p-5" aria-labelledby="student-tasks-heading">
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400">
                                <ClipboardList size={18} />
                            </span>
                            <div className="min-w-0">
                                <h2 id="student-tasks-heading" className="font-black text-brand-navy dark:text-white">{t('studentHome.tasks_heading')}</h2>
                                <p className="text-xs text-gray-500 dark:text-gray-400">{t('studentHome.tasks_subtitle')}</p>
                            </div>
                        </div>
                        <Link href="/dashboard/tasks" className="shrink-0 text-xs font-bold text-brand-gold-dark hover:underline dark:text-brand-gold-light">
                            {t('studentHome.view_all')} <Arrow size={13} className="inline" />
                        </Link>
                    </div>

                    {data.tasks.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-center dark:border-white/10">
                            <CheckCircle2 size={22} className="mx-auto mb-2 text-emerald-400" />
                            <p className="text-sm font-bold text-gray-600 dark:text-gray-300">{t('studentHome.no_pending_tasks')}</p>
                        </div>
                    ) : (
                        <div className="space-y-2.5">
                            {data.tasks.map((task) => {
                                return (
                                    <Link
                                        key={task.id}
                                        href={`/dashboard/tasks?openingId=${encodeURIComponent(task.openingId)}`}
                                        className="block rounded-xl border border-gray-200 p-3 transition hover:border-brand-gold/40 dark:border-white/10 dark:hover:border-brand-gold/30"
                                    >
                                        <div className="flex min-w-0 items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="break-words text-sm font-bold text-brand-navy dark:text-white">{pick(task, 'title')}</p>
                                                <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">{pick(task, 'courseTitle')}</p>
                                            </div>
                                            {task.dueDate && (
                                                <span className={`shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold ${task.isOverdue ? 'bg-red-500/10 text-red-500 dark:text-red-300' : 'bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-gray-300'}`}>
                                                    <Clock size={11} className="me-1 inline" />
                                                    {formatDate(task.dueDate)}
                                                </span>
                                            )}
                                        </div>
                                        {!task.dueDate && <p className="mt-2 text-[11px] text-gray-500">{t('studentHome.no_deadline')}</p>}
                                    </Link>
                                );
                            })}
                        </div>
                    )}
                </section>

                <section className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/5 dark:bg-brand-navy-dark sm:p-5" aria-labelledby="student-sessions-heading">
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                                <CalendarDays size={18} />
                            </span>
                            <div className="min-w-0">
                                <h2 id="student-sessions-heading" className="font-black text-brand-navy dark:text-white">{t('studentHome.sessions_heading')}</h2>
                                <p className="text-xs text-gray-500 dark:text-gray-400">{t('studentHome.sessions_subtitle')}</p>
                            </div>
                        </div>
                        <Link href="/dashboard/my-courses" className="shrink-0 text-xs font-bold text-brand-gold-dark hover:underline dark:text-brand-gold-light">
                            {t('studentHome.view_all')} <Arrow size={13} className="inline" />
                        </Link>
                    </div>
                    {data.upcomingSessions.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-center dark:border-white/10">
                            <CalendarDays size={22} className="mx-auto mb-2 text-gray-400" />
                            <p className="text-sm font-bold text-gray-600 dark:text-gray-300">{t('studentHome.no_sessions')}</p>
                        </div>
                    ) : (
                        <div className="space-y-2.5">
                            {data.upcomingSessions.map((session) => (
                                <article key={session.id} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-gray-200 p-3 dark:border-white/10">
                                    <div className="flex min-w-0 items-start gap-2.5">
                                        <Video size={16} className="mt-0.5 shrink-0 text-emerald-400" />
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-bold text-brand-navy dark:text-white">{pick(session, 'title')}</p>
                                            <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">{pick(session, 'courseTitle')}</p>
                                            <p className="mt-1 text-xs font-semibold text-gray-600 dark:text-gray-300">{formatDate(session.scheduledAt)}</p>
                                        </div>
                                    </div>
                                    {session.meetLink && (
                                        <a
                                            href={session.meetLink}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="shrink-0 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
                                        >
                                            <Video size={13} className="me-1 inline" /> {t('liveSessions.join')}
                                        </a>
                                    )}
                                </article>
                            ))}
                        </div>
                    )}
                </section>
            </div>

            <section aria-labelledby="student-courses-heading" className="min-w-0">
                <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                        <h2 id="student-courses-heading" className="font-black text-brand-navy dark:text-white">{t('studentHome.continue_learning')}</h2>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{t('studentHome.continue_subtitle')}</p>
                    </div>
                    <Link href="/dashboard/my-courses" className="shrink-0 text-xs font-bold text-brand-gold-dark hover:underline dark:text-brand-gold-light">
                        {t('studentHome.view_all')} <Arrow size={13} className="inline" />
                    </Link>
                </div>
                {activeCourses.length === 0 ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-gray-300 bg-white p-4 dark:border-white/10 dark:bg-brand-navy-dark sm:p-5">
                        <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">{t('studentHome.no_active_courses')}</p>
                        <Link href="/dashboard/explore" className="rounded-xl bg-brand-gold px-4 py-2.5 text-sm font-black text-brand-navy-dark hover:bg-brand-gold-light">
                            {t('studentHome.explore')}
                        </Link>
                    </div>
                ) : (
                    <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {activeCourses.slice(0, 3).map((course) => (
                            <Link
                                key={course.id}
                                href={`/dashboard/courses/${course.courseId}/player`}
                                className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-gold/40 dark:border-white/5 dark:bg-brand-navy-dark sm:p-5"
                            >
                                <div className="mb-3 flex items-start gap-2">
                                    <BookOpen size={18} className="mt-0.5 shrink-0 text-brand-gold-dark dark:text-brand-gold-light" />
                                    <div className="min-w-0">
                                        <h3 className="line-clamp-2 text-sm font-black text-brand-navy dark:text-white">{pick(course, 'title')}</h3>
                                        {(course.openingNameAr || course.openingNameEn) && (
                                            <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">{pick(course, 'openingName')}</p>
                                        )}
                                    </div>
                                </div>
                                {course.progressPercent !== null ? (
                                    <>
                                        <div className="mb-1.5 flex items-center justify-between text-xs font-bold">
                                            <span className="text-gray-500 dark:text-gray-400">{t('studentHome.progress')}</span>
                                            <span className="text-brand-gold-dark dark:text-brand-gold-light">{course.progressPercent}%</span>
                                        </div>
                                        <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
                                            <div className="h-full rounded-full bg-gradient-to-r from-brand-gold-dark to-brand-gold-light" style={{ width: `${course.progressPercent}%` }} />
                                        </div>
                                    </>
                                ) : (
                                    <p className="text-xs text-gray-500 dark:text-gray-400">{t('studentHome.progress_unavailable')}</p>
                                )}
                            </Link>
                        ))}
                    </div>
                )}
            </section>
        </section>
    );
}
