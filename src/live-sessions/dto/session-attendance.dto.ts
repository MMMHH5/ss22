import { Type } from 'class-transformer';
import {
    ArrayNotEmpty,
    IsArray,
    IsEnum,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    ValidateNested,
} from 'class-validator';
import { AttendanceStatus } from '@prisma/client';

export class SessionAttendanceEntryDto {
    @IsUUID()
    enrollmentId!: string;

    @IsEnum(AttendanceStatus)
    status!: AttendanceStatus;

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    note?: string;
}

export class SaveSessionAttendanceDto {
    @IsArray()
    @ArrayNotEmpty()
    @ValidateNested({ each: true })
    @Type(() => SessionAttendanceEntryDto)
    records!: SessionAttendanceEntryDto[];
}
