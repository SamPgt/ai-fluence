import { defineConfig, loadEnv } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Le front appelle `/api/*`, proxyfié vers le backend Hono (cookies httpOnly
// sur la même origine). En SSR, les server functions appellent l'URL directe.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendUrl = env.VITE_BACKEND_URL || 'http://localhost:3470'

  return {
    resolve: { tsconfigPaths: true },
    server: {
      port: 3070,
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
    // Outil local : pas de preset de build (nitro) tant qu'on ne déploie pas.
    plugins: [tailwindcss(), tanstackStart(), viteReact()],
  }
})
