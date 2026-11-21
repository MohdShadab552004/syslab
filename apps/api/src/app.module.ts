import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { DevAuthGuard } from './common/auth/dev-auth.guard';
import { DesignsModule } from './designs/designs.module';
import { VersionsModule } from './versions/versions.module';
import { McpModule } from './mcp/mcp.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], cache: true }),
    PrismaModule,
    UsersModule,
    DesignsModule,
    VersionsModule,
    McpModule,
  ],
  controllers: [HealthController],
  // Swap DevAuthGuard for a JWT guard when real auth lands; nothing else changes.
  providers: [{ provide: APP_GUARD, useClass: DevAuthGuard }],
})
export class AppModule {}
