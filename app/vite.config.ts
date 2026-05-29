import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

export default defineConfig(({ mode }) => {
	const loaded = loadEnv(mode, repoRoot, '')
	for (const key of Object.keys(loaded)) {
		if (process.env[key] === undefined) process.env[key] = loaded[key]
	}

	const host = process.env.TAURI_DEV_HOST

	const crossOriginIsolationHeaders = {
		'Cross-Origin-Opener-Policy': 'same-origin',
		'Cross-Origin-Embedder-Policy': 'require-corp',
		'Cross-Origin-Resource-Policy': 'same-origin'
	}

	return {
		envDir: repoRoot,
		envPrefix: ['VITE_', 'PUBLIC_', 'TAURI_ENV_'],
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
				],
			},
			headers: crossOriginIsolationHeaders,
			fs: { allow: [repoRoot] },
		},
	}
})
