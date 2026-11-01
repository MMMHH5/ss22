"use client";

import { useFetchData } from '@/lib/useFetchData';
import { useI18n } from '@/lib/i18n-context';
import {
    Award, BookOpen, Flame, MessageCircle, Star, Target, Trophy, Zap,
} from 'lucide-react';

interface BadgeData {
    id: string;
    badgeType: string;
    earnedAt?: string;
}

interface PointsData {
    points?: number;
    level?: number;
    streak?: number;
    xpToNextLevel?: number;
    badges?: BadgeData[];
}

interface Props {
    userId?: string;
}

type LucideIcon = typeof Award;

const BADGE_CATALOG: Record<string, { icon: LucideIcon; ar: string; en: string }> = {
    FIRST_LOGIN: { icon: Zap, ar: 'البداية', en: 'First Steps' },
    FIRST_LESSON: { icon: BookOpen, ar: 'أول درس', en: 'First Lesson' },
    LESSON_10: { icon: BookOpen, ar: 'قارئ نهم', en: 'Book Worm' },
    COURSE_COMPLETE: { icon: Trophy, ar: 'خريج دورة', en: 'Course Graduate' },
    QUIZ_PASS: { icon: Target, ar: 'اجتياز اختبار', en: 'Quiz Passer' },
    QUIZ_PERFECT: { icon: Star, ar: 'علامة كاملة', en: 'Perfect Score' },
    STREAK_3: { icon: Flame, ar: '٣ أيام متتالية', en: '3-Day Streak' },
    STREAK_7: { icon: Flame, ar: 'أسبوع متواصل', en: '7-Day Streak' },
    STREAK_30: { icon: Flame, ar: 'شهر متواصل', en: '30-Day Streak' },
    DISCUSSION_POST: { icon: MessageCircle, ar: 'مشارك نشط', en: 'Active Contributor' },
    FAST_LEARNER: { icon: Zap, ar: 'متعلّم سريع', en: 'Fast Learner' },
    POINTS_500: { icon: Award, ar: '٥٠٠ نقطة', en: '500 Points Club' },
};

export default function GamificationPanel({ userId }: Props) {
    const { locale, pick } = useI18n();
    const isAr = locale === 'ar';

    const meRes = useFetchData<PointsData>(userId ? `/gamification/user/${userId}` : '/gamification/me');

    const points = Number(meRes.data?.points ?? 0);
    const level = Math.max(1, Number(meRes.data?.level ?? 1));
    const streak = Number(meRes.data?.streak ?? 0);

    // Fallback XP curve: 100 XP per level (used unless API provides xpToNextLevel)
    const floorXp = (level - 1) * 100;
    const ceilXp = level * 100;
    const span = Number.isFinite(Number(meRes.data?.xpToNextLevel)) && Number(meRes.data?.xpToNextLevel) > 0
        ? Number(meRes.data?.xpToNextLevel)
        : ceilXp - floorXp;
    const inLevel = points - floorXp;
    const pct = Math.min(100, Math.max(0, (inLevel / span) * 100));

    const earnedTypes = new Set((meRes.data?.badges || []).map((b) => b.badgeType));

    const earnedBadges = Object.entries(BADGE_CATALOG)
        .filter(([type]) => earnedTypes.has(type))
        .map(([type, definition]) => ({ type, ...definition }));
    const extraEarnedBadges = [...earnedTypes]
        .filter((type) => !BADGE_CATALOG[type])
        .map((type) => ({ type, icon: Award, ar: type, en: type }));
    const badgeList = [...earnedBadges, ...extraEarnedBadges];

    if (meRes.loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Zap size={28} className="animate-pulse text-brand-gold-light" />
            </div>
        );
    }

    if (meRes.error) {
        return (
            <div className="bg-brand-navy-dark border border-white/5 rounded-2xl p-8 text-center">
                <Trophy size={32} className="mx-auto text-gray-600 mb-3" />
                <p className="text-gray-400 font-bold text-sm">{meRes.error}</p>
            </div>
        );
    }

    return (
        <div className="space-y-5">
            {/* Level / XP / Streak */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 bg-brand-navy-dark border border-white/5 rounded-2xl p-6">
                    <div className="flex items-center gap-4 mb-4">
                        <span className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-gold/30 to-brand-gold/10 border border-brand-gold/40 flex items-center justify-center shrink-0">
                            <Zap size={26} className="text-brand-gold-light" />
                        </span>
                        <div>
                            <p className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">{isAr ? 'المستوى' : 'Level'}</p>
                            <p className="text-2xl font-black text-white">
                                {level} <span className="text-sm font-bold text-gray-500">{isAr ? 'مستوى' : 'level'}</span>
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center justify-between mb-1.5 text-[11px] font-bold">
                        <span className="text-gray-400">{isAr ? 'نقاط الخبرة' : 'XP'}</span>
                        <span className="text-brand-gold-light tabular-nums">
                            {points} XP{meRes.data?.xpToNextLevel ? ` · ${isAr ? 'يبقى' : 'to next'} ${Math.max(0, span - inLevel)}` : ''}
                        </span>
                    </div>
                    <div className="h-3 bg-white/5 rounded-full overflow-hidden">
                        <div
                            className="h-full rounded-full bg-gradient-to-r from-brand-gold-dark via-brand-gold to-brand-gold-light transition-all duration-700"
                            style={{ width: `${Math.max(3, pct)}%` }}
                        />
                    </div>
                    <div className="flex items-center justify-between mt-1 text-[10px] text-gray-600 font-bold tabular-nums">
                        <span>{floorXp}</span>
                        <span>{ceilXp}</span>
                    </div>
                </div>

                <div className="bg-brand-navy-dark border border-white/5 rounded-2xl p-6 flex items-center gap-4">
                    <span className={`w-14 h-14 rounded-2xl border flex items-center justify-center shrink-0 ${
                        streak > 0 ? 'bg-orange-500/15 border-orange-500/40' : 'bg-white/5 border-white/10'
                    }`}>
                        <Flame size={26} className={streak > 0 ? 'text-orange-400' : 'text-gray-600'} />
                    </span>
                    <div>
                        <p className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">{isAr ? 'سلسلة الأيام' : 'Streak'}</p>
                        <p className="text-2xl font-black text-white">
                            {streak} <span className="text-sm font-bold text-gray-500">{isAr ? 'يوم' : streak === 1 ? 'day' : 'days'}</span>
                        </p>
                        <p className="text-[11px] text-gray-600 font-bold mt-0.5">
                            {streak > 0 ? (isAr ? 'واصل التعلم كل يوم!' : 'Keep learning every day!') : (isAr ? 'ابدأ سلسلتك اليوم' : 'Start your streak today')}
                        </p>
                    </div>
                </div>
            </div>

            <section aria-label={isAr ? 'مجموعة الشارات' : 'Badge collection'} className="bg-brand-navy-dark border border-white/5 rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="flex items-center gap-2 text-sm font-black text-white">
                            <Award size={16} className="text-brand-gold-light" />
                            {isAr ? 'مجموعة الشارات' : 'Badge collection'}
                        </h3>
                        <span className="text-[11px] font-bold text-gray-500">
                            {badgeList.length}
                        </span>
                    </div>
                    {badgeList.length === 0 ? (
                        <p className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-center text-xs font-semibold text-gray-400">
                            {isAr ? 'لم تحصل على شارات بعد. واصل التعلم لاكتسابها.' : 'No badges earned yet. Keep learning to earn one.'}
                        </p>
                    ) : (
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
                            {badgeList.map(({ type, icon: Icon, ar, en }) => (
                                <div
                                    key={type}
                                    title={isAr ? ar : en}
                                    className="flex flex-col items-center gap-1.5 rounded-xl border border-brand-gold/30 bg-brand-gold/5 p-3 text-center transition-all hover:border-brand-gold/50"
                                >
                                    <Icon size={22} className="text-brand-gold-light" />
                                    <span className="text-[10px] font-bold leading-tight text-gray-200">
                                        {pick({ labelAr: ar, labelEn: en }, 'label')}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
            </section>
        </div>
    );
}
