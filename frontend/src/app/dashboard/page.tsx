"use client";

import { useAuth } from '@/lib/auth-context';
import { useFetchData } from '@/lib/useFetchData';
import { useI18n } from '@/lib/i18n-context';
import { Activity, BookOpen, Clock, Compass, GraduationCap, LifeBuoy } from 'lucide-react';
import Link from 'next/link';
import { StatCard } from '@/app/dashboard/admin/components';
import StudentAnnouncements from '@/components/StudentAnnouncements';
import GamificationPanel from '@/components/GamificationPanel';
import InstructorDashboard from '@/components/InstructorDashboard';
import LearningAnalytics from '@/components/LearningAnalytics';
import LearningPathList from '@/components/LearningPathList';
import AnnouncementBanner from '@/components/AnnouncementBanner';

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

    const isInstructor = user?.role === 'INSTRUCTOR';
    const canSeePending = user && (user.role === 'FINANCE' || user.role === 'ADMIN');
    const { data: coursesData, loading: coursesLoading, error: coursesError } = useFetchData<unknown[]>(isInstructor ? null : '/courses');
    const { data: pending, loading: pendingLoading } = useFetchData<unknown[]>(canSeePending ? '/enrollments/pending' : null);
    const { data: health } = useFetchData<HealthResponse>(isInstructor ? null : '/health');
    const { data: me } = useFetchData<MeProfile>('/users/me');

    if (!user) return null;

    const roleLabel = t('roles.' + (user.role || '').toLowerCase()) || user.role;

    const gender = (me?.metadata?.gender as string) || '';
    const fullName = (me?.metadata?.fullName as string) || '';
    const honorific = gender === 'FEMALE' ? t('dashboard.engineer_label_female') : t('dashboard.engineer_label');
    const displayName = `${honorific} ${fullName}`.trim() || user.email;

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
                    <p className="break-words text-sm sm:text-base text-gray-400 mt-2 font-semibold">
                        {t('dashboard.secure_login')}{' '}
                        <span className="font-black text-brand-gold-light">{roleLabel}</span>{' '}
                        {t('dashboard.permissions')}
                    </p>
                </div>
            </div>

            <div className="min-w-0">
                <AnnouncementBanner variant="dashboard" />
            </div>

            {/* Metrics Row */}
            {!isInstructor && (
                <div className="grid min-w-0 grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 animate-fade-in-up">
                    {metrics.map((m) => (
                        <StatCard key={m.label} icon={m.icon} color={m.color} value={m.value} label={m.label} accent />
                    ))}
                </div>
            )}

            {/* Error or Dashboard specific elements */}
            {coursesError && (
                <div className="p-4 text-red-600 dark:text-red-400 rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 font-semibold">
                    {t('dashboard.failed_metrics')} {coursesError}
                </div>
            )}

            {/* Quick Actions (students) */}
            {user.role === 'STUDENT' && (
                <div className="animate-fade-in-up">
                    <h3 className="text-xl font-black text-brand-navy dark:text-white mb-4">{t('dashboard.quick_actions')}</h3>
                    <div className="grid min-w-0 grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                        <Link href="/dashboard/explore" className="group bg-brand-navy-dark border border-white/5 rounded-2xl p-6 hover:border-brand-gold/20 hover:shadow-xl hover:-translate-y-0.5 transition-all">
                            <div className="w-12 h-12 rounded-2xl bg-brand-gold/10 text-brand-gold-light flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                <Compass size={24} />
                            </div>
                            <div className="font-black text-white">{t('landing.explore_courses')}</div>
                            <div className="text-sm text-gray-400 mt-1">{t('dashboard.explore_desc')}</div>
                        </Link>
                        <Link href="/dashboard/my-courses" className="group bg-brand-navy-dark border border-white/5 rounded-2xl p-6 hover:border-brand-gold/20 hover:shadow-xl hover:-translate-y-0.5 transition-all">
                            <div className="w-12 h-12 rounded-2xl bg-brand-gold/10 text-brand-gold-light flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                <BookOpen size={24} />
                            </div>
                            <div className="font-black text-white">{t('sidebar.my_courses')}</div>
                            <div className="text-sm text-gray-400 mt-1">{t('dashboard.my_courses_desc')}</div>
                        </Link>
                        <Link href="/dashboard/my-grades" className="group bg-brand-navy-dark border border-white/5 rounded-2xl p-6 hover:border-brand-gold/20 hover:shadow-xl hover:-translate-y-0.5 transition-all">
                            <div className="w-12 h-12 rounded-2xl bg-brand-gold/10 text-brand-gold-light flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                <GraduationCap size={24} />
                            </div>
                            <div className="font-black text-white">{t('sidebar.my_grades')}</div>
                            <div className="text-sm text-gray-400 mt-1">{t('dashboard.my_grades_desc')}</div>
                        </Link>
                        <Link href="/dashboard/support" className="group bg-brand-navy-dark border border-white/5 rounded-2xl p-6 hover:border-brand-gold/20 hover:shadow-xl hover:-translate-y-0.5 transition-all">
                            <div className="w-12 h-12 rounded-2xl bg-brand-gold/10 text-brand-gold-light flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                <LifeBuoy size={24} />
                            </div>
                            <div className="font-black text-white">{t('sidebar.support')}</div>
                            <div className="text-sm text-gray-400 mt-1">{t('dashboard.support_desc')}</div>
                        </Link>
                    </div>
                </div>
            )}

            {/* Content Area */}
            <div className="space-y-6 animate-fade-in-up">
                {user.role === 'STUDENT' ? (
                    <>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <StudentAnnouncements />
                            <GamificationPanel />
                        </div>
                        <LearningAnalytics />
                        <LearningPathList mode="browse" />
                    </>
                ) : user.role === 'INSTRUCTOR' ? (
                    <InstructorDashboard />
                ) : (
                    <div className="bg-white dark:bg-brand-navy-dark border border-gray-200 dark:border-white/5 rounded-3xl p-4 sm:p-6 lg:p-8 min-h-[400px] shadow-sm">
                        <h3 className="text-xl font-black text-brand-navy dark:text-white mb-6">{t('dashboard.recent_activity')}</h3>
                        <div className="flex items-center justify-center text-gray-500 dark:text-gray-400 h-64 border-2 border-dashed border-gray-300 dark:border-white/10 rounded-2xl bg-gray-100 dark:bg-white/5 font-semibold">
                            {t('dashboard.detailed_metrics')}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
