import { Module } from '@nestjs/common';
import { DesignsModule } from '../designs/designs.module';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';

@Module({
  imports: [DesignsModule],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
