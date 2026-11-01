import { Controller, Get, Post, Param, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RubricsService } from './rubrics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { Role } from '@prisma/client';
import { SubmitReviewDto } from './dto/submit-review.dto';

const STAFF = [Role.ADMIN, Role.COURSE_MANAGER, Role.INSTRUCTOR];

@ApiTags('Rubrics & Peer Review (تقييم الأقران)')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('rubrics')
export class RubricsController {
    constructor(private readonly svc: RubricsService) {}

    @ApiOperation({ summary: 'Create rubric for a task' })
    @Roles(...STAFF)
    @RequirePermissions(PERMISSIONS.CONTENT_WRITE)
    @Post('task/:taskId')
    create(@Param('taskId') taskId: string, @Body() dto: any, @Request() req: any) {
        return this.svc.createRubric(taskId, dto, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'Get rubric for a task' })
    @Get('task/:taskId')
    getForTask(@Param('taskId') taskId: string) {
        return this.svc.getRubric(taskId);
    }

    @ApiOperation({ summary: 'Submit peer review' })
    @Roles(Role.STUDENT)
    @Post(':id/review')
    // Was `@Body() dto: any`, which opts the payload out of the global
    // ValidationPipe entirely: forbidNonWhitelisted and the nested checks never
    // ran, so `scores` could be any shape and anything else in the body rode
    // along into the service.
    submitReview(@Param('id') id: string, @Body() dto: SubmitReviewDto, @Request() req: any) {
        return this.svc.submitReview(id, dto.submissionId, req.user.userId, dto);
    }

    @ApiOperation({ summary: 'Get reviews for a submission' })
    // STUDENT stays allowed here: the ownership decision is per-submission and
    // lives in the service, where a student may read their own feedback but
    // not a stranger's. Restricting the route to staff would have silently
    // cut students off from their own reviews.
    @Roles(Role.STUDENT, Role.INSTRUCTOR, Role.ADMIN, Role.COURSE_MANAGER)
    @Get('submission/:submissionId/reviews')
    getReviews(@Param('submissionId') submissionId: string, @Request() req: any) {
        return this.svc.getReviewsForSubmission(submissionId, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'Assign random peer reviews' })
    @Roles(...STAFF)
    @RequirePermissions(PERMISSIONS.CONTENT_WRITE)
    @Post(':id/assign')
    assign(@Param('id') id: string, @Body('count') count: number, @Request() req: any) {
        return this.svc.assignRandomReviews(id, count || 2, req.user.userId, req.user.role);
    }
}
