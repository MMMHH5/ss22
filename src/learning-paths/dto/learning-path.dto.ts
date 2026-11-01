import { PartialType } from '@nestjs/mapped-types';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateLearningPathDto {
    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    titleAr!: string;

    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    titleEn!: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    descriptionAr?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    descriptionEn?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    coverImageUrl?: string;

    @ApiPropertyOptional({ type: [String] })
    @IsOptional()
    @IsArray()
    @ArrayUnique()
    @IsString({ each: true })
    courseIds?: string[];

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isPublished?: boolean;
}

export class UpdateLearningPathDto extends PartialType(CreateLearningPathDto) {}
