import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationAutomationService } from './notification-automation.service';

@Module({
    controllers: [NotificationsController],
    providers: [NotificationsService, NotificationAutomationService],
    exports: [NotificationsService],
})
export class NotificationsModule { }