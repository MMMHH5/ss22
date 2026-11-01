import {
    LayoutDashboard,
    BookOpen,
    Users,
    CreditCard,
    ShieldAlert,
    Settings,
    MessageSquare,
    LifeBuoy,
    GraduationCap,
    Wallet,
    RotateCcw,
    Award,
    UserRound,
    ClipboardList,
    ClipboardCheck,
    MessagesSquare,
    CalendarClock,
    BadgeCheck,
    type LucideIcon,
} from 'lucide-react';

export interface NavLink {
    name: string;
    href: string;
    icon: LucideIcon;
    roles: string[];
}

export interface NavSection {
    title: string;
    links: NavLink[];
}

export function groupStudentNavLinks(
    links: NavLink[],
    t: (key: string) => string,
): NavSection[] {
    const sections = [
        {
            title: t('sidebar.nav_overview'),
            hrefs: ['/dashboard'],
        },
        {
            title: t('sidebar.nav_learning'),
            hrefs: ['/dashboard/explore', '/dashboard/my-courses', '/dashboard/my-grades', '/dashboard/tasks'],
        },
        {
            title: t('sidebar.nav_communication'),
            hrefs: ['/dashboard/inbox', '/dashboard/batch-chats', '/dashboard/notifications', '/dashboard/support'],
        },
        {
            title: t('sidebar.nav_account_payments'),
            hrefs: [
                '/dashboard/profile',
                '/dashboard/payments',
                '/dashboard/refunds',
                '/dashboard/profile?tab=certificates',
            ],
        },
    ];

    return sections.flatMap((section) => {
        const sectionLinks = section.hrefs
            .map((href) => links.find((link) => link.href === href))
            .filter((link): link is NavLink => !!link);
        return sectionLinks.length ? [{ title: section.title, links: sectionLinks }] : [];
    });
}

export function buildNavLinks(t: (key: string) => string): NavLink[] {
    return [
        { name: t('sidebar.dashboard'), href: '/dashboard', icon: LayoutDashboard, roles: ['STUDENT', 'INSTRUCTOR', 'COURSE_MANAGER', 'FINANCE', 'ADMIN'] },
        { name: t('sidebar.profile'), href: '/dashboard/profile', icon: UserRound, roles: ['STUDENT', 'INSTRUCTOR', 'COURSE_MANAGER', 'FINANCE', 'ADMIN'] },
        { name: t('landing.explore_courses'), href: '/dashboard/explore', icon: BookOpen, roles: ['STUDENT'] },
        { name: t('sidebar.my_courses'), href: '/dashboard/my-courses', icon: BookOpen, roles: ['STUDENT'] },
        { name: t('sidebar.my_grades'), href: '/dashboard/my-grades', icon: GraduationCap, roles: ['STUDENT'] },
        { name: t('sidebar.tasks'), href: '/dashboard/tasks', icon: ClipboardList, roles: ['STUDENT'] },
        { name: t('sidebar.payments'), href: '/dashboard/payments', icon: Wallet, roles: ['STUDENT'] },
        { name: t('sidebar.refunds'), href: '/dashboard/refunds', icon: RotateCcw, roles: ['STUDENT'] },
        { name: t('sidebar.certificates'), href: '/dashboard/profile?tab=certificates', icon: Award, roles: ['STUDENT'] },
        { name: t('sidebar.inbox'), href: '/dashboard/inbox', icon: MessageSquare, roles: ['STUDENT', 'INSTRUCTOR', 'COURSE_MANAGER', 'FINANCE', 'ADMIN'] },
        { name: t('sidebar.batch_chats'), href: '/dashboard/batch-chats', icon: MessagesSquare, roles: ['STUDENT', 'INSTRUCTOR', 'COURSE_MANAGER', 'ADMIN'] },
        { name: t('sidebar.notifications'), href: '/dashboard/notifications', icon: ShieldAlert, roles: ['STUDENT', 'INSTRUCTOR', 'COURSE_MANAGER', 'FINANCE', 'ADMIN'] },
        { name: t('sidebar.support'), href: '/dashboard/support', icon: LifeBuoy, roles: ['STUDENT', 'INSTRUCTOR', 'COURSE_MANAGER', 'FINANCE', 'ADMIN'] },
        { name: t('sidebar.manage_courses'), href: '/dashboard/admin/courses', icon: BookOpen, roles: ['COURSE_MANAGER', 'ADMIN'] },
        { name: t('sidebar.openings'), href: '/dashboard/admin/openings', icon: CalendarClock, roles: ['COURSE_MANAGER', 'ADMIN'] },
        { name: t('sidebar.teach_hub'), href: '/dashboard/teaching', icon: GraduationCap, roles: ['INSTRUCTOR'] },
        // The public CV used to be reachable only through the generic profile
        // edit modal, so nobody found it and every instructor stayed
        // `isProfileIncomplete`. Its own entry is what makes it discoverable.
        { name: t('sidebar.instructor_profile'), href: '/dashboard/instructor-profile', icon: BadgeCheck, roles: ['INSTRUCTOR', 'COURSE_MANAGER'] },
        { name: t('sidebar.submissions'), href: '/dashboard/submissions', icon: ClipboardCheck, roles: ['INSTRUCTOR'] },
        { name: t('sidebar.instructors_hr'), href: '/dashboard/admin/instructors', icon: Users, roles: ['ADMIN', 'COURSE_MANAGER'] },
        { name: t('sidebar.audit_logs'), href: '/dashboard/admin/audit', icon: ShieldAlert, roles: ['ADMIN'] },
        { name: t('sidebar.finance'), href: '/dashboard/admin/finance', icon: CreditCard, roles: ['FINANCE', 'ADMIN'] },
        { name: t('sidebar.admin'), href: '/dashboard/admin', icon: Settings, roles: ['ADMIN'] },
    ];
}
