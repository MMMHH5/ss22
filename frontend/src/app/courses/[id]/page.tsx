import type { Metadata } from 'next';
import CourseDetails, { type Course } from './CourseDetails.client';
import { API_BASE_URL, SITE_URL } from '@/lib/deployment-urls';

export const dynamic = 'force-dynamic';

type Props = {
    params: Promise<{ id: string }>;
};

async function getCourse(id: string): Promise<Course | null> {
    try {
        const res = await fetch(`${API_BASE_URL}/courses/${encodeURIComponent(id)}`, { cache: 'no-store' });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { id } = await params;
    const course = await getCourse(id);
    if (!course) {
        return { title: 'Course Not Found' };
    }
    return {
        title: course.titleEn || course.titleAr,
        description: course.excerptEn || course.excerptAr || course.descriptionEn || course.descriptionAr || undefined,
        alternates: { canonical: `/courses/${course.id}` },
        openGraph: course.coverImageUrl
            ? { images: [{ url: `${API_BASE_URL}${course.coverImageUrl}` }] }
            : undefined,
    };
}

export default async function CoursePage({ params }: Props) {
    const { id } = await params;
    const course = await getCourse(id);

    const jsonLd = course
        ? {
              '@context': 'https://schema.org',
              '@graph': [
                  {
                      '@type': 'Course',
                      name: course.titleEn || course.titleAr,
                      description: course.excerptEn || course.excerptAr || course.descriptionEn || course.descriptionAr || undefined,
                      inLanguage: course.language || 'ar',
                      datePublished: course.createdAt || undefined,
                      provider: { '@type': 'Organization', name: 'Laxalab', url: SITE_URL },
                      ...(course.coverImageUrl
                          ? { image: `${API_BASE_URL}${course.coverImageUrl}` }
                          : {}),
                      ...(course.openings?.length
                          ? {
                                hasCourseInstance: course.openings
                                    .filter((o) => o.status === 'OPEN' || o.status === 'ANNOUNCEMENT')
                                    .map((o) => ({
                                        '@type': 'CourseInstance',
                                        courseMode: 'Online',
                                        ...(o.startDate ? { startDate: o.startDate } : {}),
                                        ...(o.endDate ? { endDate: o.endDate } : {}),
                                        offers: { '@type': 'Offer', category: o.status === 'OPEN' ? 'Paid' : 'Presale' },
                                    })),
                            }
                          : {}),
                  },
                  {
                      '@type': 'BreadcrumbList',
                      itemListElement: [
                          { '@type': 'ListItem', position: 1, name: 'Laxalab', item: `${SITE_URL}/` },
                          { '@type': 'ListItem', position: 2, name: 'Courses', item: `${SITE_URL}/courses` },
                          { '@type': 'ListItem', position: 3, name: course.titleEn || course.titleAr },
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
            <CourseDetails initialCourse={course} />
        </>
    );
}