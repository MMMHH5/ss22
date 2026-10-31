import { Controller, Get, Patch, Param, Body, UseGuards, Request, Res } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { basename } from 'path';
import { InstructorApplicationsService } from './instructor-applications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { Role } from '@prisma/client';
import { readPrivateUpload } from '../common/private-uploads';

@ApiTags('Instructor Applications')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('api/admin/instructor-applications')
export class AdminInstructorApplicationsController {
    constructor(private readonly instructorApplicationsService: InstructorApplicationsService) { }

    @Get()
    @Roles(Role.ADMIN, Role.COURSE_MANAGER)
    @RequirePermissions(PERMISSIONS.INSTRUCTORS_READ)
    async getApplications() {
        return this.instructorApplicationsService.getApplications();
    }

    @Patch(':id/status')
    @Roles(Role.ADMIN, Role.COURSE_MANAGER)
    @RequirePermissions(PERMISSIONS.INSTRUCTORS_REVIEW)
    async updateStatus(
        @Param('id') id: string,
        @Body('status') status: 'APPROVED' | 'REJECTED',
        @Request() req: any
    ) {
        return this.instructorApplicationsService.updateApplicationStatus(id, status, req.user.id || req.user.userId);
    }

    @Get(':id/cv')
    @Roles(Role.ADMIN, Role.COURSE_MANAGER)
    @RequirePermissions(PERMISSIONS.INSTRUCTORS_READ)
    async downloadCv(@Param('id') id: string, @Res() res: Response) {
        const abs = await this.instructorApplicationsService.getCvPath(id);
        const content = await readPrivateUpload(abs);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        res.setHeader('Content-Disposition', `inline; filename="${basename(abs).replace(/["\\\r\n]/g, '')}"`);
        res.type(basename(abs));
        return res.send(content);
    }
}
