import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { jazzSvelteKit } from 'jazz-tools/dev/sveltekit'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger, defineConfig, loadEnv } from 'vite'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
/** Monorepo root (`.env` lives here when using `bun --env-file=../../.env`). */
const repoRoot = path.resolve(__dirname, '../..')

/** Previously: silence jazz-tools broken sourcemaps in Vite logs. Kept hook no-op without jazz plugin. */
function silenceJazzBrokenSourcemaps(msg: unknown): boolean {
	return (
		typeof msg === 'string' &&
		msg.includes('Sourcemap for') &&
		msg.includes('jazz-tools') &&
		msg.includes('missing source files')
	)
}

const logger = createLogger()
const origWarn = logger.warn.bind(logger)
const origWarnOnce = logger.warnOnce.bind(logger)
logger.warn = (msg, options) => {
	if (silenceJazzBrokenSourcemaps(msg)) return
	origWarn(msg, options)
}
logger.warnOnce = (msg, options) => {
	if (silenceJazzBrokenSourcemaps(msg)) return
	origWarnOnce(msg, options)
}

export default defineConfig(({ mode }) => {
	const loaded = loadEnv(mode, repoRoot, '')
	for (const key of Object.keys(loaded)) {
		if (process.env[key] === undefined) process.env[key] = loaded[key]
	}

	/*
	// Dev only: skip Jazz Cloud schema push — use embedded local sync (see `.env.example`).
	if (command === 'serve' && process.env.JAZZ_DEV_USE_LOCAL === '1') {
		delete process.env.PUBLIC_JAZZ_SERVER_URL
	}
	*/

	return {
		envDir: repoRoot,
		customLogger: logger,
		resolve: {
			alias: {
				'@avenos/jaensen-bot': path.resolve(__dirname, '../jaensen-bot/index.ts')
			}
		},
		ssr: {
			noExternal: ['@xyflow/svelte']
		},
		plugins: [
			jazzSvelteKit({
				adminSecret: process.env.JAZZ_ADMIN_SECRET,
				schemaDir: 'src/lib'
			}),
			tailwindcss(),
			sveltekit()
		]
	}
})
