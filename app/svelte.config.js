import path from 'node:path'
import { fileURLToPath } from 'node:url'
import adapter from '@sveltejs/adapter-static'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		prerender: {
			// Dynamic app routes (e.g. /sparks/[sparkId]) are client-only; static shell uses fallback.
			handleUnseenRoutes: 'ignore',
		},
		adapter: adapter({ fallback: 'index.html', strict: false }),
		alias: {
			'@avenos/aven-city': path.resolve(__dirname, '../libs/aven-city/src/index.ts'),
			'@avenos/docs': path.resolve(__dirname, '../docs')
		}
	}
}

export default config
