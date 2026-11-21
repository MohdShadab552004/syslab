import { Module } from '@nestjs/common';
import { DesignsModule } from '../designs/designs.module';
import { VersionsController } from './versions.controller';
import { VersionsService } from './versions.service';
import { VersionsRepository } from './versions.repository';

@Module({
  imports: [DesignsModule],
  controllers: [VersionsController],
  providers: [VersionsService, VersionsRepository],
})
export class VersionsModule {}
