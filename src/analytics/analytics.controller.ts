import { Controller, Get, Post, Patch, Param, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { Role } from '@prisma/client';

const STAFF = [Role.ADMIN, Role.COURSE_MANAGER, Role.INSTRUCTOR];

@ApiTags('Analytics (إحصائيات التعلم)')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('analytics')
export class AnalyticsController {
    constructor(private readonly svc: AnalyticsService) {}

    @ApiOperation({ summary: 'Start a learning session' })
    @Roles(Role.STUDENT)
    @Post('session/start')
    startSession(@Body('courseId') courseId: string, @Body('moduleId') moduleId: string | undefined, @Request() req: any) {
        return this.svc.startSession(req.user.userId, courseId, moduleId);
    }

    @ApiOperation({ summary: 'Heartbeat for session' })
    @Roles(Role.STUDENT)
    @Patch('session/:id/heartbeat')
    heartbeat(@Param('id') id: string, @Request() req: any) {
        return this.svc.heartbeat(id, req.user.userId);
    }

    @ApiOperation({ summary: 'Get own learning analytics' })
    @Roles(Role.STUDENT)
    @Get('me')
    getMe(@Request() req: any) {
        return this.svc.getStudentAnalytics(req.user.userId);
    }

    @ApiOperation({ summary: 'Get own analytics for a course' })
    @Roles(Role.STUDENT)
    @Get('me/course/:courseId')
    getMyCourse(@Param('courseId') courseId: string, @Request() req: any) {
        return this.svc.getStudentCourseAnalytics(req.user.userId, courseId);
    }

    @ApiOperation({ summary: 'Get course analytics (instructor / staff)' })
    @Roles(...STAFF)
    @RequirePermissions(PERMISSIONS.ANALYTICS_READ)
    @Get('course/:courseId')
    getCourse(@Param('courseId') courseId: string, @Request() req: any) {
        return this.svc.getCourseAnalytics(courseId, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: "Instructor's teaching dashboard summary" })
    @Roles(Role.INSTRUCTOR)
    @RequirePermissions(PERMISSIONS.ANALYTICS_READ)
    @Get('instructor-dashboard')
    getInstructorDashboard(@Request() req: any) {
        return this.svc.getInstructorDashboard(req.user.userId);
    }
}
