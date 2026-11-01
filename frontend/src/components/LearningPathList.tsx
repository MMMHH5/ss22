"use client";

import { useMemo, useState } from 'react';
import { api, getErrorMessage } from '@/lib/api';
import { useFetchData } from '@/lib/useFetchData';
import { useI18n } from '@/lib/i18n-context';
import { useAuth } from '@/lib/auth-context';
import toast from 'react-hot-toast';
import Link from 'next/link';
import {
    ArrowDown, ArrowUp, BarChart3, BookOpen, ChevronDown, GraduationCap, Layers, Loader, Lock, Pencil,
    Plus, Route, Search, Trash2, X, Zap,
} from 'lucide-react';

interface CourseReadiness {
    checks: Record<string, boolean>;
    missing: string[];
    percent: number;
}

interface CourseOption {
    id: string;
    titleAr?: string | null;
    titleEn?: string | null;
    categoryAr?: string | null;
    categoryEn?: string | null;
    level?: string | null;
    isPublished?: boolean;
    readiness?: CourseReadiness;
}

interface PathCourseItem {
    id: string;
    orderIndex: number;
    course?: CourseOption | null;
    readiness?: CourseReadiness;
    registrationStatus?: string;
    enrollmentStatus?: string | null;
    completedLessons?: number;
    totalLessons?: number;
    progressPercent?: number;
    isCompleted?: boolean;
}

interface StudentPathEnrollment {
    id: string;
    path: { id: string };
    totalCourses: number;
    completedCourses: number;
    totalLessons: number;
    completedLessons: number;
    progressPercent: number;
    isCompleted: boolean;
    pathEnrollment?: { id: string };
    courses: PathCourseItem[];
}

interface LearningPathReport {
    path: { id: string; titleAr: string; titleEn: string; isPublished: boolean };
    learners: number;
    activeStudents: number;
    completedStudents: number;
    completionRate: number;
    courses: {
        id: string;
        titleAr: string;
        titleEn: string;
        enrolledStudents: number;
        totalLessons: number;
        readiness: CourseReadiness;
    }[];
}

interface LearningPathData {
    id: string;
    titleAr: string;
    titleEn: string;
    descriptionAr?: string | null;
    descriptionEn?: string | null;
    coverImageUrl?: string | null;
    isPublished: boolean;
    createdAt: string;
    creator?: { id: string; email?: string } | null;
    courses?: PathCourseItem[];
    _count?: { enrollments?: number };
}

interface PathForm {
    titleAr: string;
    titleEn: string;
    descriptionAr: string;
    descriptionEn: string;
    coverImageUrl: string;
    isPublished: boolean;
    courseIds: string[];
}

interface Props {
    mode?: 'browse' | 'manage';
}

const emptyPathForm: PathForm = {
    titleAr: '',
    titleEn: '',
    descriptionAr: '',
    descriptionEn: '',
    coverImageUrl: '',
    isPublished: false,
    courseIds: [],
};

const GRADIENTS = [
    'from-brand-gold/40 via-brand-navy-dark to-brand-navy',
    'from-brand-navy-light/30 via-brand-navy-dark to-brand-navy',
    'from-purple-500/25 via-brand-navy-dark to-brand-navy',
    'from-emerald-500/25 via-brand-navy-dark to-brand-navy',
];

export default function LearningPathList({ mode = 'browse' }: Props) {
    const { t, locale, pick } = useI18n();
    const isAr = locale === 'ar';
    const { user } = useAuth();

    const canManage = ['ADMIN', 'COURSE_MANAGER'].includes(user?.role || '');
    const manage = mode === 'manage' && canManage;

    const { data, loading, error, refetch } = useFetchData<LearningPathData[]>(manage ? '/learning-paths/manage' : '/learning-paths');
    const { data: studentPathsData, loading: studentPathsLoading, error: studentPathsError, refetch: refetchStudentPaths } =
        useFetchData<StudentPathEnrollment[]>(!manage && user?.role === 'STUDENT' ? '/learning-paths/my' : null);
    const { data: courseData, loading: coursesLoading, error: coursesError } = useFetchData<CourseOption[]>(
        manage ? '/learning-paths/manage/courses' : null,
    );

    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [enrollingId, setEnrollingId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<LearningPathData | null>(null);
    const [form, setForm] = useState<PathForm>(emptyPathForm);
    const [saving, setSaving] = useState(false);
    const [courseQuery, setCourseQuery] = useState('');
    const [reportId, setReportId] = useState<string | null>(null);
    const [report, setReport] = useState<LearningPathReport | null>(null);
    const [reportLoading, setReportLoading] = useState(false);
    const [reportError, setReportError] = useState<string | null>(null);

    const paths = useMemo(() => {
        const list = data || [];
        return manage ? list : list.filter((p) => p.isPublished !== false);
    }, [data, manage]);
    const studentPaths = useMemo(
        () => new Map((studentPathsData || []).map((item) => [item.path.id, item])),
        [studentPathsData],
    );

    const openCreate = () => {
        setEditing(null);
        setForm(emptyPathForm);
        setCourseQuery('');
        setModalOpen(true);
    };

    const openEdit = (p: LearningPathData) => {
        setEditing(p);
        setForm({
            titleAr: p.titleAr || '',
            titleEn: p.titleEn || '',
            descriptionAr: p.descriptionAr || '',
            descriptionEn: p.descriptionEn || '',
            coverImageUrl: p.coverImageUrl || '',
            isPublished: !!p.isPublished,
            courseIds: [...(p.courses || [])]
                .sort((a, b) => a.orderIndex - b.orderIndex)
                .map((item) => item.course?.id)
                .filter((id): id is string => !!id),
        });
        setCourseQuery('');
        setModalOpen(true);
    };

    const save = async () => {
        if (!form.titleAr.trim() || !form.titleEn.trim()) {
            toast.error(isAr ? 'أدخل العنوان بالعربي والإنجليزي' : 'Enter the title in Arabic and English');
            return;
        }
        if (form.isPublished && form.courseIds.length === 0) {
            toast.error(isAr ? 'أضف دورة واحدة على الأقل قبل نشر المسار' : 'Add at least one course before publishing the path');
            return;
        }
        setSaving(true);
        try {
            const payload = {
                titleAr: form.titleAr.trim(),
                titleEn: form.titleEn.trim(),
                descriptionAr: form.descriptionAr.trim(),
                descriptionEn: form.descriptionEn.trim(),
                coverImageUrl: form.coverImageUrl.trim(),
                isPublished: form.isPublished,
                courseIds: form.courseIds,
            };
            if (editing) {
                await api.patch(`/learning-paths/${editing.id}`, payload);
                toast.success(isAr ? 'تم تحديث المسار' : 'Learning path updated');
            } else {
                await api.post('/learning-paths', payload);
                toast.success(isAr ? 'تم إنشاء المسار' : 'Learning path created');
            }
            setModalOpen(false);
            refetch();
        } catch (err) {
            toast.error(getErrorMessage(err) || t('common.error'));
        } finally {
            setSaving(false);
        }
    };

    const enroll = async (p: LearningPathData) => {
        setEnrollingId(p.id);
        try {
            const response = await api.post(`/learning-paths/${p.id}/enroll`);
            const openCount = response.data.courses.filter((course: { registrationStatus: string }) => course.registrationStatus === 'open').length;
            const reservationCount = response.data.courses.filter((course: { registrationStatus: string }) => course.registrationStatus === 'reservation').length;
            toast.success(
                (isAr ? 'تمت إضافتك إلى المسار. الدورات المتاحة للتسجيل الآن: ' : 'You joined the path. Courses open for registration: ')
                + openCount
                + (reservationCount > 0
                    ? (isAr ? `، ومقاعد متاحة للحجز المسبق: ${reservationCount}.` : `; ${reservationCount} available for early reservation.`)
                    : '.')
                + (isAr ? ' أكمل التسجيل لكل دورة من صفحتها.' : ' Complete enrollment for each course from its course page.'),
            );
            await refetchStudentPaths();
        } catch (err) {
            toast.error(getErrorMessage(err) || t('common.error'));
        } finally {
            setEnrollingId(null);
        }
    };

    const openReport = async (pathId: string) => {
        setReportId(pathId);
        setReport(null);
        setReportError(null);
        setReportLoading(true);
        try {
            const response = await api.get<LearningPathReport>(`/learning-paths/manage/${pathId}/report`);
            setReport(response.data);
        } catch (err) {
            setReportError(getErrorMessage(err) || t('common.error'));
        } finally {
            setReportLoading(false);
        }
    };

    const remove = async (p: LearningPathData) => {
        if (!confirm(isAr ? `هل أنت متأكد من حذف مسار "${pick(p, 'title')}"؟` : `Delete the path "${pick(p, 'title')}"?`)) return;
        setDeletingId(p.id);
        try {
            await api.delete(`/learning-paths/${p.id}`);
            toast.success(isAr ? 'تم حذف المسار' : 'Learning path deleted');
            refetch();
        } catch (err) {
            toast.error(getErrorMessage(err) || t('common.error'));
        } finally {
            setDeletingId(null);
        }
    };

    const selectedCourses = form.courseIds
        .map((id) => courseData?.find((course) => course.id === id))
        .filter((course): course is CourseOption => !!course);
    const incompleteSelectedCourses = selectedCourses.filter((course) => (course.readiness?.percent ?? 0) < 100);
    const availableCourses = (courseData || []).filter((course) => {
        if (form.courseIds.includes(course.id)) return false;
        const query = courseQuery.trim().toLocaleLowerCase();
        return !query || `${course.titleAr || ''} ${course.titleEn || ''} ${course.categoryAr || ''} ${course.categoryEn || ''}`
            .toLocaleLowerCase()
            .includes(query);
    });

    const moveCourse = (index: number, direction: -1 | 1) => {
        const target = index + direction;
        if (target < 0 || target >= form.courseIds.length) return;
        const courseIds = [...form.courseIds];
        [courseIds[index], courseIds[target]] = [courseIds[target], courseIds[index]];
        setForm({ ...form, courseIds });
    };

    if (!manage && mode === 'manage') {
        return (
            <div className="bg-brand-navy-dark border border-white/5 rounded-2xl p-8 text-center">
                <Lock size={32} className="mx-auto text-gray-600 mb-3" />
                <p className="text-gray-400 font-bold text-sm">
                    {isAr ? 'إدارة المسارات متاحة للمدراء والمدرسين فقط' : 'Path management is available to admins and instructors only'}
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="flex items-center gap-2 text-lg font-black text-white">
                    <Route size={20} className="text-brand-gold-light" />
                    {isAr ? 'مسارات التعلم' : 'Learning Paths'}
                    <span className="text-xs font-bold text-gray-500">({paths.length})</span>
                </h3>
                {manage && (
                    <button
                        onClick={openCreate}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-brand-gold text-brand-navy-dark hover:bg-brand-gold-light transition"
                    >
                        <Plus size={16} /> {isAr ? 'مسار جديد' : 'New Path'}
                    </button>
                )}
            </div>

            {!manage && studentPathsError && (
                <p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs font-bold text-red-300">
                    {studentPathsError}
                </p>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader size={28} className="animate-spin text-brand-gold-light" />
                </div>
            ) : error ? (
                <div className="bg-brand-navy-dark border border-white/5 rounded-2xl p-8 text-center">
                    <Route size={32} className="mx-auto text-gray-600 mb-3" />
                    <p className="text-gray-400 font-bold text-sm">{error}</p>
                </div>
            ) : paths.length === 0 ? (
                <div className="bg-brand-navy-dark border border-white/5 rounded-2xl p-10 text-center">
                    <Layers size={32} className="mx-auto text-gray-600 mb-3" />
                    <p className="text-gray-400 font-bold text-sm">{isAr ? 'لا توجد مسارات تعلم بعد' : 'No learning paths yet'}</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {paths.map((p, idx) => {
                        const courses = [...(p.courses || [])].sort((a, b) => a.orderIndex - b.orderIndex);
                        const expanded = expandedId === p.id;
                        const studentPath = studentPaths.get(p.id);
                        const pathReadiness = courses.length > 0
                            ? Math.round(courses.reduce((total, item) => total + (item.readiness?.percent ?? 0), 0) / courses.length)
                            : 0;
                        return (
                            <div
                                key={p.id}
                                className={`bg-brand-navy-dark border rounded-2xl overflow-hidden flex flex-col transition-all duration-200 ${
                                    expanded ? 'border-brand-gold/30' : 'border-white/5 hover:border-white/15'
                                }`}
                            >
                                {/* Cover */}
                                <div className={`relative h-28 bg-gradient-to-br ${GRADIENTS[idx % GRADIENTS.length]} flex items-end p-4`}>
                                    {p.coverImageUrl ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={p.coverImageUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" />
                                    ) : null}
                                    <div className="relative z-10 w-full flex items-start justify-between gap-2">
                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/40 backdrop-blur-sm text-[11px] font-bold text-white border border-white/10">
                                            <BookOpen size={12} className="text-brand-gold-light" />
                                            {courses.length} {isAr ? 'دورة' : courses.length === 1 ? 'course' : 'courses'}
                                        </span>
                                        {mode === 'manage' && (
                                            <span className={`px-2 py-1 rounded-lg text-[10px] font-black backdrop-blur-sm border ${
                                                p.isPublished
                                                    ? 'bg-green-500/20 text-green-300 border-green-500/30'
                                                    : 'bg-gray-900/50 text-gray-400 border-white/10'
                                            }`}>
                                                {p.isPublished ? (isAr ? 'منشور' : 'Published') : (isAr ? 'مسودة' : 'Draft')}
                                            </span>
                                        )}
                                        {manage && (
                                            <span className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[10px] font-bold text-white">
                                                {p._count?.enrollments ?? 0} {isAr ? 'متعلم' : 'learners'}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="p-4 flex-1 flex flex-col">
                                    <h4 className="text-white font-black leading-snug">{pick(p, 'title')}</h4>
                                    {pick(p, 'description') && (
                                        <p className="text-gray-400 text-xs mt-1.5 leading-relaxed line-clamp-2">{pick(p, 'description')}</p>
                                    )}

                                    {manage && (
                                        <div className="mt-3 flex items-center justify-between gap-2 text-[11px] font-bold text-gray-400">
                                            <span>{isAr ? 'جاهزية بيانات الدورات' : 'Course information readiness'}</span>
                                            <span className={pathReadiness === 100 ? 'text-emerald-400' : 'text-brand-gold-light'}>{pathReadiness}%</span>
                                        </div>
                                    )}
                                    {manage && (
                                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                                            <div className="h-full rounded-full bg-brand-gold" style={{ width: `${pathReadiness}%` }} />
                                        </div>
                                    )}
                                    {studentPath && (
                                        <div className="mt-3 space-y-1.5">
                                            <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-gray-300">
                                                <span>{isAr ? 'تقدمك في المسار' : 'Your path progress'}</span>
                                                <span>{studentPath.completedCourses}/{studentPath.totalCourses} {isAr ? 'دورات' : 'courses'} · {studentPath.progressPercent}%</span>
                                            </div>
                                            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                                                <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${studentPath.progressPercent}%` }} />
                                            </div>
                                        </div>
                                    )}

                                    {expanded && (
                                        <div className="mt-4 space-y-2 animate-fade-in">
                                            {courses.length === 0 ? (
                                                <p className="text-[11px] text-gray-500 font-bold">{isAr ? 'لا توجد دورات في هذا المسار بعد' : 'No courses in this path yet'}</p>
                                            ) : (
                                                courses.map((pc, i) => {
                                                    const studentCourse = studentPath?.courses.find((item) => item.course?.id === pc.course?.id);
                                                    const readiness = pc.readiness;
                                                    return (
                                                        <div key={pc.id} className="space-y-2 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5">
                                                            <div className="flex items-center gap-2.5">
                                                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-brand-gold/30 bg-brand-gold/15 text-[11px] font-black tabular-nums text-brand-gold-light">
                                                                    {i + 1}
                                                                </span>
                                                                <div className="min-w-0 flex-1">
                                                                    {studentPath && pc.course?.id ? (
                                                                        <Link href={`/courses/${pc.course.id}`} className="block truncate text-xs font-bold text-gray-200 hover:text-brand-gold-light">
                                                                            {pick(pc.course, 'title') || (isAr ? 'دورة' : 'Course')}
                                                                        </Link>
                                                                    ) : (
                                                                        <span className="block truncate text-xs font-bold text-gray-200">
                                                                            {pick(pc.course, 'title') || (isAr ? 'دورة' : 'Course')}
                                                                        </span>
                                                                    )}
                                                                    {manage && readiness && (
                                                                        <span className={`text-[10px] font-bold ${readiness.percent === 100 ? 'text-emerald-400' : 'text-brand-gold-light'}`}>
                                                                            {isAr ? 'جاهزية الدورة' : 'Course readiness'}: {readiness.percent}%
                                                                        </span>
                                                                    )}
                                                                    {studentPath && studentCourse && (
                                                                        <span className="text-[10px] font-bold text-gray-400">
                                                                            {t(`learningPaths.status_${studentCourse.registrationStatus || 'not_enrolled'}`)}
                                                                            {studentCourse.enrollmentStatus === 'APPROVED' && studentCourse.totalLessons
                                                                                ? ` · ${studentCourse.completedLessons}/${studentCourse.totalLessons}`
                                                                                : ''}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            {manage && readiness?.missing.length ? (
                                                                <p className="ps-8 text-[10px] leading-relaxed text-gray-500">
                                                                    {isAr ? 'ناقص: ' : 'Missing: '}
                                                                    {readiness.missing.map((key) => t(`learningPaths.check_${key}`)).join(isAr ? '، ' : ', ')}
                                                                </p>
                                                            ) : null}
                                                            {studentPath && studentCourse && (
                                                                <div className="ps-8">
                                                                    <div className="h-1 overflow-hidden rounded-full bg-white/10">
                                                                        <div className="h-full rounded-full bg-emerald-400" style={{ width: `${studentCourse.progressPercent ?? 0}%` }} />
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    )}

                                    <div className="mt-auto pt-4 flex items-center gap-2">
                                        <button
                                            onClick={() => setExpandedId(expanded ? null : p.id)}
                                            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white/5 border border-white/10 text-gray-300 hover:text-white hover:bg-white/10 transition"
                                        >
                                            {isAr ? 'الدورات' : 'Courses'}
                                            <ChevronDown size={13} className={`transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
                                        </button>
                                        {!manage && (
                                            <button
                                                onClick={() => enroll(p)}
                                                disabled={enrollingId === p.id || !!studentPath || studentPathsLoading}
                                                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black bg-brand-gold text-brand-navy-dark hover:bg-brand-gold-light transition disabled:opacity-50"
                                            >
                                                {enrollingId === p.id ? <Loader size={13} className="animate-spin" /> : <Zap size={13} />}
                                                {studentPath
                                                    ? (isAr ? 'مسجل في المسار' : 'Joined')
                                                    : (isAr ? 'التسجيل في المسار' : 'Join path')}
                                            </button>
                                        )}
                                        {manage && (
                                            <>
                                                <button
                                                    onClick={() => openReport(p.id)}
                                                    className="p-2 rounded-xl bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 transition-colors"
                                                    title={isAr ? 'تقرير المسار' : 'Path report'}
                                                >
                                                    <BarChart3 size={14} />
                                                </button>
                                                <button
                                                    onClick={() => openEdit(p)}
                                                    className="p-2 rounded-xl bg-brand-gold/10 text-brand-gold-light hover:bg-brand-gold/20 transition-colors"
                                                    title={isAr ? 'تعديل' : 'Edit'}
                                                >
                                                    <Pencil size={14} />
                                                </button>
                                                <button
                                                    onClick={() => remove(p)}
                                                    disabled={deletingId === p.id}
                                                    className="p-2 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                                                    title={isAr ? 'حذف' : 'Delete'}
                                                >
                                                    {deletingId === p.id ? <Loader size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {modalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setModalOpen(false)}>
                    <div
                        className="bg-brand-navy border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between p-6 border-b border-white/5">
                            <h3 className="text-lg font-black text-white">
                                {editing ? (isAr ? 'تعديل المسار' : 'Edit Learning Path') : (isAr ? 'مسار تعلم جديد' : 'New Learning Path')}
                            </h3>
                            <button onClick={() => setModalOpen(false)} className="text-gray-400 hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-5">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-bold text-gray-300 mb-1.5">{isAr ? 'العنوان بالعربي' : 'Title (Arabic)'}</label>
                                    <input
                                        type="text"
                                        value={form.titleAr}
                                        onChange={(e) => setForm({ ...form, titleAr: e.target.value })}
                                        dir="rtl"
                                        className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-300 mb-1.5">{isAr ? 'العنوان بالإنجليزي' : 'Title (English)'}</label>
                                    <input
                                        type="text"
                                        value={form.titleEn}
                                        onChange={(e) => setForm({ ...form, titleEn: e.target.value })}
                                        dir="ltr"
                                        className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-bold text-gray-300 mb-1.5">{isAr ? 'الوصف بالعربي' : 'Description (Arabic)'}</label>
                                    <textarea
                                        value={form.descriptionAr}
                                        onChange={(e) => setForm({ ...form, descriptionAr: e.target.value })}
                                        rows={3}
                                        dir="rtl"
                                        className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold/50 resize-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-300 mb-1.5">{isAr ? 'الوصف بالإنجليزي' : 'Description (English)'}</label>
                                    <textarea
                                        value={form.descriptionEn}
                                        onChange={(e) => setForm({ ...form, descriptionEn: e.target.value })}
                                        rows={3}
                                        dir="ltr"
                                        className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold/50 resize-none"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-gray-300 mb-1.5">{isAr ? 'رابط صورة الغلاف (اختياري)' : 'Cover image URL (optional)'}</label>
                                <input
                                    type="url"
                                    value={form.coverImageUrl}
                                    onChange={(e) => setForm({ ...form, coverImageUrl: e.target.value })}
                                    dir="ltr"
                                    placeholder="https://..."
                                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
                                />
                            </div>
                            <section className="space-y-3">
                                <div className="flex items-center justify-between gap-2">
                                    <h4 className="text-sm font-black text-white">
                                        {isAr ? 'دورات المسار' : 'Path courses'}
                                        <span className="ms-2 text-xs text-gray-500">({form.courseIds.length})</span>
                                    </h4>
                                    <span className="text-[11px] text-gray-500">
                                        {isAr ? 'رتّبها حسب التسلسل المقترح للتعلم' : 'Arrange courses in the recommended learning order'}
                                    </span>
                                </div>

                                {incompleteSelectedCourses.length > 0 && (
                                    <div role="status" className="rounded-xl border border-brand-gold/20 bg-brand-gold/5 p-3">
                                        <p className="text-xs font-black text-brand-gold-light">
                                            {isAr
                                                ? `توجد ${incompleteSelectedCourses.length} دورة تحتاج استكمال بياناتها قبل أن يصبح المسار جاهزًا بالكامل.`
                                                : `${incompleteSelectedCourses.length} selected course(s) need more information before the path is fully ready.`}
                                        </p>
                                        <ul className="mt-2 space-y-1">
                                            {incompleteSelectedCourses.map((course) => (
                                                <li key={course.id} className="text-[10px] leading-relaxed text-gray-400">
                                                    <span className="font-bold text-gray-200">{pick(course, 'title')}: </span>
                                                    {(course.readiness?.missing ?? []).map((key) => t(`learningPaths.check_${key}`)).join(isAr ? '، ' : ', ')}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {selectedCourses.length > 0 ? (
                                    <ol className="space-y-2">
                                        {selectedCourses.map((course, index) => (
                                            <li key={course.id} className="flex items-center gap-2 rounded-xl border border-brand-gold/20 bg-brand-gold/5 p-2.5">
                                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-gold/15 text-xs font-black text-brand-gold-light">
                                                    {index + 1}
                                                </span>
                                                <div className="min-w-0 flex-1">
                                                    <p className="truncate text-sm font-bold text-white">{pick(course, 'title')}</p>
                                                    <p className="truncate text-[11px] text-gray-500">
                                                        {pick(course, 'category') || (isAr ? 'بدون تصنيف' : 'Uncategorized')}
                                                        {course.level ? ` · ${course.level}` : ''}
                                                    </p>
                                                    {course.readiness && (
                                                        <p className={`truncate text-[10px] font-bold ${course.readiness.percent === 100 ? 'text-emerald-400' : 'text-brand-gold-light'}`}>
                                                            {isAr ? 'الجاهزية' : 'Readiness'}: {course.readiness.percent}%
                                                        </p>
                                                    )}
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => moveCourse(index, -1)}
                                                    disabled={index === 0}
                                                    aria-label={isAr ? 'تحريك الدورة للأعلى' : 'Move course up'}
                                                    className="rounded-lg p-2 text-gray-400 hover:bg-white/10 hover:text-white disabled:opacity-30"
                                                >
                                                    <ArrowUp size={15} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => moveCourse(index, 1)}
                                                    disabled={index === selectedCourses.length - 1}
                                                    aria-label={isAr ? 'تحريك الدورة للأسفل' : 'Move course down'}
                                                    className="rounded-lg p-2 text-gray-400 hover:bg-white/10 hover:text-white disabled:opacity-30"
                                                >
                                                    <ArrowDown size={15} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setForm({ ...form, courseIds: form.courseIds.filter((id) => id !== course.id) })}
                                                    aria-label={isAr ? 'إزالة الدورة' : 'Remove course'}
                                                    className="rounded-lg p-2 text-red-400 hover:bg-red-500/10"
                                                >
                                                    <X size={15} />
                                                </button>
                                            </li>
                                        ))}
                                    </ol>
                                ) : (
                                    <p className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-center text-xs font-bold text-gray-500">
                                        {isAr ? 'لم تتم إضافة دورات إلى هذا المسار بعد' : 'No courses have been added to this path yet'}
                                    </p>
                                )}

                                <div className="space-y-2 rounded-xl border border-white/5 bg-black/10 p-3">
                                    <div className="relative">
                                        <Search size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-500" />
                                        <input
                                            type="search"
                                            value={courseQuery}
                                            onChange={(e) => setCourseQuery(e.target.value)}
                                            placeholder={isAr ? 'ابحث عن دورة لإضافتها' : 'Search courses to add'}
                                            className="w-full rounded-lg border border-white/10 bg-white/5 py-2 ps-9 pe-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
                                        />
                                    </div>
                                    {coursesLoading ? (
                                        <p className="py-3 text-center text-xs text-gray-500">{isAr ? 'جارٍ تحميل الدورات…' : 'Loading courses…'}</p>
                                    ) : coursesError ? (
                                        <p className="py-3 text-center text-xs text-red-400">{coursesError}</p>
                                    ) : availableCourses.length > 0 ? (
                                        <div className="max-h-44 space-y-1 overflow-y-auto">
                                            {availableCourses.map((course) => (
                                                <button
                                                    key={course.id}
                                                    type="button"
                                                    onClick={() => setForm({ ...form, courseIds: [...form.courseIds, course.id] })}
                                                    className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-start hover:bg-white/5"
                                                >
                                                    <span className="min-w-0">
                                                        <span className="block truncate text-xs font-bold text-gray-200">{pick(course, 'title')}</span>
                                                        <span className="block truncate text-[10px] text-gray-500">{pick(course, 'category') || course.level || ''}</span>
                                                    </span>
                                                    <Plus size={15} className="shrink-0 text-brand-gold-light" />
                                                </button>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="py-3 text-center text-xs text-gray-500">
                                            {isAr ? 'لا توجد دورات مطابقة أو تمت إضافتها كلها' : 'No matching courses, or all courses have been added'}
                                        </p>
                                    )}
                                </div>
                            </section>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={form.isPublished}
                                    onChange={(e) => setForm({ ...form, isPublished: e.target.checked })}
                                    className="w-4 h-4 rounded border-white/20 bg-white/5 accent-brand-gold cursor-pointer"
                                />
                                <span className="text-sm text-gray-300 font-bold">{isAr ? 'منشور (مرئي للطلاب)' : 'Published (visible to students)'}</span>
                            </label>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-3 p-6 border-t border-white/5">
                            <span className="hidden sm:flex items-center gap-1.5 text-[11px] font-bold text-gray-600">
                                <GraduationCap size={13} />
                                {isAr ? `${form.courseIds.length} دورة محددة` : `${form.courseIds.length} courses selected`}
                            </span>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => setModalOpen(false)}
                                    className="px-5 py-2.5 rounded-xl text-sm font-bold text-gray-400 hover:text-white hover:bg-white/5 transition-all"
                                >
                                    {isAr ? 'إلغاء' : 'Cancel'}
                                </button>
                                <button
                                    onClick={save}
                                    disabled={saving}
                                    className="px-5 py-2.5 rounded-xl text-sm font-bold bg-brand-gold text-brand-navy-dark hover:bg-brand-gold-light transition-all disabled:opacity-50 flex items-center gap-2"
                                >
                                    {saving && <Loader size={14} className="animate-spin" />}
                                    {editing ? (isAr ? 'تحديث' : 'Update') : (isAr ? 'إنشاء' : 'Create')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {reportId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setReportId(null)}>
                    <section
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="learning-path-report-title"
                        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-brand-navy p-6 shadow-2xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <header className="mb-5 flex items-center justify-between gap-3 border-b border-white/5 pb-4">
                            <h3 id="learning-path-report-title" className="text-lg font-black text-white">
                                {isAr ? 'تقرير المسار' : 'Learning path report'}
                            </h3>
                            <button onClick={() => setReportId(null)} aria-label={isAr ? 'إغلاق' : 'Close'} className="rounded-lg p-2 text-gray-400 hover:bg-white/5 hover:text-white">
                                <X size={18} />
                            </button>
                        </header>
                        {reportLoading ? (
                            <div className="flex justify-center py-12"><Loader size={24} className="animate-spin text-brand-gold-light" /></div>
                        ) : reportError ? (
                            <p role="alert" className="rounded-xl bg-red-500/10 p-4 text-sm text-red-300">{reportError}</p>
                        ) : report ? (
                            <div className="space-y-5">
                                <h4 className="font-black text-white">{pick(report.path, 'title')}</h4>
                                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                    {[
                                        { label: isAr ? 'إجمالي المسجلين' : 'Learners', value: report.learners },
                                        { label: isAr ? 'يتعلمون حاليًا' : 'Active', value: report.activeStudents },
                                        { label: isAr ? 'أكملوا المسار' : 'Completed', value: report.completedStudents },
                                        { label: isAr ? 'نسبة الإكمال' : 'Completion rate', value: `${report.completionRate}%` },
                                    ].map((stat) => (
                                        <div key={stat.label} className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
                                            <p className="text-[10px] font-bold text-gray-500">{stat.label}</p>
                                            <p className="mt-1 text-xl font-black text-brand-gold-light">{stat.value}</p>
                                        </div>
                                    ))}
                                </div>
                                <div className="space-y-2">
                                    <h5 className="text-sm font-black text-white">{isAr ? 'تفاصيل الدورات والجاهزية' : 'Courses and readiness'}</h5>
                                    {report.courses.map((course) => (
                                        <article key={course.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                                            <div className="flex items-center justify-between gap-3">
                                                <p className="truncate text-xs font-bold text-gray-200">{pick(course, 'title')}</p>
                                                <span className="shrink-0 text-[10px] font-bold text-gray-400">
                                                    {course.enrolledStudents} {isAr ? 'تسجيل' : 'enrollments'} · {course.readiness.percent}%
                                                </span>
                                            </div>
                                            {course.readiness.missing.length > 0 && (
                                                <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
                                                    {isAr ? 'ناقص: ' : 'Missing: '}
                                                    {course.readiness.missing.map((key) => t(`learningPaths.check_${key}`)).join(isAr ? '، ' : ', ')}
                                                </p>
                                            )}
                                        </article>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                    </section>
                </div>
            )}
        </div>
    );
}
