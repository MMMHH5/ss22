import { Controller, Post, Get, Body, UseGuards, Request, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { InstructorApplicationsService } from './instructor-applications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { hasValidUploadedSignature } from '../common/file-signatures';
import { createUploadStorage, removeUploadedFile, uploadUrl } from '../common/upload-storage';

@Controller('instructor-applications')
export class InstructorApplicationsController {
    constructor(private readonly instructorApplicationsService: InstructorApplicationsService) { }

    @Get('my')
    @UseGuards(JwtAuthGuard)
    async getMyApplication(@Request() req: any) {
        return this.instructorApplicationsService.getMyApplication(req.user.id || req.user.userId);
    }

    @Post()
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(FileInterceptor('cv', {
        storage: createUploadStorage({
            destination: () => './uploads/private/cvs',
            filename: (_req, file) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
                // Use fixed extension based on validated MIME type
                const mimeToExt: Record<string, string> = {
                    'application/pdf': '.pdf',
                    'application/msword': '.doc',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
                    'text/plain': '.txt',
                };
                const ext = mimeToExt[file.mimetype] || '.pdf';
                return `cv-${uniqueSuffix}${ext}`;
            },
        }),
        fileFilter: (req, file, cb) => {
            const allowedMimes = [
                'application/pdf',
                'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'text/plain',
            ];
            if (allowedMimes.includes(file.mimetype)) {
                cb(null, true);
            } else {
                cb(new BadRequestException('Only PDF, DOC, DOCX, and TXT files are allowed.'), false);
            }
        },
        limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 20, fieldSize: 1 * 1024 * 1024, parts: 30 } // 10MB
    }))
    async createApplication(
        @UploadedFile() file: Express.Multer.File,
        @Body() data: any,
        @Request() req: any
    ) {
        if (!file) throw new BadRequestException('CV file is required.');
        if (!hasValidUploadedSignature(file)) {
            await removeUploadedFile(file);
            throw new BadRequestException('CV content does not match its declared type.');
        }
        try {
            return await this.instructorApplicationsService.createApplication(req.user.id || req.user.userId, data, uploadUrl(file));
        } catch (error) {
            await removeUploadedFile(file);
            throw error;
        }
    }
}
