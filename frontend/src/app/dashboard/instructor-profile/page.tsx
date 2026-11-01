"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useFetchData } from '@/lib/useFetchData';
import { useI18n } from '@/lib/i18n-context';
import { api, getErrorMessage, API_BASE_URL } from '@/lib/api';
import toast from 'react-hot-toast';
import {
    BadgeCheck, Camera, Check, CircleAlert, Eye, Loader, Save, Sparkles,
    Plus, Trash2, ArrowUp, ArrowDown, Link2, GraduationCap, Award, Languages,
    Briefcase, Info,
} from 'lucide-react';
import type {
    BilingualText,
    ProfileCertificate,
    ProfileExperience,
    ProfileLanguage,
    ProfileLink,
    ProfileQualification,
} from '@/lib/public-instructor';

interface MyProfile {
    id: string;
    email: string;
    role: string;
    metadata?: Record<string, unknown> | null;
}

/**
 * The editable shape. Every value is a string because form inputs hand strings
 * back; the server coerces `experienceYears`, trims the rest and drops entries
 * missing a required field.
 *
 * This is the public profile and nothing else. The account details collected at
 * registration — phone, date of birth, country — live in the same `metadata`
 * column but are deliberately not editable here: they are not shown to students,
 * and mixing the two on one page is what made this page ambiguous about what a
 * visitor would actually see.
 */
interface ProfileForm {
    nameAr: string;
    nameEn: string;
    jobTitleAr: string;
    jobTitleEn: string;
    bioAr: string;
    bioEn: string;
    specialties: BilingualText[];
    experienceYears: string;
    experiences: ProfileExperience[];
    qualifications: ProfileQualification[];
    languages: ProfileLanguage[];
    certificates: ProfileCertificate[];
    links: ProfileLink[];
}

const EMPTY: ProfileForm = {
    nameAr: '', nameEn: '', jobTitleAr: '', jobTitleEn: '',
    bioAr: '', bioEn: '', specialties: [], experienceYears: '',
    experiences: [], qualifications: [], languages: [], certificates: [], links: [],
};

/** Mirrors the server-side key in `metadata`, so the two cannot drift. */
const PROFILE_KEY = 'publicProfile';

const asText = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const asNum = (v: unknown): string => (v === null || v === undefined || v === '' ? '' : String(v));

/** Reads the namespaced profile out of a metadata blob, tolerating its absence. */
function readStoredProfile(metadata: unknown): Record<string, unknown> {
    if (!metadata || typeof metadata !== 'object') return {};
    const section = (metadata as Record<string, unknown>)[PROFILE_KEY];
    if (!section || typeof section !== 'object' || Array.isArray(section)) return {};
    return section as Record<string, unknown>;
}

const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/** Reads a `{ ar, en }` pair out of the stored section, tolerating anything else. */
const storedBilingual = (stored: Record<string, unknown>, key: string): BilingualText => {
    const value = stored[key];
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as BilingualText) : {};
};

/**
 * Drops rows the teacher started but never filled in.
 *
 * The server rejects a structured row that is missing its required field rather
 * than silently discarding it, so a half-typed entry — or the blank row the "add"
 * button inserts — would otherwise fail the whole save and lose every other
 * section's edits too. Filtering here keeps "I clicked add and changed my mind"
 * harmless while still letting a real mistake reach the server and be reported.
 */
const completeOnly = <T,>(items: T[], required: Array<keyof T>): T[] =>
    items.filter((item) => required.every((key) => asText(item[key])));

const trimmedText = <T extends object>(items: T[]): T[] =>
    items.map((item) => {
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(item)) {
            if (typeof value !== 'string') {
                out[key] = value;
                continue;
            }
            const trimmed = value.trim();
            out[key] = trimmed.length > 0 ? trimmed : null;
        }
        return out as T;
    });

export default function InstructorProfilePage() {
    const { t, locale } = useI18n();
    const { data: profile, loading, error, refetch } = useFetchData<MyProfile>('/users/me');

    const [form, setForm] = useState<ProfileForm>(EMPTY);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const fileRef = useRef<HTMLInputElement | null>(null);

    // Hydrate once per profile. The ref only remembers *which* profile was
    // hydrated, so the save's refetch does not overwrite the edits in progress;
    // the actual values come from state, set inside the effect.
    const hydratedFor = useRef<string | null>(null);
    useEffect(() => {
        if (!profile?.id || hydratedFor.current === profile.id) return;
        hydratedFor.current = profile.id;
        const md = (profile.metadata ?? {}) as Record<string, unknown>;
        const stored = readStoredProfile(md);
        // The canonical shape nests bilingual pairs (`name: { ar, en }`); the
        // pre-namespaced keys stay as a fallback so a teacher who saved before
        // the change does not open an empty form.
        const name = storedBilingual(stored, 'name');
        const jobTitle = storedBilingual(stored, 'jobTitle');
        const bio = storedBilingual(stored, 'bio');
        setForm({
            nameAr: asText(name.ar ?? md.nameAr),
            nameEn: asText(name.en ?? md.nameEn),
            jobTitleAr: asText(jobTitle.ar ?? md.jobTitleAr),
            jobTitleEn: asText(jobTitle.en ?? md.jobTitleEn),
            bioAr: asText(bio.ar ?? md.bio),
            bioEn: asText(bio.en ?? md.bioEn),
            specialties: list<BilingualText>(stored.specialties).length
                ? list<BilingualText>(stored.specialties)
                // The pre-existing single `specialty` becomes a one-item list so
                // nothing a teacher already saved is dropped.
                : asText(md.specialty) ? [{ ar: asText(md.specialty) }] : [],
            experienceYears: asNum(stored.experienceYears ?? md.experienceYears),
            experiences: list<ProfileExperience>(stored.experiences).map((e) => ({
                role: asText(e.role),
                organisation: asText(e.organisation),
                from: asText(e.from),
                to: asText(e.to),
                description: asText(e.description),
            })),
            qualifications: list<ProfileQualification>(stored.qualifications).map((q) => ({
                degree: asText(q.degree),
                field: asText(q.field),
                institution: asText(q.institution),
                year: asText(q.year),
            })),
            languages: list<ProfileLanguage>(stored.languages).map((l) => ({
                name: asText(l.name),
                proficiency: asText(l.proficiency),
            })),
            certificates: list<ProfileCertificate>(stored.certificates).map((c) => ({
                title: asText(c.title),
                issuer: asText(c.issuer),
                year: asText(c.year),
            })),
            links: list<ProfileLink>(stored.links).map((l) => ({
                label: asText(l.label),
                url: asText(l.url),
            })),
        });
    }, [profile]);

    const set = useCallback(
        <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) =>
            setForm((f) => ({ ...f, [key]: value })),
        [],
    );
    const setField = useCallback(
        (key: keyof ProfileForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
            setForm((f) => ({ ...f, [key]: e.target.value })),
        [],
    );

    /**
     * Immutable list edits. Each section gets `patch` so add/remove/reorder share
     * one implementation instead of five near-copies that drift apart.
     */
    function editList<K extends 'specialties' | 'experiences' | 'qualifications' | 'languages' | 'certificates' | 'links'>(
        key: K,
        patch: (items: ProfileForm[K]) => ProfileForm[K],
    ) {
        setForm((f) => ({ ...f, [key]: patch(f[key]) }));
    }

    const move = <T,>(items: T[], index: number, delta: number): T[] => {
        const next = [...items];
        const target = index + delta;
        if (target < 0 || target >= next.length) return next;
        [next[index], next[target]] = [next[target], next[index]];
        return next;
    };

    const save = async () => {
        // A link only counts once it has both a label and an https URL; anything
        // else is a row the teacher abandoned, not a link they meant to publish.
        const usableLinks = completeOnly(form.links, ['label', 'url'])
            .filter((l) => /^https:\/\//i.test(String(l.url).trim()));

        const payload = {
            name: { ar: form.nameAr, en: form.nameEn },
            jobTitle: { ar: form.jobTitleAr, en: form.jobTitleEn },
            bio: { ar: form.bioAr, en: form.bioEn },
            // A specialty is bilingual, so either side alone is enough to keep it.
            specialties: trimmedText(
                form.specialties.filter((s) => Boolean((s.ar || '').trim() || (s.en || '').trim())),
            ),
            experienceYears: form.experienceYears === '' ? null : Number(form.experienceYears),
            experiences: trimmedText(completeOnly(form.experiences, ['role', 'organisation'])),
            qualifications: trimmedText(completeOnly(form.qualifications, ['degree'])),
            languages: trimmedText(completeOnly(form.languages, ['name'])),
            certificates: trimmedText(completeOnly(form.certificates, ['title'])),
            links: trimmedText(usableLinks),
        };

        setSaving(true);
        try {
            // Only the public-profile section is sent, so the account details the
            // account page owns are untouched by this form.
            await api.patch('/users/me', { metadata: { [PROFILE_KEY]: payload } });
            toast.success(t('profile.saved'));
            hydratedFor.current = null;
            refetch();
        } catch (err) {
            toast.error(getErrorMessage(err) || t('common.error'));
        } finally {
            setSaving(false);
        }
    };

    const uploadAvatar = async (file: File) => {
        setUploading(true);
        try {
            const body = new FormData();
            body.append('file', file);
            await api.post('/users/me/avatar', body, { headers: { 'Content-Type': 'multipart/form-data' } });
            toast.success(t('profile.avatar_updated'));
            hydratedFor.current = null;
            refetch();
        } catch (err) {
            toast.error(getErrorMessage(err) || t('profile.avatar_failed'));
        } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = '';
        }
    };

    const avatar = asText((profile?.metadata as Record<string, unknown> | undefined)?.avatarUrl);
    const displayName = locale === 'ar' ? (form.nameAr || form.nameEn) : (form.nameEn || form.nameAr);
    const displayTitle = locale === 'ar' ? (form.jobTitleAr || form.jobTitleEn) : (form.jobTitleEn || form.jobTitleAr);

    // Only the name and the headline decide whether a card renders; the photo is
    // explicitly optional, so it is not part of "complete".
    const hasIdentity = Boolean(form.nameAr || form.nameEn);
    const hasTitle = Boolean(form.jobTitleAr || form.jobTitleEn);
    const hasAbout = Boolean(form.bioAr || form.bioEn);
    const hasDetail = form.experiences.length + form.qualifications.length > 0;
    const complete = hasIdentity && hasTitle;

    const steps = [
        { label: t('instructorProfile.step_identity'), done: hasIdentity },
        { label: t('instructorProfile.step_title'), done: hasTitle },
        { label: t('instructorProfile.step_bio'), done: hasAbout },
        { label: t('instructorProfile.sections_experience'), done: hasDetail },
    ];
    const doneCount = steps.filter((s) => s.done).length;

    const visibleSpecialties = useMemo(
        () => form.specialties.filter((s) => (s.ar || '').trim() || (s.en || '').trim()),
        [form.specialties],
    );

    const inputCls = 'w-full px-4 py-3 bg-brand-navy border border-white/10 rounded-xl text-white placeholder:text-gray-500 focus:ring-2 focus:ring-brand-gold/40 focus:border-brand-gold/40 outline-none transition';
    const labelCls = 'block text-sm font-bold text-gray-300 mb-1.5';
    const cardCls = 'bg-brand-navy-dark border border-white/5 rounded-2xl p-4 sm:p-6 lg:p-7';
    const sectionTitle = 'text-lg font-black text-white mb-1';
    const hintCls = 'text-sm text-gray-400 mb-5';

    return (
        <ProtectedRoute allowedRoles={['INSTRUCTOR', 'COURSE_MANAGER']}>
            <div className="min-w-0 bg-gray-50 dark:bg-brand-navy space-y-5 sm:space-y-6 animate-fade-in p-3 sm:p-4 lg:p-8">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-black text-brand-navy dark:text-white tracking-tight flex items-center gap-2 sm:gap-3">
                            <BadgeCheck className="text-brand-gold-dark dark:text-brand-gold-light shrink-0" size={26} />
                            {t('instructorProfile.studio_title')}
                        </h1>
                        <p className="text-gray-600 dark:text-gray-400 text-sm mt-2 max-w-2xl">
                            {t('instructorProfile.studio_subtitle')}
                        </p>
                    </div>
                    {profile?.id && (
                        <Link
                            href={`/instructors/${profile.id}`}
                            target="_blank"
                            className="inline-flex items-center gap-2 bg-white dark:bg-brand-navy border border-gray-200 dark:border-white/10 text-brand-navy dark:text-white font-bold text-sm px-4 sm:px-5 py-2.5 rounded-xl hover:border-brand-gold/50 transition-all"
                        >
                            <Eye size={16} /> {t('instructorProfile.view_public')}
                        </Link>
                    )}
                </div>

                {error && <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-500 dark:text-red-400 rounded-xl">{error}</div>}

                <div className="flex items-start gap-3 p-4 bg-blue-500/10 border border-blue-500/25 text-blue-700 dark:text-blue-300 rounded-xl">
                    <Info size={18} className="mt-0.5 shrink-0" />
                    <p className="text-sm">{t('instructorProfile.cv_only_note')}</p>
                </div>

                {!complete && (
                    <div className="flex items-start gap-3 p-4 bg-brand-gold/10 border border-brand-gold/30 text-brand-navy dark:text-brand-gold-light rounded-xl">
                        <CircleAlert size={18} className="mt-0.5 shrink-0" />
                        <p className="text-sm font-bold">{t('instructorProfile.required_hint')}</p>
                    </div>
                )}

                <div className="grid min-w-0 grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 items-start">
                    {/* ================= EDIT ================= */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* Photo — optional */}
                        <section className={cardCls}>
                            <h2 className={`${sectionTitle} flex items-center gap-2`}>
                                <Camera size={18} className="text-brand-gold-light" />
                                {t('instructorProfile.sections_identity')}
                            </h2>
                            <p className={hintCls}>{t('instructorProfile.sections_identity_hint')}</p>

                            <div className="flex flex-wrap items-center gap-5">
                                <div className="relative">
                                    {avatar ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            src={`${API_BASE_URL}${avatar}`}
                                            alt={t('instructorProfile.avatar_alt')}
                                            className="w-24 h-24 rounded-2xl object-cover border-2 border-brand-gold/30"
                                        />
                                    ) : (
                                        <div className="w-24 h-24 rounded-2xl bg-brand-navy border-2 border-dashed border-white/15 flex items-center justify-center text-gray-500">
                                            <Camera size={26} />
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 min-w-[200px]">
                                    <input
                                        ref={fileRef}
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); }}
                                    />
                                    <button
                                        onClick={() => fileRef.current?.click()}
                                        disabled={uploading}
                                        className="inline-flex items-center gap-2 bg-brand-gold/10 text-brand-gold-light border border-brand-gold/25 font-bold text-sm px-4 py-2.5 rounded-xl hover:bg-brand-gold hover:text-black transition-all disabled:opacity-50"
                                    >
                                        {uploading ? <Loader size={15} className="animate-spin" /> : <Camera size={15} />}
                                        {t('instructorProfile.photo_label')}
                                    </button>
                                    <p className="text-xs text-gray-400 mt-2">{t('instructorProfile.photo_hint')}</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                                <div>
                                    <label className={labelCls}>{t('profile.field_name_ar')}</label>
                                    <input value={form.nameAr} onChange={setField('nameAr')} className={inputCls} />
                                </div>
                                <div>
                                    <label className={labelCls}>{t('profile.field_name_en')}</label>
                                    <input value={form.nameEn} onChange={setField('nameEn')} className={inputCls} dir="ltr" />
                                </div>
                            </div>
                        </section>

                        {/* Headline + intro */}
                        <section className={cardCls}>
                            <h2 className={sectionTitle}>{t('instructorProfile.sections_about')}</h2>
                            <p className={hintCls}>{t('instructorProfile.sections_about_hint')}</p>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className={labelCls}>{t('instructorProfile.job_title_label')}</label>
                                    <input
                                        value={form.jobTitleAr}
                                        onChange={setField('jobTitleAr')}
                                        placeholder={t('instructorProfile.job_title_ar_ph')}
                                        className={inputCls}
                                    />
                                </div>
                                <div>
                                    <label className={labelCls}>{`${t('instructorProfile.job_title_label')} (EN)`}</label>
                                    <input
                                        value={form.jobTitleEn}
                                        onChange={setField('jobTitleEn')}
                                        placeholder={t('instructorProfile.job_title_en_ph')}
                                        className={inputCls}
                                        dir="ltr"
                                    />
                                </div>
                                <div>
                                    <label className={labelCls}>{t('instructorProfile.experience_years_label')}</label>
                                    <input
                                        value={form.experienceYears}
                                        onChange={setField('experienceYears')}
                                        inputMode="numeric"
                                        placeholder={t('instructorProfile.years_hint')}
                                        className={inputCls}
                                        dir="ltr"
                                    />
                                </div>
                            </div>

                            <div className="mt-4 space-y-4">
                                <div>
                                    <label className={labelCls}>{t('instructorProfile.bio_ar_label')}</label>
                                    <textarea
                                        value={form.bioAr}
                                        onChange={setField('bioAr')}
                                        rows={5}
                                        maxLength={1200}
                                        placeholder={t('instructorProfile.bio_ar_ph')}
                                        className={`${inputCls} resize-y`}
                                    />
                                    <p className="text-xs text-gray-500 mt-1">{form.bioAr.length}/1200</p>
                                </div>
                                <div>
                                    <label className={labelCls}>{t('instructorProfile.bio_en_label')}</label>
                                    <textarea
                                        value={form.bioEn}
                                        onChange={setField('bioEn')}
                                        rows={4}
                                        maxLength={1200}
                                        dir="ltr"
                                        placeholder={t('instructorProfile.bio_en_ph')}
                                        className={`${inputCls} resize-y`}
                                    />
                                </div>
                            </div>
                        </section>

                        {/* Specialties */}
                        <section className={cardCls}>
                            <h2 className={sectionTitle}>{t('instructorProfile.sections_specialties')}</h2>
                            <p className={hintCls}>{t('instructorProfile.sections_specialties_hint')}</p>

                            <div className="space-y-3">
                                {form.specialties.map((item, index) => (
                                    <div key={index} className="flex flex-wrap items-end gap-3 p-3 bg-white/[0.03] rounded-xl border border-white/5">
                                        <div className="flex-1 min-w-[140px]">
                                            <label className="block text-xs font-bold text-gray-400 mb-1">AR</label>
                                            <input
                                                value={item.ar ?? ''}
                                                onChange={(e) => editList('specialties', (items) =>
                                                    items.map((it, i) => i === index ? { ...it, ar: e.target.value } : it))}
                                                placeholder={t('instructorProfile.specialty_ar_ph')}
                                                className={`${inputCls} py-2.5`}
                                            />
                                        </div>
                                        <div className="flex-1 min-w-[140px]">
                                            <label className="block text-xs font-bold text-gray-400 mb-1">EN</label>
                                            <input
                                                value={item.en ?? ''}
                                                onChange={(e) => editList('specialties', (items) =>
                                                    items.map((it, i) => i === index ? { ...it, en: e.target.value } : it))}
                                                placeholder={t('instructorProfile.specialty_en_ph')}
                                                className={`${inputCls} py-2.5`}
                                                dir="ltr"
                                            />
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => editList('specialties', (items) => items.filter((_, i) => i !== index))}
                                            title={t('instructorProfile.remove_item')}
                                            aria-label={t('instructorProfile.remove_item')}
                                            className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 transition"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))}
                            </div>

                            <button
                                type="button"
                                onClick={() => editList('specialties', (items) => [...items, { ar: '', en: '' }])}
                                className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-brand-gold-light hover:text-brand-gold transition"
                            >
                                <Plus size={16} /> {t('instructorProfile.add_specialty')}
                            </button>
                        </section>

                        {/* Experience */}
                        <section className={cardCls}>
                            <h2 className={`${sectionTitle} flex items-center gap-2`}>
                                <Briefcase size={18} className="text-brand-gold-light" />
                                {t('instructorProfile.sections_experience')}
                            </h2>
                            <p className={hintCls}>{t('instructorProfile.sections_experience_hint')}</p>

                            <div className="space-y-4">
                                {form.experiences.map((item, index) => (
                                    <div key={index} className="p-4 bg-white/[0.03] rounded-xl border border-white/5 space-y-3">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-xs font-black text-brand-gold-light">#{index + 1}</span>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => editList('experiences', (items) => move(items, index, -1))}
                                                    disabled={index === 0}
                                                    title={t('instructorProfile.move_up')}
                                                    aria-label={t('instructorProfile.move_up')}
                                                    className="p-1.5 rounded-lg text-gray-400 hover:bg-white/10 disabled:opacity-30 transition"
                                                >
                                                    <ArrowUp size={15} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => editList('experiences', (items) => move(items, index, 1))}
                                                    disabled={index === form.experiences.length - 1}
                                                    title={t('instructorProfile.move_down')}
                                                    aria-label={t('instructorProfile.move_down')}
                                                    className="p-1.5 rounded-lg text-gray-400 hover:bg-white/10 disabled:opacity-30 transition"
                                                >
                                                    <ArrowDown size={15} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => editList('experiences', (items) => items.filter((_, i) => i !== index))}
                                                    title={t('instructorProfile.remove_item')}
                                                    aria-label={t('instructorProfile.remove_item')}
                                                    className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition"
                                                >
                                                    <Trash2 size={15} />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="grid md:grid-cols-2 gap-3">
                                            <div>
                                                <label className={labelCls}>{t('instructorProfile.experience_role')}</label>
                                                <input
                                                    value={item.role}
                                                    onChange={(e) => editList('experiences', (items) =>
                                                        items.map((it, i) => i === index ? { ...it, role: e.target.value } : it))}
                                                    placeholder={t('instructorProfile.experience_role_ph')}
                                                    className={`${inputCls} py-2.5`}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelCls}>{t('instructorProfile.experience_org')}</label>
                                                <input
                                                    value={item.organisation}
                                                    onChange={(e) => editList('experiences', (items) =>
                                                        items.map((it, i) => i === index ? { ...it, organisation: e.target.value } : it))}
                                                    placeholder={t('instructorProfile.experience_org_ph')}
                                                    className={`${inputCls} py-2.5`}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelCls}>{t('instructorProfile.experience_from')}</label>
                                                <input
                                                    value={item.from ?? ''}
                                                    onChange={(e) => editList('experiences', (items) =>
                                                        items.map((it, i) => i === index ? { ...it, from: e.target.value } : it))}
                                                    placeholder="2021"
                                                    className={`${inputCls} py-2.5`}
                                                    dir="ltr"
                                                />
                                            </div>
                                            <div>
                                                <label className={labelCls}>{t('instructorProfile.experience_to')}</label>
                                                <input
                                                    value={item.to ?? ''}
                                                    onChange={(e) => editList('experiences', (items) =>
                                                        items.map((it, i) => i === index ? { ...it, to: e.target.value } : it))}
                                                    placeholder={t('instructorProfile.current_role')}
                                                    className={`${inputCls} py-2.5`}
                                                    dir="ltr"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className={labelCls}>{t('instructorProfile.experience_desc')}</label>
                                            <textarea
                                                value={item.description ?? ''}
                                                onChange={(e) => editList('experiences', (items) =>
                                                    items.map((it, i) => i === index ? { ...it, description: e.target.value } : it))}
                                                rows={2}
                                                maxLength={600}
                                                placeholder={t('instructorProfile.experience_desc_ph')}
                                                className={`${inputCls} py-2.5 resize-y`}
                                            />
                                        </div>
                                    </div>
                                ))}
                                {form.experiences.length === 0 && (
                                    <p className="text-sm text-gray-500">{t('instructorProfile.section_empty')}</p>
                                )}
                            </div>

                            <button
                                type="button"
                                onClick={() => editList('experiences', (items) => [
                                    ...items,
                                    { role: '', organisation: '', from: '', to: '', description: '' },
                                ])}
                                className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-brand-gold-light hover:text-brand-gold transition"
                            >
                                <Plus size={16} /> {t('instructorProfile.add_experience')}
                            </button>
                        </section>

                        {/* Qualifications */}
                        <section className={cardCls}>
                            <h2 className={`${sectionTitle} flex items-center gap-2`}>
                                <GraduationCap size={18} className="text-brand-gold-light" />
                                {t('instructorProfile.sections_qualifications')}
                            </h2>
                            <p className={hintCls}>{t('instructorProfile.sections_qualifications_hint')}</p>

                            <div className="space-y-4">
                                {form.qualifications.map((item, index) => (
                                    <div key={index} className="p-4 bg-white/[0.03] rounded-xl border border-white/5 space-y-3">
                                        <div className="flex items-center justify-end">
                                            <button
                                                type="button"
                                                onClick={() => editList('qualifications', (items) => items.filter((_, i) => i !== index))}
                                                title={t('instructorProfile.remove_item')}
                                                aria-label={t('instructorProfile.remove_item')}
                                                className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition"
                                            >
                                                <Trash2 size={15} />
                                            </button>
                                        </div>
                                        <div className="grid md:grid-cols-2 gap-3">
                                            <div>
                                                <label className={labelCls}>{t('instructorProfile.qualification_degree')}</label>
                                                <input
                                                    value={item.degree}
                                                    onChange={(e) => editList('qualifications', (items) =>
                                                        items.map((it, i) => i === index ? { ...it, degree: e.target.value } : it))}
                                                    placeholder={t('instructorProfile.qualification_degree_ph')}
                                                    className={`${inputCls} py-2.5`}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelCls}>{t('instructorProfile.qualification_field')}</label>
                                                <input
                                                    value={item.field ?? ''}
                                                    onChange={(e) => editList('qualifications', (items) =>
                                                        items.map((it, i) => i === index ? { ...it, field: e.target.value } : it))}
                                                    placeholder={t('instructorProfile.qualification_field_ph')}
                                                    className={`${inputCls} py-2.5`}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelCls}>{t('instructorProfile.qualification_org')}</label>
                                                <input
                                                    value={item.institution ?? ''}
                                                    onChange={(e) => editList('qualifications', (items) =>
                                                        items.map((it, i) => i === index ? { ...it, institution: e.target.value } : it))}
                                                    placeholder={t('instructorProfile.qualification_org_ph')}
                                                    className={`${inputCls} py-2.5`}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelCls}>{t('instructorProfile.qualification_year')}</label>
                                                <input
                                                    value={item.year ?? ''}
                                                    onChange={(e) => editList('qualifications', (items) =>
                                                        items.map((it, i) => i === index ? { ...it, year: e.target.value } : it))}
                                                    placeholder="2020"
                                                    className={`${inputCls} py-2.5`}
                                                    dir="ltr"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {form.qualifications.length === 0 && (
                                    <p className="text-sm text-gray-500">{t('instructorProfile.section_empty')}</p>
                                )}
                            </div>

                            <button
                                type="button"
                                onClick={() => editList('qualifications', (items) => [...items, { degree: '' }])}
                                className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-brand-gold-light hover:text-brand-gold transition"
                            >
                                <Plus size={16} /> {t('instructorProfile.add_qualification')}
                            </button>
                        </section>

                        {/* Languages */}
                        <section className={cardCls}>
                            <h2 className={`${sectionTitle} flex items-center gap-2`}>
                                <Languages size={18} className="text-brand-gold-light" />
                                {t('instructorProfile.sections_languages')}
                            </h2>
                            <p className={hintCls}>{t('instructorProfile.sections_languages_hint')}</p>

                            <div className="space-y-3">
                                {form.languages.map((item, index) => (
                                    <div key={index} className="flex flex-wrap items-end gap-3 p-3 bg-white/[0.03] rounded-xl border border-white/5">
                                        <div className="flex-1 min-w-[150px]">
                                            <label className={labelCls}>{t('instructorProfile.language_name')}</label>
                                            <input
                                                value={item.name}
                                                onChange={(e) => editList('languages', (items) =>
                                                    items.map((it, i) => i === index ? { ...it, name: e.target.value } : it))}
                                                placeholder={t('instructorProfile.language_name_ph')}
                                                className={`${inputCls} py-2.5`}
                                            />
                                        </div>
                                        <div className="flex-1 min-w-[150px]">
                                            <label className={labelCls}>{t('instructorProfile.language_proficiency')}</label>
                                            <input
                                                value={item.proficiency ?? ''}
                                                onChange={(e) => editList('languages', (items) =>
                                                    items.map((it, i) => i === index ? { ...it, proficiency: e.target.value } : it))}
                                                placeholder={t('instructorProfile.language_proficiency_ph')}
                                                className={`${inputCls} py-2.5`}
                                            />
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => editList('languages', (items) => items.filter((_, i) => i !== index))}
                                            title={t('instructorProfile.remove_item')}
                                            aria-label={t('instructorProfile.remove_item')}
                                            className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 transition"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))}
                                {form.languages.length === 0 && (
                                    <p className="text-sm text-gray-500">{t('instructorProfile.section_empty')}</p>
                                )}
                            </div>

                            <button
                                type="button"
                                onClick={() => editList('languages', (items) => [...items, { name: '' }])}
                                className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-brand-gold-light hover:text-brand-gold transition"
                            >
                                <Plus size={16} /> {t('instructorProfile.add_language')}
                            </button>
                        </section>

                        {/* Certificates */}
                        <section className={cardCls}>
                            <h2 className={`${sectionTitle} flex items-center gap-2`}>
                                <Award size={18} className="text-brand-gold-light" />
                                {t('instructorProfile.sections_certificates')}
                            </h2>
                            <p className={hintCls}>{t('instructorProfile.sections_certificates_hint')}</p>

                            <div className="space-y-3">
                                {form.certificates.map((item, index) => (
                                    <div key={index} className="flex flex-wrap items-end gap-3 p-3 bg-white/[0.03] rounded-xl border border-white/5">
                                        <div className="flex-1 min-w-[150px]">
                                            <label className={labelCls}>{t('instructorProfile.certificate_title')}</label>
                                            <input
                                                value={item.title}
                                                onChange={(e) => editList('certificates', (items) =>
                                                    items.map((it, i) => i === index ? { ...it, title: e.target.value } : it))}
                                                placeholder={t('instructorProfile.certificate_title_ph')}
                                                className={`${inputCls} py-2.5`}
                                            />
                                        </div>
                                        <div className="flex-1 min-w-[150px]">
                                            <label className={labelCls}>{t('instructorProfile.certificate_issuer')}</label>
                                            <input
                                                value={item.issuer ?? ''}
                                                onChange={(e) => editList('certificates', (items) =>
                                                    items.map((it, i) => i === index ? { ...it, issuer: e.target.value } : it))}
                                                placeholder={t('instructorProfile.certificate_issuer_ph')}
                                                className={`${inputCls} py-2.5`}
                                            />
                                        </div>
                                        <div className="w-28">
                                            <label className={labelCls}>{t('instructorProfile.certificate_year')}</label>
                                            <input
                                                value={item.year ?? ''}
                                                onChange={(e) => editList('certificates', (items) =>
                                                    items.map((it, i) => i === index ? { ...it, year: e.target.value } : it))}
                                                placeholder="2023"
                                                className={`${inputCls} py-2.5`}
                                                dir="ltr"
                                            />
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => editList('certificates', (items) => items.filter((_, i) => i !== index))}
                                            title={t('instructorProfile.remove_item')}
                                            aria-label={t('instructorProfile.remove_item')}
                                            className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 transition"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))}
                                {form.certificates.length === 0 && (
                                    <p className="text-sm text-gray-500">{t('instructorProfile.section_empty')}</p>
                                )}
                            </div>

                            <button
                                type="button"
                                onClick={() => editList('certificates', (items) => [...items, { title: '' }])}
                                className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-brand-gold-light hover:text-brand-gold transition"
                            >
                                <Plus size={16} /> {t('instructorProfile.add_certificate')}
                            </button>
                        </section>

                        {/* Links */}
                        <section className={cardCls}>
                            <h2 className={`${sectionTitle} flex items-center gap-2`}>
                                <Link2 size={18} className="text-brand-gold-light" />
                                {t('instructorProfile.sections_links')}
                            </h2>
                            <p className={hintCls}>{t('instructorProfile.sections_links_hint')}</p>

                            <div className="space-y-3">
                                {form.links.map((item, index) => {
                                    const bad = Boolean(item.url) && !/^https:\/\//i.test(item.url.trim());
                                    return (
                                        <div key={index} className="flex flex-wrap items-end gap-3 p-3 bg-white/[0.03] rounded-xl border border-white/5">
                                            <div className="flex-1 min-w-[130px]">
                                                <label className={labelCls}>{t('instructorProfile.link_label')}</label>
                                                <input
                                                    value={item.label}
                                                    onChange={(e) => editList('links', (items) =>
                                                        items.map((it, i) => i === index ? { ...it, label: e.target.value } : it))}
                                                    placeholder={t('instructorProfile.link_label_ph')}
                                                    className={`${inputCls} py-2.5`}
                                                />
                                            </div>
                                            <div className="flex-[2] min-w-[200px]">
                                                <label className={labelCls}>{t('instructorProfile.link_url')}</label>
                                                <input
                                                    value={item.url}
                                                    onChange={(e) => editList('links', (items) =>
                                                        items.map((it, i) => i === index ? { ...it, url: e.target.value } : it))}
                                                    placeholder={t('instructorProfile.link_url_ph')}
                                                    className={`${inputCls} py-2.5 ${bad ? 'border-red-500/60' : ''}`}
                                                    dir="ltr"
                                                />
                                                {bad && <p className="text-xs text-red-400 mt-1">{t('instructorProfile.link_invalid')}</p>}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => editList('links', (items) => items.filter((_, i) => i !== index))}
                                                title={t('instructorProfile.remove_item')}
                                                aria-label={t('instructorProfile.remove_item')}
                                                className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 transition"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    );
                                })}
                                {form.links.length === 0 && (
                                    <p className="text-sm text-gray-500">{t('instructorProfile.section_empty')}</p>
                                )}
                            </div>

                            <button
                                type="button"
                                onClick={() => editList('links', (items) => [...items, { label: '', url: '' }])}
                                className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-brand-gold-light hover:text-brand-gold transition"
                            >
                                <Plus size={16} /> {t('instructorProfile.add_link')}
                            </button>
                        </section>

                        {/* Save */}
                        <section className={cardCls}>
                            <div className="flex flex-wrap items-center gap-3">
                                <button
                                    onClick={save}
                                    disabled={saving || loading}
                                    className="inline-flex items-center gap-2 bg-gradient-to-r from-brand-gold to-brand-gold-dark text-black font-bold px-6 py-3 rounded-xl hover:opacity-95 transition-all disabled:opacity-50"
                                >
                                    {saving ? <Loader size={16} className="animate-spin" /> : <Save size={16} />}
                                    {saving ? t('common.saving') : t('common.save')}
                                </button>
                                <p className="text-xs text-gray-400">{t('instructorProfile.save_section_hint')}</p>
                            </div>
                        </section>
                    </div>

                    {/* ================= PREVIEW ================= */}
                    <div className="space-y-6">
                        <section className={cardCls}>
                            <h3 className="text-base font-black text-white flex items-center gap-2 mb-1">
                                <Eye size={16} className="text-brand-gold-light" />
                                {t('instructorProfile.preview_heading')}
                            </h3>
                            <p className="text-xs text-gray-400 mb-5">{t('instructorProfile.preview_hint')}</p>

                            <div className="bg-brand-navy border border-white/5 rounded-2xl p-5 space-y-4">
                                <div className="flex items-start gap-4">
                                    {avatar ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            src={`${API_BASE_URL}${avatar}`}
                                            alt=""
                                            className="w-14 h-14 rounded-xl object-cover shrink-0 border border-brand-gold/30"
                                        />
                                    ) : (
                                        <div className="w-14 h-14 rounded-xl bg-brand-navy-dark border border-dashed border-white/15 shrink-0 flex items-center justify-center text-gray-600">
                                            <Camera size={18} />
                                        </div>
                                    )}
                                    <div className="min-w-0">
                                        <p className="font-black text-white truncate">
                                            {displayName || <span className="text-gray-500">{t('instructorProfile.preview_name_placeholder')}</span>}
                                        </p>
                                        <p className="text-xs text-brand-gold-light font-bold truncate mt-0.5">
                                            {displayTitle || <span className="text-gray-500">{t('instructorProfile.preview_title_placeholder')}</span>}
                                        </p>
                                    </div>
                                </div>

                                {(visibleSpecialties.length > 0 || form.experienceYears) && (
                                    <div className="flex flex-wrap gap-2 pt-4 border-t border-white/5">
                                        {visibleSpecialties.map((s, i) => {
                                            const label = locale === 'ar' ? (s.ar || s.en) : (s.en || s.ar);
                                            return label ? (
                                                <span key={i} className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-brand-gold/10 text-brand-gold-light border border-brand-gold/20">
                                                    {label}
                                                </span>
                                            ) : null;
                                        })}
                                        {form.experienceYears && (
                                            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-white/5 text-gray-300 border border-white/10">
                                                {form.experienceYears} {t('instructorProfile.years_suffix')}
                                            </span>
                                        )}
                                    </div>
                                )}

                                {(locale === 'ar' ? form.bioAr : form.bioEn) && (
                                    <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap line-clamp-8">
                                        {locale === 'ar' ? form.bioAr : form.bioEn}
                                    </p>
                                )}

                                {form.experiences.length > 0 && (
                                    <PreviewBlock title={t('instructorProfile.preview_experiences')}>
                                        {form.experiences.filter((e) => e.role || e.organisation).slice(0, 3).map((e, i) => (
                                            <p key={i} className="text-xs text-gray-300">
                                                <span className="font-bold">{e.role}</span>
                                                {e.organisation && <span className="text-gray-400"> · {e.organisation}</span>}
                                            </p>
                                        ))}
                                    </PreviewBlock>
                                )}

                                {form.qualifications.length > 0 && (
                                    <PreviewBlock title={t('instructorProfile.preview_qualifications')}>
                                        {form.qualifications.filter((q) => q.degree).slice(0, 3).map((q, i) => (
                                            <p key={i} className="text-xs text-gray-300">
                                                <span className="font-bold">{q.degree}</span>
                                                {q.institution && <span className="text-gray-400"> · {q.institution}</span>}
                                            </p>
                                        ))}
                                    </PreviewBlock>
                                )}

                                {form.languages.length > 0 && (
                                    <PreviewBlock title={t('instructorProfile.preview_languages')}>
                                        <div className="flex flex-wrap gap-1.5">
                                            {form.languages.filter((l) => l.name).slice(0, 6).map((l, i) => (
                                                <span key={i} className="text-[11px] font-bold px-2 py-1 rounded-full bg-white/5 text-gray-300 border border-white/10">
                                                    {l.name}{l.proficiency ? ` — ${l.proficiency}` : ''}
                                                </span>
                                            ))}
                                        </div>
                                    </PreviewBlock>
                                )}

                                {form.certificates.length > 0 && (
                                    <PreviewBlock title={t('instructorProfile.preview_certificates')}>
                                        {form.certificates.filter((c) => c.title).slice(0, 3).map((c, i) => (
                                            <p key={i} className="text-xs text-gray-300">
                                                <span className="font-bold">{c.title}</span>
                                                {c.issuer && <span className="text-gray-400"> · {c.issuer}</span>}
                                            </p>
                                        ))}
                                    </PreviewBlock>
                                )}

                                {!displayName && !form.bioAr && !form.bioEn && (
                                    <p className="text-xs text-gray-500 flex items-start gap-2">
                                        <Sparkles size={13} className="mt-0.5 shrink-0" />
                                        {t('instructorProfile.preview_empty')}
                                    </p>
                                )}
                            </div>
                        </section>

                        <section className={cardCls}>
                            <h3 className="text-base font-black text-white mb-1">{t('instructorProfile.completion_heading')}</h3>
                            <div className="flex items-center gap-3 mt-4 mb-5">
                                <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-gradient-to-r from-brand-gold to-brand-gold-light rounded-full transition-all duration-500"
                                        style={{ width: `${(doneCount / steps.length) * 100}%` }}
                                    />
                                </div>
                                <span className="text-xs font-black text-brand-gold-light shrink-0">
                                    {doneCount}/{steps.length}
                                </span>
                            </div>

                            <ul className="space-y-2.5">
                                {steps.map((s) => (
                                    <li key={s.label} className="flex items-center gap-2.5">
                                        {s.done
                                            ? <Check size={15} className="text-emerald-400 shrink-0" />
                                            : <Sparkles size={15} className="text-brand-gold-light shrink-0" />}
                                        <span className={`text-sm ${s.done ? 'text-gray-400 line-through' : 'text-white font-bold'}`}>
                                            {s.label}
                                        </span>
                                        <span className={`ms-auto text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                            s.done
                                                ? 'bg-emerald-500/10 text-emerald-400'
                                                : 'bg-brand-gold/10 text-brand-gold-light'
                                        }`}>
                                            {s.done ? t('instructorProfile.step_done') : t('instructorProfile.step_missing')}
                                        </span>
                                    </li>
                                ))}
                            </ul>

                            <p className="text-xs text-gray-400 mt-5 pt-5 border-t border-white/5">
                                {t('instructorProfile.readonly_note')}
                            </p>
                        </section>
                    </div>
                </div>
            </div>
        </ProtectedRoute>
    );
}

/** One titled block in the preview column. */
function PreviewBlock({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="pt-3 border-t border-white/5 space-y-1">
            <p className="text-[10px] font-black uppercase tracking-wide text-gray-500">{title}</p>
            {children}
        </div>
    );
}
