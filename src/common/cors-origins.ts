import { getFrontendUrl } from './frontend-url';

/**
 * CORS allow-list used by app.enableCors. Phase 7: even though the current
 * deployment serves a single frontend origin, the boundary decision requires
 * the learner and admin surfaces to eventually live on separate origins, and
 * an admin route must never answer a browser that is not on the list.
 * `CORS_ORIGINS` lets an operator add origins (comma-separated) without a
 * code change; `FRONTEND_URL` stays an implicit member so existing set-ups do
 * not silently stop working.
 */
export function corsOrigins(): string[] {
    const base = getFrontendUrl();
    const learnerDomains = process.env.ADMIN_SURFACE === '1'
        ? []
        : ['https://laxalab.com', 'https://www.laxalab.com'];
    const explicit = (process.env.CORS_ORIGINS || '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    return [...new Set([base, ...learnerDomains, ...explicit])];
}