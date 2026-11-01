'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, getErrorMessage } from '@/lib/api';
import { useFetchData } from '@/lib/useFetchData';
import { useI18n } from '@/lib/i18n-context';
import toast from 'react-hot-toast';
import { Loader, Plus, Save, Trash2 } from 'lucide-react';

interface InstructorOption {
    id: string;
    email: string;
    role: string;
}

interface InstructorGrant {
    instructorId: string;
    instructor?: { id: string; email: string };
    canReadContent: boolean;
    canManageTasks: boolean;
    canGrade: boolean;
    canManageSessions: boolean;
    canManageAnnouncements: boolean;
    canViewAnalytics: boolean;
}

type PermissionKey = Exclude<keyof InstructorGrant, 'instructorId' | 'instructor'>;

const PERMISSIONS: { key: PermissionKey; ar: string; en: string }[] = [
    { key: 'canReadContent', ar: 'عرض محتوى الدورة فقط', en: 'View course content only' },
    { key: 'canManageTasks', ar: 'إدارة الواجبات', en: 'Manage assignments' },
    { key: 'canGrade', ar: 'عرض الطلاب والدرجات والتصحيح', en: 'View roster, grades, and grade work' },
    { key: 'canManageSessions', ar: 'إدارة الجلسات والحضور', en: 'Manage sessions and attendance' },
    { key: 'canManageAnnouncements', ar: 'إدارة الإعلانات', en: 'Manage announcements' },
    { key: 'canViewAnalytics', ar: 'عرض تقارير الدفعة', en: 'View batch reports' },
];

const emptyGrant = (instructorId: string): InstructorGrant => ({
    instructorId,
    canReadContent: true,
    canManageTasks: true,
    canGrade: true,
    canManageSessions: true,
    canManageAnnouncements: true,
    canViewAnalytics: true,
});

export default function OpeningInstructorPermissions({
    openingId,
    primaryInstructorId,
}: {
    openingId: string;
    primaryInstructorId: string;
}) {
    const { locale } = useI18n();
    const isAr = locale === 'ar';
    const { data: users } = useFetchData<InstructorOption[]>('/users');
    const [grants, setGrants] = useState<InstructorGrant[]>([]);
    const [selectedId, setSelectedId] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let active = true;
        const load = async () => {
            try {
                const response = await api.get(`/openings/${openingId}/instructor-grants`);
                if (active) setGrants(response.data as InstructorGrant[]);
            } catch (error) {
                if (active) toast.error(getErrorMessage(error) || (isAr ? 'تعذر تحميل صلاحيات المساعدين.' : 'Could not load assistant permissions.'));
            } finally {
                if (active) setLoading(false);
            }
        };
        load();
        return () => { active = false; };
    }, [openingId, isAr]);

    const instructorOptions = useMemo(
        () => (users ?? []).filter((user) => user.role === 'INSTRUCTOR' && user.id !== primaryInstructorId),
        [users, primaryInstructorId],
    );

    const updateGrant = (instructorId: string, key: PermissionKey, value: boolean) => {
        setGrants((current) => current.map((grant) => (
            grant.instructorId === instructorId ? { ...grant, [key]: value } : grant
        )));
    };

    const addInstructor = () => {
        if (!selectedId || grants.some((grant) => grant.instructorId === selectedId)) return;
        setGrants((current) => [...current, emptyGrant(selectedId)]);
        setSelectedId('');
    };

    const save = async () => {
        if (grants.some((grant) => !PERMISSIONS.some(({ key }) => grant[key]))) {
            toast.error(isAr ? 'يجب منح صلاحية واحدة على الأقل لكل مدرّس مساعد.' : 'Each assistant must have at least one permission.');
            return;
        }
        setSaving(true);
        try {
            const response = await api.put(`/openings/${openingId}/instructor-grants`, {
                instructors: grants.map(({ instructorId, ...permissions }) => ({ instructorId, ...permissions })),
            });
            setGrants(response.data as InstructorGrant[]);
            toast.success(isAr ? 'تم حفظ صلاحيات المدرّسين.' : 'Instructor permissions saved.');
        } catch (error) {
            toast.error(getErrorMessage(error) || (isAr ? 'تعذر حفظ الصلاحيات.' : 'Could not save permissions.'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="mt-8 border-t border-white/10 pt-8">
            <div className="mb-4">
                <h3 className="text-xl font-black text-white">
                    {isAr ? 'المدرّسون المساعدون والصلاحيات' : 'Assistant instructors and permissions'}
                </h3>
                <p className="mt-1 text-sm text-gray-400">
                    {isAr
                        ? 'المدرّس الأساسي يحتفظ بكامل الصلاحيات. تعديل محتوى الدورة غير متاح للمساعد لأن المحتوى مشترك بين الدفعات.'
                        : 'The primary instructor retains full access. Assistants can view shared course content but cannot edit it.'}
                </p>
            </div>

            {loading ? (
                <p className="flex items-center gap-2 text-sm text-gray-400">
                    <Loader size={16} className="animate-spin" /> {isAr ? 'جارٍ تحميل الصلاحيات...' : 'Loading permissions...'}
                </p>
            ) : (
                <>
                    <div className="mb-4 flex flex-wrap gap-2">
                        <select
                            value={selectedId}
                            onChange={(event) => setSelectedId(event.target.value)}
                            className="min-w-64 flex-1 rounded-xl border border-white/10 bg-brand-navy px-4 py-3 text-white"
                        >
                            <option value="">{isAr ? 'اختر مدرّسًا مساعدًا' : 'Select an assistant instructor'}</option>
                            {instructorOptions
                                .filter((user) => !grants.some((grant) => grant.instructorId === user.id))
                                .map((user) => <option key={user.id} value={user.id}>{user.email}</option>)}
                        </select>
                        <button
                            type="button"
                            onClick={addInstructor}
                            disabled={!selectedId}
                            className="inline-flex items-center gap-2 rounded-xl border border-brand-gold/20 px-4 py-3 font-bold text-brand-gold-light disabled:opacity-50"
                        >
                            <Plus size={16} /> {isAr ? 'إضافة' : 'Add'}
                        </button>
                    </div>

                    <div className="space-y-3">
                        {grants.map((grant) => {
                            const instructor = grant.instructor ?? instructorOptions.find((user) => user.id === grant.instructorId);
                            return (
                                <div key={grant.instructorId} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                                    <div className="mb-3 flex items-center justify-between gap-3">
                                        <p className="truncate font-bold text-white">{instructor?.email ?? grant.instructorId}</p>
                                        <button
                                            type="button"
                                            onClick={() => setGrants((current) => current.filter((entry) => entry.instructorId !== grant.instructorId))}
                                            aria-label={isAr ? 'إزالة المدرّس المساعد' : 'Remove assistant instructor'}
                                            className="rounded-lg p-2 text-red-400 hover:bg-red-500/10"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                        {PERMISSIONS.map(({ key, ar, en }) => (
                                            <label key={key} className="flex items-center gap-2 text-sm text-gray-300">
                                                <input
                                                    type="checkbox"
                                                    checked={grant[key]}
                                                    onChange={(event) => updateGrant(grant.instructorId, key, event.target.checked)}
                                                    className="accent-amber-400"
                                                />
                                                {isAr ? ar : en}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                        {grants.length === 0 && (
                            <p className="rounded-xl border border-dashed border-white/10 p-4 text-center text-sm text-gray-400">
                                {isAr ? 'لا يوجد مدرّسون مساعدون لهذه الدفعة.' : 'No assistant instructors are assigned to this batch.'}
                            </p>
                        )}
                    </div>

                    <button
                        type="button"
                        onClick={save}
                        disabled={saving}
                        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-gold to-brand-gold-dark px-5 py-3 font-bold text-black disabled:opacity-50"
                    >
                        {saving ? <Loader size={16} className="animate-spin" /> : <Save size={16} />}
                        {isAr ? 'حفظ الصلاحيات' : 'Save permissions'}
                    </button>
                </>
            )}
        </section>
    );
}
