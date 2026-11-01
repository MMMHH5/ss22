import Link from 'next/link';
import React from 'react';
import type { LucideIcon } from 'lucide-react';

/* ---- Reusable design tokens for the admin panel (DARK THEME) ---- */

export const tileColors: Record<string, string> = {
    blue: 'bg-brand-navy-light/15 text-brand-navy-light',
    cyan: 'bg-cyan-500/15 text-cyan-400',
    purple: 'bg-purple-500/15 text-purple-400',
    green: 'bg-emerald-500/15 text-emerald-400',
    amber: 'bg-brand-gold/15 text-brand-gold-light',
    indigo: 'bg-brand-navy-light/15 text-indigo-400',
    orange: 'bg-orange-500/15 text-orange-400',
    gray: 'bg-white/10 text-gray-400',
    teal: 'bg-teal-500/15 text-teal-400',
    red: 'bg-red-500/15 text-red-400',
};

export type Tone = 'green' | 'amber' | 'red' | 'gray' | 'blue' | 'purple' | 'gold' | 'navy' | 'teal';

const badgeToneMap: Record<Tone, string> = {
    green: 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/20',
    amber: 'bg-brand-gold/15 text-brand-gold-light ring-1 ring-brand-gold/20',
    red: 'bg-red-500/15 text-red-400 ring-1 ring-red-500/20',
    gray: 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-400 ring-1 ring-gray-200 dark:ring-white/10',
    blue: 'bg-brand-navy-light/15 text-brand-navy-light ring-1 ring-brand-navy-light/20',
    purple: 'bg-purple-500/15 text-purple-400 ring-1 ring-purple-500/20',
    gold: 'bg-brand-gold/15 text-brand-gold-light ring-1 ring-brand-gold/20',
    navy: 'bg-brand-navy-dark text-white ring-1 ring-white/10',
    teal: 'bg-teal-500/15 text-teal-400 ring-1 ring-teal-500/20',
};

/** Header block shown at the top of every admin page */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-xl bg-brand-gold/10 flex items-center justify-center shadow-md shrink-0">
                    <span className="w-2.5 h-2.5 rounded-full bg-brand-gold-dark dark:bg-brand-gold-light" />
                </div>
                <div>
                    <h2 className="text-2xl font-black text-brand-navy dark:text-white tracking-tight">{title}</h2>
                    {subtitle && <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">{subtitle}</p>}
                </div>
            </div>
            {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
        </div>
    );
}

/** Clickable stat / summary card */
export function StatCard({
    icon: Icon,
    color,
    value,
    label,
    href,
    accent,
}: {
    icon: LucideIcon;
    color: string;
    value: React.ReactNode;
    label: string;
    href?: string;
    accent?: boolean;
}) {
    const inner = (
        <div className={`bg-white dark:bg-brand-navy-dark border border-gray-200 dark:border-white/5 rounded-2xl p-3 sm:p-5 h-full ${accent ? 'shadow-lg shadow-brand-navy/10 dark:shadow-black/20' : 'shadow-sm'}`}>
            <div className="flex items-center justify-between mb-3">
                <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center ${tileColors[color]}`}>
                    <Icon size={20} className="w-[18px] h-[18px] sm:w-5 sm:h-5" />
                </div>
            </div>
            <div className="text-xl sm:text-2xl font-black text-brand-navy dark:text-white">{value}</div>
            <div className="text-[11px] sm:text-xs font-bold text-gray-500 dark:text-gray-400 mt-1.5 leading-snug">{label}</div>
        </div>
    );
    return href ? <Link href={href} className="block h-full">{inner}</Link> : inner;
}

/** Section title with icon */
export function SectionHeader({
    icon: Icon,
    title,
    subtitle,
    action,
    color = 'navy',
}: {
    icon: LucideIcon;
    title: string;
    subtitle?: string;
    action?: React.ReactNode;
    color?: Tone;
}) {
    const tile = {
        navy: 'bg-brand-gold/10 text-brand-gold-light',
        green: 'bg-emerald-500/10 text-emerald-400',
        amber: 'bg-brand-gold/10 text-brand-gold-light',
        red: 'bg-red-500/10 text-red-400',
        blue: 'bg-brand-navy-light/10 text-brand-navy-light',
        purple: 'bg-purple-500/10 text-purple-400',
        gold: 'bg-brand-gold/10 text-brand-gold-light',
gray: 'bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400',
        teal: 'bg-teal-500/10 text-teal-400',
    }[color];

    return (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${tile}`}>
                    <Icon size={18} />
                </div>
                <div>
                    <h3 className="font-black text-brand-navy dark:text-white leading-tight">{title}</h3>
                    {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold mt-0.5">{subtitle}</p>}
                </div>
            </div>
            {action}
        </div>
    );
}

/** Status pill */
export function Badge({ tone = 'gray', dot = true, children }: { tone?: Tone; dot?: boolean; children: React.ReactNode }) {
    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${badgeToneMap[tone]}`}>
            {dot && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />}
            {children}
        </span>
    );
}

/** Empty / no-data state for tables (renders a <tr>) */
export function EmptyState({ icon: Icon, title, color = 'navy' }: { icon: LucideIcon; title: string; color?: Tone }) {
    const tile = {
        navy: 'bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-gray-400',
        green: 'bg-emerald-500/10 text-emerald-400',
        amber: 'bg-brand-gold/10 text-brand-gold-light',
        red: 'bg-red-500/10 text-red-400',
        blue: 'bg-brand-navy-light/10 text-brand-navy-light',
        purple: 'bg-purple-500/10 text-purple-400',
        gold: 'bg-brand-gold/10 text-brand-gold-light',
        gray: 'bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-gray-400',
        teal: 'bg-teal-500/10 text-teal-400',
    }[color];

    return (
        <tr>
            <td colSpan={99} className="p-12">
                <div className="flex flex-col items-center justify-center text-center animate-fade-in">
                    <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${tile} mb-4`}>
                        <Icon size={30} />
                    </div>
                    <p className="text-gray-500 dark:text-gray-400 font-bold text-sm max-w-sm">{title}</p>
                </div>
            </td>
        </tr>
    );
}

/** Empty / no-data state for cards and sections (renders a <div>) */
export function EmptyPanel({ icon: Icon, title, color = 'navy' }: { icon: LucideIcon; title: string; color?: Tone }) {
    const tile = {
        navy: 'bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-gray-400',
        green: 'bg-emerald-500/10 text-emerald-400',
        amber: 'bg-brand-gold/10 text-brand-gold-light',
        red: 'bg-red-500/10 text-red-400',
        blue: 'bg-brand-navy-light/10 text-brand-navy-light',
        purple: 'bg-purple-500/10 text-purple-400',
        gold: 'bg-brand-gold/10 text-brand-gold-light',
        gray: 'bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-gray-400',
        teal: 'bg-teal-500/10 text-teal-400',
    }[color];

    return (
        <div className="flex flex-col items-center justify-center text-center py-12 animate-fade-in">
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${tile} mb-4`}>
                <Icon size={30} />
            </div>
            <p className="text-gray-500 dark:text-gray-400 font-bold text-sm max-w-sm">{title}</p>
        </div>
    );
}

/** Primary amber button */
export function BtnPrimary({ icon: Icon, children, onClick, href, disabled, type = 'button' }: {
    icon?: LucideIcon;
    children: React.ReactNode;
    onClick?: () => void;
    href?: string;
    disabled?: boolean;
    type?: 'button' | 'submit';
}) {
    const cls = `inline-flex items-center gap-2 bg-gradient-to-r from-brand-gold to-brand-gold-dark text-black px-4 py-2.5 rounded-xl font-bold hover:shadow-lg hover:shadow-brand-gold/20 transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`;
    const inner = (
        <>
            {Icon && <Icon size={18} />}
            {children}
        </>
    );
    if (href) return <Link href={href} className={cls}>{inner}</Link>;
    return (
        <button type={type} onClick={onClick} disabled={disabled} className={cls}>{inner}</button>
    );
}

/** Soft secondary button */
export function BtnSoft({ icon: Icon, children, onClick, disabled }: {
    icon?: LucideIcon;
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className="inline-flex items-center gap-2 bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-white/10 px-4 py-2 rounded-xl font-bold hover:bg-gray-200 dark:hover:bg-white/10 hover:text-brand-navy dark:hover:text-white transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
        >
            {Icon && <Icon size={16} />}
            {children}
        </button>
    );
}
