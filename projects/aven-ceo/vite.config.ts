import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { jazzSvelteKit } from 'jazz-tools/dev/sveltekit'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger, defineConfig } from 'vite'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** jazz-tools ships sourcemaps that reference unpublished paths; Vite logs those via warnOnce. */
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

export default defineConfig({
	customLogger: logger,
	resolve: {
		alias: {
			'@avenos/jaensen-bot': path.resolve(__dirname, '../jaensen-bot/index.ts')
		}
	},
	plugins: [
		// Must run before sveltekit so PUBLIC_JAZZ_* from the dev runtime are visible to SvelteKit.
		jazzSvelteKit({
			adminSecret: process.env.JAZZ_ADMIN_SECRET,
			schemaDir: 'src/lib'
		}),
		tailwindcss(),
		sveltekit()
	]
})
