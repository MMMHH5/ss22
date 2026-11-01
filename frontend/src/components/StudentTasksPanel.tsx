"use client";

import { useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { api, API_BASE_URL, getErrorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n-context';
import toast from 'react-hot-toast';
import { Loader, ClipboardList, Send, CheckCircle, Clock, Paperclip, FileText, Trash2 } from 'lucide-react';

interface SubmittedFile {
    url: string;
    name: string;
    size?: number;
    mimetype?: string | null;
}

interface SubmissionRow {
    id: string;
    content?: string | null;
    attachmentUrl?: string | null;
    attachmentName?: string | null;
    attachmentSize?: number | null;
    score?: number | null;
    notes?: string | null;
    submittedAt: string;
}

interface TaskItem {
    id: string;
    titleAr: string;
    titleEn: string;
    descriptionAr?: string | null;
    descriptionEn?: string | null;
    dueDate?: string | null;
    maxScore: number;
    attachmentUrl?: string | null;
    attachmentName?: string | null;
    attachmentType?: string | null;
    links?: { url: string; labelAr?: string | null; labelEn?: string | null }[] | null;
    module?: { id: string; titleAr?: string | null; titleEn?: string | null } | null;
    submissions?: SubmissionRow[];
}

type Props =
    | { courseId: string; openingId?: never }
    | { openingId: string; courseId?: never };

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function StudentTasksPanel({ courseId, openingId }: Props) {
    const { t, pick } = useI18n();
    const [tasks, setTasks] = useState<TaskItem[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [unresolved, setUnresolved] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [files, setFiles] = useState<Record<string, SubmittedFile | null>>({});
    const [uploadingId, setUploadingId] = useState<string | null>(null);
    const [submittingId, setSubmittingId] = useState<string | null>(null);
    const inputs = useRef<Record<string, HTMLInputElement | null>>({});

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                if (typeof window === 'undefined' || !localStorage.getItem('laxalab_token')) {
                    if (active) { setTasks([]); }
                    return;
                }
                // The server resolves the student's batch. Asking the client to
                // read it off `/enrollments/my` meant an enrollment that never
                // recorded a batch produced "no tasks", and the student was
                // told the course had no assignments.
                const res = await api.get(openingId ? `/tasks/opening/${openingId}` : `/tasks/course/${courseId}`);
                if (!active) return;
                setTasks(res.data || []);
                setUnresolved(false);
                setLoadError(null);
            } catch (e: unknown) {
                if (!active) return;
                const status = isAxiosError(e) ? e.response?.status : undefined;
                // 403 here means "enrolled, but not tied to one batch", which is
                // a different message from "no assignments exist".
                setUnresolved(!openingId && status === 403);
                setLoadError(!openingId && status === 403 ? null : getErrorMessage(e) || t('tasks.load_fail'));
                setTasks([]);
            } finally {
                if (active) setLoading(false);
            }
        })();
        return () => { active = false; };
    }, [courseId, openingId, t]);

    const handleFile = async (taskId: string, file: File | null | undefined) => {
        if (!file) return;
        setUploadingId(taskId);
        try {
            const form = new FormData();
            form.append('file', file);
            const res = await api.post(`/tasks/${taskId}/submit-file`, form, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            setFiles(prev => ({ ...prev, [taskId]: res.data }));
        } catch (e) {
            toast.error(getErrorMessage(e) || t('tasks.load_fail'));
        } finally {
            setUploadingId(null);
            if (inputs.current[taskId]) inputs.current[taskId]!.value = '';
        }
    };

    const handleSubmit = async (taskId: string) => {
        const content = (drafts[taskId] || '').trim();
        const file = files[taskId] ?? null;
        if (!content && !file) return;
        setSubmittingId(taskId);
        try {
            await api.post(`/tasks/${taskId}/submit`, {
                content: content || undefined,
                attachmentUrl: file?.url,
                attachmentName: file?.name,
                attachmentType: file?.mimetype,
                attachmentSize: file?.size,
            });
            toast.success(t('tasks.submitted_ok'));
            setDrafts(prev => ({ ...prev, [taskId]: '' }));
            setFiles(prev => ({ ...prev, [taskId]: null }));
            const res = await api.get(openingId ? `/tasks/opening/${openingId}` : `/tasks/course/${courseId}`);
            setTasks(res.data || []);
        } catch (e) {
            toast.error(getErrorMessage(e) || t('tasks.load_fail'));
        } finally {
            setSubmittingId(null);
        }
    };

    const sorted = (tasks || []).slice().sort((a, b) => new Date(a.dueDate || 0).getTime() - new Date(b.dueDate || 0).getTime());

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <ClipboardList size={24} className="text-accent" />
                <h2 className="text-2xl font-black text-ink">{t('tasks.tasks_title')}</h2>
            </div>

            {loading ? (
                <div className="h-48 flex items-center justify-center text-ink">
                    <Loader className="animate-spin" size={32} />
                </div>
            ) : loadError ? (
                <div role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm font-bold text-red-600 dark:text-red-400">
                    {loadError}
                </div>
            ) : unresolved ? (
                <div className="text-center text-ink-subtle font-bold py-16">
                    {t('tasks.not_linked_to_batch')}
                </div>
            ) : sorted.length === 0 ? (
                <div className="text-center text-ink-subtle font-bold py-16">{t('tasks.no_tasks')}</div>
            ) : (
                <div className="space-y-4">
                    {sorted.map(task => {
                        const mySubmission = task.submissions?.length ? task.submissions[0] : null;
                        const graded = typeof mySubmission?.score === 'number';
                        const overdue = task.dueDate ? new Date(task.dueDate) < new Date() : false;
                        const submittedFileUrl = mySubmission?.attachmentUrl
                            ? (mySubmission.attachmentUrl.startsWith('/') ? API_BASE_URL + mySubmission.attachmentUrl : mySubmission.attachmentUrl)
                            : null;
                        const chosen = files[task.id] ?? null;
                        return (
                            <div key={task.id} className="border border-brand-mist rounded-2xl p-5 bg-surface-raised shadow-sm">
                                <div className="flex items-start justify-between gap-3 flex-wrap">
                                    <div>
                                        {task.module && (
                                            <p className="text-[11px] font-bold text-accent mb-1">
                                                {pick(task.module, 'title')}
                                            </p>
                                        )}
                                        <h3 className="font-bold text-ink">{pick(task, 'title')}</h3>
                                        {pick(task, 'description') && (
                                            <p className="text-sm text-ink-subtle mt-1 whitespace-pre-wrap">{pick(task, 'description')}</p>
                                        )}
                                        {task.attachmentUrl && (
                                            <a href={task.attachmentUrl.startsWith('/') ? API_BASE_URL + task.attachmentUrl : task.attachmentUrl}
                                                target="_blank" rel="noreferrer"
                                                className="inline-flex items-center gap-1.5 text-xs font-bold text-ink underline mt-2">
                                                <Paperclip size={13} />
                                                {task.attachmentName || t('tasks.attachment')}
                                            </a>
                                        )}
                                        {task.links?.map((link, index) => (
                                            <a
                                                key={`${link.url}-${index}`}
                                                href={link.url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="ms-3 inline-flex items-center gap-1.5 text-xs font-bold text-ink underline mt-2"
                                            >
                                                <FileText size={13} />
                                                {pick(link, 'label') || link.url}
                                            </a>
                                        ))}
                                    </div>
                                    <div className="flex items-center gap-2 text-xs font-bold">
                                        {task.dueDate && (
                                            <span className={`flex items-center gap-1 px-2.5 py-1 rounded-lg ${overdue ? 'bg-danger-soft text-danger' : 'bg-ink/[0.05] text-ink-muted'}`}>
                                                <Clock size={12} /> {t('tasks.due_on')} {new Date(task.dueDate).toLocaleDateString()}
                                            </span>
                                        )}
                                        <span className="bg-surface text-ink px-2.5 py-1 rounded-lg">
                                            {t('tasks.max_score_label')} {task.maxScore}
                                        </span>
                                    </div>
                                </div>

                                {graded ? (
                                    <div className="mt-4 space-y-3">
                                        <div className="flex items-center gap-2 text-sm font-bold text-success dark:text-success bg-success-soft border border-line rounded-xl p-3">
                                            <CheckCircle size={16} />
                                            {t('tasks.current_grade')}: {mySubmission?.score} / {task.maxScore}
                                        </div>
                                        {mySubmission?.notes && (
                                            <p className="text-sm text-ink-muted bg-ink/[0.03] border border-brand-mist rounded-xl p-3 whitespace-pre-wrap">
                                                {mySubmission.notes}
                                            </p>
                                        )}
                                        {submittedFileUrl && (
                                            <a href={submittedFileUrl} target="_blank" rel="noreferrer"
                                                className="inline-flex items-center gap-2 text-sm font-bold text-ink">
                                                <FileText size={15} />
                                                {mySubmission?.attachmentName || t('tasks.attachment')}
                                                {mySubmission?.attachmentSize ? ` (${formatFileSize(mySubmission.attachmentSize)})` : ''}
                                            </a>
                                        )}
                                    </div>
                                ) : mySubmission ? (
                                    <div className="mt-4 space-y-3">
                                        <div className="text-sm text-ink-muted bg-ink/[0.03] border border-brand-mist rounded-xl p-3">
                                            {t('tasks.submitted_at')} {new Date(mySubmission.submittedAt).toLocaleString()}
                                        </div>
                                        {submittedFileUrl && (
                                            <a href={submittedFileUrl} target="_blank" rel="noreferrer"
                                                className="inline-flex items-center gap-2 text-sm font-bold text-ink">
                                                <FileText size={15} />
                                                {mySubmission.attachmentName || t('tasks.attachment')}
                                                {mySubmission.attachmentSize ? ` (${formatFileSize(mySubmission.attachmentSize)})` : ''}
                                            </a>
                                        )}
                                        <p className="text-xs text-ink-subtle">{t('tasks.resubmit_hint')}</p>
                                    </div>
                                ) : null}

                                <div className="mt-4">
                                    <textarea
                                        value={drafts[task.id] || ''}
                                        onChange={e => setDrafts(prev => ({ ...prev, [task.id]: e.target.value }))}
                                        rows={2}
                                        placeholder={t('tasks.answer_hint')}
                                        className="w-full bg-surface-raised border border-brand-mist rounded-xl px-4 py-3 font-medium text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold/40 resize-y"
                                    />
                                    <div className="mt-2 flex flex-wrap items-center gap-3">
                                        <input
                                            ref={el => { inputs.current[task.id] = el; }}
                                            type="file"
                                            className="hidden"
                                            onChange={e => handleFile(task.id, e.target.files?.[0])}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => inputs.current[task.id]?.click()}
                                            disabled={uploadingId === task.id}
                                            className="inline-flex items-center gap-2 text-sm font-bold text-ink border border-brand-mist rounded-xl px-4 py-2.5 hover:bg-ink/[0.04] disabled:opacity-50 transition"
                                        >
                                            {uploadingId === task.id ? <Loader size={14} className="animate-spin" /> : <Paperclip size={14} />}
                                            {t('tasks.attach_file')}
                                        </button>
                                        {chosen && (
                                            <span className="inline-flex items-center gap-2 text-xs font-bold text-ink-muted bg-ink/[0.04] rounded-lg px-3 py-2">
                                                <FileText size={14} /> {chosen.name}
                                                {chosen.size ? ` (${formatFileSize(chosen.size)})` : ''}
                                                <button type="button" onClick={() => setFiles(prev => ({ ...prev, [task.id]: null }))}
                                                    className="text-ink-subtle hover:text-red-600" aria-label={t('common.remove')}>
                                                    <Trash2 size={13} />
                                                </button>
                                            </span>
                                        )}
                                        <button
                                            onClick={() => handleSubmit(task.id)}
                                            disabled={submittingId === task.id || uploadingId === task.id || (!(drafts[task.id] || '').trim() && !chosen)}
                                            className="inline-flex items-center gap-2 bg-surface hover:bg-brand-charcoal text-ink disabled:opacity-40 px-5 py-2.5 rounded-xl font-bold text-sm transition"
                                        >
                                            {submittingId === task.id ? <Loader size={14} className="animate-spin" /> : <Send size={14} />}
                                            {mySubmission ? t('tasks.update_submission') : t('common.submit')}
                                        </button>
                                    </div>
                                    <p className="mt-2 text-[11px] text-ink-subtle">{t('tasks.any_file_hint')}</p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
