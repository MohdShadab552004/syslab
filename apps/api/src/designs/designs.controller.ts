import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { DesignsService } from './designs.service';
import { CreateDesignDto } from './dto/create-design.dto';
import { UpdateDesignDto } from './dto/update-design.dto';
import { UpdateShareDto } from './dto/share.dto';
import { ListDesignsQuery } from './dto/list-designs.query';
import { CurrentUser, type AuthUser } from '../common/auth/current-user.decorator';
import { Public } from '../common/auth/public.decorator';

@Controller()
export class DesignsController {
  constructor(private readonly designs: DesignsService) {}

  @Get('designs')
  list(@CurrentUser() user: AuthUser, @Query() q: ListDesignsQuery) {
    return this.designs.list(user.id, q.limit, q.cursor);
  }

  @Post('designs')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDesignDto) {
    return this.designs.create(user.id, dto);
  }

  @Get('designs/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.designs.get(user.id, id);
  }

  @Patch('designs/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateDesignDto) {
    return this.designs.update(user.id, id, dto);
  }

  @Post('designs/:id/duplicate')
  duplicate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.designs.duplicate(user.id, id);
  }

  @Patch('designs/:id/share')
  share(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateShareDto) {
    return this.designs.setShare(user.id, id, dto.enabled);
  }

  @Delete('designs/:id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.designs.remove(user.id, id);
  }

  @Public()
  @Get('public/designs/:token')
  shared(@Param('token') token: string) {
    return this.designs.getShared(token);
  }
}
