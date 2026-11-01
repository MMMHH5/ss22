"use client";

import { useAuth } from '@/lib/auth-context';
import { useFetchData } from '@/lib/useFetchData';
import { useI18n } from '@/lib/i18n-context';
import { Activity, BookOpen, Clock, ChevronDown } from 'lucide-react';
import { StatCard } from '@/app/dashboard/admin/components';
import StudentAnnouncements from '@/components/StudentAnnouncements';
import GamificationPanel from '@/components/GamificationPanel';
import InstructorDashboard from '@/components/InstructorDashboard';
import LearningAnalytics from '@/components/LearningAnalytics';
import LearningPathList from '@/components/LearningPathList';
import AnnouncementBanner from '@/components/AnnouncementBanner';
import StudentDashboardOverview from '@/components/StudentDashboardOverview';

interface HealthResponse {
    status?: string;
}

interface MeProfile {
    id: string;
    email: string;
    role: string;
    metadata?: Record<string, unknown>;
}

export default function DashboardPage() {
    const { user } = useAuth();
    const { t } = useI18n();

    const isStudent = user?.role === 'STUDENT';
    const isInstructor = user?.role === 'INSTRUCTOR';
    const canSeePending = user && (user.role === 'FINANCE' || user.role === 'ADMIN');
    const { data: coursesData, loading: coursesLoading, error: coursesError } = useFetchData<unknown[]>(isInstructor || isStudent ? null : '/courses');
    const { data: pending, loading: pendingLoading } = useFetchData<unknown[]>(canSeePending ? '/enrollments/pending' : null);
    const { data: health } = useFetchData<HealthResponse>(isInstructor || isStudent ? null : '/health');
    const { data: me } = useFetchData<MeProfile>('/users/me');

    if (!user) return null;

    const roleLabel = t('roles.' + (user.role || '').toLowerCase()) || user.role;

    const gender = (me?.metadata?.gender as string) || '';
    const fullName = (me?.metadata?.fullName as string) || '';
    const honorific = gender === 'FEMALE' ? t('dashboard.engineer_label_female') : t('dashboard.engineer_label');
    const displayName = isStudent ? fullName || user.email : `${honorific} ${fullName}`.trim() || user.email;

    const metrics: { label: string; value: string | number; icon: typeof Activity; color: string }[] = [
        {
            label: t('dashboard.system_status'),
            value: health ? (health.status === 'ok' ? t('dashboard.online') : t('dashboard.offline')) : '...',
            icon: Activity,
            color: 'green',
        },
        {
            label: t('dashboard.platform_courses'),
            value: coursesLoading ? '...' : (coursesData ? coursesData.length : 0),
            icon: BookOpen,
            color: 'navy',
        },
    ];

    if (canSeePending) {
        metrics.push({
            label: t('dashboard.pending_review'),
            value: pendingLoading ? '...' : (pending ? pending.length : 0),
            icon: Clock,
            color: 'amber',
        });
    }

    return (
        <div className="mx-auto w-full min-w-0 max-w-6xl space-y-5 sm:space-y-6">
            {/* Welcome Banner */}
            <div className="relative min-w-0 overflow-hidden bg-gradient-to-br from-brand-navy via-brand-navy-light to-brand-navy rounded-2xl sm:rounded-3xl p-4 sm:p-6 lg:p-8 text-white shadow-lg shadow-black/20 animate-fade-in">
                <div className="absolute -top-16 -right-16 w-64 h-64 bg-brand-gold/10 rounded-full blur-3xl" />
                <div className="absolute -bottom-20 -left-10 w-72 h-72 bg-brand-gold/5 rounded-full blur-3xl" />
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-brand-gold via-brand-gold/40 to-transparent" />
                <div className="relative min-w-0">
                    <h1 className="break-words text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight leading-tight">
                        {t('dashboard.welcome_back')}, {displayName}
                    </h1>
                    <p className="mt-2 break-words text-sm font-semibold text-gray-400 sm:text-base">
                        {isStudent ? (
                            t('dashboard.student_welcome_subtitle')
                        ) : (
                            <>
                                {t('dashboard.secure_login')}{' '}
                                <span className="font-black text-brand-gold-light">{roleLabel}</span>{' '}
                                {t('dashboard.permissions')}
                            </>
                        )}
                    </p>
                </div>
            </div>

            {isStudent ? (
                <StudentDashboardOverview />
            ) : (
                <>
                    <div className="min-w-0">
                        <AnnouncementBanner variant="dashboard" />
                    </div>
                    <div className="grid min-w-0 grid-cols-2 gap-3 animate-fade-in-up sm:gap-4 lg:grid-cols-3">
                        {metrics.map((m) => (
                            <StatCard key={m.label} icon={m.icon} color={m.color} value={m.value} label={m.label} accent />
                        ))}
                    </div>
                    {coursesError && (
                        <div className="rounded-xl border border-red-200 bg-red-50 p-4 font-semibold text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
                            {t('dashboard.failed_metrics')} {coursesError}
                        </div>
                    )}
                </>
            )}

            {isStudent ? (
                <div className="space-y-5 sm:space-y-6 animate-fade-in-up">
                    <AnnouncementBanner variant="dashboard" />
                    <StudentAnnouncements />
                    <details className="group rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-white/5 dark:bg-brand-navy-dark">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl p-4 font-black text-brand-navy marker:hidden hover:bg-gray-50 dark:text-white dark:hover:bg-white/[0.03] sm:p-5">
                            <span>{t('studentHome.optional_analytics')}</span>
                            <ChevronDown size={18} className="shrink-0 text-gray-500 transition-transform group-open:rotate-180" />
                        </summary>
                        <div className="border-t border-gray-200 p-3 dark:border-white/5 sm:p-5">
                            <LearningAnalytics />
                        </div>
                    </details>
                    <details className="group rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-white/5 dark:bg-brand-navy-dark">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl p-4 font-black text-brand-navy marker:hidden hover:bg-gray-50 dark:text-white dark:hover:bg-white/[0.03] sm:p-5">
                            <span>{t('studentHome.optional_achievements')}</span>
                            <ChevronDown size={18} className="shrink-0 text-gray-500 transition-transform group-open:rotate-180" />
                        </summary>
                        <div className="border-t border-gray-200 p-3 dark:border-white/5 sm:p-5">
                            <GamificationPanel />
                        </div>
                    </details>
                    <details className="group rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-white/5 dark:bg-brand-navy-dark">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl p-4 font-black text-brand-navy marker:hidden hover:bg-gray-50 dark:text-white dark:hover:bg-white/[0.03] sm:p-5">
                            <span>{t('studentHome.optional_paths')}</span>
                            <ChevronDown size={18} className="shrink-0 text-gray-500 transition-transform group-open:rotate-180" />
                        </summary>
                        <div className="border-t border-gray-200 p-3 dark:border-white/5 sm:p-5">
                            <LearningPathList mode="browse" />
                        </div>
                    </details>
                </div>
            ) : (
                <div className="space-y-6 animate-fade-in-up">
                    {isInstructor ? (
                        <InstructorDashboard />
                    ) : (
                        <div className="min-h-[400px] rounded-3xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/5 dark:bg-brand-navy-dark sm:p-6 lg:p-8">
                            <h3 className="mb-6 text-xl font-black text-brand-navy dark:text-white">{t('dashboard.recent_activity')}</h3>
                            <div className="flex h-64 items-center justify-center rounded-2xl border-2 border-dashed border-gray-300 bg-gray-100 font-semibold text-gray-500 dark:border-white/10 dark:bg-white/5 dark:text-gray-400">
                                {t('dashboard.detailed_metrics')}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
