import {
    Controller, Get, Post, Put, Patch, Delete, Param, Body, UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { LiveSessionsService } from './live-sessions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { CreateLiveSessionDto } from './dto/live-session.dto';
import { UpdateLiveSessionDto } from './dto/update-live-session.dto';
import { SaveSessionAttendanceDto } from './dto/session-attendance.dto';

const STAFF_ROLES = [Role.ADMIN, Role.COURSE_MANAGER, Role.INSTRUCTOR];

/**
 * A batch's meeting schedule.
 *
 * Nested under the opening because a session belongs to a batch, and because
 * the batch is what carries the management rule: the service asks
 * `CoursesService.assertCanManageOpening`, so an instructor can only touch the
 * sessions of the batch they teach.
 */
@ApiTags('Live sessions (weekly meeting schedule)')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('openings/:openingId/sessions')
export class LiveSessionsController {
    constructor(private readonly sessions: LiveSessionsService) { }

    @ApiOperation({ summary: "A batch's sessions, soonest first" })
    @Roles(...STAFF_ROLES)
    @RequirePermissions(PERMISSIONS.CONTENT_READ)
    @Get()
    list(@Param('openingId') openingId: string, @Request() req: any) {
        return this.sessions.listForStaff(openingId, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'Schedule a session (meetLink falls back to the batch link)' })
    @Roles(...STAFF_ROLES)
    @RequirePermissions(PERMISSIONS.OPENINGS_WRITE)
    @Post()
    create(@Param('openingId') openingId: string, @Body() dto: CreateLiveSessionDto, @Request() req: any) {
        return this.sessions.create(openingId, dto, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'Reschedule or edit a session' })
    @Roles(...STAFF_ROLES)
    @RequirePermissions(PERMISSIONS.OPENINGS_WRITE)
    @Patch(':id')
    update(
        @Param('openingId') openingId: string,
        @Param('id') id: string,
        @Body() dto: UpdateLiveSessionDto,
        @Request() req: any,
    ) {
        return this.sessions.update(openingId, id, dto, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'Remove a session' })
    @Roles(...STAFF_ROLES)
    @RequirePermissions(PERMISSIONS.OPENINGS_WRITE)
    @Delete(':id')
    remove(
        @Param('openingId') openingId: string,
        @Param('id') id: string,
        @Request() req: any,
    ) {
        return this.sessions.remove(openingId, id, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: "Approved student's attendance history for a batch" })
    @Roles(Role.STUDENT)
    @Get('my-attendance')
    myAttendance(@Param('openingId') openingId: string, @Request() req: any) {
        return this.sessions.listMyAttendance(openingId, req.user.userId);
    }

    @ApiOperation({ summary: 'Attendance roster for one session' })
    @Roles(...STAFF_ROLES)
    @RequirePermissions(PERMISSIONS.GRADES_READ)
    @Get(':id/attendance')
    attendance(
        @Param('openingId') openingId: string,
        @Param('id') sessionId: string,
        @Request() req: any,
    ) {
        return this.sessions.listAttendance(openingId, sessionId, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'Save attendance for enrolled students in one session' })
    @Roles(...STAFF_ROLES)
    @RequirePermissions(PERMISSIONS.GRADES_WRITE)
    @Put(':id/attendance')
    saveAttendance(
        @Param('openingId') openingId: string,
        @Param('id') sessionId: string,
        @Body() dto: SaveSessionAttendanceDto,
        @Request() req: any,
    ) {
        return this.sessions.saveAttendance(
            openingId,
            sessionId,
            dto.records,
            req.user.userId,
            req.user.role,
        );
    }
}