"use client";

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { API_BASE_URL } from '@/lib/deployment-urls';

/**
 * Reports page views and named UI actions to the operations center.
 *
 * WHY THIS EXISTS ALONGSIDE THE SERVER TRACKER
 * The server already records every API call, but an SPA navigation performs no
 * request at all -- opening the course catalog, reading a lesson page or
 * finishing the checkout all leave a gap. This closes it.
 *
 * WHY IT REPORTS THE FINGERPRINT ON THE FIRST EVENT
 * Screen size and timezone are client-only facts the HTTP request cannot carry.
 * They ride along with the first page view of a visit so the session is
 * enriched without inventing an extra event -- a separate "fingerprint" event
 * would be counted as a page view and inflate the numbers.
 *
 * DELIVERY
 * `sendBeacon` when available, because a page can be unloading and a normal
 * fetch would be cancelled exactly when the event matters most (navigating
 * away). It falls back to a keepalive fetch and finally to a plain call, so an
 * event is never silently dropped for lack of a transport.
 */
export default function OperationsTracker() {
    const pathname = usePathname();
    const lastPath = useRef<string | null>(null);
    const fingerprinted = useRef(false);

    const post = (payload: Record<string, unknown>) => {
        const body = JSON.stringify(payload);
        try {
            if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
                // sendBeacon posts text/plain, which the backend's json parser
                // still accepts because it parses by content regardless of the
                // declared type; the beacon path is the unload-safe one.
                const ok = navigator.sendBeacon(`${API_BASE_URL}/operations/track`, new Blob([body], { type: 'application/json' }));
                if (ok) return;
            }
        } catch {
            // fall through to fetch
        }
        void api.post('/operations/track', payload).catch(() => {
            // Tracking must never surface an error to a visitor.
        });
    };

    const fingerprint = (): { screen?: string; timezone?: string } => {
        if (typeof window === 'undefined') return {};
        const screen = window.screen ? `${window.screen.width}x${window.screen.height}` : undefined;
        let timezone: string | undefined;
        try {
            timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        } catch {
            timezone = undefined;
        }
        return { screen, timezone };
    };

    useEffect(() => {
        if (!pathname) return;
        // Skip the duplicate that fires when the tracker itself mounts mid-route.
        if (lastPath.current === pathname) return;
        lastPath.current = pathname;
        // Only the first view of a visit carries the fingerprint; after that the
        // session already has it and re-sending would be a wasted write.
        const extra = fingerprinted.current ? {} : fingerprint();
        if (extra.screen || extra.timezone) fingerprinted.current = true;
        post({ type: 'page_view', path: pathname, label: document.title, ...extra });
    }, [pathname]);

    useEffect(() => {
        if (typeof document === 'undefined') return;

        /**
         * Actions are declared in markup rather than wired per component:
         * any element carrying `data-ops-action="name"` reports when clicked.
         * That keeps the instrumentation one attribute instead of an edit to
         * every page, and a forgotten button degrades to "not tracked" instead of
         * silently reporting something wrong.
         */
        const onClick = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null;
            const el = target?.closest?.('[data-ops-action]') as HTMLElement | null;
            if (!el) return;
            const name = el.getAttribute('data-ops-action');
            if (!name) return;
            post({
                type: 'action',
                label: name,
                path: window.location.pathname,
                meta: { resourceId: el.getAttribute('data-ops-id') || undefined, resourceType: el.getAttribute('data-ops-type') || undefined },
            });
        };

        document.addEventListener('click', onClick, true);
        return () => document.removeEventListener('click', onClick, true);
    }, []);

    return null;
}

/**
 * Fire an action from code rather than markup -- for outcomes that have no
 * button, such as a payment finishing on a redirect.
 */
export function trackOpsAction(label: string, meta?: Record<string, string | number>) {
    if (typeof window === 'undefined') return;
    try {
        void api.post('/operations/track', {
            type: 'action',
            label,
            path: window.location.pathname,
            meta,
        }).catch(() => {
            // Never surface a tracking failure to the user.
        });
    } catch {
        // ignore
    }
}
