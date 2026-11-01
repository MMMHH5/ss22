import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsBoolean,
    IsString,
    ValidateNested,
} from 'class-validator';

export class OpeningInstructorGrantDto {
    @IsString()
    instructorId!: string;

    @IsBoolean()
    canReadContent!: boolean;

    @IsBoolean()
    canManageTasks!: boolean;

    @IsBoolean()
    canGrade!: boolean;

    @IsBoolean()
    canManageSessions!: boolean;

    @IsBoolean()
    canManageAnnouncements!: boolean;

    @IsBoolean()
    canViewAnalytics!: boolean;
}

export class SetOpeningInstructorGrantsDto {
    @IsArray()
    @ArrayMaxSize(50)
    @ValidateNested({ each: true })
    @Type(() => OpeningInstructorGrantDto)
    instructors!: OpeningInstructorGrantDto[];
}
