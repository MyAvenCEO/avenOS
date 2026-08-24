/**
 * Where the marketing website lives, per environment — so every other
 * surface (the id app, the desktop app) can deep-link into it without
 * hardcoding a host that changes between local, next and prod.
 */
export type WebsiteEnv = 'local' | 'next' | 'prod'

export const WEBSITE_ORIGINS: Record<WebsiteEnv, string> = {
	/** The website dev server (`bun run dev:website`, strict port). */
	local: 'http://localhost:1421',
	next: 'https://next.aven.ceo',
	/** The production site — DNS not live yet; the value is already the plan. */
	prod: 'https://aven.ceo'
}

/**
 * Which environment a BROWSER surface is running in, read off its own
 * hostname — localhost pairs with the local website, anything under
 * next.aven.ceo (id.next.aven.ceo included) with the next site, and
 * everything else with prod. Zero configuration, correct by construction.
 */
export function websiteEnvFromHostname(hostname: string): WebsiteEnv {
	const h = hostname.toLowerCase()
	if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost')) {
		return 'local'
	}
	if (h === 'next.aven.ceo' || h.endsWith('.next.aven.ceo')) return 'next'
	return 'prod'
}

export function websiteOrigin(env: WebsiteEnv): string {
	return WEBSITE_ORIGINS[env]
}
