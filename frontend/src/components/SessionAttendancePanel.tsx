"use client";

import { useEffect, useState } from 'react';
import { api, getErrorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n-context';
import toast from 'react-hot-toast';
import { Check, Loader, Save, Users } from 'lucide-react';

type AttendanceStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED';

interface AttendanceRow {
    enrollmentId: string;
    studentId: string;
    studentName?: string | null;
    email: string;
    status: AttendanceStatus | null;
    note?: string | null;
    markedAt?: string | null;
}

const STATUS_OPTIONS: AttendanceStatus[] = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'];

export default function SessionAttendancePanel({
    openingId,
    sessionId,
}: {
    openingId: string;
    sessionId: string;
}) {
    const { locale } = useI18n();
    const isAr = locale === 'ar';
    const [rows, setRows] = useState<AttendanceRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        api.get(`/openings/${openingId}/sessions/${sessionId}/attendance`)
            .then((response) => {
                if (active) {
                    setRows(response.data);
                    setError(null);
                }
            })
            .catch((err: unknown) => {
                if (active) setError(getErrorMessage(err) || (isAr ? 'تعذر تحميل سجل الحضور' : 'Could not load attendance'));
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => { active = false; };
    }, [openingId, sessionId, isAr]);

    const statusLabel = (status: AttendanceStatus) => {
        if (isAr) {
            return {
                PRESENT: 'حاضر',
                LATE: 'متأخر',
                ABSENT: 'غائب',
                EXCUSED: 'بعذر',
            }[status];
        }
        return {
            PRESENT: 'Present',
            LATE: 'Late',
            ABSENT: 'Absent',
            EXCUSED: 'Excused',
        }[status];
    };

    const save = async () => {
        const records = rows
            .filter((row): row is AttendanceRow & { status: AttendanceStatus } => row.status !== null)
            .map(({ enrollmentId, status, note }) => ({ enrollmentId, status, note: note || undefined }));
        if (!records.length) {
            toast.error(isAr ? 'حدد حالة حضور طالب واحد على الأقل' : 'Mark at least one student');
            return;
        }

        setSaving(true);
        try {
            const response = await api.put(`/openings/${openingId}/sessions/${sessionId}/attendance`, { records });
            setRows(response.data);
            toast.success(isAr ? 'تم حفظ الحضور' : 'Attendance saved');
        } catch (err) {
            toast.error(getErrorMessage(err) || (isAr ? 'تعذر حفظ الحضور' : 'Could not save attendance'));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="flex items-center justify-center py-8"><Loader size={20} className="animate-spin text-brand-gold-light" /></div>;
    }

    if (error) {
        return <div role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">{error}</div>;
    }

    return (
        <div className="mt-4 border-t border-white/10 pt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="inline-flex items-center gap-2 text-sm font-bold text-white">
                    <Users size={16} className="text-brand-gold-light" />
                    {isAr ? `سجل الحضور (${rows.length} طالب)` : `Attendance (${rows.length} students)`}
                </p>
                <button
                    type="button"
                    onClick={save}
                    disabled={saving || rows.length === 0}
                    className="inline-flex items-center gap-2 rounded-lg bg-brand-gold px-3 py-2 text-xs font-black text-brand-navy-dark transition hover:bg-brand-gold-light disabled:opacity-50"
                >
                    {saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
                    {isAr ? 'حفظ الحضور المحدد' : 'Save marked students'}
                </button>
            </div>

            {rows.length === 0 ? (
                <p className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-400">
                    {isAr ? 'لا يوجد طلاب مقبولون في هذه الدفعة.' : 'There are no approved students in this batch.'}
                </p>
            ) : (
                <div className="space-y-2">
                    {rows.map((row) => (
                        <div key={row.enrollmentId} className="grid gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:grid-cols-[minmax(0,1fr)_160px_minmax(160px,0.8fr)] sm:items-center">
                            <div className="min-w-0">
                                <p className="truncate text-sm font-bold text-white">
                                    {row.studentName || row.email}
                                </p>
                                {row.studentName && <p className="truncate text-xs text-gray-500">{row.email}</p>}
                            </div>
                            <label className="sr-only" htmlFor={`attendance-${row.enrollmentId}`}>
                                {isAr ? 'حالة الحضور' : 'Attendance status'}
                            </label>
                            <select
                                id={`attendance-${row.enrollmentId}`}
                                value={row.status ?? ''}
                                onChange={(event) => {
                                    const status = event.target.value as AttendanceStatus | '';
                                    setRows((current) => current.map((item) => item.enrollmentId === row.enrollmentId
                                        ? { ...item, status: status || null }
                                        : item));
                                }}
                                className="w-full rounded-lg border border-white/10 bg-brand-navy px-3 py-2 text-sm text-white outline-none focus:border-brand-gold"
                            >
                                <option value="">{isAr ? 'لم يحدد' : 'Not marked'}</option>
                                {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
                            </select>
                            <label className="flex min-w-0 items-center gap-2 rounded-lg border border-white/10 px-2.5 py-2 text-xs text-gray-400">
                                <Check size={13} className="shrink-0" />
                                <input
                                    value={row.note ?? ''}
                                    onChange={(event) => setRows((current) => current.map((item) => item.enrollmentId === row.enrollmentId
                                        ? { ...item, note: event.target.value }
                                        : item))}
                                    maxLength={1000}
                                    placeholder={isAr ? 'ملاحظة (اختياري)' : 'Note (optional)'}
                                    className="min-w-0 flex-1 bg-transparent text-white outline-none placeholder:text-gray-500"
                                />
                            </label>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
