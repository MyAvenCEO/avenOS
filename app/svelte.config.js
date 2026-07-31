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
		adapter: adapter({ fallback: 'index.html', strict: false }),
		// Source-aliased so the game compiles from libs/ rather than a build artifact
		// and edits there hot-reload. app.css `@source`s the same path, so Tailwind
		// still generates the HUD's utility classes.
		alias: {
			'@avenos/aven-city': path.resolve(__dirname, '../libs/aven-city/src/index.ts')
		}
	}
}

export default config
