import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request, BadRequestException, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { TasksService } from './tasks.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { Role } from '@prisma/client';
import { hasValidUploadedSignature } from '../common/file-signatures';
import { createUploadStorage, removeUploadedFile, uploadUrl } from '../common/upload-storage';

const STAFF_ROLES = [Role.ADMIN, Role.COURSE_MANAGER, Role.INSTRUCTOR];

const uploadDir = './uploads/tasks';

/**
 * Extensions we will hand out for a submission.
 *
 * The assignment is "any file type", so the type is not restricted — an
 * instructor has to be able to receive a .docx, a .zip of source, a .py or a
 * .mp4. What is not negotiable is that the *stored* name is decided by the
 * server: the original filename is kept in the database as metadata for
 * display, and the stored object uses a generated name with a
 * sanitised extension, so an upload cannot drop a `.php`, a double extension
 * or a path into the folder. Anything without an extension is stored as
 * `.bin`, and the file is removed again if its bytes do not match the declared
 * type.
 */
function safeStoredName(originalName: string | undefined, mimetype: string | undefined): string {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const base = (originalName || '').replace(/\\/g, '/').split('/').pop() ?? '';
    const ext = (base.includes('.') ? base.slice(base.lastIndexOf('.')) : '').toLowerCase();
    const safeExt = /^\.[a-z0-9]{1,12}$/.test(ext) ? ext : '';
    return `submission-${unique}${safeExt}`;
}

@ApiTags('Tasks (المهام الدراسية)')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('tasks')
export class TasksController {
    constructor(private readonly tasksService: TasksService) { }

    @ApiOperation({ summary: 'List tasks for an opening (students see enrolled tasks; staff see their own openings)' })
    @Get('opening/:openingId')
    list(@Param('openingId') openingId: string, @Request() req: any) {
        return this.tasksService.listTasks(openingId, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'List approved students without grade details for task management' })
    @Roles(...STAFF_ROLES)
    @RequirePermissions(PERMISSIONS.CONTENT_READ)
    @Get('opening/:openingId/roster')
    taskRoster(@Param('openingId') openingId: string, @Request() req: any) {
        return this.tasksService.getTaskRoster(openingId, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'Create a task for an opening (instructor of the opening or staff)' })
    @ApiResponse({ status: 201, description: 'Task created.' })
    @Roles(...STAFF_ROLES)
    @RequirePermissions(PERMISSIONS.CONTENT_WRITE)
    @Post('opening/:openingId')
    create(
        @Param('openingId') openingId: string,
        @Body('titleAr') titleAr: string,
        @Body('titleEn') titleEn: string,
        @Body('descriptionAr') descriptionAr: string | undefined,
        @Body('descriptionEn') descriptionEn: string | undefined,
        @Body('dueDate') dueDate: string | undefined,
        @Body('maxScore') maxScore: number | undefined,
        @Body('moduleId') moduleId: string | undefined,
        @Body('attachmentUrl') attachmentUrl: string | undefined,
        @Body('attachmentType') attachmentType: string | undefined,
        @Body('links') links: { url: string; labelAr?: string; labelEn?: string }[] | undefined,
        @Request() req: any,
    ) {
        return this.tasksService.createTask(openingId, { titleAr, titleEn, descriptionAr, descriptionEn, dueDate, maxScore, moduleId, attachmentUrl, attachmentType, links }, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'Update a task' })
    @Roles(...STAFF_ROLES)
    @RequirePermissions(PERMISSIONS.CONTENT_WRITE)
    @Patch(':id')
    update(
        @Param('id') id: string,
        @Body('titleAr') titleAr: string | undefined,
        @Body('titleEn') titleEn: string | undefined,
        @Body('descriptionAr') descriptionAr: string | undefined,
        @Body('descriptionEn') descriptionEn: string | undefined,
        @Body('dueDate') dueDate: string | undefined,
        @Body('maxScore') maxScore: number | undefined,
        @Body('moduleId') moduleId: string | undefined,
        @Body('attachmentUrl') attachmentUrl: string | undefined,
        @Body('attachmentType') attachmentType: string | undefined,
        @Body('links') links: { url: string; labelAr?: string; labelEn?: string }[] | undefined,
        @Request() req: any,
    ) {
        return this.tasksService.updateTask(id, { titleAr, titleEn, descriptionAr, descriptionEn, dueDate, maxScore, moduleId, attachmentUrl, attachmentType, links }, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'Delete a task' })
    @Roles(...STAFF_ROLES)
    @RequirePermissions(PERMISSIONS.CONTENT_DELETE)
    @Delete(':id')
    remove(@Param('id') id: string, @Request() req: any) {
        return this.tasksService.deleteTask(id, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'Upload the file for a submission (any type)' })
    @ApiConsumes('multipart/form-data')
    @ApiResponse({ status: 201, description: 'Stored; returns the URL to submit with.' })
    @Roles(Role.STUDENT)
    @Post(':id/submit-file')
    @UseInterceptors(FileInterceptor('file', {
        storage: createUploadStorage({
            destination: () => uploadDir,
            filename: (_req, file) => safeStoredName(file.originalname, file.mimetype),
        }),
        limits: {
            // Assignment work is a document or a source bundle, not a video
            // library; 50MB is well past any realistic report and keeps the
            // upload volume from being used as free storage.
            fileSize: 50 * 1024 * 1024,
            files: 1,
            fields: 10,
            fieldSize: 1 * 1024 * 1024,
            parts: 15,
        },
    }))
    async uploadSubmissionFile(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Request() req: any) {
        if (!file) {
            throw new BadRequestException('File is required.');
        }
        // The interceptor has already stored the file by the time the handler
        // runs, so a rejected request has to remove it from storage.
        // Without this, any authenticated student could park arbitrary bytes in
        // the uploads volume for a task they are not enrolled in.
        try {
            await this.tasksService.assertStudentCanSubmit(id, req.user.userId);
            if (file.mimetype && !hasValidUploadedSignature(file)) {
                throw new BadRequestException('File content does not match its declared type.');
            }
        } catch (err) {
            await removeUploadedFile(file);
            throw err;
        }
        return {
            url: uploadUrl(file),
            name: file.originalname || file.filename,
            size: file.size,
            mimetype: file.mimetype || null,
        };
    }

    @ApiOperation({ summary: 'Student submits (or updates) their answer for a task' })
    @ApiResponse({ status: 201, description: 'Submission saved.' })
    @Roles(Role.STUDENT)
    @Post(':id/submit')
    submit(
        @Param('id') id: string,
        @Body('content') content: string | undefined,
        @Body('attachmentUrl') attachmentUrl: string | undefined,
        @Body('attachmentName') attachmentName: string | undefined,
        @Body('attachmentType') attachmentType: string | undefined,
        @Body('attachmentSize') attachmentSize: number | undefined,
        @Request() req: any,
    ) {
        return this.tasksService.submitTask(id, req.user.userId, { content, attachmentUrl, attachmentName, attachmentType, attachmentSize });
    }

    @ApiOperation({ summary: "A student's task list for a course (batch resolved for them)" })
    @Roles(Role.STUDENT)
    @Get('course/:courseId')
    forCourse(@Param('courseId') courseId: string, @Request() req: any) {
        return this.tasksService.listStudentCourseTasks(courseId, req.user.userId);
    }

    @ApiOperation({ summary: 'Student reads their own submission for a task' })
    @Roles(Role.STUDENT)
    @Get(':id/my-submission')
    mySubmission(@Param('id') id: string, @Request() req: any) {
        return this.tasksService.getMySubmission(id, req.user.userId);
    }

    @ApiOperation({ summary: 'Every student submission across all batches the actor teaches' })
    @Roles(...STAFF_ROLES)
    @RequirePermissions(PERMISSIONS.GRADES_READ)
    @Get('submissions')
    inbox(
        @Query('courseId') courseId: string | undefined,
        @Query('openingId') openingId: string | undefined,
        @Query('ungraded') ungraded: string | undefined,
        @Query('limit') limit: string | undefined,
        @Query('skip') skip: string | undefined,
        @Request() req: any,
    ) {
        return this.tasksService.listSubmissionsForActor(req.user.userId, req.user.role, {
            courseId: courseId || undefined,
            openingId: openingId || undefined,
            ungradedOnly: ungraded === 'true',
            limit: limit ? Number(limit) : undefined,
            skip: skip ? Number(skip) : undefined,
        });
    }

    @ApiOperation({ summary: 'List submissions for a task (staff/own openings)' })
    @Roles(...STAFF_ROLES)
    @RequirePermissions(PERMISSIONS.GRADES_READ)
    @Get(':id/submissions')
    submissions(@Param('id') id: string, @Request() req: any) {
        return this.tasksService.getSubmissions(id, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'Grade a student submission (score + notes)' })
    @Roles(...STAFF_ROLES)
    @RequirePermissions(PERMISSIONS.GRADES_WRITE)
    @Patch('submissions/:submissionId/grade')
    grade(
        @Param('submissionId') submissionId: string,
        @Body('score') score: number,
        @Body('notes') notes: string | undefined,
        @Request() req: any,
    ) {
        return this.tasksService.gradeSubmission(submissionId, req.user.userId, req.user.role, score, notes);
    }
}