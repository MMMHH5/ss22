"use client";

import { useEffect, useState } from 'react';
import { api, getErrorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n-context';
import { CalendarCheck, Loader } from 'lucide-react';

type AttendanceStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED';

interface AttendanceSession {
    id: string;
    titleAr: string;
    titleEn: string;
    scheduledAt: string;
    status: AttendanceStatus | null;
    note?: string | null;
    markedAt?: string | null;
}

export default function StudentAttendanceHistory({ openingId }: { openingId: string }) {
    const { locale } = useI18n();
    const isAr = locale === 'ar';
    const [sessions, setSessions] = useState<AttendanceSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        api.get(`/openings/${openingId}/sessions/my-attendance`)
            .then((response) => {
                if (active) setSessions(response.data);
            })
            .catch((err: unknown) => {
                if (active) setError(getErrorMessage(err) || (isAr ? 'تعذر تحميل سجل الحضور' : 'Could not load attendance history'));
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => { active = false; };
    }, [openingId, isAr]);

    const statusLabel = (status: AttendanceStatus | null) => {
        if (isAr) {
            return status ? {
                PRESENT: 'حاضر',
                LATE: 'متأخر',
                ABSENT: 'غائب',
                EXCUSED: 'بعذر',
            }[status] : 'لم يرصد بعد';
        }
        return status ? {
            PRESENT: 'Present',
            LATE: 'Late',
            ABSENT: 'Absent',
            EXCUSED: 'Excused',
        }[status] : 'Not recorded';
    };

    const statusStyle = (status: AttendanceStatus | null) => {
        if (status === 'PRESENT') return 'bg-emerald-500/10 text-emerald-300';
        if (status === 'LATE') return 'bg-amber-500/10 text-amber-300';
        if (status === 'ABSENT') return 'bg-red-500/10 text-red-300';
        if (status === 'EXCUSED') return 'bg-sky-500/10 text-sky-300';
        return 'bg-white/5 text-gray-400';
    };

    return (
        <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-black text-white">
                <CalendarCheck size={16} className="text-brand-gold-light" />
                {isAr ? 'سجل حضوري' : 'My attendance'}
            </h3>
            {loading ? (
                <div className="flex justify-center py-6"><Loader size={20} className="animate-spin text-brand-gold-light" /></div>
            ) : error ? (
                <p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">{error}</p>
            ) : sessions.length === 0 ? (
                <p className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-gray-400">
                    {isAr ? 'لا توجد جلسات مسجلة لهذه الدفعة.' : 'No sessions are scheduled for this batch.'}
                </p>
            ) : (
                <div className="space-y-2">
                    {sessions.map((session) => (
                        <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                            <div>
                                <p className="text-sm font-bold text-white">{isAr ? session.titleAr : session.titleEn}</p>
                                <p className="mt-1 text-xs text-gray-400">
                                    {new Date(session.scheduledAt).toLocaleString(isAr ? 'ar-SA' : 'en-US', {
                                        dateStyle: 'medium',
                                        timeStyle: 'short',
                                    })}
                                </p>
                                {session.note && <p className="mt-1 text-xs text-gray-400">{session.note}</p>}
                            </div>
                            <span className={`rounded-full px-3 py-1 text-xs font-black ${statusStyle(session.status)}`}>
                                {statusLabel(session.status)}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
