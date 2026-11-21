import { All, Controller, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthUser } from '../common/auth/current-user.decorator';
import { McpService } from './mcp.service';

type McpRequest = Request & { user: AuthUser; auth?: { token: string; clientId: string; scopes: string[]; extra?: Record<string, unknown> } };

/**
 * POST /api/mcp — the Model Context Protocol endpoint LLM apps connect to.
 * Express has already parsed the JSON body, so it is handed over as `parsedBody`.
 */
@Controller('mcp')
export class McpController {
  constructor(private readonly mcp: McpService) {}

  @All()
  async handle(@Req() req: McpRequest, @Res() res: Response): Promise<void> {
    if (!this.mcp.isAuthorized(req.headers.authorization)) {
      res.status(401).setHeader('WWW-Authenticate', 'Bearer').json({ error: 'Missing or wrong MCP API key. Send "Authorization: Bearer <MCP_API_KEY>".' });
      return;
    }
    // DevAuthGuard already resolved the (dev) user; pass it to the tools as MCP authInfo
    req.auth = { token: 'dev', clientId: req.user.id, scopes: [], extra: { userId: req.user.id } };
    await this.mcp.handle(req, res, req.method === 'POST' ? req.body : undefined);
  }
}
