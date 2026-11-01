"use client";

import ProtectedRoute from '@/components/ProtectedRoute';
import { useFetchData } from '@/lib/useFetchData';
import { useI18n } from '@/lib/i18n-context';
import { api, getErrorMessage, fetchProtectedFile } from '@/lib/api';
import { formatPrice, formatDate } from '@/lib/format';
import toast from 'react-hot-toast';
import { useState } from 'react';
import { RotateCcw, X, CheckCircle, Clock, XCircle, Receipt, AlertTriangle, Loader } from 'lucide-react';

interface Eligibility {
    paymentId: string;
    courseId: string | null;
    course?: { id: string; titleAr?: string | null; titleEn?: string | null } | null;
    openingId: string | null;
    openingNameAr?: string | null;
    openingNameEn?: string | null;
    amount: number;
    currency: string;
    receiptFileUrl: string | null;
    enrollmentId: string | null;
    paidAt: string;
    startDate: string | null;
    refundWindowDays: number | null;
    deadline: string | null;
    eligible: boolean;
    reason: string | null;
    requestId: string | null;
    requestStatus: string | null;
}

interface RefundRequest {
    id: string;
    status: string;
    amount: number | string;
    currency: string;
    method: string;
    accountName: string;
    accountNumber: string;
    studentNote?: string | null;
    reviewerNote?: string | null;
    reviewedAt?: string | null;
    createdAt: string;
    course?: { titleAr?: string | null; titleEn?: string | null } | null;
    opening?: { nameAr?: string | null; nameEn?: string | null } | null;
}

type Method = 'WALLET' | 'BANK';

export default function RefundsPage() {
    const { t, pick, locale } = useI18n();
    const { data: eligibleItems, loading, error, refetch: refetchEligibility } = useFetchData<Eligibility[]>('/refunds/eligibility');
    const { data: myRequests, loading: requestsLoading, refetch: refetchRequests } = useFetchData<RefundRequest[]>('/refunds/mine');

    const [selected, setSelected] = useState<Eligibility | null>(null);
    const [method, setMethod] = useState<Method>('BANK');
    const [accountName, setAccountName] = useState('');
    const [accountNumber, setAccountNumber] = useState('');
    const [note, setNote] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
    const [receiptLoading, setReceiptLoading] = useState(false);
    const [receiptError, setReceiptError] = useState<string | null>(null);

    const money = (amount: number | string, currency?: string) =>
        formatPrice(amount, { currency: currency || undefined, locale });

    const statusBadge = (status: string) => {
        const cls = status === 'APPROVED' ? 'bg-green-500/10 text-green-400 border-green-500/20'
            : status === 'REJECTED' ? 'bg-red-500/10 text-red-400 border-red-500/20'
                : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
        const Icon = status === 'APPROVED' ? CheckCircle : status === 'REJECTED' ? XCircle : Clock;
        return (
            <span className={`px-3 py-1 text-xs font-bold rounded-full border flex items-center gap-1.5 w-fit ${cls}`}>
                <Icon size={12} /> {t('statuses.' + (status || '').toLowerCase())}
            </span>
        );
    };

    const openModal = async (item: Eligibility) => {
        setSelected(item);
        setMethod('BANK');
        setAccountName('');
        setAccountNumber('');
        setNote('');
        setReceiptUrl(null);
        setReceiptError(null);
        if (item.enrollmentId && item.receiptFileUrl) {
            setReceiptLoading(true);
            try {
                const { url } = await fetchProtectedFile(`/enrollments/${item.enrollmentId}/receipt`);
                setReceiptUrl(url);
            } catch (err) {
                setReceiptError(getErrorMessage(err) || t('refunds.receipt_failed'));
            } finally {
                setReceiptLoading(false);
            }
        }
    };

    const closeModal = () => {
        if (receiptUrl && receiptUrl.startsWith('blob:')) URL.revokeObjectURL(receiptUrl);
        setSelected(null);
        setReceiptUrl(null);
        setReceiptError(null);
    };

    const submit = async () => {
        if (!selected?.courseId) return;
        if (!accountName.trim() || !accountNumber.trim()) {
            toast.error(t('refunds.need_all_fields'));
            return;
        }
        setSubmitting(true);
        try {
            await api.post('/refunds', {
                courseId: selected.courseId,
                method,
                accountName: accountName.trim(),
                accountNumber: accountNumber.trim(),
                studentNote: note.trim() || undefined,
            });
            toast.success(t('refunds.request_success'));
            closeModal();
            refetchEligibility();
            refetchRequests();
        } catch (err) {
            toast.error(getErrorMessage(err) || t('refunds.request_failed'));
        } finally {
            setSubmitting(false);
        }
    };

    const eligible = (eligibleItems || []).filter(i => i.eligible);

    return (
        <ProtectedRoute allowedRoles={['STUDENT']}>
            <div className="min-w-0 bg-white dark:bg-brand-navy-dark p-4 sm:p-6 lg:p-8 rounded-2xl sm:rounded-3xl shadow-sm border border-gray-200 dark:border-white/5 min-h-[80vh] space-y-8 sm:space-y-10">
                <div className="mb-2">
                    <h2 className="text-2xl sm:text-3xl font-black text-brand-navy dark:text-white flex items-center gap-2 sm:gap-3">
                        <RotateCcw size={26} className="shrink-0 text-brand-gold-dark dark:text-brand-gold-light sm:w-8 sm:h-8" /> {t('refunds.title')}
                    </h2>
                    <p className="text-gray-500 dark:text-gray-400 mt-2">{t('refunds.subtitle')}</p>
                </div>

                {error && <div className="p-4 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 rounded-xl">{error}</div>}

                {/* Enrollments that can be refunded now */}
                <section>
                    <h3 className="text-xl font-black text-brand-navy dark:text-white mb-4">{t('refunds.section_eligible')}</h3>
                    {loading ? (
                        <div className="h-32 flex items-center justify-center font-bold text-gray-500 dark:text-gray-400">{t('common.loading')}</div>
                    ) : eligible.length === 0 ? (
                        <div className="text-center py-12 text-gray-500 dark:text-gray-400 font-semibold border-2 border-dashed border-gray-300 dark:border-white/10 rounded-xl">
                            {t('refunds.empty_eligible')}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {eligible.map(item => (
                                <div key={item.paymentId} className="border border-white/5 rounded-2xl p-5 bg-gray-50 dark:bg-brand-navy flex flex-col gap-3">
                                    <div className="min-w-0">
                                        <h4 className="font-black text-brand-navy dark:text-white text-lg line-clamp-2">{pick(item.course, 'title')}</h4>
                                        {(item.openingNameAr || item.openingNameEn) && (
                                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{locale === 'ar' ? item.openingNameAr : item.openingNameEn}</p>
                                        )}
                                        <p className="text-sm mt-1 text-green-600 dark:text-green-400 font-bold">{money(item.amount, item.currency)}</p>
                                        {item.deadline && (
                                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                {t('refunds.eligible_until')} {formatDate(item.deadline, { locale })}
                                            </p>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => openModal(item)}
                                        className="bg-gradient-to-r from-brand-gold to-brand-gold-dark text-black text-sm font-bold px-4 py-2.5 rounded-xl hover:from-brand-gold-light hover:to-brand-gold transition w-fit"
                                    >
                                        {t('refunds.request_btn')}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                {/* My requests */}
                <section>
                    <h3 className="text-xl font-black text-brand-navy dark:text-white mb-4">{t('refunds.section_requests')}</h3>
                    {requestsLoading ? (
                        <div className="h-32 flex items-center justify-center font-bold text-gray-500 dark:text-gray-400">{t('common.loading')}</div>
                    ) : (myRequests || []).length === 0 ? (
                        <div className="text-center py-12 text-gray-500 dark:text-gray-400 font-semibold border-2 border-dashed border-gray-300 dark:border-white/10 rounded-xl">
                            {t('refunds.empty_requests')}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {(myRequests || []).map(r => (
                                <div key={r.id} className="border border-white/5 rounded-2xl p-5 bg-gray-50 dark:bg-brand-navy">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <h4 className="font-black text-brand-navy dark:text-white text-lg line-clamp-2">{pick(r.course, 'title')}</h4>
                                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                                {t('refunds.requested_at')} {formatDate(r.createdAt, { locale })}
                                            </p>
                                        </div>
                                        {statusBadge(r.status)}
                                    </div>
                                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm text-gray-600 dark:text-gray-300">
                                        <span>{t('refunds.amount')}: <strong className="text-brand-navy dark:text-white">{money(r.amount, r.currency)}</strong></span>
                                        <span>{t('refunds.method')}: <strong className="text-brand-navy dark:text-white">{r.method === 'WALLET' ? t('refunds.method_wallet') : t('refunds.method_bank')}</strong></span>
                                        <span>{t('refunds.account_holder')}: <strong className="text-brand-navy dark:text-white">{r.accountName}</strong></span>
                                        <span>{t('refunds.account_number')}: <strong className="text-brand-navy dark:text-white break-all">{r.accountNumber}</strong></span>
                                    </div>
                                    {r.studentNote && (
                                        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400"><strong>{t('refunds.note')}:</strong> {r.studentNote}</p>
                                    )}
                                    {r.reviewerNote && (
                                        <div className={`mt-3 p-3 rounded-xl text-sm border ${r.status === 'REJECTED' ? 'bg-red-500/10 text-red-500 border-red-500/20' : 'bg-green-500/10 text-green-500 border-green-500/20'}`}>
                                            <strong>{t('refunds.reviewer_note')}:</strong> {r.reviewerNote}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </div>

            {/* Request modal */}
            {selected && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-brand-navy-dark rounded-2xl w-full max-w-lg p-7 shadow-2xl max-h-[90vh] overflow-y-auto border border-gray-200 dark:border-white/10">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-2xl font-black text-brand-navy dark:text-white">{t('refunds.modal_title')}</h2>
                            <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 dark:hover:text-white transition" aria-label="Close">
                                <X size={22} />
                            </button>
                        </div>
                        <p className="text-gray-500 dark:text-gray-400 mb-1">{pick(selected.course, 'title')}</p>
                        <p className="text-lg font-black text-green-600 dark:text-green-400 mb-5">{money(selected.amount, selected.currency)}</p>

                        {/* Existing registration receipt */}
                        <div className="mb-5">
                            <label className="block text-sm font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider mb-2">{t('refunds.registration_receipt')}</label>
                            {receiptLoading ? (
                                <div className="flex items-center gap-2 text-sm text-gray-500"><Loader className="animate-spin" size={16} /> {t('refunds.receipt_loading')}</div>
                            ) : receiptUrl ? (
                                <button
                                    onClick={() => window.open(receiptUrl, '_blank', 'noopener')}
                                    className="inline-flex items-center gap-2 text-sm font-bold px-4 py-2.5 rounded-xl border border-gray-300 dark:border-white/10 text-brand-navy dark:text-white hover:border-brand-gold transition"
                                    type="button"
                                >
                                    <Receipt size={16} /> {t('refunds.view_receipt')}
                                </button>
                            ) : (
                                <p className="text-sm p-3 rounded-xl border flex items-center gap-2 text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/5 border-gray-200 dark:border-white/10">
                                    <AlertTriangle size={16} className="flex-shrink-0 text-brand-gold" />
                                    {receiptError || t('refunds.no_receipt')}
                                </p>
                            )}
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider mb-2">{t('refunds.method')}</label>
                                <select
                                    value={method}
                                    onChange={(e) => setMethod(e.target.value as Method)}
                                    className="w-full border border-gray-300 dark:border-white/10 rounded-xl px-4 py-3 bg-white dark:bg-brand-navy-dark font-semibold text-brand-navy dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-gold"
                                >
                                    <option value="BANK">{t('refunds.method_bank')}</option>
                                    <option value="WALLET">{t('refunds.method_wallet')}</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider mb-2">{t('refunds.account_holder')}</label>
                                <input
                                    value={accountName}
                                    onChange={(e) => setAccountName(e.target.value)}
                                    className="w-full border border-gray-300 dark:border-white/10 rounded-xl px-4 py-3 bg-white dark:bg-brand-navy-dark font-semibold text-brand-navy dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-gold"
                                    placeholder={t('refunds.account_holder_ph')}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider mb-2">{t('refunds.account_number')}</label>
                                <input
                                    value={accountNumber}
                                    onChange={(e) => setAccountNumber(e.target.value)}
                                    dir="ltr"
                                    className="w-full border border-gray-300 dark:border-white/10 rounded-xl px-4 py-3 bg-white dark:bg-brand-navy-dark font-mono font-semibold text-brand-navy dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-gold"
                                    placeholder={t('refunds.account_number_ph')}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider mb-2">{t('refunds.note')}</label>
                                <textarea
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                    rows={2}
                                    className="w-full border border-gray-300 dark:border-white/10 rounded-xl px-4 py-3 bg-white dark:bg-brand-navy-dark text-brand-navy dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-gold"
                                    placeholder={t('refunds.note_ph')}
                                />
                            </div>
                        </div>

                        <div className="flex gap-3 mt-7">
                            <button
                                onClick={submit}
                                disabled={submitting}
                                className="flex-1 bg-gradient-to-r from-brand-gold to-brand-gold-dark text-black py-3 font-bold rounded-xl shadow-sm transition disabled:opacity-50"
                            >
                                {submitting ? t('common.submitting') : t('refunds.submit')}
                            </button>
                            <button
                                onClick={closeModal}
                                disabled={submitting}
                                className="flex-1 bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-white hover:bg-gray-200 dark:hover:bg-white/10 py-3 font-bold rounded-xl transition border border-gray-200 dark:border-white/10"
                            >
                                {t('common.cancel')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </ProtectedRoute>
    );
}
