import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
	// Server-side code reads configuration from process.env everywhere (dev,
	// production, scripts, tests), so surface .env files there during dev too.
	for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), '')))
		process.env[key] ??= value
	return { plugins: [sveltekit()] }
})
