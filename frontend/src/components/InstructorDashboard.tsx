"use client";

import Link from 'next/link';
import { Activity, BookOpen, CalendarDays, ClipboardCheck, Users } from 'lucide-react';
import { useFetchData } from '@/lib/useFetchData';
import { useI18n } from '@/lib/i18n-context';

interface InstructorOpening {
    id: string;
    nameAr?: string | null;
    nameEn?: string | null;
    status: string;
    startDate?: string | null;
    endDate?: string | null;
    course: { id: string; titleAr?: string | null; titleEn?: string | null };
}

interface InstructorOpeningReport extends InstructorOpening {
    approvedStudentCount: number;
    attendanceRate: number | null;
    taskSubmissionRate: number | null;
    needsFollowUpCount: number;
}

interface UpcomingSession {
    id: string;
    titleAr: string;
    titleEn: string;
    scheduledAt: string;
    durationMinutes?: number | null;
    opening: {
        id: string;
        nameAr?: string | null;
        nameEn?: string | null;
        course: { id: string; titleAr?: string | null; titleEn?: string | null };
    };
}

interface InstructorDashboardData {
    openingCount: number;
    activeOpeningCount: number;
    approvedStudentCount: number;
    ungradedSubmissionCount: number;
    openings: InstructorOpening[];
    openingReports: InstructorOpeningReport[];
    upcomingSessions: UpcomingSession[];
}

export default function InstructorDashboard() {
    const { locale, pick } = useI18n();
    const isAr = locale === 'ar';
    const { data, loading, error } = useFetchData<InstructorDashboardData>('/analytics/instructor-dashboard');

    const metrics = [
        { icon: BookOpen, label: isAr ? 'إجمالي الدفعات' : 'Total batches', value: data?.openingCount },
        { icon: Activity, label: isAr ? 'دفعات نشطة' : 'Active batches', value: data?.activeOpeningCount },
        { icon: Users, label: isAr ? 'الطلاب المقبولون' : 'Approved students', value: data?.approvedStudentCount },
        { icon: ClipboardCheck, label: isAr ? 'تسليمات تنتظر التصحيح' : 'Submissions to grade', value: data?.ungradedSubmissionCount },
    ];

    const statusLabel = (status: string) => {
        if (isAr) {
            return {
                DRAFT: 'مسودة',
                ANNOUNCEMENT: 'إعلان',
                OPEN: 'التسجيل مفتوح',
                STARTED: 'قيد التنفيذ',
                ENDED: 'منتهية',
            }[status] ?? status;
        }
        return {
            DRAFT: 'Draft',
            ANNOUNCEMENT: 'Announced',
            OPEN: 'Enrollment open',
            STARTED: 'In progress',
            ENDED: 'Ended',
        }[status] ?? status;
    };

    return (
        <section className="min-w-0 space-y-5 sm:space-y-6" aria-label={isAr ? 'ملخص التدريس' : 'Teaching summary'}>
            <div className="grid min-w-0 grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
                {metrics.map(({ icon: Icon, label, value }) => (
                    <div key={label} className="min-w-0 rounded-2xl border border-white/10 bg-brand-navy-dark p-3 sm:p-5">
                        <div className="mb-2 sm:mb-3 flex min-w-0 items-center gap-2 sm:gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-gold/10 text-brand-gold-light sm:h-10 sm:w-10">
                                <Icon size={18} />
                            </span>
                            <p className="min-w-0 text-[11px] leading-snug font-bold text-gray-400 sm:text-sm">{label}</p>
                        </div>
                        <p className="text-2xl font-black text-white sm:text-3xl">
                            {loading ? '…' : (value ?? '—')}
                        </p>
                    </div>
                ))}
            </div>

            {error && (
                <div role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm font-semibold text-red-400">
                    {error}
                </div>
            )}

            <section aria-label={isAr ? 'تقارير الدفعات' : 'Batch reports'} className="space-y-4">
                <h2 className="text-lg font-black text-white">{isAr ? 'متابعة الدفعات' : 'Batch progress'}</h2>
                {loading ? (
                    <p className="rounded-2xl border border-white/10 bg-brand-navy-dark p-5 text-center text-sm text-gray-400">
                        {isAr ? 'جارٍ تحميل التقارير...' : 'Loading reports...'}
                    </p>
                ) : data?.openingReports.length ? (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {data.openingReports.map((report) => (
                            <Link
                                key={report.id}
                                href={`/dashboard/teaching/${report.id}`}
                                className="rounded-2xl border border-white/10 bg-brand-navy-dark p-5 transition hover:border-brand-gold/30"
                            >
                                <div className="mb-4 min-w-0">
                                    <p className="truncate font-black text-white">{pick(report.course, 'title')}</p>
                                    <p className="mt-1 truncate text-sm text-gray-400">
                                        {pick(report, 'name') || (isAr ? 'دفعة بدون اسم' : 'Unnamed batch')}
                                    </p>
                                </div>
                                <div className="grid grid-cols-2 gap-3 text-sm">
                                    <div className="rounded-xl bg-white/[0.04] p-3">
                                        <p className="text-gray-400">{isAr ? 'الحضور' : 'Attendance'}</p>
                                        <p className="mt-1 font-black text-white">
                                            {report.attendanceRate === null ? '—' : `${report.attendanceRate}%`}
                                        </p>
                                    </div>
                                    <div className="rounded-xl bg-white/[0.04] p-3">
                                        <p className="text-gray-400">{isAr ? 'تسليم الواجبات' : 'Task submissions'}</p>
                                        <p className="mt-1 font-black text-white">
                                            {report.taskSubmissionRate === null ? '—' : `${report.taskSubmissionRate}%`}
                                        </p>
                                    </div>
                                    <div className="rounded-xl bg-white/[0.04] p-3">
                                        <p className="text-gray-400">{isAr ? 'الطلاب المقبولون' : 'Approved students'}</p>
                                        <p className="mt-1 font-black text-white">{report.approvedStudentCount}</p>
                                    </div>
                                    <div className="rounded-xl bg-white/[0.04] p-3">
                                        <p className="text-gray-400">{isAr ? 'يحتاجون متابعة' : 'Need follow-up'}</p>
                                        <p className={`mt-1 font-black ${report.needsFollowUpCount ? 'text-amber-300' : 'text-white'}`}>
                                            {report.needsFollowUpCount}
                                        </p>
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                ) : (
                    <p className="rounded-2xl border border-white/10 bg-brand-navy-dark p-5 text-center text-sm text-gray-400">
                        {data?.openings.length
                            ? (isAr ? 'لم تُمنح صلاحية عرض التقارير في هذه الدفعات.' : 'You do not have batch-report access for these openings.')
                            : (isAr ? 'لا توجد دفعات لعرض تقاريرها.' : 'No batches available for reporting.')}
                    </p>
                )}
            </section>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-brand-navy-dark p-5">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <h2 className="text-lg font-black text-white">{isAr ? 'دفعاتي' : 'My batches'}</h2>
                        <Link href="/dashboard/teaching" className="text-sm font-bold text-brand-gold-light hover:underline">
                            {isAr ? 'إدارة التدريس' : 'Teaching hub'}
                        </Link>
                    </div>
                    {loading ? (
                        <p className="py-8 text-center text-sm text-gray-400">{isAr ? 'جارٍ التحميل...' : 'Loading...'}</p>
                    ) : data?.openings.length ? (
                        <div className="space-y-3">
                            {data.openings.map((opening) => (
                                <Link
                                    key={opening.id}
                                    href={`/dashboard/teaching/${opening.id}`}
                                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-brand-gold/30"
                                >
                                    <div className="min-w-0">
                                        <p className="truncate font-bold text-white">{pick(opening.course, 'title')}</p>
                                        <p className="mt-1 truncate text-xs text-gray-400">
                                            {pick(opening, 'name') || (isAr ? 'دفعة بدون اسم' : 'Unnamed batch')}
                                        </p>
                                    </div>
                                    <span className="shrink-0 rounded-full bg-white/5 px-3 py-1 text-xs font-bold text-gray-300">
                                        {statusLabel(opening.status)}
                                    </span>
                                </Link>
                            ))}
                        </div>
                    ) : (
                        <p className="py-8 text-center text-sm text-gray-400">
                            {isAr ? 'لا توجد دفعات مسندة إليك حالياً.' : 'No batches are assigned to you yet.'}
                        </p>
                    )}
                </div>

                <div className="rounded-2xl border border-white/10 bg-brand-navy-dark p-5">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <h2 className="text-lg font-black text-white">{isAr ? 'الجلسات القادمة' : 'Upcoming sessions'}</h2>
                        <CalendarDays size={18} className="text-brand-gold-light" />
                    </div>
                    {loading ? (
                        <p className="py-8 text-center text-sm text-gray-400">{isAr ? 'جارٍ التحميل...' : 'Loading...'}</p>
                    ) : data?.upcomingSessions.length ? (
                        <div className="space-y-3">
                            {data.upcomingSessions.map((session) => (
                                <Link
                                    key={session.id}
                                    href={`/dashboard/teaching/${session.opening.id}?tab=sessions`}
                                    className="block rounded-xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-brand-gold/30"
                                >
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="truncate font-bold text-white">{pick(session, 'title')}</p>
                                            <p className="mt-1 truncate text-xs text-gray-400">
                                                {pick(session.opening.course, 'title')} · {pick(session.opening, 'name') || (isAr ? 'دفعة' : 'Batch')}
                                            </p>
                                        </div>
                                        <time className="shrink-0 text-xs font-bold text-brand-gold-light">
                                            {new Date(session.scheduledAt).toLocaleString(isAr ? 'ar-SA' : 'en-US', {
                                                dateStyle: 'medium',
                                                timeStyle: 'short',
                                            })}
                                        </time>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    ) : (
                        <p className="py-8 text-center text-sm text-gray-400">
                            {isAr ? 'لا توجد جلسات مجدولة قادمة.' : 'No upcoming sessions are scheduled.'}
                        </p>
                    )}
                </div>
            </div>

            <Link
                href="/dashboard/submissions"
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-gold/20 bg-brand-gold/5 p-5 transition hover:bg-brand-gold/10"
            >
                <div>
                    <p className="font-black text-white">{isAr ? 'مراجعة التسليمات والدرجات' : 'Review submissions and grades'}</p>
                    <p className="mt-1 text-sm text-gray-400">
                        {isAr
                            ? `${data?.ungradedSubmissionCount ?? 0} تسليم بانتظار التصحيح`
                            : `${data?.ungradedSubmissionCount ?? 0} submissions awaiting grading`}
                    </p>
                </div>
                <ClipboardCheck size={20} className="text-brand-gold-light" />
            </Link>
        </section>
    );
}
