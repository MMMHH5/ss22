"use client";

import { useEffect, useState } from 'react';
import ProtectedRoute from '@/components/ProtectedRoute';
import { api, getErrorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n-context';
import toast from 'react-hot-toast';
import { Loader, Send, LifeBuoy, Inbox as InboxIcon } from 'lucide-react';
import { PageHeader, Badge } from '@/app/dashboard/admin/components';

interface Ticket {
    id: string;
    subject: string;
    message: string;
    status: string;
    adminNotes?: string | null;
    createdAt: string;
}

const ticketTone: Record<string, 'amber' | 'blue' | 'green'> = {
    OPEN: 'amber',
    IN_PROGRESS: 'blue',
    CLOSED: 'green',
};
const ticketKey: Record<string, string> = {
    OPEN: 'support.status_open',
    IN_PROGRESS: 'support.status_in_progress',
    CLOSED: 'support.status_closed',
};

export default function SupportPage() {
    const { t } = useI18n();
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [loading, setLoading] = useState(true);
    const [subject, setSubject] = useState('');
    const [message, setMessage] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);

    useEffect(() => {
        let active = true;
        const run = async () => {
            try {
                const res = await api.get('/support-tickets/my');
                if (active) setTickets(res.data);
            } catch (err) {
                if (active) toast.error(getErrorMessage(err) || t('support.submit_fail'));
            } finally {
                if (active) setLoading(false);
            }
        };
        run();
        return () => { active = false; };
    }, [refreshKey, t]);

    const submit = async () => {
        if (!subject.trim()) { toast.error(t('support.subject_required')); return; }
        if (!message.trim()) { toast.error(t('support.message_required')); return; }
        setSubmitting(true);
        try {
            await api.post('/support-tickets', { subject: subject.trim(), message: message.trim() });
            toast.success(t('support.submit_success'));
            setSubject('');
            setMessage('');
            setRefreshKey((k) => k + 1);
        } catch (err) {
            toast.error(getErrorMessage(err) || t('support.submit_fail'));
        }
        setSubmitting(false);
    };

    const inputCls = "w-full px-4 py-3 bg-white dark:bg-brand-navy-dark border border-gray-300 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none transition text-brand-navy dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500";

    return (
        <ProtectedRoute>
            <div className="min-w-0 space-y-5 sm:space-y-6 animate-fade-in max-w-5xl">
                <PageHeader title={t('support.title')} subtitle={t('support.subtitle')} />

                <div className="grid min-w-0 lg:grid-cols-2 gap-4 sm:gap-6">
                    {/* New request form */}
                    <div className="min-w-0 bg-white dark:bg-brand-navy-dark p-4 sm:p-6 lg:p-8 rounded-2xl sm:rounded-3xl shadow-sm border border-gray-200 dark:border-white/5">
                        <h3 className="text-lg sm:text-xl font-black text-brand-navy dark:text-white mb-5 flex items-center gap-2">
                            <span className="admin-tile w-9 h-9 bg-brand-navy/5 dark:bg-white/5 text-brand-gold-dark dark:text-brand-gold-light"><LifeBuoy size={18} /></span>
                            {t('support.new_ticket_title')}
                        </h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-gray-600 dark:text-gray-300 mb-1">{t('support.subject')} *</label>
                                <input value={subject} onChange={(e) => setSubject(e.target.value)} className={inputCls} placeholder={t('support.subject_placeholder')} />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-gray-600 dark:text-gray-300 mb-1">{t('support.message')} *</label>
                                <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} className={`${inputCls} resize-none`} placeholder={t('support.message_placeholder')} />
                            </div>
                            <button
                                onClick={submit}
                                disabled={submitting}
                                className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-r from-brand-gold to-brand-gold-dark text-black font-bold py-3.5 rounded-xl hover:from-brand-gold-light hover:to-brand-gold shadow-md transition disabled:opacity-50 cursor-pointer"
                            >
                                {submitting ? <Loader size={18} className="animate-spin" /> : <Send size={18} />}
                                {submitting ? t('support.submitting') : t('support.submit')}
                            </button>
                        </div>
                    </div>

                    {/* My tickets */}
                    <div className="min-w-0 bg-white dark:bg-brand-navy-dark p-4 sm:p-6 lg:p-8 rounded-2xl sm:rounded-3xl shadow-sm border border-gray-200 dark:border-white/5">
                        <h3 className="text-lg sm:text-xl font-black text-brand-navy dark:text-white mb-5 flex items-center gap-2">
                            <span className="admin-tile w-9 h-9 bg-brand-navy/5 dark:bg-white/5 text-brand-gold-dark dark:text-brand-gold-light"><InboxIcon size={18} /></span>
                            {t('support.my_tickets')}
                        </h3>
                        {loading ? (
                            <div className="h-40 flex items-center justify-center"><Loader className="animate-spin text-brand-gold-dark dark:text-brand-gold-light" size={28} /></div>
                        ) : tickets.length === 0 ? (
                            <p className="text-gray-500 dark:text-gray-400 font-bold text-sm text-center py-10">{t('support.no_tickets')}</p>
                        ) : (
                            <div className="space-y-3 max-h-[480px] overflow-y-auto admin-scroll">
                                {tickets.map((tk) => (
                                    <div key={tk.id} className="border border-white/5 rounded-2xl p-4 bg-brand-navy">
                                        <div className="flex items-center justify-between gap-2 mb-1.5">
                                            <span className="font-black text-white text-sm truncate">{tk.subject}</span>
                                            <Badge tone={ticketTone[tk.status] ?? 'gray'}>{t(ticketKey[tk.status] ?? '')}</Badge>
                                        </div>
                                        <p className="text-sm text-gray-300 whitespace-pre-wrap break-words mb-2">{tk.message}</p>
                                        {tk.adminNotes && (
                                            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 mt-2">
                                                <p className="text-[11px] font-black text-emerald-400 mb-0.5">{t('support.admin_response')}</p>
                                                <p className="text-sm text-emerald-300 whitespace-pre-wrap break-words">{tk.adminNotes}</p>
                                            </div>
                                        )}
                                        <p className="text-[11px] text-gray-500 mt-2">{new Date(tk.createdAt).toLocaleString()}</p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </ProtectedRoute>
    );
}
