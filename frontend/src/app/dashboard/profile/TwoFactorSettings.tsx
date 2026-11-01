"use client";

import { useState, type FormEvent } from 'react';
import { api, getErrorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n-context';
import toast from 'react-hot-toast';
import { CheckCircle2, KeyRound, QrCode, ShieldCheck } from 'lucide-react';

export default function TwoFactorSettings({
    enabled: initialEnabled,
    sensitiveActionsRequireTwoFactor,
    onChanged,
}: {
    enabled: boolean;
    sensitiveActionsRequireTwoFactor: boolean;
    onChanged: () => void;
}) {
    const { t } = useI18n();
    const [enabledOverride, setEnabledOverride] = useState<boolean | null>(null);
    const enabled = enabledOverride ?? initialEnabled;
    const [setupLoading, setSetupLoading] = useState(false);
    const [enabling, setEnabling] = useState(false);
    const [disabling, setDisabling] = useState(false);
    const [qrDataUrl, setQrDataUrl] = useState('');
    const [secret, setSecret] = useState('');
    const [enableCode, setEnableCode] = useState('');
    const [disableForm, setDisableForm] = useState({ password: '', code: '' });

    const beginSetup = async () => {
        setSetupLoading(true);
        try {
            const response = await api.post('/auth/2fa/setup');
            setQrDataUrl(response.data.qrDataUrl);
            setSecret(response.data.secret);
        } catch (error) {
            toast.error(getErrorMessage(error) || t('profile.two_factor_setup_failed'));
        } finally {
            setSetupLoading(false);
        }
    };

    const confirmSetup = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setEnabling(true);
        try {
            await api.post('/auth/2fa/confirm', { code: enableCode });
            setEnabledOverride(true);
            setQrDataUrl('');
            setSecret('');
            setEnableCode('');
            toast.success(t('profile.two_factor_enabled'));
            onChanged();
        } catch (error) {
            toast.error(getErrorMessage(error) || t('profile.two_factor_enable_failed'));
        } finally {
            setEnabling(false);
        }
    };

    const disableTwoFactor = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setDisabling(true);
        try {
            await api.post('/auth/2fa/disable', disableForm);
            setEnabledOverride(false);
            setDisableForm({ password: '', code: '' });
            toast.success(t('profile.two_factor_disabled'));
            onChanged();
        } catch (error) {
            toast.error(getErrorMessage(error) || t('profile.two_factor_disable_failed'));
        } finally {
            setDisabling(false);
        }
    };

    const cardClass = 'bg-white dark:bg-brand-navy-dark border border-gray-200 dark:border-white/5 rounded-3xl shadow-sm p-6 lg:p-7';
    const inputClass = 'w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-white/10 bg-white dark:bg-white/5 text-brand-navy dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-gold';

    return (
        <section className={cardClass}>
            <div className="flex items-center gap-2.5 mb-5">
                <div className="w-10 h-10 rounded-xl bg-brand-gold/10 flex items-center justify-center text-brand-gold-dark dark:text-brand-gold-light">
                    <ShieldCheck size={20} />
                </div>
                <div>
                    <h3 className="text-xl font-black text-brand-navy dark:text-white">{t('profile.two_factor_title')}</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        {enabled ? t('profile.two_factor_active') : t('profile.two_factor_inactive')}
                    </p>
                </div>
                <span className={`ms-auto rounded-full px-3 py-1 text-xs font-bold ${enabled ? 'bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400' : 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300'}`}>
                    {enabled ? t('profile.two_factor_on') : t('profile.two_factor_off')}
                </span>
            </div>

            {sensitiveActionsRequireTwoFactor && (
                <p className="mb-4 rounded-xl border border-brand-gold/30 bg-brand-gold/10 p-4 text-sm font-semibold text-brand-navy dark:text-gray-200">
                    {t('profile.two_factor_step_up_hint')}
                </p>
            )}

            {enabled ? (
                <form onSubmit={disableTwoFactor} className="space-y-4">
                    <p className="text-sm text-gray-600 dark:text-gray-300">{t('profile.two_factor_disable_hint')}</p>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <label className="space-y-2 text-sm font-bold text-brand-navy dark:text-gray-200">
                            {t('profile.field_current_password')}
                            <input
                                type="password"
                                autoComplete="current-password"
                                required
                                className={inputClass}
                                value={disableForm.password}
                                onChange={(event) => setDisableForm({ ...disableForm, password: event.target.value })}
                            />
                        </label>
                        <label className="space-y-2 text-sm font-bold text-brand-navy dark:text-gray-200">
                            {t('profile.two_factor_code')}
                            <input
                                type="text"
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                pattern="[0-9]{6}"
                                maxLength={6}
                                required
                                dir="ltr"
                                className={inputClass}
                                value={disableForm.code}
                                onChange={(event) => setDisableForm({ ...disableForm, code: event.target.value.replace(/\D/g, '') })}
                            />
                        </label>
                    </div>
                    <button
                        type="submit"
                        disabled={disabling}
                        className="inline-flex items-center gap-2 rounded-xl border border-red-300 px-5 py-3 font-bold text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10"
                    >
                        <KeyRound size={17} />
                        {disabling ? t('common.processing') : t('profile.two_factor_disable')}
                    </button>
                </form>
            ) : qrDataUrl ? (
                <div className="space-y-4">
                    <p className="text-sm text-gray-600 dark:text-gray-300">{t('profile.two_factor_scan_hint')}</p>
                    <div className="flex justify-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={qrDataUrl} alt={t('profile.two_factor_qr_alt')} className="h-48 w-48 rounded-xl bg-white p-2" />
                    </div>
                    <p className="text-center text-sm text-gray-600 dark:text-gray-300">
                        {t('profile.two_factor_secret_hint')}{' '}
                        <span dir="ltr" className="select-all font-mono font-bold text-brand-navy dark:text-white">{secret}</span>
                    </p>
                    <form onSubmit={confirmSetup} className="flex flex-col gap-3 sm:flex-row">
                        <input
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            pattern="[0-9]{6}"
                            maxLength={6}
                            required
                            dir="ltr"
                            aria-label={t('profile.two_factor_code')}
                            placeholder={t('profile.two_factor_code')}
                            className={`${inputClass} sm:max-w-xs`}
                            value={enableCode}
                            onChange={(event) => setEnableCode(event.target.value.replace(/\D/g, ''))}
                        />
                        <button
                            type="submit"
                            disabled={enabling}
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-gold to-brand-gold-dark px-5 py-3 font-bold text-black transition disabled:opacity-50"
                        >
                            <CheckCircle2 size={17} />
                            {enabling ? t('common.processing') : t('profile.two_factor_confirm')}
                        </button>
                    </form>
                </div>
            ) : (
                <div>
                    <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">{t('profile.two_factor_enable_hint')}</p>
                    <button
                        type="button"
                        onClick={beginSetup}
                        disabled={setupLoading}
                        className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-gold to-brand-gold-dark px-5 py-3 font-bold text-black transition disabled:opacity-50"
                    >
                        <QrCode size={17} />
                        {setupLoading ? t('common.processing') : t('profile.two_factor_enable')}
                    </button>
                </div>
            )}
        </section>
    );
}
