import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { VersionsService } from './versions.service';
import { CreateVersionDto } from './dto/create-version.dto';
import { CurrentUser, type AuthUser } from '../common/auth/current-user.decorator';

@Controller('designs/:designId/versions')
export class VersionsController {
  constructor(private readonly versions: VersionsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('designId') designId: string) {
    return this.versions.list(user.id, designId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Param('designId') designId: string, @Body() dto: CreateVersionDto) {
    return this.versions.create(user.id, designId, dto.name);
  }

  @Post(':versionId/restore')
  restore(@CurrentUser() user: AuthUser, @Param('designId') designId: string, @Param('versionId') versionId: string) {
    return this.versions.restore(user.id, designId, versionId);
  }
}
