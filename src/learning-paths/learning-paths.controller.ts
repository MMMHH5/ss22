import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LearningPathsService } from './learning-paths.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { Role } from '@prisma/client';
import { CreateLearningPathDto, UpdateLearningPathDto } from './dto/learning-path.dto';

const STAFF = [Role.ADMIN, Role.COURSE_MANAGER];

@ApiTags('Learning Paths (مسارات التعلم)')
@ApiBearerAuth('JWT-auth')
@Controller('learning-paths')
export class LearningPathsController {
    constructor(private readonly svc: LearningPathsService) {}

    @ApiOperation({ summary: 'Create a learning path' })
    @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
    @Roles(...STAFF)
    @RequirePermissions(PERMISSIONS.PATHS_WRITE)
    @Post()
    create(@Body() dto: CreateLearningPathDto, @Request() req: any) {
        return this.svc.createPath(dto, req.user.userId);
    }

    @ApiOperation({ summary: 'List all learning paths for course staff' })
    @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
    @Roles(...STAFF)
    @RequirePermissions(PERMISSIONS.PATHS_WRITE)
    @Get('manage')
    listForManagement() {
        return this.svc.listPaths();
    }

    @ApiOperation({ summary: 'List courses with learning-path publishing readiness' })
    @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
    @Roles(...STAFF)
    @RequirePermissions(PERMISSIONS.PATHS_WRITE)
    @Get('manage/courses')
    listCoursesForManagement() {
        return this.svc.listCoursesForManagement();
    }

    @ApiOperation({ summary: 'Get learning path learner and completion report' })
    @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
    @Roles(...STAFF)
    @RequirePermissions(PERMISSIONS.PATHS_WRITE)
    @Get('manage/:id/report')
    report(@Param('id') id: string) {
        return this.svc.getPathReport(id);
    }

    @ApiOperation({ summary: 'List the current student learning paths and progress' })
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(Role.STUDENT)
    @Get('my')
    myPaths(@Request() req: any) {
        return this.svc.getStudentPaths(req.user.userId);
    }

    @ApiOperation({ summary: 'List learning paths' })
    @Get()
    list() {
        return this.svc.listPaths(true);
    }

    @ApiOperation({ summary: 'Get learning path details' })
    @Get(':id')
    getOne(@Param('id') id: string) {
        return this.svc.getPublishedPath(id);
    }

    @ApiOperation({ summary: 'Update learning path' })
    @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
    @Roles(...STAFF)
    @RequirePermissions(PERMISSIONS.PATHS_WRITE)
    @Patch(':id')
    update(@Param('id') id: string, @Body() dto: UpdateLearningPathDto, @Request() req: any) {
        return this.svc.updatePath(id, dto, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'Delete learning path' })
    @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
    @Roles(...STAFF)
    @RequirePermissions(PERMISSIONS.PATHS_WRITE)
    @Delete(':id')
    remove(@Param('id') id: string, @Request() req: any) {
        return this.svc.deletePath(id, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'Enroll in a learning path' })
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(Role.STUDENT)
    @Post(':id/enroll')
    enroll(@Param('id') id: string, @Request() req: any) {
        return this.svc.enrollPath(id, req.user.userId);
    }
}
