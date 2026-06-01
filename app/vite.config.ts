import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

// In a git worktree, `node_modules` is hoisted to the monorepo root (outside
// `repoRoot`), so Vite's default fs allow-list rejects SvelteKit's runtime.
// Resolve where deps actually live so this works from a worktree *or* the main
// checkout without hardcoding paths.
const require = createRequire(import.meta.url)
const workspaceRoot = path.resolve(require.resolve('vite/package.json'), '../../..')

export default defineConfig(({ mode }) => {
	const loaded = loadEnv(mode, repoRoot, '')
	for (const key of Object.keys(loaded)) {
		if (process.env[key] === undefined) process.env[key] = loaded[key]
	}

	const host = process.env.TAURI_DEV_HOST
	// dev:app2x runs two Vite servers — separate cache dirs avoid .vite-temp races on restart.
	const devInstance = (process.env.AVENOS_DEV_INSTANCE ?? 'A').toLowerCase()
	const cacheDir = path.join(repoRoot, 'node_modules', `.vite-dev-${devInstance}`)

	const crossOriginIsolationHeaders = {
		'Cross-Origin-Opener-Policy': 'same-origin',
		'Cross-Origin-Embedder-Policy': 'require-corp',
		'Cross-Origin-Resource-Policy': 'same-origin'
	}

	return {
		// App-local env only — repo-root `.env` is Tauri/P2P; loadEnv below still merges it at startup.
		envDir: __dirname,
		envPrefix: ['VITE_', 'PUBLIC_', 'TAURI_ENV_'],
		cacheDir,
		clearScreen: false,
		plugins: [tailwindcss(), sveltekit()],
		preview: {
			headers: crossOriginIsolationHeaders
		},
		server: {
			host: host || '127.0.0.1',
			port: 1420,
			strictPort: true,
			hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
			watch: {
				ignored: [
					'**/src-tauri/**',
					'**/build/**',
					'**/.svelte-kit/**',
					// Relay/Tauri secrets — changing ../.env must not restart Vite (race on shared .vite-temp).
					path.join(repoRoot, '.env'),
					path.join(repoRoot, '.env.*'),
				],
			},
			headers: crossOriginIsolationHeaders,
			fs: { allow: [repoRoot, workspaceRoot] },
		},
	}
})
