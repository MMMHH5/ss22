import { Module } from '@nestjs/common';
import { RubricsService } from './rubrics.service';
import { RubricsController } from './rubrics.controller';
import { GamificationModule } from '../gamification/gamification.module';
import { CoursesModule } from '../courses/courses.module';

@Module({
    imports: [GamificationModule, CoursesModule],
    controllers: [RubricsController],
    providers: [RubricsService],
    exports: [RubricsService],
})
export class RubricsModule {}