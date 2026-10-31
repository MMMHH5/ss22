import { Controller, Get, Post, Patch, Body, Param, Delete, UseGuards, Request, Ip, UseInterceptors, UploadedFile, BadRequestException, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { CoursesService } from './courses.service';
import { hasValidUploadedSignature } from '../common/file-signatures';
import { createUploadStorage, removeUploadedFile, uploadUrl } from '../common/upload-storage';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { Role } from '@prisma/client';
import { CreateCourseDto, UpdateCourseDto } from './dto/create-course.dto';
import { CreateOpeningDto } from './dto/create-opening.dto';

const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime'];

@ApiTags('Courses Management')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('api/admin/courses')
export class AdminCoursesController {
    constructor(private readonly coursesService: CoursesService) { }

    @ApiOperation({ summary: 'Create a new course (Managers/Admins)' })
    @ApiResponse({ status: 201, description: 'Course created.' })
    @Roles(Role.ADMIN, Role.COURSE_MANAGER)
    @RequirePermissions(PERMISSIONS.COURSES_WRITE)
    @Post()
    create(@Body() createCourseDto: CreateCourseDto, @Request() req: any) {
        return this.coursesService.create(createCourseDto, req.user.userId);
    }

    @ApiOperation({ summary: 'Upload course media (images/videos). kind=cover|gallery|video|general via query' })
    @ApiConsumes('multipart/form-data')
    @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
    @ApiResponse({ status: 201, description: 'Media URL returned.' })
    @Roles(Role.ADMIN, Role.COURSE_MANAGER)
    @RequirePermissions(PERMISSIONS.COURSES_WRITE)
    @Post('media')
    @UseInterceptors(FileInterceptor('file', {
        storage: createUploadStorage({
            destination: (req) => {
                const kind = (req.query.kind as string) || 'general';
                const safeKind = /^[a-z0-9_-]+$/i.test(kind) ? kind : 'general';
                return `./uploads/courses/${safeKind}`;
            },
            filename: (_req, file) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
                // Use fixed extension based on validated MIME type
                const mimeToExt: Record<string, string> = {
                    'image/jpeg': '.jpg',
                    'image/png': '.png',
                    'image/webp': '.webp',
                    'image/gif': '.gif',
                    'video/mp4': '.mp4',
                    'video/webm': '.webm',
                    'video/quicktime': '.mov',
                };
                const ext = mimeToExt[file.mimetype] || '.bin';
                return `course-${uniqueSuffix}${ext}`;
            },
        }),
        fileFilter: (req, file, cb) => {
            const allowed = ALLOWED_IMAGE_MIMES.includes(file.mimetype) || ALLOWED_VIDEO_MIMES.includes(file.mimetype);
            if (allowed) {
                cb(null, true);
            } else {
                cb(new BadRequestException('Only JPEG, PNG, WEBP, GIF images and MP4/WEBM/MOV videos are allowed.'), false);
            }
        },
        limits: {
            fileSize: 100 * 1024 * 1024, // 100MB
            files: 1,
            fields: 20,
            fieldSize: 1 * 1024 * 1024,
            parts: 30,
        }
    }))
    async uploadMedia(
        @UploadedFile() file: Express.Multer.File,
        @Query('kind') kind: string,
        @Request() req: any
    ) {
        if (!file) {
            throw new BadRequestException('File is required.');
        }
        if (!hasValidUploadedSignature(file)) {
            await removeUploadedFile(file);
            throw new BadRequestException('File content does not match its declared type.');
        }
        const safeKind = /^[a-z0-9_-]+$/i.test(kind || '') ? kind : 'general';
        return {
            url: uploadUrl(file),
            kind: safeKind,
            size: file.size,
            mimetype: file.mimetype,
        };
    }

    @ApiOperation({ summary: 'Open/create a new opening (batch) for a course' })
    @ApiResponse({ status: 201, description: 'Course opening created.' })
    @Roles(Role.ADMIN, Role.COURSE_MANAGER)
    @RequirePermissions(PERMISSIONS.COURSES_WRITE)
    @Post(':id/openings')
    createOpening(@Param('id') id: string, @Body() dto: CreateOpeningDto) {
        return this.coursesService.createOpening(id, dto);
    }

    @ApiOperation({ summary: 'Update a course (Managers/Admins)' })
    @ApiResponse({ status: 200, description: 'Course updated.' })
    @Roles(Role.ADMIN, Role.COURSE_MANAGER)
    @RequirePermissions(PERMISSIONS.COURSES_WRITE)
    @Patch(':id')
    update(@Param('id') id: string, @Body() updateCourseDto: UpdateCourseDto, @Request() req?: any) {
        return this.coursesService.update(id, updateCourseDto, req?.user);
    }

    @ApiOperation({ summary: 'Delete a course (Admins/Course Managers)' })
    @ApiResponse({ status: 200, description: 'Course successfully deleted.' })
    @Roles(Role.ADMIN, Role.COURSE_MANAGER)
    @RequirePermissions(PERMISSIONS.COURSES_DELETE)
    @Delete(':id')
    remove(@Param('id') id: string, @Request() req: any, @Ip() ip: string) {
        return this.coursesService.remove(id, req.user.userId, ip);
    }
}
