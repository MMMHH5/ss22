"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import ProtectedRoute from '@/components/ProtectedRoute';
import CertificateApprovalModal from '@/components/CertificateApprovalModal';
import { useFetchData } from '@/lib/useFetchData';
import { api, getErrorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n-context';
import toast from 'react-hot-toast';
import {
    BookOpen, CalendarPlus, Lightbulb, Flag, Users, ClipboardList, X, ArrowUpRight, Loader, Clock, Award,
} from 'lucide-react';

interface MyOpening {
    id: string;
    nameAr?: string | null;
    nameEn?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    enrollmentDeadline?: string | null;
    price?: string | null;
    priceOld?: string | null;
    maxStudents?: number | null;
    isPublished: boolean;
    status: string;
    course: { id: string; titleAr?: string | null; titleEn?: string | null };
    access: {
        canReadContent: boolean;
        canManageTasks: boolean;
        canGrade: boolean;
        canManageSessions: boolean;
        canManageAnnouncements: boolean;
        canViewAnalytics: boolean;
        isPrimaryInstructor: boolean;
    };
    instructorId: string;
    meetLink?: string | null;
    _count?: { enrollments?: number | null; tasks?: number | null };
}

interface Course {
    id: string;
    titleAr?: string | null;
    titleEn?: string | null;
    categoryAr?: string | null;
    categoryEn?: string | null;
}

interface RequestRow {
    id: string;
    status: string;
    reason?: string | null;
    createdAt: string;
    course?: { id: string; titleAr?: string | null; titleEn?: string | null } | null;
    opening?: {
        id: string;
        nameAr?: string | null;
        nameEn?: string | null;
        status?: string;
        course?: { id: string; titleAr?: string | null; titleEn?: string | null } | null;
    } | null;
}

type ModalState =
    | { type: 'open' }
    | { type: 'close'; opening: MyOpening }
    | null;

const openingStatusColors: Record<string, string> = {
    DRAFT: 'bg-gray-500/10 text-gray-400 border border-gray-500/20',
    ANNOUNCEMENT: 'bg-brand-navy-light/10 text-brand-navy-light border border-brand-navy-light/20',
    OPEN: 'bg-green-500/10 text-green-400 border border-green-500/20',
    STARTED: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
    ENDED: 'bg-gray-500/10 text-gray-500 border border-gray-500/20',
};

const openingStatusLabels: Record<string, string> = {
    DRAFT: 'مسودة',
    ANNOUNCEMENT: 'إعلان',
    OPEN: 'مفتوح',
    STARTED: 'قيد التنفيذ',
    ENDED: 'منتهي',
};

const openingStatusLabelsEn: Record<string, string> = {
    DRAFT: 'Draft',
    ANNOUNCEMENT: 'Announcement',
    OPEN: 'Open',
    STARTED: 'Started',
    ENDED: 'Ended',
};

export default function TeachingHubPage() {
    const { t, pick, locale } = useI18n();
    const isAr = locale === 'ar';
    const searchParams = useSearchParams();
    const { data: openings, loading, error, refetch } = useFetchData<MyOpening[]>('/openings/mine');
    const { data: courses } = useFetchData<Course[]>('/courses');
    const { data: openRequests, refetch: refetchOpen } = useFetchData<RequestRow[]>('/instructor-requests/openings/my');
    const { data: closeRequests, refetch: refetchClose } = useFetchData<RequestRow[]>('/instructor-requests/closures/my');

    const [modal, setModal] = useState<ModalState>(null);
    const [certOpening, setCertOpening] = useState<MyOpening | null>(null);
    const [dismissCloseId, setDismissCloseId] = useState<string | null>(null);
    const [selectedCourseId, setSelectedCourseId] = useState('');
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);

    const pendingCloseFor = (openingId: string) =>
        (closeRequests || []).some((r) => r.opening?.id === openingId && r.status === 'PENDING');

    const autoCloseId = searchParams?.get('close') ?? null;
    const autoCloseOpening = autoCloseId && openings
        ? openings.find((opening) => opening.id === autoCloseId && opening.access.isPrimaryInstructor)
        : undefined;
    const closeTarget = modal?.type === 'close'
        ? modal.opening
        : (autoCloseOpening && dismissCloseId !== autoCloseId ? autoCloseOpening : undefined);

    const closeModalOnClose = () => { if (autoCloseId) setDismissCloseId(autoCloseId); setModal(null); };

    // Stats
    const totalStudents = (openings || [])
        .filter((opening) => opening.access.canGrade || opening.access.canManageTasks || opening.access.canViewAnalytics)
        .reduce((sum, opening) => sum + (opening._count?.enrollments ?? 0), 0);
    const totalTasks = (openings || [])
        .filter((opening) => opening.access.canManageTasks || opening.access.canGrade || opening.access.canViewAnalytics)
        .reduce((sum, opening) => sum + (opening._count?.tasks ?? 0), 0);
    const pendingRequests = [...(openRequests || []), ...(closeRequests || [])].filter(r => r.status === 'PENDING').length;

    const requestOpen = async () => {
        if (!selectedCourseId) { toast.error(isAr ? 'اختر دورة' : 'Please select a course'); return; }
        setSaving(true);
        try {
            await api.post('/instructor-requests/openings', { courseId: selectedCourseId, reason: reason || undefined });
            toast.success(isAr ? 'تم إرسال طلب فتح الدورة' : 'Opening request submitted');
            setModal(null); setSelectedCourseId(''); setReason(''); refetchOpen();
        } catch (err) { toast.error(getErrorMessage(err) || t('common.error')); }
        setSaving(false);
    };

    const requestClose = async (openingId: string, closeReason: string) => {
        setSaving(true);
        try {
            await api.post('/instructor-requests/closures', { openingId, reason: closeReason || undefined });
            toast.success(isAr ? 'تم إرسال طلب إغلاق الدورة' : 'Close request submitted');
            setModal(null); setReason(''); refetch(); refetchOpen(); refetchClose();
        } catch (err) { toast.error(getErrorMessage(err) || t('common.error')); }
        setSaving(false);
    };

    const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString(isAr ? 'ar-SA' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    const inputCls = "w-full px-4 py-3 bg-brand-navy-dark border border-white/10 rounded-xl text-white placeholder:text-gray-500 focus:ring-2 focus:ring-brand-gold/40 focus:border-brand-gold/40 outline-none transition";

    return (
        <ProtectedRoute allowedRoles={['INSTRUCTOR']}>
            <div className="min-h-screen bg-gray-50 dark:bg-brand-navy-dark space-y-6 animate-fade-in p-6 lg:p-8">
                {/* Header */}
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-black text-white tracking-tight">
                            {isAr ? 'مركز التدريس' : 'Teaching Hub'}
                        </h1>
                        <p className="text-gray-400 text-sm mt-1">
                            {isAr ? 'إدارة الدورات المسندة إليك وتقديم الطلبات' : 'Manage your assigned batches and submit requests'}
                        </p>
                    </div>
                    <button onClick={() => { setSelectedCourseId(''); setReason(''); setModal({ type: 'open' }); }}
                        className="inline-flex items-center gap-2 bg-gradient-to-r from-brand-gold to-brand-gold-dark text-black font-bold text-sm px-5 py-2.5 rounded-xl hover:shadow-lg hover:shadow-brand-gold/20 transition-all">
                        <CalendarPlus size={16} /> {isAr ? 'طلب فتح دورة' : 'Request Open'}
                    </button>
                </div>

                {error && <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl">{error}</div>}

                {/* Tab Navigation */}
                <div className="inline-flex items-center gap-1 bg-brand-navy-dark border border-white/5 rounded-2xl p-1.5">
                    <Link href="/dashboard/teaching"
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 bg-brand-gold/10 text-brand-gold-light border border-brand-gold/20">
                        <BookOpen size={16} /> {isAr ? 'الدورات المسندة' : 'My Openings'}
                    </Link>
                    <Link href="/dashboard/teaching/suggestions"
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 text-gray-400 hover:text-white hover:bg-white/5 border border-transparent">
                        <Lightbulb size={16} /> {isAr ? 'الاقتراحات' : 'Suggestions'}
                    </Link>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {[
                        { icon: BookOpen, label: isAr ? 'إجمالي الدورات' : 'Total Openings', value: openings?.length ?? 0, color: 'text-brand-navy-light', bg: 'bg-brand-navy-light/10' },
                        { icon: Users, label: isAr ? 'إجمالي الطلاب' : 'Total Students', value: totalStudents, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
                        { icon: ClipboardList, label: isAr ? 'إجمالي المهام' : 'Total Tasks', value: totalTasks, color: 'text-purple-400', bg: 'bg-purple-500/10' },
                        { icon: Clock, label: isAr ? 'طلبات معلقة' : 'Pending Requests', value: pendingRequests, color: 'text-brand-gold-light', bg: 'bg-brand-gold/10' },
                    ].map((s, i) => (
                        <div key={i} className="bg-brand-navy-dark border border-white/5 rounded-2xl p-5 hover:border-white/10 transition-all">
                            <div className="flex items-center gap-3 mb-3">
                                <div className={`w-10 h-10 rounded-xl ${s.bg} ${s.color} flex items-center justify-center`}>
                                    <s.icon size={20} />
                                </div>
                                <p className="text-xs font-bold text-gray-400">{s.label}</p>
                            </div>
                            <p className="text-3xl font-black text-white">{s.value}</p>
                        </div>
                    ))}
                </div>

                {/* My Openings */}
                <section className="bg-brand-navy-dark border border-white/5 rounded-2xl p-6 lg:p-8">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h3 className="text-lg font-black text-white flex items-center gap-2">
                                <BookOpen size={18} className="text-brand-gold-light" />
                                {isAr ? 'دوراتي المسندة' : 'My Openings'}
                            </h3>
                            <p className="text-sm text-gray-400 mt-1">{isAr ? 'الدورات المسندة إليك — أدِر الطلاب والدرجات والمهام' : 'Batches assigned to you — manage students, grades and tasks'}</p>
                        </div>
                    </div>

                    {loading ? (
                        <div className="h-40 flex items-center justify-center text-gray-400"><Loader className="animate-spin me-2" size={20} /> {isAr ? 'جاري التحميل...' : 'Loading...'}</div>
                    ) : (openings || []).length === 0 ? (
                        <div className="text-center py-12 text-gray-400 border-2 border-dashed border-white/10 rounded-xl">
                            <BookOpen size={40} className="mx-auto mb-3 text-gray-500" />
                            <p className="font-bold">{isAr ? 'لا توجد دورات مسندة بعد' : 'No openings assigned yet'}</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {(openings || []).map((o) => {
                                const isEnded = o.status === 'ENDED';
                                const closePending = pendingCloseFor(o.id);
                                const canViewEnrollmentCount = o.access.canGrade || o.access.canManageTasks || o.access.canViewAnalytics;
                                const canViewTaskCount = o.access.canManageTasks || o.access.canGrade || o.access.canViewAnalytics;
                                const enrollmentCount = canViewEnrollmentCount ? (o._count?.enrollments ?? '—') : '—';
                                const taskCount = canViewTaskCount ? (o._count?.tasks ?? '—') : '—';
                                return (
                                    <div key={o.id} className="bg-brand-navy border border-white/5 hover:border-brand-gold/20 rounded-2xl overflow-hidden transition-all duration-300 group">
                                        {/* Status bar */}
                                        <div className={`h-1 ${isEnded ? 'bg-gray-500/30' : 'bg-gradient-to-r from-brand-gold to-brand-gold-light'}`} />

                                        <div className="p-5">
                                            <div className="flex items-start justify-between gap-3 mb-4">
                                                <div className="min-w-0">
                                                    <p className="text-xs font-bold text-brand-gold-light/80 mb-1">{pick(o.course, 'title')}</p>
                                                    <h4 className="text-lg font-black text-white truncate">{pick(o, 'name') || (isAr ? 'دورة بدون عنوان' : 'Untitled Batch')}</h4>
                                                </div>
                                                <span className={`px-2.5 py-1 text-[10px] font-bold rounded-full shrink-0 ${openingStatusColors[o.status] ?? 'bg-gray-500/10 text-gray-400'}`}>
                                                    {isAr ? (openingStatusLabels[o.status] ?? o.status) : (openingStatusLabelsEn[o.status] ?? o.status)}
                                                </span>
                                            </div>

                                            {/* Stats row */}
                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
                                                <div className="bg-brand-navy-dark rounded-xl py-2.5 text-center border border-white/5">
                                                    <p className="text-lg font-black text-white">{enrollmentCount}</p>
                                                    <p className="text-[10px] font-bold text-gray-500">{isAr ? 'طالب' : 'Students'}</p>
                                                </div>
                                                <div className="bg-brand-navy-dark rounded-xl py-2.5 text-center border border-white/5">
                                                    <p className="text-lg font-black text-white">{taskCount}</p>
                                                    <p className="text-[10px] font-bold text-gray-500">{isAr ? 'مهمة' : 'Tasks'}</p>
                                                </div>
                                                <div className="bg-brand-navy-dark rounded-xl py-2.5 text-center border border-white/5">
                                                    <p className="text-lg font-black text-white font-mono">{o.access.isPrimaryInstructor && o.price != null ? `$${o.price}` : '—'}</p>
                                                    <p className="text-[10px] font-bold text-gray-500">{isAr ? 'السعر' : 'Price'}</p>
                                                </div>
                                            </div>

                                            {/* Date */}
                                            <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-4">
                                                <Clock size={12} />
                                                {fmtDate(o.startDate)} → {fmtDate(o.endDate)}
                                            </div>

                                            {/* Actions */}
                                            <div className="flex gap-2">
                                                <Link href={`/dashboard/teaching/${o.id}`}
                                                    className="flex-1 inline-flex items-center justify-center gap-1.5 bg-brand-gold/10 text-brand-gold-light border border-brand-gold/20 text-sm font-bold py-2.5 rounded-xl hover:bg-brand-gold hover:text-black transition-all">
                                                    {isAr ? 'إدارة' : 'Manage'} <ArrowUpRight size={14} />
                                                </Link>
                                                {isEnded && o.access.isPrimaryInstructor && (
                                                    <button
                                                        onClick={() => setCertOpening(o)}
                                                        title={isAr ? 'إصدار الشهادات' : 'Issue certificates'}
                                                        className="inline-flex items-center justify-center gap-1.5 text-sm font-bold px-3 py-2.5 rounded-xl transition border text-brand-gold-light border-brand-gold/20 hover:bg-brand-gold hover:text-black"
                                                    >
                                                        <Award size={14} /> {isAr ? 'شهادات' : 'Certs'}
                                                    </button>
                                                )}
                                                {o.access.isPrimaryInstructor && (
                                                    <button
                                                        onClick={() => { setReason(''); setModal({ type: 'close', opening: o }); }}
                                                        disabled={isEnded || closePending}
                                                        className={`inline-flex items-center justify-center gap-1.5 text-sm font-bold px-4 py-2.5 rounded-xl transition border ${
                                                            isEnded ? 'text-gray-600 border-white/5 cursor-not-allowed'
                                                            : closePending ? 'text-brand-gold-light border-brand-gold/20 cursor-not-allowed'
                                                            : 'text-red-400 border-red-500/20 hover:bg-red-500/10'
                                                        }`}
                                                    >
                                                        <Flag size={14} /> {closePending ? (isAr ? 'تم الطلب' : 'Requested') : (isAr ? 'إغلاق' : 'Close')}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>



                {/* === MODALS === */}

                {certOpening && (
                    <CertificateApprovalModal
                        openingId={certOpening.id}
                        openingTitle={pick(certOpening, 'name') || (isAr ? 'دورة بدون عنوان' : 'Untitled Batch')}
                        canRevoke={false}
                        onClose={() => setCertOpening(null)}
                    />
                )}

                {/* Open Request Modal */}
                {modal?.type === 'open' && (
                    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setModal(null)}>
                        <div className="bg-brand-navy border border-white/10 rounded-3xl shadow-2xl p-6 lg:p-8 w-full max-w-lg animate-fade-in-up max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-between mb-6">
                                <div>
                                    <h3 className="text-xl font-black text-white">{isAr ? 'طلب فتح دورة' : 'Request to Open'}</h3>
                                    <p className="text-sm text-gray-400 mt-1">{isAr ? 'سيتم فتح دفعة جديدة بعد الموافقة' : 'New batch after approval'}</p>
                                </div>
                                <button onClick={() => setModal(null)} className="text-gray-400 hover:text-white"><X size={20} /></button>
                            </div>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-bold text-gray-300 mb-1">{isAr ? 'الدورة' : 'Course'} *</label>
                                    <select value={selectedCourseId} onChange={e => setSelectedCourseId(e.target.value)} className={inputCls}>
                                        <option value="">{isAr ? 'اختر دورة...' : 'Select course...'}</option>
                                        {(courses || []).map(c => <option key={c.id} value={c.id}>{pick(c, 'title')}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-300 mb-1">{isAr ? 'السبب (اختياري)' : 'Reason (optional)'}</label>
                                    <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder={isAr ? 'لماذا تريد فتح دفعة جديدة؟' : 'Why open a new batch?'} className={inputCls} />
                                </div>
                            </div>
                            <div className="flex gap-3 mt-6">
                                <button onClick={requestOpen} disabled={saving} className="flex-1 bg-gradient-to-r from-brand-gold to-brand-gold-dark text-black font-bold py-3 rounded-xl hover:opacity-95 transition disabled:opacity-50">
                                    {saving ? (isAr ? 'جاري...' : 'Submitting...') : (isAr ? 'إرسال' : 'Submit')}
                                </button>
                                <button onClick={() => setModal(null)} className="flex-1 bg-white/5 text-gray-300 hover:bg-white/10 font-bold py-3 rounded-xl transition">
                                    {isAr ? 'إلغاء' : 'Cancel'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Close Modal */}
                {closeTarget && (
                    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={closeModalOnClose}>
                        <div className="bg-brand-navy border border-white/10 rounded-3xl shadow-2xl p-6 lg:p-8 w-full max-w-lg animate-fade-in-up max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-between mb-6">
                                <div>
                                    <h3 className="text-xl font-black text-white">{isAr ? 'طلب إغلاق الدورة' : 'Request to Close'}</h3>
                                    <p className="text-sm text-gray-400 mt-1">{pick(closeTarget.course, 'title')}</p>
                                </div>
                                <button onClick={closeModalOnClose} className="text-gray-400 hover:text-white"><X size={20} /></button>
                            </div>
                            <div className="flex items-center gap-2 text-sm font-bold text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-4">
                                <Flag size={16} /> {isAr ? 'الموافقة ستنهي الدورة. تُصدر الشهادات يدوياً بعد المراجعة' : 'Approval will end the course. Certificates are issued manually after review'}
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-gray-300 mb-1">{isAr ? 'السبب (اختياري)' : 'Reason (optional)'}</label>
                                <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder={isAr ? 'ملاحظات...' : 'Notes...'} className={inputCls} />
                            </div>
                            <div className="flex gap-3 mt-6">
                                <button onClick={() => requestClose(closeTarget.id, reason)} disabled={saving} className="flex-1 bg-gradient-to-r from-red-600 to-red-500 text-white font-bold py-3 rounded-xl hover:opacity-95 transition disabled:opacity-50">
                                    {saving ? (isAr ? 'جاري...' : 'Submitting...') : (isAr ? 'إرسال' : 'Submit')}
                                </button>
                                <button onClick={closeModalOnClose} className="flex-1 bg-white/5 text-gray-300 hover:bg-white/10 font-bold py-3 rounded-xl transition">
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
