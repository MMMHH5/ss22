import axios from 'axios';
import { requestStepUpCode } from './stepup-bridge';
import { API_BASE_URL } from './deployment-urls';
export { API_BASE_URL };

// Extract a human-readable message from any thrown error (axios, Error, unknown)
//
// Auth and server failures are deliberately reported as an EMPTY string: the
// backend phrases them in English boilerplate ("Unauthorized", "Internal
// server error"), which is meaningless in an Arabic UI. Returning '' is what
// makes the `getErrorMessage(e) || t('...')` fallback used across the app
// actually fire — the function used to return a non-empty English string
// there, so every localized fallback was dead code.
//
// Domain errors (409 "Already enrolled in this course", 400 "Opening not
// found", …) still surface their server text, because it is specific and
// more useful than a generic string.
export function getErrorMessage(err: unknown): string {
    if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        if (status === 401 || status === 403 || (status !== undefined && status >= 500)) {
            return '';
        }
        const data = err.response?.data as { message?: string | string[] } | undefined;
        // NestJS validation pipes answer with `message` as an array.
        const serverMessage = Array.isArray(data?.message) ? data?.message[0] : data?.message;
        return serverMessage || err.message || '';
    }
    if (err instanceof Error) {
        return err.message || '';
    }
    return '';
}

// True when the request was rejected because the caller is not authenticated.
// The backend answers 401 "Unauthorized", which is useless to show a visitor, so
// guarded actions use this to open a login prompt instead of a raw error toast.
export function isUnauthorized(err: unknown): boolean {
    return axios.isAxiosError(err) && err.response?.status === 401;
}

// Create a centralized Axios instance
export const api = axios.create({
    baseURL: API_BASE_URL, // Our NestJS Backend
    headers: {
        'Content-Type': 'application/json',
    },
});

const TOKEN_KEY = 'laxalab_token';
const REFRESH_KEY = 'laxalab_refresh';
const USER_KEY = 'laxalab_user';

// Interceptor to inject the JWT token automatically
api.interceptors.request.use(
    (config) => {
        // We fetch the token from localStorage
        const token = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;

        if (token && config.headers) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

let isRefreshing = false;
let pendingQueue: Array<(token: string | null) => void> = [];

function storeTokens(access: string, refresh?: string) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(TOKEN_KEY, access);
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
}

function clearAuth() {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
}

async function tryRefresh(): Promise<string | null> {
    if (typeof window === 'undefined') return null;
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    if (!refreshToken) return null;
    try {
        const res = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken }, { headers: { 'Content-Type': 'application/json' } });
        const access = res.data?.access_token;
        if (access) {
            storeTokens(access, res.data?.refresh_token);
            return access;
        }
    } catch {
        // fall through
    }
    clearAuth();
    if (typeof window !== 'undefined') {
        window.location.replace('/login');
    }
    return null;
}

// Interceptor to catch 401 Unauthorized and attempt a token refresh
api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const original = error?.config;
        if (error?.response?.status !== 401 || !original || original._retried) {
            return Promise.reject(error);
        }
        if (original.url?.includes('/auth/login') || original.url?.includes('/auth/refresh') || original.url?.includes('/auth/2fa/verify-login') || original.url?.includes('/auth/change-password')) {
            return Promise.reject(error);
        }
        // A 401 on a request that never carried a token is not a stale session.
        // The viewer is a guest and the endpoint is simply protected: a refresh
        // cannot conjure a session that was never there, and bouncing a guest to
        // /login would be wrong. Let the caller handle its own empty state.
        if (!original.headers?.Authorization) {
            return Promise.reject(error);
        }

        original._retried = true;
        if (isRefreshing) {
            // Queue the request until the in-flight refresh completes
            return new Promise((resolve, reject) => {
                pendingQueue.push((token) => {
                    if (token) {
                        original.headers = { ...(original.headers || {}), Authorization: `Bearer ${token}` };
                        resolve(api(original));
                    } else {
                        reject(error);
                    }
                });
            });
        }

        isRefreshing = true;
        const fresh = await tryRefresh();
        isRefreshing = false;
        pendingQueue.forEach((cb) => cb(fresh));
        pendingQueue = [];

        if (fresh) {
            original.headers = { ...(original.headers || {}), Authorization: `Bearer ${fresh}` };
            return api(original);
        }
        return Promise.reject(error);
    }
);

// --- Step-up authentication (sensitive admin/finance actions) ---------------
// Privileged APIs (refund review, certificate revoke/reissue, payment-gateway
// mutations) answer 403 with { stepUpRequired: true }. The user must supply a
// fresh authenticator code; we ask through StepUpProvider, then retry the exact
// request carrying X-Step-Up-Code. Any other 403 keeps flowing to the caller.
api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const original = error?.config;
        const body = error?.response?.data as { stepUpRequired?: boolean } | undefined;
        if (error?.response?.status !== 403 || !body?.stepUpRequired || !original || original._stepUpRetried) {
            return Promise.reject(error);
        }
        const code = await requestStepUpCode();
        if (!code) return Promise.reject(error);
        original._stepUpRetried = true;
        original.headers = { ...(original.headers || {}), 'X-Step-Up-Code': code };
        return api(original);
    }
);

// --- Authenticated downloads / previews ------------------------------------
// The backend serves receipts/CVs through role-gated endpoints (e.g.
// GET /enrollments/:id/receipt, GET /instructor-applications/:id/cv) that
// require a JWT and set Content-Disposition. These helpers fetch the file AS A
// BLOB (so the Authorization header follows the request) instead of pointing a
// plain <a href> at the previously public /uploads/... path.

function blobFilename(res: { headers: Record<string, unknown> }, fallback: string): string {
    const cd = res.headers?.['content-disposition'];
    if (typeof cd === 'string') {
        const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
        if (m && m[1]) return m[1];
    }
    return fallback || 'file';
}

// Fetch a protected file as a blob and return a temporary object URL + name.
// Caller is responsible for revoking the URL with URL.revokeObjectURL(url).
export async function fetchProtectedFile(path: string): Promise<{ url: string; name: string }> {
    const res = await api.get(path, { responseType: 'blob' });
    const name = blobFilename(res, (path.split('/').pop() || 'file'));
    return { url: URL.createObjectURL(res.data as Blob), name };
}

// Download a protected file to disk (triggers the browser save dialog).
export async function downloadProtectedFile(path: string) {
    const { url, name } = await fetchProtectedFile(path);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
