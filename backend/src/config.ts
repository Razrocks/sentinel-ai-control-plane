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
  /**
   * AES-256-GCM key, base64-encoded, 32 bytes after decode. Used to encrypt
   * integration credentials (GitHub PAT, Slack bot tokens, webhook secrets)
   * at rest. Generate with:
   *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   * Empty string disables integration writes (foundation can be installed
   * before the operator generates a key; integration save endpoints will
   * 503 until it's set).
   */
  encryptionKey: process.env.ENCRYPTION_KEY || '',
} as const
