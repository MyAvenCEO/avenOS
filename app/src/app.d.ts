declare global {
	// Baked at build by vite.config.ts `define` — the full app version incl. the -next.N build suffix.
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
