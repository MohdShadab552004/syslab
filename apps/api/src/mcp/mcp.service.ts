import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler, type NodeMcpRequestHandler } from '@modelcontextprotocol/node';
import { DesignsService } from '../designs/designs.service';
import type { AppConfig } from '../config/configuration';
import { buildMcpServer } from './mcp.server';

/**
 * Owns the MCP HTTP handler. createMcpHandler serves the 2026-07-28 protocol (one stateless
 * POST per message) and, by default, 2025-era clients too. toNodeHandler adapts its
 * web-standard fetch() face to Express's (req, res).
 */
@Injectable()
export class McpService {
  private readonly log = new Logger('MCP');
  readonly handle: NodeMcpRequestHandler;

  constructor(private readonly designs: DesignsService, private readonly config: ConfigService<AppConfig, true>) {
    const webUrl = this.config.get('webUrl', { infer: true });
    const mcp = createMcpHandler(
      // a fresh server per request; the user comes from authInfo set by the controller
      (ctx) => buildMcpServer({ designs: this.designs, webUrl, userId: String(ctx.authInfo?.extra?.userId ?? '') }),
      { onerror: (e) => this.log.warn(e.message) },
    );
    this.handle = toNodeHandler(mcp, { onerror: (e) => this.log.error(e.message) });
  }

  /** True when no MCP key is configured, or the request carries the right one. */
  isAuthorized(authorization: string | undefined): boolean {
    const key = this.config.get('mcpApiKey', { infer: true });
    if (!key) return true;
    const given = Buffer.from(authorization ?? '');
    const want = Buffer.from(`Bearer ${key}`);
    return given.length === want.length && timingSafeEqual(given, want);
  }
}
