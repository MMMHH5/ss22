"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Menu, X, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useI18n } from '@/lib/i18n-context';
import { useTheme } from '@/lib/theme-context';
import { buildNavLinks, groupStudentNavLinks } from '@/lib/nav-links';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import ThemeToggle from '@/components/ThemeToggle';
import { createPortal } from 'react-dom';
import { CalendarClock, Users as UsersIcon, Newspaper, CreditCard, Settings, LifeBuoy, CalendarPlus, MessageCircle, Megaphone } from 'lucide-react';

const ADMIN_EXTRA_LINKS = [
    { href: '/dashboard/admin/openings', icon: CalendarClock, roles: ['COURSE_MANAGER', 'ADMIN'] },
    { href: '/dashboard/admin/users', icon: UsersIcon, roles: ['ADMIN'] },
    { href: '/dashboard/admin/blog', icon: Newspaper, roles: ['COURSE_MANAGER', 'ADMIN'] },
    { href: '/dashboard/admin/gateways', icon: CreditCard, roles: ['ADMIN'] },
    { href: '/dashboard/admin/system', icon: Settings, roles: ['ADMIN'] },
    { href: '/dashboard/admin/tickets', icon: LifeBuoy, roles: ['COURSE_MANAGER', 'ADMIN'] },
    { href: '/dashboard/admin/requests', icon: CalendarPlus, roles: ['COURSE_MANAGER', 'ADMIN'] },
    { href: '/dashboard/admin/chats', icon: MessageCircle, roles: ['COURSE_MANAGER', 'ADMIN'] },
    { href: '/dashboard/admin/announcements', icon: Megaphone, roles: ['COURSE_MANAGER', 'ADMIN'] },
] as Array<{ href: string; icon: typeof CalendarClock; roles: string[] }>;

export default function MobileSidebar() {
    const { user, logout } = useAuth();
    const { t } = useI18n();
    const { dark } = useTheme();
    const pathname = usePathname();
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (!open) return;

        const previousOverflow = document.body.style.overflow;
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };

        document.body.style.overflow = 'hidden';
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [open]);

    if (!user) return null;

    const roleKey = (user.role || '').toUpperCase();
    const allNav = buildNavLinks(t);
    const roleLinks = allNav.filter(link => link.roles.some(r => r.toUpperCase() === roleKey));
    const links = roleLinks.length > 0
        ? roleLinks
        : allNav.filter(link => ['/dashboard', '/dashboard/profile', '/dashboard/support'].includes(link.href));
    const sections = roleKey === 'STUDENT' ? groupStudentNavLinks(links, t) : [{ title: '', links }];
    const adminLinks = pathname?.startsWith('/dashboard/admin')
        ? ADMIN_EXTRA_LINKS.filter(l => l.roles.includes(roleKey)).map(l => ({ ...l, name: t('admin.nav_' + l.href.split('/').pop()) }))
        : [];

    return (
        <>
            <button
                onClick={() => setOpen(true)}
                className="lg:hidden p-2 text-ink hover:bg-ink/[0.06] rounded-xl transition"
                aria-label="Open navigation menu"
                aria-expanded={open}
                aria-controls="mobile-navigation"
            >
                <Menu size={24} />
            </button>

            {open && createPortal(
                <div className="fixed inset-0 z-50 lg:hidden">
                    <div className="fixed inset-0 bg-black/50" onClick={() => setOpen(false)} />
                    <div id="mobile-navigation" role="dialog" aria-modal="true" aria-label="Navigation menu" className={`fixed top-0 bottom-0 start-0 w-[min(85%,20rem)] overflow-y-auto overscroll-contain shadow-2xl ${dark ? 'bg-surface-sunken text-ink' : 'bg-surface-raised text-ink'}`}>
                        <div className={`flex items-center justify-between p-5 border-b ${'border-line'}`}>
                            <div className="flex items-center gap-3">
                                <img
                                    src={dark ? '/logos/LaxaLab_Academy_Horizontal_Reverse_4K.png' : '/logos/LaxaLab_Academy_Horizontal_Primary_4K.png'}
                                    alt="Laxalab Academy"
                                    className="h-8 w-auto object-contain"
                                />
                            </div>
                            <button onClick={() => setOpen(false)} className="transition text-ink hover:text-ink" aria-label="Close">
                                <X size={24} />
                            </button>
                        </div>

                        <div className="p-4 space-y-2">
                            {sections.map((section) => (
                                <div key={section.title || 'navigation-links'} className="space-y-1">
                                    {section.title && (
                                        <h2 className="px-3.5 pb-1 pt-3 text-[10px] font-black uppercase tracking-wider text-ink-muted/70">
                                            {section.title}
                                        </h2>
                                    )}
                                    {section.links.map((link) => {
                                        const isActive = (pathname.startsWith(link.href) && link.href !== '/dashboard') || pathname === link.href;
                                        const Icon = link.icon;
                                        return (
                                            <Link key={link.href} href={link.href} onClick={() => setOpen(false)}>
                                                <div className={`flex items-center gap-3 rounded-xl px-3.5 py-3 font-bold transition-colors ${isActive
                                                        ? dark ? 'bg-brand-gold/20 text-gold-ink' : 'bg-brand-gold/10 text-gold-ink'
                                                        : 'text-ink-muted hover:bg-ink/[0.06] hover:text-ink'
                                                    }`}>
                                                    <Icon size={19} />
                                                    <span>{link.name}</span>
                                                </div>
                                            </Link>
                                        );
                                    })}
                                </div>
                            ))}
                            {adminLinks.map((link) => {
                                const isActive = pathname.startsWith(link.href);
                                const Icon = link.icon;
                                return (
                                    <Link key={link.href} href={link.href} onClick={() => setOpen(false)}>
                                        <div className={`flex items-center gap-3 px-3.5 py-3 rounded-xl font-bold transition-colors ${isActive
                                                ? dark ? 'bg-brand-gold/20 text-gold-ink' : 'bg-brand-gold/10 text-gold-ink'
                                                : 'text-ink-muted hover:bg-ink/[0.06] hover:text-ink'
                                            }`}>
                                            <Icon size={19} />
                                            <span>{link.name}</span>
                                        </div>
                                    </Link>
                                );
                            })}
                        </div>

                        <div className={`p-4 border-t space-y-4 ${'border-line'}`}>
                            <LanguageSwitcher />
                            <ThemeToggle />
                            <button onClick={logout} className="flex items-center gap-3 w-full px-3.5 py-3 rounded-xl transition-colors font-bold text-danger hover:bg-danger-soft">
                                <LogOut size={19} className="rtl:rotate-180" />
                                <span>{t('sidebar.logout')}</span>
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}