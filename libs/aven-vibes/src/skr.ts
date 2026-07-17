// board 0069 — DATEV SKR04 chart of accounts (1598 accounts), pure JSON re-export so the betterauth
// server can load it for the booking step without the renderer. Source: app/static/skills/bookkeeping
// /konten.json (same data the avenSKILLS/bookkeeping view shows).

import skr04 from './skr04.json'

export type SkrAccount = { konto: string; funktion: string; bezeichnung: string }

export const SKR04_ACCOUNTS = skr04 as unknown as SkrAccount[]

const BY_KONTO: Map<string, SkrAccount> = new Map(SKR04_ACCOUNTS.map((a) => [a.konto, a]))

/** Look up an account by its 4-digit konto (leading zeros preserved), or undefined. */
export function getAccount(konto: string): SkrAccount | undefined {
	return BY_KONTO.get(String(konto).trim())
}

/** Is this a real SKR04 account number? */
export function isValidKonto(konto: unknown): konto is string {
	return typeof konto === 'string' && BY_KONTO.has(konto.trim())
}

/** The official Bezeichnung for a konto, or '' if unknown. */
export function bezeichnungFor(konto: unknown): string {
	return (typeof konto === 'string' && BY_KONTO.get(konto.trim())?.bezeichnung) || ''
}

/** Compact "konto  bezeichnung" text of the FULL chart for the booking LLM context. board 0069. */
export function skrForPrompt(): string {
	return SKR04_ACCOUNTS.map((a) => `${a.konto}\t${a.bezeichnung}`).join('\n')
}
