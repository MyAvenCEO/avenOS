import { createRequire } from 'node:module'
import path from 'node:path'
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

// App release/build version (e.g. "26.6.22-next.4") baked into the bundle so the Profile UI can show
// the FULL version + build suffix — Tauri's getVersion() drops the `-next.N` because Apple's
// CFBundleShortVersionString must be a plain X.Y.Z. board 0061.
const appVersion = (require('./package.json') as { version: string }).version

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
		// Bake the package.json version (incl. the -next.N build suffix) for the Profile "App version" row.
		define: { __APP_VERSION__: JSON.stringify(appVersion) },
		// App-local env only — repo-root `.env` is Tauri/P2P; loadEnv below still merges it at startup.
		envDir: __dirname,
		envPrefix: ['VITE_', 'PUBLIC_', 'TAURI_ENV_'],
		cacheDir,
		clearScreen: false,
		// Pre-bundle @storagesdk/core (+ its /adapter subpath), used by the in-app composer. Without
		// this, Vite discovers it at runtime (the composer view is behind auth/routing, not in the
		// startup crawl), then re-optimizes + reloads — a reload the Tauri WKWebView fails to ride on
		// a cold cache ("Importing a module script failed"). Eager pre-bundling avoids that churn.
		optimizeDeps: {
			include: ['@storagesdk/core', '@storagesdk/core/adapter']
		},
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
					path.join(repoRoot, '.env.*')
				]
			},
			headers: crossOriginIsolationHeaders,
			fs: { allow: [repoRoot, workspaceRoot] }
		}
	}
})
