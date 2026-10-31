import type { Metadata } from 'next';
import BlogPost from './BlogPost.client';
import { API_BASE_URL, SITE_URL } from '@/lib/deployment-urls';

export const dynamic = 'force-dynamic';

type Props = {
    params: Promise<{ slug: string }>;
};

interface BlogPostJson {
    slug: string;
    titleAr: string;
    titleEn: string;
    excerptAr?: string | null;
    excerptEn?: string | null;
    coverImageUrl?: string | null;
    isPublished: boolean;
    publishedAt?: string | null;
    createdAt: string;
    author?: { id: string; email: string } | null;
}

async function getPost(slug: string): Promise<BlogPostJson | null> {
    try {
        const res = await fetch(`${API_BASE_URL}/blog/${encodeURIComponent(slug)}`, { cache: 'no-store' });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { slug } = await params;
    const post = await getPost(slug);
    if (!post || post.isPublished === false) {
        return { title: 'Post Not Found' };
    }
    return {
        title: post.titleEn || post.titleAr,
        description: post.excerptEn || post.excerptAr || undefined,
        alternates: { canonical: `/blog/${post.slug}` },
        openGraph: post.coverImageUrl
            ? { images: [{ url: `${API_BASE_URL}${post.coverImageUrl}` }] }
            : undefined,
    };
}

export default async function BlogPostPage({ params }: Props) {
    const { slug } = await params;
    const post = await getPost(slug);

    const jsonLd =
        post && post.isPublished === false
            ? null
            : post
              ? {
                    '@context': 'https://schema.org',
                    '@graph': [
                        {
                            '@type': 'BlogPosting',
                            headline: post.titleEn,
                            name: post.titleEn,
                            description: post.excerptEn || post.excerptAr || undefined,
                            datePublished: post.publishedAt || post.createdAt,
                            dateModified: post.createdAt,
                            inLanguage: 'en',
                            mainEntityOfPage: `${SITE_URL}/blog/${post.slug}`,
                            ...(post.author
                                ? { author: { '@type': 'Person', name: post.author.email } }
                                : {}),
                            ...(post.coverImageUrl
                                ? { image: `${API_BASE_URL}${post.coverImageUrl}` }
                                : {}),
                            publisher: { '@type': 'Organization', name: 'Laxalab', url: SITE_URL },
                        },
                        {
                            '@type': 'BreadcrumbList',
                            itemListElement: [
                                { '@type': 'ListItem', position: 1, name: 'Laxalab', item: `${SITE_URL}/` },
                                { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE_URL}/blog` },
                                { '@type': 'ListItem', position: 3, name: post.titleEn },
                            ],
                        },
                    ],
                }
              : null;

    return (
        <>
            {jsonLd && (
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
                />
            )}
            <BlogPost slug={slug} />
        </>
    );
}