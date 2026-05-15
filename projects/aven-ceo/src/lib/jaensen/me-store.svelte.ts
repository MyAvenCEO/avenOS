import {
	getActor,
	getIntent,
	getIntentActivity,
	getIntentActors,
	getIntentEnvelopes,
	listContextItems,
	listIntents,
	postMessage
} from './api'
import type {
	ActorDetailDto,
	ActorDetailTab,
	ContextItemDto,
	EnvelopeDto,
	EventRecord,
	IntentActorNode,
	IntentDetailDto,
	IntentSummaryDto
} from './types'

export function intentActorId(intentId: string): string {
	return `aven/intents/${intentId}`
}

export function selectionKey(intentId: string, actorId: string, tab: string): string {
	return `${intentId}:${actorId}:${tab}`
}

export class MeStore {
	intents = $state<IntentSummaryDto[]>([])
	intentDetails = $state<Record<string, IntentDetailDto>>({})
	selectedIntentId = $state<string | null>(null)
	selectedActorId = $state<string | null>(null)
	selectedTab = $state<ActorDetailTab>('log')
	error = $state<string | null>(null)
	loading = $state(false)
	actorsByIntent = $state<Record<string, IntentActorNode[]>>({})
	eventsBySelection = $state<Record<string, EventRecord[]>>({})
	envelopesBySelection = $state<Record<string, EnvelopeDto[]>>({})
	contextBySelection = $state<Record<string, ContextItemDto[]>>({})
	actorDetails = $state<Record<string, ActorDetailDto>>({})
	private booted = false

	get selectedIntent(): IntentDetailDto | null {
		return this.selectedIntentId ? this.intentDetails[this.selectedIntentId] ?? null : null
	}

	get selectedActors(): IntentActorNode[] {
		return this.selectedIntentId ? this.actorsByIntent[this.selectedIntentId] ?? [] : []
	}

	async init(): Promise<void> {
		if (this.booted) return
		this.booted = true
		this.loading = true
		this.error = null
		try {
			const intents = await listIntents()
			this.intents = intents
			for (const intent of intents) {
				this.intentDetails[intent.id] = await getIntent(intent.id)
			}
			if (!this.selectedIntentId && intents[0]) {
				await this.selectIntent(intents[0].id)
			}
		} catch (error) {
			this.error = error instanceof Error ? error.message : String(error)
		} finally {
			this.loading = false
		}
	}

	async selectIntent(intentId: string): Promise<void> {
		this.selectedIntentId = intentId
		this.selectedActorId = intentActorId(intentId)
		this.selectedTab = 'log'
		if (!this.intentDetails[intentId]) {
			this.intentDetails[intentId] = await getIntent(intentId)
		}
		if (!this.actorsByIntent[intentId]) {
			this.actorsByIntent[intentId] = await getIntentActors(intentId)
		}
		await this.ensureSelectedTabLoaded()
	}

	async refreshSelectedIntent(): Promise<void> {
		if (!this.selectedIntentId) return
		this.intentDetails[this.selectedIntentId] = await getIntent(this.selectedIntentId)
		this.actorsByIntent[this.selectedIntentId] = await getIntentActors(this.selectedIntentId)
		const actorIds = new Set(this.actorsByIntent[this.selectedIntentId].map((actor) => actor.actorId))
		if (!this.selectedActorId || !actorIds.has(this.selectedActorId)) {
			this.selectedActorId = intentActorId(this.selectedIntentId)
		}
		await this.ensureSelectedTabLoaded(true)
	}

	async selectActor(actorId: string): Promise<void> {
		this.selectedActorId = actorId
		await this.ensureSelectedTabLoaded()
	}

	async selectTab(tab: ActorDetailTab): Promise<void> {
		this.selectedTab = tab
		await this.ensureSelectedTabLoaded()
	}

	async ensureSelectedTabLoaded(force = false): Promise<void> {
		if (!this.selectedIntentId || !this.selectedActorId) return
		const key = selectionKey(this.selectedIntentId, this.selectedActorId, this.selectedTab)
		if (!force) {
			if (this.selectedTab === 'log' && this.eventsBySelection[key]) return
			if (this.selectedTab === 'messages' && this.envelopesBySelection[key]) return
			if (this.selectedTab === 'context' && this.contextBySelection[key]) return
			if ((this.selectedTab === 'state' || this.selectedTab === 'config') && this.actorDetails[this.selectedActorId]) return
		}

		if (this.selectedTab === 'log') {
			this.eventsBySelection[key] = await getIntentActivity({
				intentId: this.selectedIntentId,
				actorId: this.selectedActorId
			})
			return
		}
		if (this.selectedTab === 'messages') {
			this.envelopesBySelection[key] = await getIntentEnvelopes({
				intentId: this.selectedIntentId,
				actorId: this.selectedActorId
			})
			return
		}
		if (this.selectedTab === 'context') {
			const isRoot = this.selectedActorId === intentActorId(this.selectedIntentId)
			this.contextBySelection[key] = await listContextItems(
				isRoot ? { intentId: this.selectedIntentId } : { intentId: this.selectedIntentId, actorId: this.selectedActorId }
			)
			return
		}
		this.actorDetails[this.selectedActorId] = await getActor(this.selectedActorId)
	}

	async sendMessage(
		text: string,
		options?: {
			intentIdHint?: string
			attachment?: { name?: string; contentType?: string; base64: string }
		}
	): Promise<void> {
		await postMessage({
			text,
			intentIdHint: options?.intentIdHint,
			attachments: options?.attachment ? [options.attachment] : []
		})
		await this.reload()
	}

	removeIntent(intentId: string): void {
		this.intents = this.intents.filter((intent) => intent.id !== intentId)
		const next = { ...this.intentDetails }
		delete next[intentId]
		this.intentDetails = next
		if (this.selectedIntentId === intentId) {
			const nextIntent = this.intents[0]?.id ?? null
			this.selectedIntentId = null
			this.selectedActorId = null
			if (nextIntent) void this.selectIntent(nextIntent)
		}
	}

	private async reload(): Promise<void> {
		this.booted = false
		await this.init()
		if (this.selectedIntentId) {
			await this.refreshSelectedIntent()
		}
	}
}