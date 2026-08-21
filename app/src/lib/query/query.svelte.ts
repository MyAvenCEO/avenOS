import { singleton } from '$lib/actors/singleton'

/**
 * The query surface's own state (0159) — open or not, what was asked, and
 * which intent is in view when it was asked.
 *
 * It replaces the old talk store, which had grown two jobs: a boolean for "the chat
 * is showing" and a scoping rule for which gates belong where. Those are one
 * thing here — the modal is the only answer surface, so its context IS the
 * scope.
 */
class QueryState {
	open = $state(false)
	/** What was typed or spoken; the sources see it verbatim. */
	text = $state('')
	/** The intent in view when the modal opened — sources may narrow to it. */
	intent = $state<string | null>(null)

	/** Open over whatever intent is in view. Re-opening keeps the last query. */
	show(intent: string | null = this.intent): void {
		this.intent = intent
		this.open = true
	}

	close(): void {
		this.open = false
	}

	toggle(intent: string | null = this.intent): void {
		if (this.open) this.close()
		else this.show(intent)
	}
}

export const query = singleton('aven.query', () => new QueryState())
