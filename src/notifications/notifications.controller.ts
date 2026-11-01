import { Body, Controller, Get, Patch, Param, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';

@ApiTags('Notifications (الإشعارات)')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('notifications')
export class NotificationsController {
    constructor(private readonly notificationsService: NotificationsService) {}

    @Roles('STUDENT', 'INSTRUCTOR', 'COURSE_MANAGER', 'FINANCE', 'ADMIN')
    @Get()
    list(@Request() req: any) {
        return this.notificationsService.list(req.user.userId);
    }

    @Roles('STUDENT', 'INSTRUCTOR', 'COURSE_MANAGER', 'FINANCE', 'ADMIN')
    @Get('unread-count')
    unreadCount(@Request() req: any) {
        return this.notificationsService.unreadCount(req.user.userId);
    }

    @Roles('STUDENT', 'INSTRUCTOR', 'COURSE_MANAGER', 'FINANCE', 'ADMIN')
    @Get('preferences')
    getPreferences(@Request() req: any) {
        return this.notificationsService.getPreferences(req.user.userId);
    }

    @Roles('STUDENT', 'INSTRUCTOR', 'COURSE_MANAGER', 'FINANCE', 'ADMIN')
    @Patch('preferences')
    updatePreferences(@Request() req: any, @Body() preferences: UpdateNotificationPreferencesDto) {
        return this.notificationsService.updatePreferences(req.user.userId, preferences);
    }

    @Roles('STUDENT', 'INSTRUCTOR', 'COURSE_MANAGER', 'FINANCE', 'ADMIN')
    @Patch('read-all')
    markAllRead(@Request() req: any) {
        return this.notificationsService.markAllRead(req.user.userId);
    }

    @Roles('STUDENT', 'INSTRUCTOR', 'COURSE_MANAGER', 'FINANCE', 'ADMIN')
    @Patch(':id/read')
    markRead(@Param('id') id: string, @Request() req: any) {
        return this.notificationsService.markRead(req.user.userId, id);
    }
}