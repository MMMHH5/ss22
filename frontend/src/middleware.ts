import { NextRequest, NextResponse } from 'next/server';

type Locale = 'ar' | 'en';

// Versioned on purpose. The previous name (`laxalab_locale`) is still sitting
// in every returning visitor's browser, written by the old Accept-Language
// sniffing, and it carries a `max-age` of a year. Honouring it would keep
// sending the entire existing audience to /en even though Arabic is now the
// primary language, so the old key is deliberately ignored and the new default
// applies once. From here on an explicit choice is what selects the language.
const LOCALE_COOKIE = 'laxalab_locale_v2';
const DEFAULT_LOCALE: Locale = 'ar';
const SKIP_PATHS = ['/sitemap.xml', '/robots.txt', '/manifest.webmanifest', '/favicon.ico'];
const EXT_RE = /\.(png|jpe?g|svg|gif|webp|ico|avif|woff2?|ttf|eot|otf|pdf|mp4|webm)$/i;

function getPreferredLocale(req: NextRequest): Locale {
    // Arabic is the primary language, so the only thing that may select
    // English is the visitor having explicitly chosen it. This used to fall
    // back to the browser's Accept-Language header, which sent every visitor
    // whose OS or Chrome UI is English to /en and made the platform read as
    // English-first despite `x-default`, the sitemap and the metadata all
    // pointing at Arabic.
    const cookie = req.cookies.get(LOCALE_COOKIE)?.value;
    if (cookie === 'ar' || cookie === 'en') return cookie;
    return DEFAULT_LOCALE;
}

function setLocaleCookie(res: NextResponse, locale: Locale) {
    res.cookies.set(LOCALE_COOKIE, locale, {
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
        sameSite: 'lax',
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
    });
}

// --- Phase 8: origin split (admin console vs learner/instructor app) --------
// Two deployments of this same app, told apart by env at build time:
//
//   APP_MODE = 'learner' (default): serves the platform, refuses the admin
//     console and the operations center — those pages do not exist on this
//     origin at all, so an XSS here cannot even load the admin UI's HTML.
//   APP_MODE = 'admin': serves only the admin console, shared auth pages and
//     the course-management screens admins genuinely use. Learner-only
//     sections answer 404 rather than being shared across origins.
//
// The API side of the same wall is `src/common/surface-gate.ts` on the
// backend: admin tokens are only useful against the admin API host.
const APP_MODE = (process.env.NEXT_PUBLIC_APP_MODE || process.env.APP_MODE || 'learner') === 'admin' ? 'admin' : 'learner';

const ADMIN_ONLY = ['/dashboard/admin', '/operations'];

// Course management is shared work (admins edit courses), so it stays open on
// both origins. Everything below is learner/instructor work that no admin
// console flow links into.
const LEARNER_ONLY_ON_ADMIN = [
    '/dashboard/my-grades',
    '/dashboard/explore',
    '/dashboard/submissions',
    '/dashboard/tasks',
    '/dashboard/payments',
    '/dashboard/refunds',
    '/dashboard/my-courses',
    '/dashboard/teaching',
    '/dashboard/instructor-profile',
];

function under(base: string, prefix: string): boolean {
    return base === prefix || base.startsWith(prefix + '/');
}

function notFound(): NextResponse {
    return new NextResponse(
        '<!doctype html><html lang="en"><meta charset="utf-8"><title>404</title><h1>404 — Not Found</h1></html>',
        { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
}

function allowedOnThisOrigin(base: string): boolean {
    if (APP_MODE === 'admin') {
        if (base === '/register') return false;
        return !LEARNER_ONLY_ON_ADMIN.some((p) => under(base, p));
    }
    return !ADMIN_ONLY.some((p) => under(base, p));
}

export function middleware(req: NextRequest) {
    const { pathname } = req.nextUrl;

    // Never touch API routes, Next internals or static files.
    if (pathname.startsWith('/api') || pathname.startsWith('/_next') || SKIP_PATHS.includes(pathname) || EXT_RE.test(pathname)) {
        return NextResponse.next();
    }

    const first = pathname.split('/')[1];
    const hasPrefix = first === 'ar' || first === 'en';
    const base = hasPrefix ? pathname.slice(first.length + 1) || '/' : pathname;

    // The origin split runs on the locale-stripped path so `/ar/...` and
    // `/en/...` are judged identically, and before the locale redirect so a
    // refused path never leaks through an extra hop.
    if (!allowedOnThisOrigin(base)) {
        return notFound();
    }

    if (hasPrefix) {
        const locale = first as Locale;
        const url = req.nextUrl.clone();
        // The admin origin's home IS the admin console: the marketing landing
        // page and the shared dashboard home have no meaning there.
        url.pathname = APP_MODE === 'admin' && (base === '/' || base === '/dashboard')
            ? '/dashboard/admin'
            : base;
        const res = NextResponse.rewrite(url);
        setLocaleCookie(res, locale);
        return res;
    }

    // No locale prefix: redirect to the locale-prefixed canonical URL.
    //
    // 307 (temporary), not 308 (permanent). The destination is a function of
    // this request — the cookie, i.e. what the visitor chose — so "permanent"
    // was never the right status. Worse, browsers cache a 308 indefinitely and
    // never re-ask: one visit while the old Accept-Language sniffing was active
    // left `https://site/` -> `https://site/en` sitting in the visitor's disk
    // cache, so the site kept serving English even after the server was fixed
    // and started answering /ar. A 307 plus no-store means the redirect is
    // re-evaluated on every visit, which is what a preference-dependent
    // redirect has to do.
    const locale = getPreferredLocale(req);
    const url = req.nextUrl.clone();
    url.pathname = `/${locale}${pathname}`;
    const res = NextResponse.redirect(url, 307);
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    setLocaleCookie(res, locale);
    return res;
}

export const config = {
    matcher: ['/((?!_next/static|_next/image).*)'],
};