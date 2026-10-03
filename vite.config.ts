import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { createHandler, type UserStore } from './api/user.ts'

/**
 * In development, serve /api/user from this process with a JSON file standing in
 * for the database, so `npm run dev` works without any accounts. On Vercel the
 * same handler runs as a serverless function backed by Upstash Redis.
 */
function devApi(): Plugin {
  const file = '.data/users.json'
  const read = (): Record<string, unknown> => {
    try {
      return JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      return {}
    }
  }
  const store: UserStore = {
    get: async (key) => read()[key] ?? null,
    set: async (key, value) => {
      mkdirSync('.data', { recursive: true })
      writeFileSync(file, JSON.stringify({ ...read(), [key]: value }, null, 2))
    },
  }
  const handle = createHandler(() => store)

  return {
    name: 'lokation-dev-api',
    configureServer(server) {
      server.middlewares.use('/api/user', async (req, res) => {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk as Buffer)
        const response = await handle(
          new Request(`http://localhost${req.originalUrl ?? req.url}`, {
            method: req.method,
            headers: req.headers as Record<string, string>,
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
          }),
        )
        res.statusCode = response.status
        response.headers.forEach((value, key) => res.setHeader(key, value))
        res.end(await response.text())
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), devApi()],
})
