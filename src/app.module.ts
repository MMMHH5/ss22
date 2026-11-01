import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard, ThrottlerStorage } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';

import { RedisThrottlerStorage } from './common/redis-throttler.storage';
import { UserCacheModule } from './common/user-cache.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AdminBoundaryGuard } from './auth/guards/admin-boundary.guard';
import { UsersModule } from './users/users.module';
import { CoursesModule } from './courses/courses.module';
import { EnrollmentsModule } from './enrollments/enrollments.module';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';
import { PaymentGatewaysModule } from './payment-gateways/payment-gateways.module';
import { InstructorApplicationsModule } from './instructor-applications/instructor-applications.module';
import { GradesModule } from './grades/grades.module';
import { MessagesModule } from './messages/messages.module';
import { SupportTicketsModule } from './support-tickets/support-tickets.module';
import { InstructorRequestsModule } from './instructor-requests/instructor-requests.module';
import { TasksModule } from './tasks/tasks.module';
import { EncryptionModule } from './encryption/encryption.module';
import { CertificatesModule } from './certificates/certificates.module';
import { EmailModule } from './email/email.module';
import { NotificationsModule } from './notifications/notifications.module';
import { CommerceModule } from './commerce/commerce.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { LmsModule } from './lms/lms.module';
import { BlogModule } from './blog/blog.module';
import { ConsentModule } from './consent/consent.module';
import { PublicModule } from './public/public.module';
import { ChatModule } from './chat/chat.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { DiscussionsModule } from './discussions/discussions.module';
import { RatingsModule } from './ratings/ratings.module';
import { GamificationModule } from './gamification/gamification.module';
import { LearningPathsModule } from './learning-paths/learning-paths.module';
import { CalendarModule } from './calendar/calendar.module';
import { RubricsModule } from './rubrics/rubrics.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { FinanceModule } from './finance/finance.module';
import { AnnouncementBoardModule } from './announcement-board/announcement-board.module';
import { RefundsModule } from './refunds/refunds.module';
import { LiveSessionsModule } from './live-sessions/live-sessions.module';
import { OperationsModule } from './operations/operations.module';

@Module({
    imports: [
        ScheduleModule.forRoot(),
        ThrottlerModule.forRoot([{
            ttl: 60000,
            limit: 300, // Increased to 300 requests per minute to support SPA navigation
            blockDuration: 60000,
        }]),
        PrismaModule,
        UserCacheModule,
        AuthModule,
        UsersModule,
        CoursesModule,
        EnrollmentsModule,
        AuditModule,
        HealthModule,
        PaymentGatewaysModule,
        InstructorApplicationsModule,
        GradesModule,
        MessagesModule,
        SupportTicketsModule,
        InstructorRequestsModule,
        TasksModule,
        EncryptionModule,
        CertificatesModule,
        EmailModule,
        NotificationsModule,
        CommerceModule,
        WebhooksModule,
        LmsModule,
        BlogModule,
        ConsentModule,
        PublicModule,
        ChatModule,
        AnnouncementsModule,
        DiscussionsModule,
        RatingsModule,
        GamificationModule,
        LearningPathsModule,
        CalendarModule,
        RubricsModule,
        AnalyticsModule,
        FinanceModule,
        AnnouncementBoardModule,
        RefundsModule,
        LiveSessionsModule,
        OperationsModule,
    ],
    providers: [
        // Replaces the default in-process counter store. Without this the limit
        // configured above is enforced separately by each replica, so the
        // effective ceiling is 300 x replicaCount rather than 300.
        { provide: ThrottlerStorage, useClass: RedisThrottlerStorage },
        {
            provide: APP_GUARD,
            useClass: ThrottlerGuard,
        },
        // Boundary enforcement: /admin-prefixed paths require an admin-audience
        // token. Global by design (the boundary must not depend on a controller
        // remembering to mount a guard) and additive today -- no /admin path
        // exists yet, so it changes no current route. Registered after the
        // throttler so rate limiting stays the first thing an attacker meets.
        {
            provide: APP_GUARD,
            useClass: AdminBoundaryGuard,
        },
    ],
})
export class AppModule { }
