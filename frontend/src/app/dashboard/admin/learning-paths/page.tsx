"use client";

import LearningPathList from '@/components/LearningPathList';
import { PageHeader } from '@/app/dashboard/admin/components';
import { useI18n } from '@/lib/i18n-context';
import { Route } from 'lucide-react';

export default function AdminLearningPathsPage() {
    const { t } = useI18n();

    return (
        <div className="space-y-6 animate-fade-in">
            <PageHeader
                title={t('admin.learning_paths_heading')}
                subtitle={t('admin.learning_paths_subtitle')}
                actions={<Route size={22} className="text-brand-gold-dark dark:text-brand-gold-light" />}
            />
            <LearningPathList mode="manage" />
        </div>
    );
}
