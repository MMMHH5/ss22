import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/deployment-urls';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api',
        '/auth',
        '/*/auth',
        '/dashboard',
        '/*/dashboard',
        '/login',
        '/*/login',
        '/register',
        '/*/register',
        '/forgot-password',
        '/*/forgot-password',
        '/reset-password',
        '/*/reset-password',
        '/verify-email',
        '/*/verify-email',
        '/unauthorized',
        '/*/unauthorized',
        // The operations center is reachable only by typing its path and is
        // meant to stay that way. Listing it here is a signal to crawlers and a
        // guard against someone adding it to the sitemap later.
        '/operations',
        '/*/operations',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}