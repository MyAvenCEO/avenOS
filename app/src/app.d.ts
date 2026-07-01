declare global {
	// Baked at build by vite.config.ts `define` — the full app version incl. the -next.N build
	// suffix. Must live inside `declare global` because the trailing `export {}` makes this file a
	// module; a top-level `declare const` would be module-scoped and invisible to the rest of the app.
	const __APP_VERSION__: string

	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {}
