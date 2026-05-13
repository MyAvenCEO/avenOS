// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

interface ImportMetaEnv {
	readonly PUBLIC_VIBE_SANDBOX_URL?: string
	/** @deprecated use PUBLIC_VIBE_SANDBOX_URL */
	readonly PUBLIC_MCP_SANDBOX_URL?: string
}

export {}
