export interface AppConfig {
  port: number;
  corsOrigin: string[];
  databaseUrl: string;
  devUserEmail: string;
  /** public URL of the web app, used for "open this design" links */
  webUrl: string;
  /** optional shared secret for /api/mcp; when set, clients must send "Authorization: Bearer <key>" */
  mcpApiKey: string | null;
}

export default (): AppConfig => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  return {
    port: Number(process.env.PORT ?? 4000),
    corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(',').map((s) => s.trim()),
    databaseUrl,
    devUserEmail: process.env.DEV_USER_EMAIL ?? 'dev@syslab.local',
    webUrl: (process.env.WEB_URL ?? process.env.CORS_ORIGIN?.split(',')[0] ?? 'http://localhost:3000').trim().replace(/\/$/, ''),
    mcpApiKey: process.env.MCP_API_KEY?.trim() || null,
  };
};
