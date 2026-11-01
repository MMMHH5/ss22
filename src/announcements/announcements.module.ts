import { Module } from '@nestjs/common';
import { AnnouncementsService } from './announcements.service';
import { AnnouncementsController } from './announcements.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { CoursesModule } from '../courses/courses.module';

@Module({
    imports: [NotificationsModule, CoursesModule],
    controllers: [AnnouncementsController],
    providers: [AnnouncementsService],
    exports: [AnnouncementsService],
})
export class AnnouncementsModule {}
