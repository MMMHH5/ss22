"use client";

import { useState } from 'react';
import Link from 'next/link';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useFetchData } from '@/lib/useFetchData';
import { api, getErrorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n-context';
import toast from 'react-hot-toast';
import { Lightbulb, X, Loader, ClipboardList, Clock } from 'lucide-react';

interface RequestRow {
    id: string;
    status: string;
    reason?: string | null;
    reviewNotes?: string | null;
    reviewedAt?: string | null;
    createdAt: string;
    course?: { id: string; titleAr?: string | null; titleEn?: string | null } | null;
    opening?: {
        id: string;
        nameAr?: string | null;
        nameEn?: string | null;
        status?: string;
        course?: { id: string; titleAr?: string | null; titleEn?: string | null } | null;
    } | null;
    titleAr?: string;
    titleEn?: string;
    categoryAr?: string | null;
    categoryEn?: string | null;
    description?: string | null;
}

const statusColors: Record<string, string> = {
    PENDING: 'bg-brand-gold/10 text-brand-gold-light border border-brand-gold/20',
    APPROVED: 'bg-green-500/10 text-green-400 border border-green-500/20',
    REJECTED: 'bg-red-500/10 text-red-400 border border-red-500/20',
};

const statusLabels: Record<string, string> = {
    PENDING: 'قيد المراجعة',
    APPROVED: 'موافق عليه',
    REJECTED: 'مرفوض',
};

const statusLabelsEn: Record<string, string> = {
    PENDING: 'Pending',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
};

export default function SuggestionsPage() {
    const { t, pick, locale } = useI18n();
    const isAr = locale === 'ar';
    const { data: suggestions, loading, error, refetch } = useFetchData<RequestRow[]>('/instructor-requests/suggestions/my');

    const [showModal, setShowModal] = useState(false);
    const [sTitleAr, setSTitleAr] = useState('');
    const [sTitleEn, setSTitleEn] = useState('');
    const [sCatAr, setSCatAr] = useState('');
    const [sCatEn, setSCatEn] = useState('');
    const [sDesc, setSDesc] = useState('');
    const [saving, setSaving] = useState(false);

    const totalSuggestions = (suggestions || []).length;
    const pendingSuggestions = (suggestions || []).filter(r => r.status === 'PENDING').length;

    const openModal = () => { setSTitleAr(''); setSTitleEn(''); setSCatAr(''); setSCatEn(''); setSDesc(''); setShowModal(true); };

    const suggestCourse = async () => {
        if (!sTitleAr.trim() || !sTitleEn.trim()) { toast.error(isAr ? 'أدخل عنوان الدورة بالعربي والإنجليزي' : 'Fill both titles'); return; }
        setSaving(true);
        try {
            await api.post('/instructor-requests/suggestions', {
                titleAr: sTitleAr.trim(), titleEn: sTitleEn.trim(),
                categoryAr: sCatAr.trim() || undefined, categoryEn: sCatEn.trim() || undefined,
                description: sDesc.trim() || undefined,
            });
            toast.success(isAr ? 'تم إرسال الاقتراح' : 'Suggestion submitted');
            setShowModal(false); refetch();
        } catch (err) { toast.error(getErrorMessage(err) || t('common.error')); }
        setSaving(false);
    };

    const inputCls = "w-full px-4 py-3 bg-brand-navy-dark border border-white/10 rounded-xl text-white placeholder:text-gray-500 focus:ring-2 focus:ring-brand-gold/40 focus:border-brand-gold/40 outline-none transition";

    return (
        <ProtectedRoute allowedRoles={['INSTRUCTOR']}>
            <div className="min-w-0 bg-gray-50 dark:bg-brand-navy-dark space-y-5 sm:space-y-6 animate-fade-in p-3 sm:p-4 lg:p-8">
                {/* Tab Navigation */}
                <div className="flex max-w-full gap-1 bg-brand-navy-dark border border-white/5 rounded-xl p-1 overflow-x-auto">
                    <Link href="/dashboard/teaching"
                        className="shrink-0 px-4 py-2 rounded-lg text-sm font-bold transition-all text-gray-400 hover:text-white">
                        {isAr ? 'الدورات المسندة' : 'My Openings'}
                    </Link>
                    <span className="shrink-0 px-4 py-2 rounded-lg text-sm font-bold transition-all bg-brand-gold/10 text-brand-gold-light">
                        {isAr ? 'الاقتراحات' : 'Suggestions'}
                    </span>
                </div>

                {/* Header */}
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight flex items-center gap-2">
                            <Lightbulb size={24} className="shrink-0 text-brand-gold-light" />
                            {isAr ? 'الاقتراحات' : 'Suggestions'}
                        </h1>
                        <p className="text-gray-400 text-sm mt-1">
                            {isAr ? 'اقترح دورات جديدة' : 'Suggest new courses'}
                        </p>
                    </div>
                    <button onClick={openModal}
                        className="inline-flex items-center gap-2 bg-gradient-to-r from-brand-gold to-brand-gold-dark text-black font-bold text-sm px-5 py-2.5 rounded-xl hover:shadow-lg hover:shadow-brand-gold/20 transition-all">
                        <Lightbulb size={16} /> {isAr ? 'اقتراح دورة جديدة' : 'Suggest New Course'}
                    </button>
                </div>

                {error && <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl">{error}</div>}

                {/* Stats Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                    {[
                        { icon: ClipboardList, label: isAr ? 'إجمالي الاقتراحات' : 'Total Suggestions', value: totalSuggestions, color: 'text-brand-navy-light', bg: 'bg-brand-navy-light/10' },
                        { icon: Clock, label: isAr ? 'اقتراحات معلقة' : 'Pending Suggestions', value: pendingSuggestions, color: 'text-brand-gold-light', bg: 'bg-brand-gold/10' },
                    ].map((s, i) => (
                        <div key={i} className="min-w-0 bg-brand-navy-dark border border-white/5 rounded-2xl p-3 sm:p-5 hover:border-white/10 transition-all">
                            <div className="flex items-center gap-3 mb-3">
                                <div className={`w-9 h-9 sm:w-10 sm:h-10 shrink-0 rounded-xl ${s.bg} ${s.color} flex items-center justify-center`}>
                                    <s.icon size={18} />
                                </div>
                                <p className="text-[11px] sm:text-xs leading-snug font-bold text-gray-400">{s.label}</p>
                            </div>
                            <p className="text-2xl sm:text-3xl font-black text-white">{s.value}</p>
                        </div>
                    ))}
                </div>

                {/* Suggestions Table */}
                <section className="min-w-0 bg-brand-navy-dark border border-white/5 rounded-2xl p-4 sm:p-6 lg:p-8">
                    <div className="flex items-center gap-2 mb-6">
                        <Lightbulb size={18} className="text-brand-gold-light" />
                        <h3 className="text-lg font-black text-white">{isAr ? 'اقتراحاتي' : 'My Suggestions'}</h3>
                    </div>

                    <div className="sm:hidden divide-y divide-white/5">
                        {loading ? (
                            <div className="h-40 flex items-center justify-center text-gray-400">
                                <Loader className="animate-spin me-2" size={20} /> {isAr ? 'جاري التحميل...' : 'Loading...'}
                            </div>
                        ) : (suggestions || []).length === 0 ? (
                            <div className="text-center py-10 text-gray-400">
                                <Lightbulb size={36} className="mx-auto mb-3 text-gray-500" />
                                <p className="font-bold">{isAr ? 'لا توجد اقتراحات بعد' : 'No suggestions yet'}</p>
                            </div>
                        ) : (suggestions || []).map((r) => (
                            <article key={r.id} className="space-y-2.5 py-4">
                                <h4 className="break-words font-bold text-white">{pick(r, 'title') || '—'}</h4>
                                <div className="flex items-center justify-between gap-3 text-sm">
                                    <span className="text-gray-500">{isAr ? 'الفئة' : 'Category'}</span>
                                    <span className="min-w-0 break-words text-end text-gray-300">{pick(r, 'category') || '—'}</span>
                                </div>
                                <div className="flex items-center justify-between gap-3 text-sm">
                                    <span className="text-gray-500">{isAr ? 'التاريخ' : 'Date'}</span>
                                    <span className="text-gray-300">{new Date(r.createdAt).toLocaleDateString()}</span>
                                </div>
                                <span className={`inline-flex px-2.5 py-1 text-[10px] font-bold rounded-full ${statusColors[r.status] ?? ''}`}>
                                    {isAr ? (statusLabels[r.status] ?? r.status) : (statusLabelsEn[r.status] ?? r.status)}
                                </span>
                            </article>
                        ))}
                    </div>
                    <div className="hidden sm:block overflow-x-auto">
                        {loading ? (
                            <div className="h-40 flex items-center justify-center text-gray-400"><Loader className="animate-spin me-2" size={20} /> {isAr ? 'جاري التحميل...' : 'Loading...'}</div>
                        ) : (suggestions || []).length === 0 ? (
                            <div className="text-center py-12 text-gray-400 border-2 border-dashed border-white/10 rounded-xl">
                                <Lightbulb size={40} className="mx-auto mb-3 text-gray-500" />
                                <p className="font-bold">{isAr ? 'لا توجد اقتراحات بعد' : 'No suggestions yet'}</p>
                                <p className="text-sm mt-1">{isAr ? 'اقترح دورة جديدة لتبدأ' : 'Suggest a new course to get started'}</p>
                            </div>
                        ) : (
                            <table className="w-full text-left">
                                <thead><tr className="border-b border-white/5">
                                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">{isAr ? 'العنوان' : 'Title'}</th>
                                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">{isAr ? 'الفئة' : 'Category'}</th>
                                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">{isAr ? 'التاريخ' : 'Date'}</th>
                                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">{isAr ? 'الحالة' : 'Status'}</th>
                                </tr></thead>
                                <tbody className="divide-y divide-white/5">
                                    {(suggestions || []).map(r => (
                                        <tr key={r.id} className="hover:bg-white/[0.02]">
                                            <td className="p-3 font-bold text-white text-sm">{pick(r, 'title') || '—'}</td>
                                            <td className="p-3 text-sm text-gray-400">{pick(r, 'category') || '—'}</td>
                                            <td className="p-3 text-sm text-gray-400">{new Date(r.createdAt).toLocaleDateString()}</td>
                                            <td className="p-3"><span className={`px-2.5 py-1 text-[10px] font-bold rounded-full ${statusColors[r.status] ?? ''}`}>{isAr ? (statusLabels[r.status] ?? r.status) : (statusLabelsEn[r.status] ?? r.status)}</span></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </section>

                {/* Suggest Course Modal */}
                {showModal && (
                    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
                        <div className="bg-brand-navy border border-white/10 rounded-3xl shadow-2xl p-6 lg:p-8 w-full max-w-lg animate-fade-in-up max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-between mb-6">
                                <div>
                                    <h3 className="text-xl font-black text-white">{isAr ? 'اقتراح دورة جديدة' : 'Suggest New Course'}</h3>
                                    <p className="text-sm text-gray-400 mt-1">{isAr ? 'اقترح دورة جديدة سيتم إنشاؤك كمدرّس لها' : 'Propose a new course with you as instructor'}</p>
                                </div>
                                <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white"><X size={20} /></button>
                            </div>
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-sm font-bold text-gray-300 mb-1">{isAr ? 'العنوان بالعربي' : 'Title (AR)'} *</label>
                                        <input value={sTitleAr} onChange={e => setSTitleAr(e.target.value)} className={inputCls} />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-300 mb-1">{isAr ? 'العنوان بالإنجليزي' : 'Title (EN)'} *</label>
                                        <input value={sTitleEn} onChange={e => setSTitleEn(e.target.value)} className={inputCls} />
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-sm font-bold text-gray-300 mb-1">{isAr ? 'الفئة بالعربي' : 'Category (AR)'}</label>
                                        <input value={sCatAr} onChange={e => setSCatAr(e.target.value)} className={inputCls} />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-300 mb-1">{isAr ? 'الفئة بالإنجليزي' : 'Category (EN)'}</label>
                                        <input value={sCatEn} onChange={e => setSCatEn(e.target.value)} className={inputCls} />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-300 mb-1">{isAr ? 'الوصف' : 'Description'}</label>
                                    <textarea value={sDesc} onChange={e => setSDesc(e.target.value)} rows={3} className={inputCls} />
                                </div>
                            </div>
                            <div className="flex gap-3 mt-6">
                                <button onClick={suggestCourse} disabled={saving} className="flex-1 bg-gradient-to-r from-brand-gold to-brand-gold-dark text-black font-bold py-3 rounded-xl hover:opacity-95 transition disabled:opacity-50">
                                    {saving ? (isAr ? 'جاري...' : 'Submitting...') : (isAr ? 'إرسال' : 'Submit')}
                                </button>
                                <button onClick={() => setShowModal(false)} className="flex-1 bg-white/5 text-gray-300 hover:bg-white/10 font-bold py-3 rounded-xl transition">
                                    {isAr ? 'إلغاء' : 'Cancel'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </ProtectedRoute>
    );
}
