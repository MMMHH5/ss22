"use client";

import { useState } from 'react';
import { useFetchData } from '@/lib/useFetchData';
import { API_BASE_URL } from '@/lib/deployment-urls';
import { useI18n } from '@/lib/i18n-context';
import { useTheme } from '@/lib/theme-context';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { Activity, Database, MemoryStick, ShieldAlert, Server, Cpu, Settings } from 'lucide-react';
import { PageHeader, SectionHeader, Badge, BtnPrimary } from '../components';

interface HealthResponse {
    status?: string;
    info?: {
        database?: { status: string };
        memory_heap?: { status: string };
    };
    error?: Record<string, unknown>;
}

export default function AdminSystemPage() {
    const { data: health, loading: healthLoading, error: healthError } = useFetchData<HealthResponse>('/health');
    const { t } = useI18n();
    const { dark } = useTheme();

    const dbUp = health?.info?.database?.status === 'up';
    const memUp = health?.info?.memory_heap?.status === 'up';
    const healthy = health?.status === 'ok';
    const apiUrl = API_BASE_URL;
    const env = process.env.NODE_ENV || 'development';

    const [platformCurrency, setPlatformCurrency] = useState('USD');
    const [platformName, setPlatformName] = useState('LaxaLab');
    const [maxUploadSize, setMaxUploadSize] = useState(10);
    const [allowRegistration, setAllowRegistration] = useState(true);
    const [smtpHost, setSmtpHost] = useState('');
    const [smtpPort, setSmtpPort] = useState('587');

    const handleSaveSettings = () => {
        toast.success(t('admin.settings_saved'));
    };

    const loadingBadge = <span className="text-xs font-bold text-gray-500 dark:text-gray-400">{t('admin.loading_system')}</span>;

    return (
        <div className="space-y-6 animate-fade-in">
            <PageHeader title={t('admin.system_heading')} subtitle={t('admin.system_subtitle')} />

            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-navy via-[#0e2a52] to-brand-navy-dark p-4 sm:p-6 lg:p-8 flex flex-wrap items-center justify-between gap-4">
                <div className="absolute -top-16 -right-10 w-56 h-56 bg-brand-gold/15 rounded-full blur-3xl" />
                <div className="relative flex items-center gap-5">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center backdrop-blur ${healthy ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                        <Activity size={28} />
                    </div>
                    <div>
                        <h3 className="text-2xl font-black text-white tracking-tight">{t('admin.system_status_title')}</h3>
                        <p className="text-gray-400 text-sm mt-1">{t('admin.health_check_desc')}</p>
                    </div>
                </div>
                <Badge tone={healthy ? 'green' : 'red'} dot>
                    {healthy ? t('admin.system_online') : t('admin.system_offline')}
                </Badge>
            </div>

            {healthError && <div className="p-4 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 rounded-xl">{healthError}</div>}

            <section>
                <SectionHeader icon={Activity} title={t('admin.health_check_title')} subtitle={t('admin.health_check_subtitle')} color="green" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-white dark:bg-brand-navy-dark border border-gray-200 dark:border-white/5 rounded-2xl p-5">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-brand-navy-light/15 text-brand-navy-light rounded-xl flex items-center justify-center"><Database size={20} /></div>
                                <span className="font-black text-brand-navy dark:text-white">{t('admin.database_label')}</span>
                            </div>
                            {healthLoading ? loadingBadge : <Badge tone={dbUp ? 'green' : 'red'} dot>{dbUp ? t('admin.status_up') : t('admin.status_down')}</Badge>}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold">PostgreSQL / Prisma</p>
                    </div>
                    <div className="bg-white dark:bg-brand-navy-dark border border-gray-200 dark:border-white/5 rounded-2xl p-5">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-purple-500/15 text-purple-400 rounded-xl flex items-center justify-center"><MemoryStick size={20} /></div>
                                <span className="font-black text-brand-navy dark:text-white">{t('admin.memory_heap_label')}</span>
                            </div>
                            {healthLoading ? loadingBadge : <Badge tone={memUp ? 'green' : 'red'} dot>{memUp ? t('admin.status_up') : t('admin.status_down')}</Badge>}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold">&lt; 250 MB</p>
                    </div>
                </div>
            </section>

            <section>
                <SectionHeader icon={Cpu} title={t('admin.platform_info')} subtitle={t('admin.platform_info_desc')} color="navy" />
                <div className="bg-white dark:bg-brand-navy-dark border border-gray-200 dark:border-white/5 rounded-2xl p-6">
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                        <div className="bg-gray-100/60 dark:bg-white/5 rounded-xl p-4">
                            <div className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5">{t('admin.app_name_label')}</div>
                            <img
                                src={dark ? '/logos/LaxaLab_Academy_Horizontal_Reverse_4K.png' : '/logos/LaxaLab_Academy_Horizontal_Primary_4K.png'}
                                alt="Laxalab Academy"
                                className="h-6 md:h-7 w-auto max-w-[85%] object-contain"
                            />
                        </div>
                        <div className="bg-gray-100/60 dark:bg-white/5 rounded-xl p-4">
                            <div className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5">{t('admin.environment')}</div>
                            <div className="font-black text-brand-navy dark:text-white flex items-center gap-2">
                                <Server size={16} className="text-brand-gold-dark dark:text-brand-gold-light" />
                                {env === 'production' ? t('admin.environment_production') : t('admin.environment_development')}
                            </div>
                        </div>
                        <div className="bg-gray-100/60 dark:bg-white/5 rounded-xl p-4 md:col-span-2">
                            <div className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5">{t('admin.api_url_label')}</div>
                            <div className="font-mono text-sm font-bold text-brand-navy dark:text-white truncate" title={apiUrl}>{apiUrl}</div>
                        </div>
                    </div>
                </div>
            </section>

            <section>
                <SectionHeader icon={Settings} title={t('admin.platform_vars')} subtitle={t('admin.platform_vars_desc')} color="amber" />
                <div className="bg-white dark:bg-brand-navy-dark border border-gray-200 dark:border-white/5 rounded-2xl p-6">
                    <div className="grid gap-5 md:grid-cols-2">
                        <div>
                            <label htmlFor="platformName" className="block text-sm font-bold text-gray-600 dark:text-gray-300 mb-1">{t('admin.settings_platform_name')}</label>
                            <input
                                id="platformName"
                                type="text"
                                value={platformName}
                                onChange={e => setPlatformName(e.target.value)}
                                placeholder="LaxaLab"
                                className="w-full px-3 py-2 bg-white dark:bg-brand-navy-dark border border-gray-300 dark:border-white/10 rounded-xl text-sm text-brand-navy dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:ring-2 focus:ring-brand-gold outline-none transition"
                            />
                        </div>
                        <div>
                            <label htmlFor="platformCurrency" className="block text-sm font-bold text-gray-600 dark:text-gray-300 mb-1">{t('admin.settings_currency')}</label>
                            <select
                                id="platformCurrency"
                                value={platformCurrency}
                                onChange={e => setPlatformCurrency(e.target.value)}
                                className="w-full px-3 py-2 bg-white dark:bg-brand-navy-dark border border-gray-300 dark:border-white/10 rounded-xl text-sm text-brand-navy dark:text-white focus:ring-2 focus:ring-brand-gold outline-none transition"
                            >
                                {['USD', 'EUR', 'SAR', 'AED', 'YER'].map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="maxUploadSize" className="block text-sm font-bold text-gray-600 dark:text-gray-300 mb-1">{t('admin.settings_max_upload')}</label>
                            <input
                                id="maxUploadSize"
                                type="number"
                                min={1}
                                value={maxUploadSize}
                                onChange={e => setMaxUploadSize(Number(e.target.value))}
                                className="w-full px-3 py-2 bg-white dark:bg-brand-navy-dark border border-gray-300 dark:border-white/10 rounded-xl text-sm text-brand-navy dark:text-white focus:ring-2 focus:ring-brand-gold outline-none transition"
                            />
                        </div>
                        <div className="flex items-end pb-2">
                            <label className="flex items-center gap-2 font-bold cursor-pointer text-sm text-gray-600 dark:text-gray-300">
                                <input
                                    type="checkbox"
                                    checked={allowRegistration}
                                    onChange={e => setAllowRegistration(e.target.checked)}
                                    className="w-4 h-4 accent-brand-gold"
                                />
                                {t('admin.settings_allow_registration')}
                            </label>
                        </div>
                        <div>
                            <label htmlFor="smtpHost" className="block text-sm font-bold text-gray-600 dark:text-gray-300 mb-1">{t('admin.settings_smtp_host')}</label>
                            <input
                                id="smtpHost"
                                type="text"
                                value={smtpHost}
                                onChange={e => setSmtpHost(e.target.value)}
                                placeholder="smtp.example.com"
                                className="w-full px-3 py-2 bg-white dark:bg-brand-navy-dark border border-gray-300 dark:border-white/10 rounded-xl text-sm text-brand-navy dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:ring-2 focus:ring-brand-gold outline-none transition"
                            />
                        </div>
                        <div>
                            <label htmlFor="smtpPort" className="block text-sm font-bold text-gray-600 dark:text-gray-300 mb-1">{t('admin.settings_smtp_port')}</label>
                            <input
                                id="smtpPort"
                                type="text"
                                value={smtpPort}
                                onChange={e => setSmtpPort(e.target.value)}
                                placeholder="587"
                                className="w-full px-3 py-2 bg-white dark:bg-brand-navy-dark border border-gray-300 dark:border-white/10 rounded-xl text-sm text-brand-navy dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:ring-2 focus:ring-brand-gold outline-none transition"
                            />
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 mt-6 pt-5 border-t border-gray-200 dark:border-white/5">
                        <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold">{t('admin.settings_local_note')}</p>
                        <BtnPrimary icon={Settings} onClick={handleSaveSettings}>{t('admin.settings_save')}</BtnPrimary>
                    </div>
                </div>
            </section>

            <Link href="/dashboard/admin/audit">
                <div className="bg-white dark:bg-brand-navy-dark border border-gray-200 dark:border-white/5 rounded-2xl p-6 flex flex-wrap items-center justify-between gap-4 hover:border-gray-300 dark:hover:border-white/10 dark:hover:bg-[#152540] transition cursor-pointer">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-red-500/10 text-red-600 dark:text-red-400 rounded-xl flex items-center justify-center"><ShieldAlert size={22} /></div>
                        <div>
                            <h3 className="font-black text-brand-navy dark:text-white text-lg">{t('admin.audit_logs_title')}</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400">{t('admin.audit_logs_desc')}</p>
                        </div>
                    </div>
                    <span className="inline-flex items-center gap-2 bg-gradient-to-r from-brand-gold to-brand-gold-dark text-black px-5 py-2.5 rounded-xl font-bold text-sm hover:from-brand-gold-dark hover:to-brand-gold-dark transition-all duration-200">
                        {t('admin.view_audit')}
                    </span>
                </div>
            </Link>
        </div>
    );
}
