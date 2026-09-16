import type { ExecutionEnvironment } from '@avenos/actors'
import { invoke } from '@tauri-apps/api/core'
import { chatActor } from '$lib/actors/chat.actor.svelte'
import { discardHeldForEnvironmentSwitch } from '$lib/actors/hitl.svelte'
import { anonymousSpeakerFromPayload } from '$lib/chat/anonymous-speaker'
import { intents, type PersistentIntentDetail } from '$lib/intents/intents.svelte'
import {
	discoverIntentSources,
	type ProjectionArtifact
} from '$lib/intents/persistent-artifact-projection'
import { shell } from '$lib/intents/talk.svelte'
import { resetStudioForEnvironment } from '$lib/skills/studio.svelte'
import {
	clientDocumentParallelism,
	clientDocumentProcessingStatus,
	clientDocumentSourceExecutionEnvironment,
	processClientDocument
} from './client-document-processing'
import { clientReconciliation } from './client-reconciliation'
import { emailDocumentQueue } from './document-import-queue.svelte'
import type { FileImportContext } from './email-import'
import { type ArtifactProcessingLookup, isTerminalProcessing } from './processing'
import { transportError } from './transport-error'

/**
 * THE ONE DOOR EVERY FILE COMES THROUGH.
 *
 * A file becomes an intent, and the intent's skill flow is what turns it into
 * artifacts. There is no second way in: dropping a file on the window and
 * downloading an invoice from the billing pane both call `ingestFile()`, so
 * both get the same intent, the same processing watcher, the same lineage.
 *
 * They did not use to. The invoice was written straight into a local folder
 * and listed from a second, parallel "downloads" shelf that knew nothing about
 * intents, skills or provenance — two stores, one of which was a dead end. The
 * shelf is gone; this module is why nothing needs it.
 *
 * Everything here was lifted out of `dashboard/+page.svelte`, where it could
 * only ever be reached by the drop handler. Moving it to a module is what makes
 * "always through the flow" enforceable rather than a convention.
 */

const chat = chatActor.core

/** What `artifact_upload` hands back once the publication is committed. */
export interface UploadedArtifactReceipt {
	publicationId: string
	intentId: string
	intentDeclarationArtifactId: string
	artifactId: string
	originalName: string
	mediaType: string
	sha256: string
	length: number
	scopeSequence: number
	replayed: boolean
}

/** One upload at a time — the composer shows a single upload's progress. */
let uploadInFlight = false
const processingWatchers = new Set<string>()
let workspaceEpoch = 0

export function resetCustomerWorkspace(): void {
	workspaceEpoch++
	persistentIntentPages.cursor = null
	persistentIntentPages.loading = false
	persistentIntentPages.hasMore = false
	processingWatchers.clear()
	emailDocumentQueue.discardPending()
	discardHeldForEnvironmentSwitch()
	clientReconciliation.resetForEnvironment()
	resetStudioForEnvironment()
	chat.resetForEnvironment()
	intents.resetForEnvironment()
	shell.tab = 'intents'
	shell.detail = false
	shell.rightOpen = false
}

/** Default placement for the next process. Each upload freezes its own value. */
export const documentExecutionPreference = $state<{ environment: ExecutionEnvironment }>({
	environment: 'local'
})

export function ingestBusy(): boolean {
	return uploadInFlight
}

function wait(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function basename(path: string): string {
	return path.split(/[\\/]/).at(-1) || 'Dropped file'
}

function persistentTurns(detail: PersistentIntentDetail) {
	return detail.contributions.flatMap((entry) => {
		if ((entry.contributorKind !== 'human' && entry.contributorKind !== 'agent') || !entry.text)
			return []
		const anonymousSpeaker =
			entry.contributorKind === 'human' ? anonymousSpeakerFromPayload(entry.payload) : null
		return [
			{
				id: entry.id,
				role: entry.contributorKind === 'human' ? ('user' as const) : ('assistant' as const),
				content: entry.text,
				...(anonymousSpeaker ? { anonymousSpeaker } : {})
			}
		]
	})
}

export async function refreshIntent(intentId: string): Promise<PersistentIntentDetail | null> {
	const revision = intents.environmentRevision
	try {
		const detail = await invoke<PersistentIntentDetail>('intent_get', { intentId })
		if (revision !== intents.environmentRevision) return null
		intents.applyPersistent(detail)
		chat.hydrate(detail.id, persistentTurns(detail))
		// Bring the persisted source file back into the chat's in-memory
		// registry: the processing watcher loops on `hasArtifact`, and the
		// model's artifact manifest reads through the same map. Without this
		// a restart left the file invisible to both.
		const source = detail.artifacts.find((artifact) => artifact.relation === 'source')
		if (source) {
			chat.adoptArtifact(
				source.artifactId,
				detail.title,
				undefined,
				undefined,
				detail.fileSkill?.presentation
					? { ...detail.fileSkill.presentation, availability: 'available' }
					: undefined
			)
		}
		return detail
	} catch {
		// Projection follows the immutable publication asynchronously. The
		// provisional intent stays present while the processing watcher retries.
		return null
	}
}

/** Walk bounded immutable publication pages independently of recent chat hydration. */
async function discoverSources(revision: number) {
	let cursor: string | null = null
	let incomplete = false
	try {
		do {
			const page: { artifacts: ProjectionArtifact[]; nextCursor: string | null } = await invoke(
				'artifact_inventory_page',
				{ cursor }
			)
			if (revision !== intents.environmentRevision) return
			const sources = await discoverIntentSources(
				page.artifacts,
				(artifactId) =>
					invoke<{ payload?: Record<string, unknown> }>('artifact_get', { artifactId }),
				() => {
					incomplete = true
				}
			)
			if (revision !== intents.environmentRevision) return
			for (const [intentId, source] of sources)
				intents.registerDiscoveredSource(
					intentId,
					source.artifactId,
					source.title ?? source.artifactId
				)
			cursor = page.nextCursor
		} while (cursor)
		intents.setSourceInventoryComplete(!incomplete)
	} catch {
		if (revision === intents.environmentRevision) intents.setSourceInventoryComplete(false)
	}
}

export const persistentIntentPages = $state({
	cursor: null as string | null,
	loading: false,
	hasMore: false
})
export async function loadPersistentIntents(more = false): Promise<void> {
	if (persistentIntentPages.loading) return
	const revision = intents.environmentRevision
	persistentIntentPages.loading = true
	try {
		await intents.initializeSourceSearch().catch(() => {})
		if (revision !== intents.environmentRevision) return
		if (!more) intents.setSourceInventoryComplete(false)
		const page = await invoke<{
			intents: Array<{ id: string }>
			nextCursor: string | null
			hasMore: boolean
		}>('intent_search', {
			input: {
				limit: 20,
				...(more && persistentIntentPages.cursor ? { cursor: persistentIntentPages.cursor } : {})
			}
		})
		if (revision !== intents.environmentRevision) return
		const summaries = page.intents
		const details: Array<PersistentIntentDetail | null> = []
		// Avoid one concurrent network request per historical Intent at startup.
		for (let i = 0; i < summaries.length; i += 6) {
			if (revision !== intents.environmentRevision) return
			details.push(
				...(await Promise.all(summaries.slice(i, i + 6).map((intent) => refreshIntent(intent.id))))
			)
		}
		if (revision !== intents.environmentRevision) return
		if (details.some((detail) => !detail))
			throw Error('Some recent intents could not be loaded. Retry to finish this page.')
		if (!more) void discoverSources(revision)

		for (const detail of details) {
			if (revision !== intents.environmentRevision) return
			const source = detail
				? (detail.artifacts.find((artifact) => artifact.relation === 'source') ??
					intents.items
						.find((intent) => intent.id === detail.id)
						?.artifacts.find((artifact) => artifact.typeKey === 'core.file'))
				: undefined
			const executionEnvironment = source?.artifactId
				? await clientDocumentSourceExecutionEnvironment(source.artifactId)
				: null
			if (revision !== intents.environmentRevision) return
			if (
				detail &&
				source?.artifactId &&
				executionEnvironment &&
				(!detail.fileSkill?.presentation ||
					!isTerminalProcessing(detail.fileSkill.presentation.state))
			) {
				void processClientDocument(
					source.artifactId,
					detail.title,
					undefined,
					executionEnvironment,
					false
				)
				void watchArtifactProcessing(source.artifactId, detail.id)
				continue
			}
			if (
				detail?.fileSkill &&
				detail.sourceArtifactId &&
				(!detail.fileSkill.presentation ||
					!isTerminalProcessing(detail.fileSkill.presentation.state))
			) {
				void watchArtifactProcessing(detail.sourceArtifactId, detail.id)
			}
		}
		if (revision === intents.environmentRevision) {
			persistentIntentPages.cursor = page.nextCursor
			persistentIntentPages.hasMore = page.hasMore
		}
	} finally {
		if (revision === intents.environmentRevision) persistentIntentPages.loading = false
	}
}

export async function watchArtifactProcessing(
	artifactId: string,
	intentId?: string
): Promise<void> {
	const epoch = workspaceEpoch
	if (processingWatchers.has(artifactId)) return
	processingWatchers.add(artifactId)
	let delay = 300
	let consecutiveFailures = 0
	try {
		while (epoch === workspaceEpoch && chat.hasArtifact(artifactId)) {
			try {
				const local = clientDocumentProcessingStatus(artifactId)
				const lookup =
					local ??
					(await invoke<ArtifactProcessingLookup>('artifact_processing_status', {
						artifactId
					}))
				if (epoch !== workspaceEpoch) return
				consecutiveFailures = 0
				if (lookup.pending || !lookup.presentation) {
					chat.markArtifactProcessingPending(artifactId)
					delay = Math.min(2_000, Math.round(delay * 1.5))
				} else {
					chat.updateArtifactProcessing(artifactId, lookup.presentation)
					const owner =
						intentId ??
						intents.items.find((intent) =>
							intent.artifacts.some((artifact) => artifact.artifactId === artifactId)
						)?.id
					if (owner && !local) await refreshIntent(owner)
					if (isTerminalProcessing(lookup.presentation.state)) return
					delay = 1_500
				}
			} catch (error) {
				if (epoch !== workspaceEpoch) return
				const failure = transportError(error)
				consecutiveFailures += 1
				chat.markArtifactProcessingUnavailable(
					artifactId,
					error instanceof Error ? error.message : String(error)
				)
				if (
					failure.status === 404 ||
					((failure.status ?? 0) >= 400 && (failure.status ?? 0) < 500 && !failure.retryable)
				)
					return
				delay = Math.min(30_000, 1_000 * 2 ** Math.min(consecutiveFailures, 5))
			}
			await wait(delay)
		}
	} finally {
		if (epoch === workspaceEpoch) processingWatchers.delete(artifactId)
	}
}

/**
 * Take a file on disk into the store, as an intent.
 *
 * Brings the conversation forward first — whatever surface you were on, an
 * ingest is a thing you watch happen — then declares the intent, uploads, and
 * leaves a watcher running until the skill flow reaches a terminal state.
 *
 * Returns the receipt so a caller can follow the artifact it just created;
 * failures are reported through the chat and the intent. Background importers can
 * also request a thrown error to retain a per-file retry queue.
 */
export async function ingestFile(
	path: string,
	executionEnvironment: ExecutionEnvironment = documentExecutionPreference.environment,
	context?: FileImportContext
): Promise<UploadedArtifactReceipt | null> {
	if (!context?.background) {
		shell.tab = 'intents'
		shell.detail = true
	}
	// A mailbox job waits for the shared upload slot instead of losing a file.
	while (context?.background && uploadInFlight) await wait(100)

	if (uploadInFlight) {
		chat.failure = 'Wait for the current file upload to finish.'
		return null
	}

	const uploadId = crypto.randomUUID()
	const publicationId = context?.publicationId ?? crypto.randomUUID()
	const intentId = context?.intentId ?? crypto.randomUUID()
	const observedAt = context?.observedAt ?? new Date().toISOString()
	const name = basename(path)
	intents.beginFileIntent(intentId, name, !context?.background)
	chat.beginArtifactUpload(uploadId, publicationId, name, intentId)
	uploadInFlight = true
	let ownsUpload = true
	try {
		await invoke('intent_create', {
			expectedImapScope: context?.imapScope ?? null,
			intent: {
				id: intentId,
				title: name,
				intentType: 'file',
				sourceLabel: context?.sourceLabel ?? 'Upload · File',
				deadline: null,
				routingSummary: context?.routingSummary ?? `File upload: ${name}`
			}
		})
		const receipt = await invoke<UploadedArtifactReceipt>('artifact_upload', {
			expectedImapScope: context?.imapScope ?? null,
			uploadId,
			publicationId,
			intentId,
			observedAt,
			path,
			executionEnvironment
		})
		chat.commitArtifactUpload(uploadId, receipt)
		intents.attachFileSource(receipt.intentId, receipt.artifactId, receipt.originalName)
		await refreshIntent(receipt.intentId)
		uploadInFlight = false
		ownsUpload = false
		const startProcessing = async () => {
			// A queued document remains bound to the account that uploaded it.
			if (
				context?.background &&
				(await invoke<string>('imap_account_scope')) !== context.imapScope
			) {
				throw new Error(
					'Sign into the original Aven account to resume this document from the workspace.'
				)
			}
			const processing = processClientDocument(
				receipt.artifactId,
				receipt.originalName,
				receipt.mediaType,
				executionEnvironment
			)
			void watchArtifactProcessing(receipt.artifactId, receipt.intentId)
			await processing
		}
		if (context?.background) {
			emailDocumentQueue.setMaxParallelism(await clientDocumentParallelism().catch(() => 1))
			emailDocumentQueue.enqueue(receipt.artifactId, startProcessing)
		} else void startProcessing()

		return receipt
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		chat.failArtifactUpload(uploadId, message)
		intents.failFileIntent(intentId, message)
		await wait(1_000)
		void loadPersistentIntents().catch(() => {})
		if (context?.throwOnError) throw new Error(message)
		return null
	} finally {
		if (ownsUpload) uploadInFlight = false
	}
}

/** The window's drop handler: one regular file at a time, then the one door. */
export async function ingestDroppedFiles(paths: string[]): Promise<void> {
	shell.tab = 'intents'
	shell.detail = true
	if (paths.length !== 1) {
		chat.failure = 'Drop exactly one regular file at a time.'
		return
	}
	// Capture the choice before upload begins. Changing the selector while this
	// run is active affects only a future upload.
	await ingestFile(paths[0], documentExecutionPreference.environment)
}
