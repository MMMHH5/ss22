"use client";

import { useMemo } from 'react';
import { useFetchData } from '@/lib/useFetchData';
import { useI18n } from '@/lib/i18n-context';
import { BookOpen, CheckCircle2, Clock, FileQuestion, Flame, Loader } from 'lucide-react';

interface DailyActivity {
    date: string;
    seconds: number;
}

interface ModuleTime {
    moduleId?: string;
    titleAr?: string;
    titleEn?: string;
    seconds?: number;
    completionPercent?: number;
}

interface QuizScoreItem {
    quizId?: string;
    titleAr?: string;
    titleEn?: string;
    score?: number;
}

interface OverallAnalytics {
    totalSeconds?: number;
    coursesInProgress?: number;
    coursesCompleted?: number;
    streak?: number;
    dailyActivity?: DailyActivity[];
}

interface CourseAnalytics {
    totalSeconds?: number;
    completionPercent?: number;
    modules?: ModuleTime[];
    quizScores?: QuizScoreItem[];
    dailyActivity?: DailyActivity[];
}

interface Props {
    courseId?: string;
}

function ProgressRing({ pct, size = 120, label }: { pct: number; size?: number; label?: string }) {
    const clamped = Math.min(100, Math.max(0, pct));
    const stroke = 10;
    const radius = (size - stroke) / 2;
    const circ = 2 * Math.PI * radius;
    const offset = circ - (clamped / 100) * circ;
    return (
        <div className="relative shrink-0" style={{ width: size, height: size }}>
            <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
                <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
                <circle
                    cx={size / 2} cy={size / 2} r={radius} fill="none"
                    stroke="#f59e0b" strokeWidth={stroke} strokeLinecap="round"
                    strokeDasharray={circ} strokeDashoffset={offset}
                    style={{ transition: 'stroke-dashoffset 1s ease' }}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-black text-white tabular-nums" style={{ fontSize: size / 4 }}>{Math.round(clamped)}%</span>
                {label && <span className="text-[10px] text-gray-500 font-bold">{label}</span>}
            </div>
        </div>
    );
}

function fmtDuration(seconds: number, isAr: boolean): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return isAr ? `${h} س ${m} د` : `${h}h ${m}m`;
    return isAr ? `${m} د` : `${m}m`;
}

function Heatmap({ activity, isAr }: { activity: DailyActivity[] | undefined; isAr: boolean }) {
    const byDate = useMemo(() => {
        const map = new Map<string, number>();
        (activity || []).forEach((d) => map.set(String(d.date).slice(0, 10), Number(d.seconds || 0)));
        return map;
    }, [activity]);

    const days = useMemo(() => {
        const out: Array<{ key: string; seconds: number }> = [];
        for (let i = 29; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            out.push({ key, seconds: byDate.get(key) || 0 });
        }
        return out;
    }, [byDate]);

    const level = (s: number) => (s <= 0 ? 0 : s < 900 ? 1 : s < 1800 ? 2 : s < 3600 ? 3 : 4);
    const colors = ['bg-white/5', 'bg-brand-gold/20', 'bg-brand-gold/40', 'bg-brand-gold/70', 'bg-brand-gold-light'];

    return (
        <div>
            <div className="grid grid-cols-10 gap-1.5">
                {days.map(({ key, seconds }) => (
                    <div
                        key={key}
                        title={`${key} — ${fmtDuration(seconds, isAr)}`}
                        className={`aspect-square rounded-md ${colors[level(seconds)]} border border-white/5`}
                    />
                ))}
            </div>
            <div className="flex items-center justify-between mt-2.5">
                <span className="text-[10px] text-gray-600 font-bold">
                    {new Date(days[0]?.key ?? '').toLocaleDateString(isAr ? 'ar' : 'en-US', { month: 'short', day: 'numeric' })}
                </span>
                <div className="flex items-center gap-1">
                    <span className="text-[10px] text-gray-600 font-bold me-1">{isAr ? 'الأقل' : 'Less'}</span>
                    {colors.map((c) => <span key={c} className={`w-2.5 h-2.5 rounded-sm ${c}`} />)}
                    <span className="text-[10px] text-gray-600 font-bold ms-1">{isAr ? 'الأكثر' : 'More'}</span>
                </div>
                <span className="text-[10px] text-gray-600 font-bold">
                    {new Date().toLocaleDateString(isAr ? 'ar' : 'en-US', { month: 'short', day: 'numeric' })}
                </span>
            </div>
        </div>
    );
}

export default function LearningAnalytics({ courseId }: Props) {
    const { locale } = useI18n();
    const isAr = locale === 'ar';

    const overallRes = useFetchData<OverallAnalytics>(courseId ? null : '/analytics/me');
    const courseRes = useFetchData<CourseAnalytics>(courseId ? `/analytics/me/course/${courseId}` : null);

    if (!courseId && overallRes.loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader size={28} className="animate-spin text-brand-gold-light" />
            </div>
        );
    }
    if (courseId && courseRes.loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader size={28} className="animate-spin text-brand-gold-light" />
            </div>
        );
    }

    const error = courseId ? courseRes.error : overallRes.error;
    if (error) {
        return (
            <div className="bg-brand-navy-dark border border-white/5 rounded-2xl p-8 text-center">
                <Clock size={32} className="mx-auto text-gray-600 mb-3" />
                <p className="text-gray-400 font-bold text-sm">{error}</p>
            </div>
        );
    }

    // ===== Course-specific =====
    if (courseId) {
        const c = courseRes.data;
        const modules = c?.modules || [];
        const maxSeconds = Math.max(...modules.map((m) => Number(m.seconds || 0)), 1);
        const quizzes = c?.quizScores || [];
        const quizAvg = quizzes.length
            ? Math.round(quizzes.reduce((s, q) => s + Number(q.score || 0), 0) / quizzes.length)
            : null;

        return (
            <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-stretch">
                    <div className="bg-brand-navy-dark border border-white/5 rounded-2xl p-5 flex items-center justify-center">
                        <ProgressRing pct={Number(c?.completionPercent ?? 0)} label={isAr ? 'مكتمل' : 'complete'} />
                    </div>
                    <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="bg-brand-navy-dark border border-white/5 rounded-2xl p-5 flex flex-col justify-center">
                            <Clock size={20} className="text-brand-navy-light mb-2" />
                            <p className="text-2xl font-black text-white tabular-nums">{fmtDuration(Number(c?.totalSeconds ?? 0), isAr)}</p>
                            <p className="text-[11px] uppercase tracking-wider text-gray-500 font-bold mt-1">{isAr ? 'وقت التعلم' : 'Learning time'}</p>
                        </div>
                        <div className="bg-brand-navy-dark border border-white/5 rounded-2xl p-5 flex flex-col justify-center">
                            <FileQuestion size={20} className="text-brand-gold-light mb-2" />
                            <p className="text-2xl font-black text-white tabular-nums">{quizAvg !== null ? `${quizAvg}%` : '—'}</p>
                            <p className="text-[11px] uppercase tracking-wider text-gray-500 font-bold mt-1">{isAr ? 'متوسط الاختبارات' : 'Quiz average'}</p>
                        </div>
                    </div>
                </div>

                <div className="bg-brand-navy-dark border border-white/5 rounded-2xl p-5">
                    <h3 className="flex items-center gap-2 text-sm font-black text-white mb-4">
                        <BookOpen size={16} className="text-brand-gold-light" />
                        {isAr ? 'الوقت لكل وحدة' : 'Time per module'}
                    </h3>
                    {modules.length === 0 ? (
                        <p className="text-gray-500 font-bold text-xs text-center py-6">{isAr ? 'لا توجد بيانات وحدات بعد' : 'No module data yet'}</p>
                    ) : (
                        <div className="space-y-3.5">
                            {modules.map((m, i) => {
                                const secs = Number(m.seconds || 0);
                                return (
                                    <div key={m.moduleId || i}>
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className="text-xs font-bold text-gray-300 truncate">{m.titleAr || m.titleEn || `${isAr ? 'وحدة' : 'Module'} ${i + 1}`}</span>
                                            <span className="text-[11px] font-black text-gray-500 tabular-nums shrink-0 ms-2">{fmtDuration(secs, isAr)}</span>
                                        </div>
                                        <div className="h-2.5 bg-white/5 rounded-full overflow-hidden">
                                            <div
                                                className="h-full rounded-full bg-gradient-to-r from-brand-gold-dark to-brand-gold-light transition-all duration-700"
                                                style={{ width: `${Math.max(2, (secs / maxSeconds) * 100)}%` }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {quizzes.length > 0 && (
                    <div className="bg-brand-navy-dark border border-white/5 rounded-2xl p-5">
                        <h3 className="flex items-center gap-2 text-sm font-black text-white mb-4">
                            <FileQuestion size={16} className="text-brand-gold-light" />
                            {isAr ? 'درجات الاختبارات' : 'Quiz scores'}
                        </h3>
                        <div className="space-y-3">
                            {quizzes.map((q, i) => {
                                const score = Math.min(100, Math.max(0, Number(q.score || 0)));
                                return (
                                    <div key={q.quizId || i}>
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className="text-xs font-bold text-gray-300 truncate">{q.titleAr || q.titleEn || `${isAr ? 'اختبار' : 'Quiz'} ${i + 1}`}</span>
                                            <span className={`text-[11px] font-black tabular-nums shrink-0 ms-2 ${score >= 60 ? 'text-green-400' : 'text-red-400'}`}>{score}%</span>
                                        </div>
                                        <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full rounded-full transition-all duration-700 ${score >= 60 ? 'bg-green-500/80' : 'bg-red-500/80'}`}
                                                style={{ width: `${Math.max(2, score)}%` }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                <div className="bg-brand-navy-dark border border-white/5 rounded-2xl p-5">
                    <h3 className="text-sm font-black text-white mb-4">{isAr ? 'نشاط آخر ٣٠ يوماً' : 'Last 30 days activity'}</h3>
                    <Heatmap activity={c?.dailyActivity} isAr={isAr} />
                </div>
            </div>
        );
    }

    // ===== Overall =====
    const o = overallRes.data;
    const hasLearningData = Number(o?.totalSeconds ?? 0) > 0
        || Number(o?.coursesInProgress ?? 0) > 0
        || Number(o?.coursesCompleted ?? 0) > 0
        || Number(o?.streak ?? 0) > 0;
    const hasDailyActivity = (o?.dailyActivity ?? []).some((day) => Number(day.seconds) > 0);
    if (!hasLearningData) {
        return (
            <div className="rounded-2xl border border-dashed border-white/10 bg-brand-navy-dark p-6 text-center">
                <BookOpen size={24} className="mx-auto mb-2 text-gray-500" />
                <p className="text-sm font-bold text-gray-300">
                    {isAr ? 'ابدأ دورة لتظهر إحصاءات تقدمك هنا.' : 'Start a course to see your learning insights here.'}
                </p>
            </div>
        );
    }

    const stats = [
        { icon: Clock, color: 'text-brand-navy-light', bg: 'bg-brand-navy-light/10 border-brand-navy-light/30', value: fmtDuration(Number(o?.totalSeconds ?? 0), isAr), label: isAr ? 'إجمالي وقت التعلم' : 'Total learning time' },
        { icon: BookOpen, color: 'text-brand-gold-light', bg: 'bg-brand-gold/10 border-brand-gold/30', value: String(Number(o?.coursesInProgress ?? 0)), label: isAr ? 'دورات قيد التقدم' : 'Courses in progress' },
        { icon: CheckCircle2, color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/30', value: String(Number(o?.coursesCompleted ?? 0)), label: isAr ? 'دورات مكتملة' : 'Courses completed' },
        { icon: Flame, color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30', value: String(Number(o?.streak ?? 0)), label: isAr ? 'سلسلة الأيام' : 'Current streak' },
    ];

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {stats.map(({ icon: Icon, bg, color, value, label }) => (
                    <div key={label} className="bg-brand-navy-dark border border-white/5 rounded-2xl p-5">
                        <span className={`w-10 h-10 rounded-xl border flex items-center justify-center mb-3 ${bg}`}>
                            <Icon size={18} className={color} />
                        </span>
                        <p className="text-xl font-black text-white tabular-nums">{value}</p>
                        <p className="text-[11px] text-gray-500 font-bold mt-1 leading-snug">{label}</p>
                    </div>
                ))}
            </div>

            {hasDailyActivity && (
                <div className="bg-brand-navy-dark border border-white/5 rounded-2xl p-5">
                    <h3 className="text-sm font-black text-white mb-4">{isAr ? 'نشاط آخر ٣٠ يوماً' : 'Last 30 days activity'}</h3>
                    <Heatmap activity={o?.dailyActivity} isAr={isAr} />
                </div>
            )}
        </div>
    );
}
