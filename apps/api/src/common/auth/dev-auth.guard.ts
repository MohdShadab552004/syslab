import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { IS_PUBLIC } from './public.decorator';
import { UsersRepository } from '../../users/users.repository';
import type { AuthUser } from './current-user.decorator';
import type { AppConfig } from '../../config/configuration';

/**
 * Development stand-in for authentication: every request acts as one user.
 * The user row is resolved once and cached, so this costs nothing per request.
 */
@Injectable()
export class DevAuthGuard implements CanActivate {
  private cached: Promise<AuthUser> | null = null;

  constructor(
    private readonly reflector: Reflector,
    private readonly users: UsersRepository,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    this.cached ??= this.users.upsertByEmail(this.config.get('devUserEmail', { infer: true }), 'Dev User');
    ctx.switchToHttp().getRequest().user = await this.cached;
    return true;
  }
}
