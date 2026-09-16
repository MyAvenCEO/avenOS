import {
	Actor,
	type ExecutionEnvironment,
	type HandlerResult,
	type HeldPreview,
	type PlanRunnerClient
} from '@avenos/actors'
import type { ClientArtifactGateway } from '@avenos/artifact-store'
import {
	decideReconciliation,
	type ReconciliationGateway,
	type ReconciliationResult,
	type ReconciliationReview,
	reconcileInvoices,
	reconciliationRunCommand
} from '@avenos/document-ingest/reconciliation-flow'
import { invoke } from '@tauri-apps/api/core'
import { bus } from '$lib/actors/bus'
import { singleton } from '$lib/actors/singleton'

function gateway(publications: ClientArtifactGateway): ReconciliationGateway {
	return {
		publish: (run) => publications.publish(run),
		lookup: (publicationId) => publications.lookup?.(publicationId) ?? Promise.resolve(null),
		query: (query) => invoke('artifact_query', query),
		artifact: (artifactId) => invoke('artifact_get', { artifactId })
	}
}

const money = (minor: number | null, currency: string | null) =>
	minor === null ? 'Unknown amount' : `${(minor / 100).toFixed(2)} ${currency ?? ''}`
const ok = (value: unknown, wire: string): HandlerResult => ({
	record: JSON.stringify({ ok: true, result: value }),
	wire
})

/** Existing compare gate; this module contributes data and actions, never layout. */
function preview(review: ReconciliationReview): HeldPreview {
	return {
		kind: 'reconciliation',
		layout: 'compare',
		title: 'Use this invoice as supporting evidence for this booking?',
		sides: [
			{
				heading: `Invoice ${review.openItem.invoiceNumber}`,
				lines: [
					review.openItem.supplierName,
					money(review.openItem.grossMinor, review.openItem.currency),
					review.openItem.issueDate ?? 'Unknown invoice date'
				]
			},
			{
				heading: 'Account booking',
				lines: [
					review.transaction.counterpartyName ?? '',
					money(review.transaction.amountMinor, review.transaction.currency),
					review.transaction.bookingDate ?? 'Unknown booking date',
					review.transaction.description ?? '',
					...review.candidate.blockers
				]
			}
		]
	}
}

class ClientReconciliation {
	#gateway?: ReconciliationGateway
	#running?: Promise<ReconciliationResult>
	#execute?: (openItemArtifactId?: string) => Promise<ReconciliationResult>
	#reviews = new Map<string, ReconciliationReview>()
	#result?: ReconciliationResult
	#environmentEpoch = 0
	#active = 0
	#environmentTransition = false
	readonly actor: Actor

	constructor() {
		this.actor = new Actor(
			{
				id: 'reconciliation',
				authority: 'ceo.aven',
				namespace: 'bookkeeping',
				version: '2',
				name: 'Invoice reconciliation',
				description:
					'Find invoice-to-booking proposals and request human review. Relationships do not allocate money or initiate payments.',
				tags: ['reconciliation'],
				methods: [
					{
						name: 'reconciliation_candidates',
						description:
							'Find and rank invoice-to-booking proposals. Optionally inspect one open-item artifact.',
						parameters: {
							type: 'object',
							properties: { openItemArtifactId: { type: 'string' } },
							additionalProperties: false
						}
					},
					{
						name: 'reconciliation_review',
						description:
							'Show one stored candidate in the existing human comparison gate. Only a physical confirmation records an accepted relationship.',
						parameters: {
							type: 'object',
							properties: { candidateArtifactId: { type: 'string' } },
							required: ['candidateArtifactId'],
							additionalProperties: false
						}
					}
				]
			},
			{
				reconciliation_candidates: async (payload) => {
					if (!this.#execute) throw new Error('Import a document to initialize reconciliation.')
					if (this.#environmentTransition) throw new Error('The customer environment is changing.')
					const epoch = this.#environmentEpoch
					this.#active++
					let result: ReconciliationResult
					try {
						result = await this.#execute(
							typeof payload.openItemArtifactId === 'string'
								? payload.openItemArtifactId
								: undefined
						)
					} finally {
						this.#active--
					}
					if (epoch !== this.#environmentEpoch)
						throw new Error('The customer environment changed during reconciliation.')
					this.#remember(result)
					return ok(
						result,
						`${result.reviews.length} review proposals. No relationship was accepted automatically.`
					)
				},
				reconciliation_review: (payload) => {
					const review = this.#reviews.get(String(payload.candidateArtifactId))
					if (!review)
						throw new Error('Load current reconciliation candidates before requesting review.')
					this.#hold(review)
					return ok(
						{ candidateArtifactId: review.candidateArtifactId, confirmation: 'required' },
						'Review is waiting for a physical confirmation or rejection.'
					)
				}
			}
		)
		bus.register(this.actor)
	}

	resetForEnvironment(): void {
		this.#environmentEpoch++
		this.#gateway = undefined
		this.#execute = undefined
		this.#running = undefined
		this.#reviews.clear()
		this.#result = undefined
	}

	suspendForEnvironmentSwitch(): boolean {
		if (this.#active > 0) return false
		this.#environmentTransition = true
		return true
	}

	resumeAfterEnvironmentSwitch(): void {
		this.#environmentTransition = false
	}

	configure(
		publications: ClientArtifactGateway,
		placement: ExecutionEnvironment,
		runner: PlanRunnerClient
	): (openItemArtifactId?: string) => Promise<ReconciliationResult> {
		this.#gateway = gateway(publications)
		const selectedGateway = this.#gateway
		const execute = (openItemArtifactId?: string) =>
			placement === 'local'
				? reconcileInvoices(selectedGateway, openItemArtifactId ? { openItemArtifactId } : {})
				: remoteReconciliation(runner, openItemArtifactId)
		this.#execute = execute
		return execute
	}

	async start(
		publications: ClientArtifactGateway,
		placement: ExecutionEnvironment,
		runner: PlanRunnerClient
	): Promise<ReconciliationResult> {
		if (this.#environmentTransition) throw new Error('The customer environment is changing.')
		const epoch = this.#environmentEpoch
		const execute = this.configure(publications, placement, runner)
		// An import arriving during another reconciliation must observe the newer
		// snapshot afterwards, rather than silently reusing the older run's results.
		const pending = (this.#running ?? Promise.resolve())
			.catch(() => undefined)
			.then(() => execute())
		this.#running = pending
		this.#active++
		try {
			const result = await pending
			if (epoch !== this.#environmentEpoch)
				throw new Error('The customer environment changed during reconciliation.')
			this.#remember(result)
			const shown = new Set<string>()
			for (const review of result.reviews)
				if (bus.onHold && !shown.has(review.openItemArtifactId)) {
					shown.add(review.openItemArtifactId)
					this.#hold(review)
				}
			return result
		} finally {
			this.#active--
			if (this.#running === pending) this.#running = undefined
		}
	}

	#remember(result: ReconciliationResult) {
		this.#result = result
		for (const review of result.reviews) this.#reviews.set(review.candidateArtifactId, review)
	}

	#hold(review: ReconciliationReview) {
		const epoch = this.#environmentEpoch
		const selectedGateway = this.#gateway
		if (!selectedGateway) throw new Error('Reconciliation is unavailable.')
		bus.holdAction(
			{
				id: `reconciliation:${review.openItemArtifactId}:${review.transactionArtifactId}`,
				actor: 'reconciliation',
				method: 'reconciliation_review',
				label: 'Confirm invoice-to-booking relationship',
				detail: JSON.stringify({
					candidateArtifactId: review.candidateArtifactId,
					relation: 'supports-booking'
				}),
				preview: preview(review)
			},
			{
				confirm: async () => {
					if (epoch !== this.#environmentEpoch)
						throw new Error('The customer environment changed before review.')
					return ok(
						{ artifactId: await decideReconciliation(selectedGateway, review, 'accepted') },
						'Invoice-to-booking relationship recorded. No money was allocated or transferred.'
					)
				},
				reject: async () => {
					if (epoch !== this.#environmentEpoch)
						throw new Error('The customer environment changed before review.')
					await decideReconciliation(selectedGateway, review, 'rejected')
					const next = this.#result?.reviews.find(
						(item) =>
							item.openItemArtifactId === review.openItemArtifactId &&
							item.candidate.rank > review.candidate.rank
					)
					if (next) this.#hold(next)
				}
			}
		)
	}
}

async function remoteReconciliation(
	runner: PlanRunnerClient,
	openItemArtifactId?: string
): Promise<ReconciliationResult> {
	const handle = await runner.start(reconciliationRunCommand(openItemArtifactId))
	const deadline = Date.now() + 15 * 60_000
	while (Date.now() < deadline) {
		const run = await runner.status(handle.runId)
		if (!run) throw new Error('The remote reconciliation run is unavailable.')
		if (run.state === 'succeeded') {
			const output = run.checkpoints.at(-1)?.output
			if (output?.kind !== 'reconciliation-review' || !output.result)
				throw new Error('The remote runner returned no reconciliation result.')
			return output.result as ReconciliationResult
		}
		if (run.state === 'failed' || run.state === 'cancelled')
			throw new Error(run.failure?.message ?? `Remote reconciliation ${run.state}.`)
		await new Promise((resolve) => setTimeout(resolve, 250))
	}
	throw new Error('Remote reconciliation is still pending. Check its run before retrying.')
}

export const clientReconciliation = singleton(
	'aven.client-reconciliation',
	() => new ClientReconciliation()
)
