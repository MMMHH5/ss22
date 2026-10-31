function normalizeServiceUrl(value: string | undefined, fallback: string): string {
    const url = value?.trim() || fallback;
    return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export const API_BASE_URL = normalizeServiceUrl(
    process.env.NEXT_PUBLIC_API_URL,
    'http://localhost:3001',
).replace(/\/api\/?$/, '');

export const SITE_URL = normalizeServiceUrl(
    process.env.NEXT_PUBLIC_SITE_URL,
    'http://localhost:3000',
);
