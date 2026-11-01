"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useI18n } from '@/lib/i18n-context';
import { useTheme } from '@/lib/theme-context';
import { api, getErrorMessage } from '@/lib/api';
import { buildNavLinks, groupInstructorNavLinks, groupStudentNavLinks } from '@/lib/nav-links';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import ThemeToggle from '@/components/ThemeToggle';
import { LogOut } from 'lucide-react';

export default function Sidebar() {
    const pathname = usePathname();
    const { user, logout } = useAuth();
    const { t } = useI18n();
    const { dark } = useTheme();
    const [unread, setUnread] = useState(0);
    const [notificationsUnread, setNotificationsUnread] = useState(0);
    const [unreadError, setUnreadError] = useState<string | null>(null);

    useEffect(() => {
        if (!user) return;
        let active = true;
        const load = async () => {
            setUnreadError(null);
            try {
                const [msgRes, notifRes] = await Promise.all([
                    api.get('/messages/unread-count'),
                    api.get('/notifications/unread-count'),
                ]);
                if (active) {
                    setUnread(msgRes.data?.count ?? 0);
                    setNotificationsUnread(notifRes.data?.count ?? 0);
                }
            } catch (error) {
                if (active) setUnreadError(getErrorMessage(error) || t('common.error'));
            }
        };
        load();
        const timer = setInterval(load, 15000);
        return () => { active = false; clearInterval(timer); };
    }, [user, t]);

    if (!user) return null;

    const roleKey = (user.role || '').toUpperCase();
    const allNav = buildNavLinks(t);
    const roleLinks = allNav.filter(link => link.roles.some(r => r.toUpperCase() === roleKey));
    const links = roleLinks.length > 0
        ? roleLinks
        : allNav.filter(link => ['/dashboard', '/dashboard/profile', '/dashboard/support'].includes(link.href));
    const sections = roleKey === 'STUDENT'
        ? groupStudentNavLinks(links, t)
        : roleKey === 'INSTRUCTOR'
            ? groupInstructorNavLinks(links, t)
            : [{ title: '', links }];

    return (
        <aside className={`sticky top-0 hidden h-screen w-64 shrink-0 flex-col justify-between lg:flex ${dark ? 'bg-gradient-to-b from-brand-navy via-[#0e2a52] to-[#0a1e3c]' : 'border-r border-line bg-surface-raised shadow-sm'}`}>
            <div className="flex min-h-0 flex-1 flex-col">
                <div className={`p-5 border-b ${'border-line'}`}>
                    <div className="flex flex-col gap-2">
                        <img
                            src={dark ? '/logos/LaxaLab_Academy_Horizontal_Reverse_4K.png' : '/logos/LaxaLab_Academy_Horizontal_Primary_4K.png'}
                            alt="Laxalab Academy"
                            className="h-10 w-auto object-contain mx-auto"
                        />
                        <span className={`text-[10px] text-center font-black uppercase tracking-[0.2em] ${dark ? 'text-ink-muted' : 'text-ink'}`}>
                            {t('roles.' + user.role.toLowerCase())}
                        </span>
                    </div>
                </div>

                <nav aria-label={t('sidebar.navigation')} className="min-h-0 space-y-3 overflow-y-auto p-4">
                    {sections.map((section) => (
                        <div key={section.title || 'navigation-links'} className="space-y-1">
                            {section.title && (
                                <h2 className="px-3.5 pb-1 pt-2 text-[10px] font-black uppercase tracking-wider text-ink-muted/70">
                                    {section.title}
                                </h2>
                            )}
                            {section.links.map((link) => {
                                const isActive = (pathname.startsWith(link.href) && link.href !== '/dashboard') || pathname === link.href;
                                const Icon = link.icon;
                                return (
                                    <Link key={link.href} href={link.href}>
                                        <div className={`group relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 font-bold transition-all duration-200 ${isActive
                                                ? dark ? 'bg-gradient-to-r from-brand-gold/20 to-transparent text-gold-ink shadow-inner' : 'bg-brand-gold/10 text-gold-ink shadow-inner'
                                                : 'text-ink-muted hover:bg-ink/[0.06] hover:text-ink'
                                            }`}>
                                            {isActive && <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-brand-gold" />}
                                            <Icon size={19} className={`transition-colors ${isActive ? 'text-accent' : dark ? 'text-ink-muted group-hover:text-ink-muted' : 'text-ink group-hover:text-ink'}`} />
                                            <span>{link.name}</span>
                                            {link.href === '/dashboard/inbox' && unread > 0 && (
                                                <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-gold px-1.5 text-[10px] font-black text-ink-on-gold">
                                                    {unread}
                                                </span>
                                            )}
                                            {link.href === '/dashboard/notifications' && notificationsUnread > 0 && (
                                                <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-gold px-1.5 text-[10px] font-black text-ink-on-gold">
                                                    {notificationsUnread}
                                                </span>
                                            )}
                                        </div>
                                    </Link>
                                );
                            })}
                        </div>
                    ))}
                    {unreadError && (
                        <p role="alert" className="px-3.5 py-2 text-xs font-semibold text-danger">
                            {unreadError}
                        </p>
                    )}
                </nav>
            </div>

            <div className={`p-4 border-t space-y-4 ${'border-line'}`}>
                <LanguageSwitcher />
                <ThemeToggle />
                <button
                    onClick={logout}
                    className="flex items-center gap-3 w-full px-3.5 py-3 rounded-xl transition-colors font-bold text-danger hover:bg-danger-soft"
                >
                    <LogOut size={19} className="rtl:rotate-180" />
                    <span>{t('sidebar.logout')}</span>
                </button>
            </div>
        </aside>
    );
}