import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { CoursesModule } from '../courses/courses.module';

@Module({
    imports: [NotificationsModule, CoursesModule],
    controllers: [TasksController],
    providers: [TasksService],
})
export class TasksModule { }