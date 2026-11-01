"use client";

import ProtectedRoute from '@/components/ProtectedRoute';
import { useFetchData } from '@/lib/useFetchData';
import { useI18n } from '@/lib/i18n-context';
import { BookOpen, Clock, CheckCircle, XCircle, GraduationCap, Award, CreditCard, ChevronRight, Video } from 'lucide-react';
import StudentSessionList, { StudentLiveSession } from '@/components/StudentSessionList';
import Link from 'next/link';

interface Enrollment {
    id: string;
    status: string;
    createdAt: string;
    financeOfficerNotes?: string | null;
    course: {
        id: string;
        titleAr?: string | null;
        titleEn?: string | null;
        descriptionAr?: string | null;
        descriptionEn?: string | null;
    };
    opening?: {
        id?: string;
        status?: string | null;
        nameAr?: string | null;
        nameEn?: string | null;
        price: string;
        startDate?: string | null;
        endDate?: string | null;
        deliveryMode?: string | null;
    } | null;
    /** Only present when the batch is ONLINE and this enrollment is APPROVED. */
    meetLink?: string | null;
    /**
     * The batch's meeting schedule, already gated on the same rule as
     * `meetLink`: an empty array for anyone who is not APPROVED, and for a
     * student whose batch has no sessions yet.
     */
    liveSessions?: StudentLiveSession[];
}

interface GradeRow {
    id: string;
    score: number;
    assessment: { id: string; nameAr: string; nameEn: string; maxScore: number };
}

interface Assessment {
    id: string;
    nameAr: string;
    nameEn: string;
    maxScore: number;
}

interface GradedEnrollment {
    course: { id: string };
    opening?: { id: string } | null;
    grades: GradeRow[];
    assessments: Assessment[];
}

export default function MyCoursesPage() {
    const { data: enrollments, loading, error } = useFetchData<Enrollment[]>('/enrollments/my');
    const { data: gradesData } = useFetchData<GradedEnrollment[]>('/enrollments/my/grades');
    const { t, pick } = useI18n();

    const statusLabel = (status: string) => t('statuses.' + (status || '').toLowerCase()) || status;

    const isCompleted = (enrollment: Enrollment) =>
        enrollment.status === 'APPROVED' && enrollment.opening?.status === 'ENDED';

    /**
     * A reservation only becomes money owed once the opening is OPEN. This
     * mirrors the backend trigger in CoursesService.notifyReservedPaymentDue,
     * which fires on the transition into OPEN, and it is deliberately not
     * gated on `isPublished`: the payment page offers any OPEN/ANNOUNCEMENT
     * opening regardless of publication, so gating here would hide a payable
     * seat and leave the student with a notification but no way to act on it.
     */
    const paymentDue = (enrollment: Enrollment) =>
        enrollment.status === 'RESERVED' && enrollment.opening?.status === 'OPEN';

    const dueEnrollments = (enrollments ?? []).filter(paymentDue);

    const gradeByCourse = new Map<string, GradeRow[]>();
    const assessmentsByCourse = new Map<string, Assessment[]>();
    (gradesData || []).forEach(g => {
        gradeByCourse.set(g.course.id, g.grades || []);
        assessmentsByCourse.set(g.course.id, g.assessments || []);
    });

    const courseProgress = (courseId: string): number | null => {
        const total = assessmentsByCourse.get(courseId) || [];
        if (!total.length) return null;
        const done = (gradeByCourse.get(courseId) || []).length;
        return Math.min(100, Math.round((done / total.length) * 100));
    };

    const courseAvg = (courseId: string): number | null => {
        const rows = gradeByCourse.get(courseId) || [];
        if (!rows.length) return null;
        const pct = rows.reduce((sum, r) => sum + (r.assessment.maxScore > 0 ? (r.score / r.assessment.maxScore) * 100 : 0), 0) / rows.length;
        return Math.round(pct);
    };

    return (
        <ProtectedRoute allowedRoles={['STUDENT']}>
            <div className="min-w-0 bg-white dark:bg-brand-navy-dark p-4 sm:p-6 lg:p-8 rounded-2xl sm:rounded-3xl shadow-sm border border-gray-200 dark:border-white/5 min-h-[80vh]">
                <div className="mb-6 sm:mb-8">
                    <h2 className="text-2xl sm:text-3xl font-black text-brand-navy dark:text-white">{t('myCourses.heading')}</h2>
                    <p className="text-gray-500 dark:text-gray-400 mt-2">{t('myCourses.subtitle')}</p>
                </div>

                {error && <div className="p-4 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 rounded-xl mb-6">{error}</div>}

                {!loading && dueEnrollments.length > 0 && (
                    <div className="mb-6 p-5 rounded-2xl border border-brand-gold/30 bg-brand-gold/10 flex flex-wrap items-center gap-4 animate-fade-in">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-gold text-brand-navy-dark">
                            <CreditCard size={22} />
                        </span>
                        <div className="flex-1 min-w-[200px]">
                            <div className="font-black text-brand-navy dark:text-brand-gold-light">
                                {t('myCourses.payment_due_title').replace('{n}', String(dueEnrollments.length))}
                            </div>
                            <p className="text-sm text-gray-600 dark:text-gray-300 mt-0.5">{t('myCourses.payment_due_desc')}</p>
                        </div>
                        <Link
                            href="/dashboard/payments"
                            className="inline-flex items-center gap-2 bg-gradient-to-r from-brand-gold to-brand-gold-light text-brand-navy-dark text-sm font-black px-5 py-3 rounded-xl hover:shadow-lg hover:shadow-brand-gold/25 transition whitespace-nowrap"
                        >
                            {t('myCourses.payment_due_cta')}
                            <ChevronRight size={16} className="rtl:rotate-180" />
                        </Link>
                    </div>
                )}

                {loading ? (
                    <div className="h-40 flex items-center justify-center font-bold text-gray-500 dark:text-gray-400">{t('myCourses.loading')}</div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {enrollments?.map((enrollment) => (
                            <div key={enrollment.id} className="relative min-w-0 bg-brand-navy border border-white/5 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-sm hover:shadow-xl transition-all duration-300">
                                <div className="absolute -top-4 -right-4 w-24 h-24 bg-brand-gold/10 rounded-full blur-xl -z-10"></div>

                                <div className="flex flex-wrap justify-between items-start mb-4">
                                    <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                                        <div className="w-10 h-10 sm:w-12 sm:h-12 shrink-0 bg-brand-navy-dark rounded-xl sm:rounded-2xl flex items-center justify-center text-brand-gold-light shadow-sm">
                                            <BookOpen size={21} />
                                        </div>
                                        <div className="text-xs text-gray-400 font-semibold max-w-full min-w-0 truncate">
                                            {pick(enrollment.opening, 'name') && <span className="block text-white font-bold">{pick(enrollment.opening, 'name')}</span>}
                                            {enrollment.opening?.price != null && <span className="text-green-400 font-bold">${enrollment.opening.price}</span>}
                                        </div>
                                    </div>
                                    <span className={`px-3 py-1 text-xs font-bold rounded-full border ${
                                        isCompleted(enrollment) ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' :
                                        enrollment.status === 'APPROVED' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                                            enrollment.status === 'REJECTED' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                                                enrollment.status === 'RESERVED' ? 'bg-brand-navy-light/10 text-brand-navy-light border-brand-navy-light/20' :
                                                    'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                                    }`}>
                                        {isCompleted(enrollment) && <Award size={12} className="inline mr-1" />}
                                        {!isCompleted(enrollment) && enrollment.status === 'APPROVED' && <CheckCircle size={12} className="inline mr-1" />}
                                        {enrollment.status === 'REJECTED' && <XCircle size={12} className="inline mr-1" />}
                                        {enrollment.status === 'PENDING' && <Clock size={12} className="inline mr-1" />}
                                        {enrollment.status === 'RESERVED' && <Clock size={12} className="inline mr-1" />}
                                        {isCompleted(enrollment) ? t('statuses.completed') : statusLabel(enrollment.status)}
                                    </span>
                                </div>

                                <h3 className="text-lg sm:text-xl font-bold text-white mb-2 line-clamp-2">
                                    <Link href={`/courses/${enrollment.course.id}`} className="hover:text-brand-gold-light transition-colors">
                                        {pick(enrollment.course, 'title')}
                                    </Link>
                                </h3>
                                <p className="text-sm text-gray-400 line-clamp-3 mb-6">
                                    {pick(enrollment.course, 'description') || t('myCourses.no_description')}
                                </p>

                                <div className="pt-4 border-t border-white/5">
                                    {enrollment.liveSessions?.length ? (
                                        // A published schedule beats a bare "join"
                                        // button: the student can see what the next
                                        // session is and when it starts.
                                        <div className="mb-3">
                                            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-gray-400">
                                                <Video size={14} className="text-brand-gold-light" />
                                                {t('liveSessions.next_session')}
                                            </p>
                                            <StudentSessionList sessions={enrollment.liveSessions} limit={1} />
                                        </div>
                                    ) : enrollment.meetLink ? (
                                        <a
                                            href={enrollment.meetLink}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="mb-3 flex items-center justify-between bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/25 rounded-xl px-4 py-3 transition group"
                                        >
                                            <span className="flex items-center gap-2 text-sm font-bold text-emerald-300">
                                                <Video size={16} /> {t('myCourses.join_live')}
                                            </span>
                                            <span className="text-xs text-emerald-400/80 group-hover:text-emerald-300">
                                                {t('myCourses.online_batch')}
                                            </span>
                                        </a>
                                    ) : null}
                                    {enrollment.status === 'APPROVED' && courseProgress(enrollment.course.id) != null && (
                                        <div className="mb-3">
                                            <div className="flex items-center justify-between text-xs font-bold mb-1.5">
                                                <span className="text-gray-400 flex items-center gap-1.5">
                                                    <GraduationCap size={14} className="text-brand-gold-light" /> {t('myCourses.progress')}
                                                </span>
                                                <span className="text-brand-gold-light font-black">{courseProgress(enrollment.course.id)}%</span>
                                            </div>
                                            <div className="h-2.5 bg-white/5 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-gradient-to-r from-brand-gold to-brand-gold-light rounded-full transition-all duration-500"
                                                    style={{ width: `${courseProgress(enrollment.course.id)}%` }}
                                                />
                                            </div>
                                        </div>
                                    )}
                                    {enrollment.status === 'APPROVED' && courseAvg(enrollment.course.id) != null && (
                                        <div className="mb-3 flex items-center justify-between bg-white/5 rounded-xl px-4 py-2.5">
                                            <span className="text-xs font-bold text-gray-400 flex items-center gap-1.5">
                                                <GraduationCap size={14} className="text-brand-gold-light" /> {t('myCourses.average_score')}
                                            </span>
                                            <span className="text-sm font-black text-brand-gold-light">{courseAvg(enrollment.course.id)}%</span>
                                        </div>
                                    )}
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div className="text-xs text-gray-500 font-semibold min-w-0 truncate">
                                            {t('myCourses.enrolled_on')} {new Date(enrollment.createdAt).toLocaleDateString()}
                                        </div>
                                        {isCompleted(enrollment) ? (
                                            <div className="flex flex-wrap items-center gap-2">
                                                <Link href="/dashboard/my-grades" className="text-sm font-bold px-4 py-2 rounded-xl border border-white/10 text-white hover:border-purple-500 hover:text-purple-400 transition whitespace-nowrap">
                                                    {t('myCourses.view_grades')}
                                                </Link>
                                                <Link href={`/dashboard/profile?tab=certificates&courseId=${enrollment.course.id}`} className="bg-gradient-to-r from-purple-500 to-purple-600 text-white text-sm font-bold px-4 py-2 rounded-xl hover:from-purple-400 hover:to-purple-500 transition whitespace-nowrap flex items-center gap-1.5">
                                                    <Award size={14} /> {t('myCourses.view_certificate')}
                                                </Link>
                                            </div>
                                        ) : enrollment.status === 'APPROVED' ? (
                                            <div className="flex flex-wrap items-center gap-2">
                                                <Link href="/dashboard/my-grades" className="text-sm font-bold px-4 py-2 rounded-xl border border-white/10 text-white hover:border-brand-gold hover:text-brand-gold-light transition whitespace-nowrap">
                                                    {t('myCourses.view_grades')}
                                                </Link>
                                                <Link href={`/dashboard/courses/${enrollment.course.id}/player`} className="bg-gradient-to-r from-brand-gold to-brand-gold-dark text-black text-sm font-bold px-4 py-2 rounded-xl hover:from-brand-gold-light hover:to-brand-gold transition whitespace-nowrap">
                                                    {t('myCourses.continue')}
                                                </Link>
                                            </div>
                                        ) : paymentDue(enrollment) ? (
                                            <div className="flex flex-wrap items-center gap-2">
                                                <Link href="/dashboard/payments" className="bg-gradient-to-r from-brand-gold to-brand-gold-light text-black text-sm font-black px-4 py-2 rounded-xl hover:from-brand-gold-light hover:to-brand-gold transition whitespace-nowrap flex items-center gap-1.5">
                                                    <CreditCard size={14} /> {t('myCourses.pay_now')}
                                                </Link>
                                            </div>
                                        ) : enrollment.status === 'RESERVED' ? (
                                            <span className="text-xs font-semibold text-gray-400">{t('myCourses.reserved_waiting')}</span>
                                        ) : (
                                            <span className="text-xs font-semibold text-gray-500">{t('myCourses.locked')}</span>
                                        )}
                                    </div>
                                </div>
                                {enrollment.status === 'REJECTED' && enrollment.financeOfficerNotes && (
                                    <div className="mt-4 p-3 bg-red-500/10 rounded-xl text-xs text-red-400 border border-red-500/20">
                                        <strong>{t('myCourses.finance_note')}</strong> {enrollment.financeOfficerNotes}
                                    </div>
                                )}
                            </div>
                        ))}
                        {enrollments?.length === 0 && (
                            <div className="col-span-full text-center py-16 text-gray-500 dark:text-gray-400 font-semibold text-lg border-2 border-dashed border-gray-300 dark:border-white/10 rounded-xl bg-gray-100/50 dark:bg-transparent">
                                {t('myCourses.empty_title')}
                                <div className="mt-4">
                                    <Link href="/courses" className="text-brand-gold-dark dark:text-brand-gold-light hover:underline">{t('landing.explore_courses')}</Link>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </ProtectedRoute>
    );
}
