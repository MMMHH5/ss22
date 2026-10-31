import { Controller, Post, Body, Param, Patch, UseGuards, Request, Ip, UseInterceptors, UploadedFile, BadRequestException, Get, Query, Res, Delete } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { EnrollmentsService } from './enrollments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { Role, EnrollmentStatus } from '@prisma/client';
import { basename } from 'path';
import { Response } from 'express';
import { hasValidUploadedSignature } from '../common/file-signatures';
import { createUploadStorage, removeUploadedFile, uploadUrl } from '../common/upload-storage';
import { readPrivateUpload } from '../common/private-uploads';
import { ReviewEnrollmentDto, ReserveCourseDto, AdminEnrollDto } from './dto/enrollment.dto';

// Receipts are private: stored OUTSIDE the publicly-served uploads tree
// (uploads/private/...) and only downloadable via GET :id/receipt, which
// checks that the caller is the owning student, FINANCE, or ADMIN.
@ApiTags('Enrollments & Receipts')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('enrollments')
export class EnrollmentsController {
    constructor(private readonly enrollmentsService: EnrollmentsService) { }

    @ApiOperation({ summary: 'Admin/Course Manager directly enroll a student into a course opening (APPROVED)' })
    @ApiResponse({ status: 201, description: 'Student enrolled into the course.' })
    @Roles(Role.COURSE_MANAGER, Role.ADMIN)
    @RequirePermissions(PERMISSIONS.ENROLLMENTS_WRITE)
    @Post('admin')
    enrollStudent(
        @Body() dto: AdminEnrollDto,
        @Request() req: any,
        @Ip() ip: string
    ) {
        return this.enrollmentsService.enrollByAdmin(dto.courseId, dto.studentId, req.user.userId, dto.openingId, ip);
    }

    @ApiOperation({ summary: 'Enroll a student into a published course opening and upload payment receipt' })
    @ApiResponse({ status: 201, description: 'Successfully enrolled as PENDING with receipt.' })
    @Roles(Role.STUDENT)
    @Post()
    @UseInterceptors(FileInterceptor('receipt', {
        storage: createUploadStorage({
            destination: () => './uploads/private/receipts',
            filename: (_req, file) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
                // Use fixed extension based on validated MIME type
                const mimeToExt: Record<string, string> = {
                    'image/jpeg': '.jpg',
                    'image/png': '.png',
                    'application/pdf': '.pdf',
                };
                const ext = mimeToExt[file.mimetype] || '.pdf';
                return `receipt-${uniqueSuffix}${ext}`;
            },
        }),
        fileFilter: (req, file, cb) => {
            if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png' || file.mimetype === 'application/pdf') {
                cb(null, true);
            } else {
                cb(new BadRequestException('Only JPEG, PNG and PDF files are allowed.'), false);
            }
        },
        limits: {
            fileSize: 5 * 1024 * 1024, // 5MB
            files: 1,
            fields: 20,
            fieldSize: 1 * 1024 * 1024,
            parts: 30,
        }
    }))
    async enrollWithReceipt(
        @Body('openingId') openingId: string,
        @Body('gatewayId') gatewayId: string | undefined,
        @Body('couponCode') couponCode: string | undefined,
        @UploadedFile() file: Express.Multer.File,
        @Request() req: any,
        @Ip() ip: string
    ) {
        if (!file) {
            throw new BadRequestException('Receipt file is required.');
        }
        if (!hasValidUploadedSignature(file)) {
            await removeUploadedFile(file);
            throw new BadRequestException('Receipt content does not match its declared type.');
        }
        if (!openingId) {
            await removeUploadedFile(file);
            throw new BadRequestException('openingId is required.');
        }
        try {
            return await this.enrollmentsService.enrollWithReceipt(
                openingId,
                uploadUrl(file),
                req.user.id || req.user.userId,
                ip,
                // Which payment method the student says they used, so finance can
                // reconcile the transfer. Optional: older clients omit it.
                gatewayId || undefined,
                // Optional student-typed coupon code, priced server-side.
                couponCode || undefined,
            );
        } catch (error) {
            await removeUploadedFile(file);
            throw error;
        }
    }

    @ApiOperation({ summary: 'Reserve a seat without payment' })
    @ApiResponse({ status: 201, description: 'Seat reserved successfully' })
    @Roles(Role.STUDENT)
    @Post('reserve')
    reserveSeat(
        @Body() dto: ReserveCourseDto,
        @Request() req: any,
        @Ip() ip: string
    ) {
        return this.enrollmentsService.reserveSeat(dto.courseId, req.user.id || req.user.userId, ip);
    }

    @ApiOperation({ summary: 'Get pending enrollments for finance review' })
    @Roles(Role.FINANCE, Role.ADMIN)
    @RequirePermissions(PERMISSIONS.ENROLLMENTS_REVIEW)
    @Get('pending')
    getPendingRequests() {
        return this.enrollmentsService.getPending();
    }

    @ApiOperation({ summary: 'Get current student enrollments' })
    @Roles(Role.STUDENT)
    @Get('my')
    getMyEnrollments(@Request() req: any) {
        return this.enrollmentsService.getMyEnrollments(req.user.userId);
    }

    @ApiOperation({ summary: 'Get current student grades across enrolled courses' })
    @Roles(Role.STUDENT)
    @Get('my/grades')
    getMyGrades(@Request() req: any) {
        return this.enrollmentsService.getMyGrades(req.user.userId);
    }

    @ApiOperation({ summary: 'Get all enrollments history for finance review' })
    @Roles(Role.FINANCE, Role.ADMIN)
    @RequirePermissions(PERMISSIONS.ENROLLMENTS_READ)
    @Get('all')
    getAllEnrollments(@Query('studentId') studentId?: string) {
        return this.enrollmentsService.getAllEnrollments(studentId);
    }

    @ApiOperation({ summary: 'Get every enrollment for one course, grouped by status (course managers)' })
    @ApiResponse({ status: 200, description: 'Roster for the course with per-status counts and latest payment.' })
    @ApiResponse({ status: 404, description: 'Course not found.' })
    @Roles(Role.COURSE_MANAGER, Role.ADMIN)
    @RequirePermissions(PERMISSIONS.ENROLLMENTS_READ)
    @Get('course/:courseId')
    getCourseEnrollments(@Param('courseId') courseId: string) {
        return this.enrollmentsService.getForCourse(courseId);
    }

    @ApiOperation({ summary: 'Roster for a single opening (reserved / pending / approved)' })
    @ApiResponse({ status: 200, description: 'Opening roster with per-status counts and latest payment.' })
    @ApiResponse({ status: 404, description: 'Opening not found.' })
    @Roles(Role.COURSE_MANAGER, Role.ADMIN)
    @RequirePermissions(PERMISSIONS.ENROLLMENTS_READ)
    @Get('opening/:openingId')
    getOpeningEnrollments(@Param('openingId') openingId: string) {
        return this.enrollmentsService.getForOpening(openingId);
    }

    @ApiOperation({ summary: 'Finance/Admin review enrollment receipt' })
    @ApiResponse({ status: 200, description: 'Enrollment status updated (APPROVED/REJECTED).' })
    @Roles(Role.FINANCE, Role.ADMIN)
    @RequirePermissions(PERMISSIONS.ENROLLMENTS_REVIEW)
    @Patch(':id/review')
    review(
        @Param('id') enrollmentId: string,
        @Body() dto: ReviewEnrollmentDto,
        @Request() req: any,
        @Ip() ip: string,
    ) {
        return this.enrollmentsService.review(enrollmentId, dto.status, req.user.userId, ip, dto.notes);
    }

    @ApiOperation({ summary: 'Withdraw an enrollment (the owning student, or FINANCE/ADMIN/COURSE_MANAGER)' })
    @ApiResponse({ status: 200, description: 'Enrollment marked REVOKED and the seat returned to the opening.' })
    @ApiResponse({ status: 409, description: 'Already approved and paid — only staff may unwind it.' })
    @Roles(Role.STUDENT, Role.FINANCE, Role.ADMIN, Role.COURSE_MANAGER)
    @Delete(':id')
    withdraw(
        @Param('id') enrollmentId: string,
        @Request() req: any,
        @Ip() ip: string,
    ) {
        return this.enrollmentsService.withdraw(enrollmentId, req.user.userId || req.user.id, req.user.role, ip);
    }

    @ApiOperation({ summary: 'Download the payment receipt of an enrollment (owner student, FINANCE, or ADMIN)' })
    @ApiResponse({ status: 200, description: 'Receipt file streamed.' })
    @Roles(Role.STUDENT, Role.FINANCE, Role.ADMIN)
    @Get(':id/receipt')
    async downloadReceipt(
        @Param('id') enrollmentId: string,
        @Request() req: any,
        @Res() res: Response,
    ) {
        const abs = await this.enrollmentsService.getReceiptPath(enrollmentId, req.user.userId, req.user.role);
        const content = await readPrivateUpload(abs);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        res.setHeader('Content-Disposition', `inline; filename="${basename(abs).replace(/["\\\r\n]/g, '')}"`);
        res.type(basename(abs));
        return res.send(content);
    }
}
