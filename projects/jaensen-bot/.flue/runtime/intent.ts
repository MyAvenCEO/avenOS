import type { IntentRecord } from '../storage/types.js'

export function createIntentRecord(title: string, summary: string, now: Date): IntentRecord {
	return {
		id: `intent-${slugify(title)}-${Math.random().toString(36).slice(2, 8)}`,
		title,
		summary,
		status: 'active',
		createdAt: now.toISOString(),
		updatedAt: now.toISOString(),
		events: [],
		context: {}
	}
}

export function appendIntentEvent(intent: IntentRecord, event: IntentRecord['events'][number]): void {
	intent.events = [...intent.events.slice(-49), event]
	intent.updatedAt = event.timestamp
}

function slugify(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'topic'
}