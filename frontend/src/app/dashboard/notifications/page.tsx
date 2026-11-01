"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ProtectedRoute from '@/components/ProtectedRoute';
import { api, getErrorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n-context';
import { useAuth } from '@/lib/auth-context';
import toast from 'react-hot-toast';
import { Bell, Loader, CheckCheck, Inbox, Settings2 } from 'lucide-react';

interface NotificationItem {
    id: string;
    type: string;
    titleAr?: string | null;
    titleEn?: string | null;
    bodyAr?: string | null;
    bodyEn?: string | null;
    data?: Record<string, unknown> | null;
    createdAt: string;
    readAt?: string | null;
}

interface NotificationPreferences {
    taskRemindersEnabled: boolean;
    sessionRemindersEnabled: boolean;
    instructorFollowUpEnabled: boolean;
}

export default function NotificationsPage() {
    const { t, locale } = useI18n();
    const { user } = useAuth();
    const [items, setItems] = useState<NotificationItem[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
    const [savingPreference, setSavingPreference] = useState<keyof NotificationPreferences | null>(null);
    const [preferencesLoadError, setPreferencesLoadError] = useState(false);

    useEffect(() => {
        let active = true;
        const load = async (initial = false) => {
            try {
                const res = await api.get('/notifications');
                if (active) setItems(res.data || []);
            } catch (error) {
                if (active && initial) {
                    setItems([]);
                    toast.error(getErrorMessage(error) || t('notifications.fail'));
                }
            } finally {
                if (active && initial) setLoading(false);
            }
        };
        void load(true);
        const timer = setInterval(() => {
            if (document.visibilityState === 'visible') void load();
        }, 30000);
        const refreshOnFocus = () => { void load(); };
        window.addEventListener('focus', refreshOnFocus);
        return () => {
            active = false;
            clearInterval(timer);
            window.removeEventListener('focus', refreshOnFocus);
        };
    }, [t]);

    useEffect(() => {
        if (user?.role !== 'STUDENT' && user?.role !== 'INSTRUCTOR') return;
        let active = true;
        api.get('/notifications/preferences')
            .then((res) => {
                if (active) {
                    setPreferences(res.data);
                    setPreferencesLoadError(false);
                }
            })
            .catch((error) => {
                if (active) {
                    setPreferencesLoadError(true);
                    toast.error(getErrorMessage(error) || t('notifications.preferences_fail'));
                }
            });
        return () => { active = false; };
    }, [t, user?.role]);

    const updatePreference = async (key: keyof NotificationPreferences, value: boolean) => {
        setSavingPreference(key);
        try {
            const res = await api.patch('/notifications/preferences', { [key]: value });
            setPreferences(res.data);
        } catch (error) {
            toast.error(getErrorMessage(error) || t('notifications.preferences_fail'));
        } finally {
            setSavingPreference(null);
        }
    };

    const title = (n: NotificationItem) =>
        locale === 'ar' ? (n.titleAr || n.titleEn || '') : (n.titleEn || n.titleAr || '');
    const body = (n: NotificationItem) =>
        locale === 'ar' ? (n.bodyAr || n.bodyEn || '') : (n.bodyEn || n.bodyAr || '');
    const actionHref = (n: NotificationItem) => {
        const openingId = typeof n.data?.openingId === 'string' ? n.data.openingId : null;
        if (n.type === 'task.deadline-reminder' && openingId) {
            return `/dashboard/tasks?openingId=${encodeURIComponent(openingId)}`;
        }
        if (n.type === 'session.reminder' && typeof n.data?.courseId === 'string') {
            return `/dashboard/courses/${encodeURIComponent(n.data.courseId)}/player`;
        }
        if (n.type === 'instructor.daily-follow-up') return '/dashboard/teaching';
        return null;
    };

    const markRead = async (id: string) => {
        try {
            await api.patch(`/notifications/${id}/read`);
            setItems(prev => (prev || []).map(n => n.id === id ? { ...n, readAt: new Date().toISOString() } : n));
        } catch (e) {
            toast.error(getErrorMessage(e) || t('notifications.fail'));
        }
    };

    const markAllRead = async () => {
        try {
            await api.patch('/notifications/read-all');
            setItems(prev => (prev || []).map(n => n.readAt ? n : { ...n, readAt: new Date().toISOString() }));
        } catch (e) {
            toast.error(getErrorMessage(e) || t('notifications.fail'));
        }
    };

    const unreadCount = (items || []).filter(n => !n.readAt).length;

    return (
        <ProtectedRoute allowedRoles={['STUDENT', 'INSTRUCTOR', 'COURSE_MANAGER', 'FINANCE', 'ADMIN']}>
            <div className="bg-white dark:bg-brand-navy-dark p-4 sm:p-6 lg:p-8 rounded-3xl shadow-sm border border-gray-200 dark:border-white/5 min-h-[80vh]">
                <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <h2 className="text-3xl font-black text-brand-navy dark:text-white flex items-center gap-3">
                            <Bell size={32} className="text-brand-gold-dark dark:text-brand-gold-light" /> {t('notifications.heading')}
                        </h2>
                        <p className="text-gray-500 dark:text-gray-400 mt-2">{t('notifications.subtitle')}</p>
                    </div>
                    {unreadCount > 0 && (
                        <button onClick={markAllRead} className="inline-flex items-center gap-2 text-sm font-bold text-brand-gold-dark dark:text-brand-gold-light bg-brand-gold/10 hover:bg-brand-gold/20 px-4 py-2.5 rounded-xl transition">
                            <CheckCheck size={16} /> {t('notifications.mark_all')}
                        </button>
                    )}
                </div>

                {user?.role === 'STUDENT' || user?.role === 'INSTRUCTOR' ? (
                    <section className="mb-8 rounded-2xl border border-white/10 bg-brand-navy-dark p-5" aria-labelledby="notification-preferences-heading">
                        <div className="mb-4 flex items-center gap-3">
                            <Settings2 size={20} className="text-brand-gold-light" />
                            <h3 id="notification-preferences-heading" className="font-black text-white">
                                {t('notifications.preferences_heading')}
                            </h3>
                        </div>
                        {preferences ? (
                            <div className="grid gap-3 sm:grid-cols-2">
                                {(user.role === 'STUDENT'
                                    ? [
                                        ['taskRemindersEnabled', 'task_reminders'],
                                        ['sessionRemindersEnabled', 'session_reminders'],
                                    ] as const
                                    : [['instructorFollowUpEnabled', 'instructor_follow_up']] as const
                                ).map(([key, label]) => (
                                    <label key={key} className="flex cursor-pointer items-center justify-between gap-4 rounded-xl bg-white/[0.04] p-4 text-sm font-semibold text-gray-200">
                                        <span>{t(`notifications.${label}`)}</span>
                                        <input
                                            type="checkbox"
                                            checked={preferences[key]}
                                            disabled={savingPreference !== null}
                                            onChange={(event) => void updatePreference(key, event.target.checked)}
                                            className="h-5 w-5 accent-amber-400"
                                        />
                                    </label>
                                ))}
                            </div>
                        ) : preferencesLoadError ? (
                            <p role="alert" className="text-sm text-red-400">{t('notifications.preferences_fail')}</p>
                        ) : (
                            <p className="text-sm text-gray-400">{t('notifications.preferences_loading')}</p>
                        )}
                    </section>
                ) : null}

                {loading ? (
                    <div className="h-40 flex items-center justify-center font-bold text-gray-500 dark:text-gray-400">
                        <Loader className="animate-spin text-brand-gold-dark dark:text-brand-gold-light" size={32} />
                    </div>
                ) : !items || items.length === 0 ? (
                    <div className="h-56 flex flex-col items-center justify-center text-center text-gray-500 dark:text-gray-400">
                        <Inbox size={44} className="mb-3 text-gray-400 dark:text-gray-500" />
                        <p className="font-bold">{t('notifications.empty')}</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {items.map(n => {
                            const href = actionHref(n);
                            const content = (
                                <>
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-[11px] font-black uppercase tracking-wider text-gray-400 bg-white/5 px-2.5 py-0.5 rounded-full">
                                                {n.type}
                                            </span>
                                            {!n.readAt && <span className="w-2 h-2 rounded-full bg-brand-gold-light" />}
                                        </div>
                                        <span className="text-[11px] text-gray-500 font-semibold shrink-0">
                                            {new Date(n.createdAt).toLocaleString()}
                                        </span>
                                    </div>
                                    <h3 className="font-bold text-white mt-2">{title(n)}</h3>
                                    {body(n) && <p className="text-sm text-gray-300 mt-1 leading-relaxed">{body(n)}</p>}
                                    {href && (
                                        <span className="inline-block mt-3 text-sm font-bold text-brand-gold-light">
                                            {locale === 'ar' ? 'عرض التفاصيل' : 'View details'}
                                        </span>
                                    )}
                                </>
                            );
                            const className = `w-full text-left p-5 rounded-2xl border transition ${
                                    n.readAt
                                        ? 'bg-brand-navy border-gray-200 dark:border-white/5 opacity-75'
                                        : 'bg-brand-navy-dark border-brand-gold/30 hover:border-brand-gold/60'
                                }`;
                            return href ? (
                                <Link
                                    key={n.id}
                                    href={href}
                                    onClick={() => { if (!n.readAt) void markRead(n.id); }}
                                    className={className}
                                >
                                    {content}
                                </Link>
                            ) : (
                                <button
                                    key={n.id}
                                    onClick={() => { if (!n.readAt) void markRead(n.id); }}
                                    className={className}
                                >
                                    {content}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </ProtectedRoute>
    );
}
