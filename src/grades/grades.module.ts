import { Module } from '@nestjs/common';
import { GradesService } from './grades.service';
import { GradesController } from './grades.controller';
import { CoursesModule } from '../courses/courses.module';

@Module({
    imports: [CoursesModule],
    controllers: [GradesController],
    providers: [GradesService],
})
export class GradesModule { }
