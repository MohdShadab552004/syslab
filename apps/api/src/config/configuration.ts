export interface AppConfig {
  port: number;
  corsOrigin: string[];
  databaseUrl: string;
  devUserEmail: string;
}

export default (): AppConfig => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  return {
    port: Number(process.env.PORT ?? 4000),
    corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(',').map((s) => s.trim()),
    databaseUrl,
    devUserEmail: process.env.DEV_USER_EMAIL ?? 'dev@syslab.local',
  };
};
