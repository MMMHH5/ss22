"use client";

import ProtectedRoute from '@/components/ProtectedRoute';
import { useFetchData } from '@/lib/useFetchData';
import { useI18n } from '@/lib/i18n-context';
import { GraduationCap } from 'lucide-react';
import Link from 'next/link';

interface GradeRow {
    id: string;
    score: number;
    notes?: string | null;
    assessment: { id: string; nameAr: string; nameEn: string; maxScore: number };
}

interface GradedEnrollment {
    course: { id: string; titleAr?: string | null; titleEn?: string | null };
    opening?: { id: string; nameAr?: string | null; nameEn?: string | null } | null;
    grades: GradeRow[];
}

export default function MyGradesPage() {
    const { data: enrollments, loading, error } = useFetchData<GradedEnrollment[]>('/enrollments/my/grades');
    const { t, pick } = useI18n();

    const pct = (row: GradeRow) => (row.assessment.maxScore > 0 ? Math.round((row.score / row.assessment.maxScore) * 100) : 0);
    const courseAvg = (rows: GradeRow[]) => (rows.length ? Math.round(rows.reduce((s, r) => s + pct(r), 0) / rows.length) : null);

    const graded = (enrollments || []).filter(e => e.grades && e.grades.length > 0);
    const hasAny = graded.length > 0;

    return (
        <ProtectedRoute allowedRoles={['STUDENT']}>
            <div className="min-w-0 bg-white dark:bg-brand-navy-dark p-3 sm:p-6 lg:p-8 rounded-2xl sm:rounded-3xl shadow-sm border border-gray-200 dark:border-white/5 min-h-[80vh]">
                <div className="mb-6 sm:mb-8">
                    <h2 className="text-2xl sm:text-3xl font-black text-brand-navy dark:text-white flex items-center gap-2 sm:gap-3">
                        <GraduationCap size={26} className="shrink-0 text-brand-gold-dark dark:text-brand-gold-light sm:w-8 sm:h-8" /> {t('myGrades.heading')}
                    </h2>
                    <p className="text-gray-500 dark:text-gray-400 mt-2">{t('myGrades.subtitle')}</p>
                </div>

                {error && <div className="p-4 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 rounded-xl mb-6">{error}</div>}

                {loading ? (
                    <div className="h-40 flex items-center justify-center font-bold text-gray-500 dark:text-gray-400">{t('myGrades.loading')}</div>
                ) : hasAny ? (
                    <div className="space-y-6">
                        {graded.map((enrollment) => {
                            const avg = courseAvg(enrollment.grades);
                            return (
                                <div key={enrollment.course.id} className="border border-gray-200 dark:border-white/5 rounded-3xl overflow-x-auto bg-white dark:bg-transparent">
                                    <div className="bg-gradient-to-r from-brand-gold/20 to-brand-gold-dark/10 p-5 flex items-center justify-between gap-4 flex-wrap">
                                        <div>
                                            <h3 className="text-xl font-black text-brand-navy dark:text-white">
                                                <Link href={`/courses/${enrollment.course.id}`} className="hover:text-brand-gold-dark dark:hover:text-brand-gold-light transition-colors">
                                                    {pick(enrollment.course, 'title')}
                                                </Link>
                                            </h3>
                                            {pick(enrollment.opening, 'name') && (
                                                <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{pick(enrollment.opening, 'name')}</p>
                                            )}
                                        </div>
                                        <div className="text-right">
                                            <div className="text-2xl font-black text-brand-gold-dark dark:text-brand-gold-light">{avg}%</div>
                                            <div className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-bold">{t('myGrades.average')}</div>
                                        </div>
                                    </div>
                                    <table className="admin-table text-left">
                                        <thead>
                                            <tr>
                                                <th>{t('myGrades.col_assessment')}</th>
                                                <th>{t('myGrades.col_score')}</th>
                                                <th>{t('myGrades.col_percentage')}</th>
                                                <th>{t('myGrades.col_notes')}</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-200 dark:divide-white/5">
                                            {enrollment.grades.map((g) => (
                                                <tr key={g.id}>
                                                    <td className="p-4 font-bold text-gray-700 dark:text-gray-300">{pick(g.assessment, 'name')}</td>
                                                    <td className="p-4 font-black text-brand-gold-dark dark:text-brand-gold-light">{g.score} / {g.assessment.maxScore}</td>
                                                    <td className="p-4">
                                                        <span className={`px-2.5 py-1 rounded-full text-xs font-black ${pct(g) >= 60 ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-red-500/10 text-red-600 dark:text-red-400'}`}>
                                                            {pct(g)}%
                                                        </span>
                                                    </td>
                                                    <td className="p-4 text-sm text-gray-600 dark:text-gray-400">{g.notes || '—'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="text-center py-16 text-gray-500 dark:text-gray-400 font-semibold text-lg border-2 border-dashed border-gray-300 dark:border-white/10 rounded-xl bg-gray-100/50 dark:bg-transparent">
                        {t('myGrades.empty_title')}
                        <div className="mt-2 text-sm font-normal">{t('myGrades.empty_subtitle')}</div>
                        <div className="mt-6">
                            <Link href="/dashboard/my-courses" className="text-brand-gold-dark dark:text-brand-gold-light hover:underline">{t('sidebar.my_courses')}</Link>
                        </div>
                    </div>
                )}
            </div>
        </ProtectedRoute>
    );
}
