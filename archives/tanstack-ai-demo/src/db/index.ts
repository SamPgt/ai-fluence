import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import postgres from 'postgres'
import * as schema from './schema'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is missing')
}

// Use Neon serverless for Cloudflare Workers, postgres.js for local/Docker
const isCloudflare = process.env.DEPLOY_TARGET === 'cloudflare'

export const db = isCloudflare
  ? drizzleNeon(neon(process.env.DATABASE_URL), { schema })
  : drizzlePostgres(postgres(process.env.DATABASE_URL), { schema })
