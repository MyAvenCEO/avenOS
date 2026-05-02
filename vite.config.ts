import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { jazzSvelteKit } from 'jazz-tools/dev/sveltekit'
import { createLogger, defineConfig } from 'vite'

const logger = createLogger()
const origWarn = logger.warn.bind(logger)
logger.warn = (msg, options) => {
	if (typeof msg === 'string' && msg.includes('Sourcemap for') && msg.includes('jazz-tools')) {
		return
	}
	origWarn(msg, options)
}

export default defineConfig({
	customLogger: logger,
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
