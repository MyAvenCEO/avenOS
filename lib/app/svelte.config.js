import path from 'node:path'
import { fileURLToPath } from 'node:url'
import adapter from '@sveltejs/adapter-auto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: adapter(),
		alias: {
			'@avenos/vibe-app-sandbox': path.resolve(__dirname, '../../libs/vibe-app-sandbox/src/index.ts'),
			'@avenos/vibe-apps': path.resolve(__dirname, '../../libs/vibe-apps/src/registry.ts')
		}
	}
}

export default config
