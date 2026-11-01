import { Controller, Get, Patch, Param, Body, Delete, UseGuards, Request, Ip, Post, Put } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CoursesService } from './courses.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { Role } from '@prisma/client';
import { UpdateOpeningDto } from './dto/update-opening.dto';
import { SetOpeningInstructorGrantsDto } from './dto/opening-instructor-grants.dto';

const STAFF_ROLES = [Role.ADMIN, Role.COURSE_MANAGER, Role.INSTRUCTOR];

@ApiTags('Course Openings (??? ??????)')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('openings')
export class CourseOpeningsController {
    constructor(private readonly coursesService: CoursesService) { }

    @ApiOperation({ summary: 'My assigned openings (instructors: openings they teach; staff: all)' })
    @Roles(Role.INSTRUCTOR, Role.ADMIN, Role.COURSE_MANAGER)
    @Get('mine')
    mine(@Request() req: any) {
        return this.coursesService.listMyOpenings(req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'Module titles for an opening (staff, primary instructor, or authorized assistant)' })
    @Roles(Role.INSTRUCTOR, Role.ADMIN, Role.COURSE_MANAGER)
    @Get(':id/modules')
    modules(@Param('id') id: string, @Request() req: any) {
        return this.coursesService.listOpeningModules(id, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'List secondary instructor permissions for an opening' })
    @Roles(Role.ADMIN, Role.COURSE_MANAGER)
    @RequirePermissions(PERMISSIONS.OPENINGS_WRITE)
    @Get(':id/instructor-grants')
    listInstructorGrants(@Param('id') id: string) {
        return this.coursesService.getOpeningInstructorGrants(id);
    }

    @ApiOperation({ summary: 'Replace secondary instructor permissions for an opening' })
    @Roles(Role.ADMIN, Role.COURSE_MANAGER)
    @RequirePermissions(PERMISSIONS.OPENINGS_WRITE)
    @Put(':id/instructor-grants')
    setInstructorGrants(
        @Param('id') id: string,
        @Body() dto: SetOpeningInstructorGrantsDto,
        @Request() req: any,
    ) {
        return this.coursesService.setOpeningInstructorGrants(id, dto.instructors, req.user.userId);
    }

    @ApiOperation({ summary: 'Update an opening (dates, fees, instructor, capacity)' })
    @ApiResponse({ status: 200, description: 'Opening updated.' })
    @Roles(...STAFF_ROLES)
    @RequirePermissions(PERMISSIONS.OPENINGS_WRITE)
    @Patch(':id')
    update(@Param('id') id: string, @Body() dto: UpdateOpeningDto, @Request() req: any) {
        return this.coursesService.updateOpening(id, dto, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'Publish an opening (make it open for registration/payment)' })
    @ApiResponse({ status: 200, description: 'Opening published.' })
    @Roles(...STAFF_ROLES)
    @RequirePermissions(PERMISSIONS.OPENINGS_WRITE)
    @Post(':id/publish')
    publish(@Param('id') id: string, @Request() req: any) {
        return this.coursesService.setOpeningPublished(id, true, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'Unpublish an opening (close registration)' })
    @ApiResponse({ status: 200, description: 'Opening unpublished.' })
    @Roles(...STAFF_ROLES)
    @RequirePermissions(PERMISSIONS.OPENINGS_WRITE)
    @Post(':id/unpublish')
    unpublish(@Param('id') id: string, @Request() req: any) {
        return this.coursesService.setOpeningPublished(id, false, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'Activate the announcement banner for an opening (DRAFT -> ANNOUNCEMENT)' })
    @ApiResponse({ status: 201, description: 'Announcement activated.' })
    @Roles(...STAFF_ROLES)
    @RequirePermissions(PERMISSIONS.OPENINGS_WRITE)
    @Post(':id/announcement')
    startAnnouncement(
        @Param('id') id: string,
        @Body('announcementStartAt') announcementStartAt: string | undefined,
        @Body('announcementEndAt') announcementEndAt: string | undefined,
        @Request() req: any,
    ) {
        return this.coursesService.startAnnouncement(
            id,
            req.user.userId,
            req.user.role,
            {
                announcementStartAt: announcementStartAt as unknown as Date,
                announcementEndAt: announcementEndAt as unknown as Date,
            },
        );
    }

    @ApiOperation({ summary: 'Open an opening for registration (ANNOUNCEMENT -> OPEN)' })
    @ApiResponse({ status: 201, description: 'Opening opened for registration.' })
    @Roles(...STAFF_ROLES)
    @RequirePermissions(PERMISSIONS.OPENINGS_WRITE)
    @Post(':id/open')
    open(@Param('id') id: string, @Request() req: any) {
        return this.coursesService.openOpening(id, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'Start the course (OPEN -> STARTED); students see the internal content' })
    @ApiResponse({ status: 201, description: 'Course started.' })
    @Roles(...STAFF_ROLES)
    @RequirePermissions(PERMISSIONS.OPENINGS_WRITE)
    @Post(':id/start')
    start(@Param('id') id: string, @Request() req: any) {
        return this.coursesService.startCourse(id, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'End the course (OPEN/STARTED -> ENDED); approval-based via close request' })
    @ApiResponse({ status: 201, description: 'Course ended.' })
    @Roles(...STAFF_ROLES)
    @RequirePermissions(PERMISSIONS.OPENINGS_WRITE)
    @Post(':id/end')
    end(@Param('id') id: string, @Request() req: any) {
        return this.coursesService.endCourse(id, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'Delete an opening' })
    @ApiResponse({ status: 200, description: 'Opening deleted.' })
    @Roles(Role.ADMIN, Role.COURSE_MANAGER)
    @RequirePermissions(PERMISSIONS.OPENINGS_DELETE)
    @Delete(':id')
    remove(@Param('id') id: string, @Request() req: any, @Ip() ip: string) {
        return this.coursesService.removeOpening(id, req.user.userId, ip);
    }
}