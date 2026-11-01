"use client";

import { useCallback, useEffect, useState } from 'react';
import { api, getErrorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n-context';
import toast from 'react-hot-toast';
import {
    Loader, Plus, Pencil, Trash2, X, Video, Clock, Link2, CalendarDays, ClipboardCheck,
} from 'lucide-react';
import { EmptyPanel, BtnPrimary } from '@/app/dashboard/admin/components';
import SessionAttendancePanel from '@/components/SessionAttendancePanel';

interface LiveSession {
    id: string;
    titleAr: string;
    titleEn: string;
    scheduledAt: string;
    durationMinutes?: number | null;
    meetLink?: string | null;
}

interface SessionForm {
    titleAr: string;
    titleEn: string;
    scheduledAt: string;
    durationMinutes: string;
    meetLink: string;
}

const emptyForm: SessionForm = {
    titleAr: '',
    titleEn: '',
    scheduledAt: '',
    durationMinutes: '90',
    meetLink: '',
};

/**
 * An ISO instant as the value of an `<input type="datetime-local">`, in the
 * browser's own timezone. `toISOString().slice(0, 16)` would be wrong: it cuts
 * the UTC wall clock, so a 19:00 Riyadh class would be saved as 16:00.
 */
const toLocalInput = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function LiveSessionManager({ openingId }: { openingId: string }) {
    const { t, pick, locale } = useI18n();
    const isAr = locale === 'ar';

    const [sessions, setSessions] = useState<LiveSession[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<LiveSession | null>(null);
    const [form, setForm] = useState<SessionForm>(emptyForm);
    const [saving, setSaving] = useState(false);
    const [attendanceSessionId, setAttendanceSessionId] = useState<string | null>(null);

    const load = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const res = await api.get(`/openings/${openingId}/sessions`);
            setSessions(res.data);
        } catch (err) {
            toast.error(getErrorMessage(err) || t('common.error'));
        } finally {
            setLoading(false);
        }
    }, [openingId, t]);

    useEffect(() => { load(); }, [load]);

    const openCreate = () => {
        setEditing(null);
        setForm(emptyForm);
        setModalOpen(true);
    };

    const openEdit = (s: LiveSession) => {
        setEditing(s);
        setForm({
            titleAr: s.titleAr,
            titleEn: s.titleEn,
            scheduledAt: toLocalInput(s.scheduledAt),
            durationMinutes: s.durationMinutes != null ? String(s.durationMinutes) : '',
            meetLink: s.meetLink || '',
        });
        setModalOpen(true);
    };

    const save = async () => {
        if (!form.titleAr.trim() || !form.titleEn.trim()) {
            toast.error(isAr ? 'أدخل عنوان الجلسة بالعربي والإنجليزي' : 'Enter the session title in Arabic and English');
            return;
        }
        if (!form.scheduledAt) {
            toast.error(isAr ? 'حدد موعد الجلسة' : 'Pick a date and time');
            return;
        }
        const duration = form.durationMinutes ? Number(form.durationMinutes) : null;
        if (duration !== null && (!Number.isInteger(duration) || duration < 5 || duration > 600)) {
            toast.error(isAr ? 'المدة يجب أن تكون بين 5 و 600 دقيقة' : 'Duration must be between 5 and 600 minutes');
            return;
        }

        setSaving(true);
        try {
            const payload = {
                titleAr: form.titleAr.trim(),
                titleEn: form.titleEn.trim(),
                scheduledAt: new Date(form.scheduledAt).toISOString(),
                durationMinutes: duration,
                // An empty field is an explicit null, which puts the session back
                // on the batch's own room instead of clearing it to nothing.
                meetLink: form.meetLink.trim() ? form.meetLink.trim() : null,
            };
            if (editing) {
                await api.patch(`/openings/${openingId}/sessions/${editing.id}`, payload);
                toast.success(isAr ? 'تم تحديث الجلسة' : 'Session updated');
            } else {
                await api.post(`/openings/${openingId}/sessions`, payload);
                toast.success(isAr ? 'تمت إضافة الجلسة' : 'Session added');
            }
            setModalOpen(false);
            load(true);
        } catch (err) {
            toast.error(getErrorMessage(err) || t('common.error'));
        } finally {
            setSaving(false);
        }
    };

    const remove = async (s: LiveSession) => {
        const label = pick(s, 'title') || s.id;
        if (!confirm(isAr ? `هل أنت متأكد من حذف جلسة "${label}"؟` : `Delete the session "${label}"?`)) return;
        try {
            await api.delete(`/openings/${openingId}/sessions/${s.id}`);
            toast.success(isAr ? 'تم حذف الجلسة' : 'Session deleted');
            load(true);
        } catch (err) {
            toast.error(getErrorMessage(err) || t('common.error'));
        }
    };

    const label = (s: LiveSession) => pick(s, 'title') || s.titleEn || s.titleAr;

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader size={28} className="animate-spin text-accent" />
            </div>
        );
    }

    const list = sessions || [];

    return (
        <div className="space-y-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <p className="text-sm text-gray-400 max-w-2xl">
                    {isAr
                        ? 'جدول جلسات البث المباشر. اترك حقل الرابط فارغًا إذا كانت كل الجلسات تستخدم رابط الباقة نفسه.'
                        : 'The batch’s live meeting schedule. Leave the room empty when every session reuses the batch’s own link.'}
                </p>
                <BtnPrimary onClick={openCreate}>
                    <Plus size={16} /> {isAr ? 'جلسة جديدة' : 'New session'}
                </BtnPrimary>
            </div>

            {list.length === 0 ? (
                <EmptyPanel
                    icon={CalendarDays}
                    title={isAr ? 'لم تُجدول أي جلسات بعد' : 'No sessions scheduled yet'}
                />
            ) : (
                <div className="space-y-3">
                    {list.map((s) => {
                        const startsAt = new Date(s.scheduledAt);
                        const endsAt = s.durationMinutes
                            ? new Date(startsAt.getTime() + s.durationMinutes * 60000)
                            : null;
                        const time = (d: Date) => d.toLocaleTimeString(isAr ? 'ar-SA' : 'en-US', { hour: 'numeric', minute: '2-digit' });

                        return (
                            <div key={s.id} className="bg-brand-navy-dark border border-white/5 rounded-2xl p-5">
                                <div className="flex items-start justify-between gap-4 flex-wrap">
                                    <div className="min-w-0">
                                        <p className="font-bold text-white truncate">{label(s)}</p>
                                        <p className="text-xs text-gray-500 mt-1 flex items-center gap-1.5 flex-wrap">
                                            <CalendarDays size={12} />
                                            <span>
                                                {startsAt.toLocaleDateString(isAr ? 'ar-SA' : 'en-US', {
                                                    weekday: 'short', month: 'short', day: 'numeric',
                                                })}
                                            </span>
                                            <span>
                                                {time(startsAt)}
                                                {endsAt ? ` — ${time(endsAt)}` : ''}
                                            </span>
                                            {s.durationMinutes ? (
                                                <span className="inline-flex items-center gap-1">
                                                    <Clock size={12} />
                                                    {s.durationMinutes} {isAr ? 'دقيقة' : 'min'}
                                                </span>
                                            ) : null}
                                        </p>
                                        <p className="text-xs text-gray-500 mt-1.5 inline-flex items-center gap-1.5">
                                            <Link2 size={12} className={s.meetLink ? 'text-emerald-400' : 'text-gray-600'} />
                                            {s.meetLink
                                                ? s.meetLink
                                                : (isAr ? 'يستخدم رابط الباقة' : 'Uses the batch link')}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setAttendanceSessionId((current) => current === s.id ? null : s.id)}
                                            aria-expanded={attendanceSessionId === s.id}
                                            className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border transition ${
                                                attendanceSessionId === s.id
                                                    ? 'text-brand-gold-light bg-brand-gold/10 border-brand-gold/20'
                                                    : 'text-gray-300 bg-white/5 border-white/10 hover:bg-white/10'
                                            }`}
                                        >
                                            <ClipboardCheck size={13} /> {isAr ? 'الحضور' : 'Attendance'}
                                        </button>
                                        {s.meetLink && (
                                            <a
                                                href={s.meetLink}
                                                target="_blank"
                                                rel="noreferrer noopener"
                                                title={isAr ? 'فتح الغرفة' : 'Open the room'}
                                                className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-lg hover:bg-emerald-500/20 transition"
                                            >
                                                <Video size={13} /> {isAr ? 'دخول' : 'Join'}
                                            </a>
                                        )}
                                        <button
                                            onClick={() => openEdit(s)}
                                            className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-300 bg-white/5 border border-white/10 px-3 py-1.5 rounded-lg hover:bg-white/10 transition cursor-pointer"
                                        >
                                            <Pencil size={13} /> {isAr ? 'تعديل' : 'Edit'}
                                        </button>
                                        <button
                                            onClick={() => remove(s)}
                                            className="inline-flex items-center gap-1.5 text-xs font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-1.5 rounded-lg hover:bg-red-500 hover:text-white transition cursor-pointer"
                                        >
                                            <Trash2 size={13} /> {isAr ? 'حذف' : 'Delete'}
                                        </button>
                                    </div>
                                </div>
                                {attendanceSessionId === s.id && (
                                    <SessionAttendancePanel openingId={openingId} sessionId={s.id} />
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {modalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                    <div className="bg-brand-navy-dark border border-white/10 rounded-2xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-5">
                            <h3 className="text-lg font-black text-white">
                                {editing
                                    ? (isAr ? 'تعديل الجلسة' : 'Edit session')
                                    : (isAr ? 'جلسة جديدة' : 'New session')}
                            </h3>
                            <button onClick={() => setModalOpen(false)} className="text-gray-500 hover:text-white cursor-pointer">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-400 mb-1.5">
                                    {isAr ? 'العنوان بالعربي' : 'Title in Arabic'} *
                                </label>
                                <input
                                    type="text"
                                    dir="rtl"
                                    value={form.titleAr}
                                    onChange={(e) => setForm((f) => ({ ...f, titleAr: e.target.value }))}
                                    className="w-full px-4 py-3 bg-brand-navy border border-white/10 rounded-xl focus:ring-2 focus:ring-brand-gold outline-none text-white text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-400 mb-1.5">
                                    {isAr ? 'العنوان بالإنجليزي' : 'Title in English'} *
                                </label>
                                <input
                                    type="text"
                                    value={form.titleEn}
                                    onChange={(e) => setForm((f) => ({ ...f, titleEn: e.target.value }))}
                                    className="w-full px-4 py-3 bg-brand-navy border border-white/10 rounded-xl focus:ring-2 focus:ring-brand-gold outline-none text-white text-sm"
                                />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-400 mb-1.5">
                                        {isAr ? 'التاريخ والوقت' : 'Date and time'} *
                                    </label>
                                    <input
                                        type="datetime-local"
                                        value={form.scheduledAt}
                                        onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
                                        className="w-full px-4 py-3 bg-brand-navy border border-white/10 rounded-xl focus:ring-2 focus:ring-brand-gold outline-none text-white text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-400 mb-1.5">
                                        {isAr ? 'المدة (دقيقة)' : 'Duration (minutes)'}
                                    </label>
                                    <input
                                        type="number"
                                        min={5}
                                        max={600}
                                        step={5}
                                        placeholder="90"
                                        value={form.durationMinutes}
                                        onChange={(e) => setForm((f) => ({ ...f, durationMinutes: e.target.value }))}
                                        className="w-full px-4 py-3 bg-brand-navy border border-white/10 rounded-xl focus:ring-2 focus:ring-brand-gold outline-none text-white text-sm"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-400 mb-1.5">
                                    {isAr ? 'رابط الغرفة (اختياري)' : 'Room link (optional)'}
                                </label>
                                <input
                                    type="url"
                                    dir="ltr"
                                    placeholder="https://meet.google.com/..."
                                    value={form.meetLink}
                                    onChange={(e) => setForm((f) => ({ ...f, meetLink: e.target.value }))}
                                    className="w-full px-4 py-3 bg-brand-navy border border-white/10 rounded-xl focus:ring-2 focus:ring-brand-gold outline-none text-white text-sm"
                                />
                                <p className="text-xs text-gray-500 mt-1.5">
                                    {isAr
                                        ? 'اتركه فارغًا لاستخدام رابط الباقة. يقبل Google Meet أو Zoom أو Teams عبر https.'
                                        : 'Leave empty to use the batch’s own link. Google Meet, Zoom or Teams over https.'}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-3 mt-6">
                            <button
                                onClick={() => setModalOpen(false)}
                                className="px-5 py-2.5 rounded-xl text-sm font-bold text-gray-400 hover:text-white hover:bg-white/5 transition cursor-pointer"
                            >
                                {t('common.cancel')}
                            </button>
                            <button
                                onClick={save}
                                disabled={saving}
                                className="px-5 py-2.5 rounded-xl text-sm font-bold bg-brand-gold text-brand-navy-dark hover:bg-brand-gold-light transition disabled:opacity-50 cursor-pointer"
                            >
                                {saving ? (isAr ? 'جارٍ الحفظ...' : 'Saving...') : (isAr ? 'حفظ' : 'Save')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}