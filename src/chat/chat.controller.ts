import { Controller, Get, Post, Param, Body, Patch, UseGuards, Request, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { hasValidUploadedSignature } from '../common/file-signatures';
import { createUploadStorage, removeUploadedFile, uploadUrl } from '../common/upload-storage';


const DIRECT_ROLES = [Role.STUDENT, Role.INSTRUCTOR, Role.COURSE_MANAGER, Role.FINANCE, Role.ADMIN];

@Controller('chat')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChatController {
    constructor(
        private readonly chatService: ChatService,
        private readonly chatGateway: ChatGateway,
    ) { }

    @Roles(Role.STUDENT, Role.INSTRUCTOR, Role.COURSE_MANAGER, Role.FINANCE, Role.ADMIN)
    @Get('rooms')
    async getRooms(@Request() req: any) {
        const rooms = await this.chatService.getRooms(req.user.userId, req.user.role);
        // Ensure each room has members synced (especially on first view)
        const synced = rooms.map(room => {
            if (room.memberCount === 0) {
                this.chatService.syncRoomMembers(room.id).catch(() => {/* ignore */});
            }
            return room;
        });
        return synced;
    }

    @Roles(Role.STUDENT, Role.INSTRUCTOR, Role.COURSE_MANAGER, Role.FINANCE, Role.ADMIN)
    @Get('rooms/:roomId/thread')
    async getThread(@Param('roomId') roomId: string, @Request() req: any) {
        return this.chatService.getThread(roomId, req.user.userId);
    }

    @Roles(Role.STUDENT, Role.INSTRUCTOR, Role.COURSE_MANAGER, Role.FINANCE, Role.ADMIN)
    @Post('rooms/:roomId/messages')
    async sendMessage(
        @Param('roomId') roomId: string,
        @Request() req: any,
        @Body() body: { content?: string; attachmentUrl?: string; attachmentType?: string },
    ) {
        const message = await this.chatService.sendMessage(roomId, req.user.userId, body?.content ?? '', body?.attachmentUrl, body?.attachmentType);
        this.chatGateway.emitMessage(roomId, message);
        return message;
    }

    // ============================= Direct (1:1) chat =============================

    @Roles(...DIRECT_ROLES)
    @Get('direct')
    async getMyDirectChats(@Request() req: any) {
        return this.chatService.getMyDirectChats(req.user.userId, req.user.role);
    }

    @Roles(...DIRECT_ROLES)
    @Post('direct/course/:courseId')
    async openDirectChat(
        @Param('courseId') courseId: string,
        @Request() req: any,
        @Body() body: { studentId?: string },
    ) {
        return this.chatService.getOrCreateDirectChat(courseId, req.user.userId, req.user.role, body?.studentId);
    }

    @Roles(...DIRECT_ROLES)
    @Get('direct/course/:courseId')
    async getDirectChatsForCourse(
        @Param('courseId') courseId: string,
        @Request() req: any,
    ) {
        return this.chatService.getDirectChatsForCourse(courseId, req.user.userId, req.user.role);
    }

    @Roles(...DIRECT_ROLES)
    @Get('direct/:chatId/thread')
    async getDirectThread(@Param('chatId') chatId: string, @Request() req: any) {
        return this.chatService.getDirectThread(chatId, req.user.userId, req.user.role);
    }

    @Roles(...DIRECT_ROLES)
    @Post('direct/:chatId/messages')
    async sendDirectMessage(
        @Param('chatId') chatId: string,
        @Request() req: any,
        @Body() body: { content?: string; attachmentUrl?: string; attachmentType?: string },
    ) {
        const message = await this.chatService.sendDirectMessage(
            chatId, req.user.userId, req.user.role, body?.content, body?.attachmentUrl, body?.attachmentType,
        );
        this.chatGateway.emitDirectMessage(chatId, message);
        return message;
    }

    @Roles(...DIRECT_ROLES)
    @Patch('direct/:chatId/archive')
    async setDirectChatArchived(
        @Param('chatId') chatId: string,
        @Request() req: any,
        @Body() body: { archived: boolean },
    ) {
        return this.chatService.setDirectChatArchived(chatId, req.user.userId, req.user.role, !!body?.archived);
    }

    @Roles(Role.STUDENT, Role.INSTRUCTOR, Role.COURSE_MANAGER, Role.FINANCE, Role.ADMIN)
    @Post('upload')
    @UseInterceptors(FileInterceptor('file', {
        storage: createUploadStorage({
            destination: () => './uploads/chat',
            filename: (_req, file) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
                // Use fixed extension based on validated MIME type
                const mimeToExt: Record<string, string> = {
                    'image/jpeg': '.jpg',
                    'image/png': '.png',
                    'image/webp': '.webp',
                    'image/gif': '.gif',
                    'application/pdf': '.pdf',
                };
                const ext = file.mimetype.startsWith('video/')
                    ? (file.mimetype === 'video/webm' ? '.webm' : file.mimetype === 'video/quicktime' ? '.mov' : '.mp4')
                    : (mimeToExt[file.mimetype] || '.bin');
                return `chat-${uniqueSuffix}${ext}`;
            },
        }),
        fileFilter: (req, file, cb) => {
            const allowed = [
                'image/jpeg', 'image/png', 'image/webp', 'image/gif',
                'application/pdf',
                'video/mp4', 'video/webm', 'video/quicktime',
            ];
            if (allowed.includes(file.mimetype)) {
                cb(null, true);
            } else {
                cb(new BadRequestException('Only JPEG, PNG, WEBP, GIF images, PDF, and MP4/WEBM/MOV videos are allowed.'), false);
            }
        },
        limits: {
            fileSize: 25 * 1024 * 1024, // Reduced from 100MB to 25MB
            files: 1,
            fields: 20,
            fieldSize: 1 * 1024 * 1024,
            parts: 30,
        },
    }))
    async uploadAttachment(@UploadedFile() file: Express.Multer.File) {
        if (!file) {
            throw new BadRequestException('File is required.');
        }
        if (!hasValidUploadedSignature(file)) {
            await removeUploadedFile(file);
            throw new BadRequestException('File content does not match its declared type.');
        }
        return {
            url: uploadUrl(file),
            size: file.size,
            mimetype: file.mimetype,
        };
    }
}