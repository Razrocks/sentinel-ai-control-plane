// .env wins over any pre-existing process env vars (common Windows quirk: an
// empty ANTHROPIC_API_KEY set at user-profile level otherwise shadows .env).
import { config as loadDotenv } from 'dotenv'
loadDotenv({ override: true })

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  host: process.env.HOST || '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL!,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  nodeEnv: process.env.NODE_ENV || 'development',
} as const
