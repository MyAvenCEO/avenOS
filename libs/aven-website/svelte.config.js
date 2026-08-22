import adapter from '@sveltejs/adapter-static'

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// Fully prerendered static site → GitHub Pages (deployed from release-next.yml on every
		// push to `next`, served at next.aven.ceo). Pages has no server: every route must be
		// prerenderable (see src/routes/+layout.ts) and every page lands as `<route>/index.html`.
		adapter: adapter({ pages: 'build', assets: 'build', strict: true })
	}
}

export default config
