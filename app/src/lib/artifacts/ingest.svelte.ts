import type { ExecutionEnvironment } from '@avenos/actors'
import { transportError } from '@avenos/chat-engine/transport-error'
import { turnPayload } from '@avenos/chat-engine/turn-payload'
import { invoke } from '@tauri-apps/api/core'
import { chatActor } from '$lib/actors/chat.actor.svelte'
import { discardHeldForEnvironmentSwitch } from '$lib/actors/hitl.svelte'
import { saveFeedbackAssessment } from '$lib/chat/feedback'
import { intents, type PersistentIntentDetail } from '$lib/intents/intents.svelte'
import {
	discoverIntentAttachments,
	discoverIntentSources,
	type ProjectionArtifact
} from '$lib/intents/persistent-artifact-projection'
import { persistentTurns } from '$lib/intents/persistent-turns'
import { shell } from '$lib/intents/talk.svelte'
import { resetStudioForEnvironment } from '$lib/skills/studio.svelte'
import {
	clientDocumentParallelism,
	clientDocumentProcessingStatus,
	clientDocumentSourceExecutionEnvironment,
	processClientDocument
} from './client-document-processing'
import { clientReconciliation } from './client-reconciliation'
import { customerWork } from './customer-work.svelte'
import { emailDocumentQueue } from './document-import-queue.svelte'
import type { FileImportContext } from './email-import'
import { isTerminalProcessing } from './processing'
import { quarantineUploads, resetUploadInbox } from './upload-inbox.svelte'

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

const conversationSaves = new Map<string, Promise<void>>()

async function saveConversationTurn(
	session: string,
	turn: import('$lib/chat/chat.svelte').Turn,
	revision: number
) {
	if (!turn.content || turn.persisted) return
	if (revision !== intents.environmentRevision)
		throw Error('The workspace changed before the conversation was saved.')
	await invoke('intent_append_contribution', {
		intentId: session,
		contribution: {
			id: turn.id,
			contributorKind: turn.role === 'user' ? 'human' : 'agent',
			kind: 'message',
			text: turn.content,
			payload: turnPayload(turn)
		}
	})
	if (revision !== intents.environmentRevision)
		throw Error('The workspace changed before the conversation was saved.')
	turn.persisted = true
	if (turn.role === 'assistant') chat.resumeFeedback()
}

/** Chat admission and persistence outlive the dashboard view that hosts the input. */
export function installConversationPersistence(ready: Promise<void>): void {
	chat.onFeedbackAssessment = (...args) =>
		saveFeedbackAssessment(
			args,
			args[3]
				? chat.thread(args[2].intentId).turns.find((t) => t.id === args[3]!.responseId)
				: undefined
		)
	chat.persistInput = async (session, user) => {
		const revision = intents.environmentRevision
		customerWork.conversations++
		try {
			await ready
			await saveConversationTurn(session, user, revision)
		} finally {
			customerWork.conversations--
		}
	}
	chat.prepareSession = async (prompt, session) => {
		const revision = intents.environmentRevision
		await ready
		if (revision !== intents.environmentRevision) throw Error('The workspace changed.')
		if (intents.items.find((intent) => intent.id === session)?.persistent) return session
		const id = crypto.randomUUID()
		await invoke('intent_create', {
			intent: {
				id,
				title: prompt.slice(0, 100),
				intentType: 'conversation',
				sourceLabel: 'Chat',
				routingSummary: prompt.slice(0, 200)
			}
		})
		if (revision !== intents.environmentRevision) throw Error('The workspace changed.')
		if (!(await refreshIntent(id)))
			throw Error(
				'The conversation was created but could not be loaded. Refresh before trying again.'
			)
		return id
	}
	chat.onExchange = (session, _user, assistant, inputs) => {
		if (!intents.items.find((intent) => intent.id === session)?.persistent) return
		const revision = intents.environmentRevision
		customerWork.conversations++
		const save = (conversationSaves.get(session) ?? Promise.resolve())
			.then(async () => {
				for (const turn of [...inputs, assistant]) {
					await saveConversationTurn(session, turn, revision)
				}
				await refreshIntent(session)
			})
			.catch((error) => {
				if (revision === intents.environmentRevision)
					chat.thread(session).failure = `Could not save this conversation: ${String(error)}`
			})
			.finally(() => {
				customerWork.conversations--
				if (conversationSaves.get(session) === save) conversationSaves.delete(session)
			})
		conversationSaves.set(session, save)
	}
}

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

const processingWatchers = new Set<string>()
let workspaceEpoch = 0

export function resetCustomerWorkspace(): void {
	resetUploadInbox()
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

function wait(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function basename(path: string): string {
	return path.split(/[\\/]/).at(-1) || 'Dropped file'
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
			for (const [intentId, members] of sources)
				for (const source of members)
					intents.registerDiscoveredSource(
						intentId,
						source.artifactId,
						source.title ?? source.artifactId
					)
			const attachments = await discoverIntentAttachments(
				page.artifacts,
				(artifactId) => invoke('artifact_get', { artifactId }),
				() => {
					incomplete = true
				}
			)
			if (revision !== intents.environmentRevision) return
			for (const attachment of attachments)
				intents.registerDiscoveredAttachment(
					attachment.intentId,
					attachment.artifactId,
					attachment.title
				)
			cursor = page.nextCursor
		} while (cursor)
		intents.setSourceInventoryComplete(!incomplete)
		return !incomplete
	} catch {
		if (revision === intents.environmentRevision) intents.setSourceInventoryComplete(false)
		return false
	}
}

/** Refresh immutable links after a completed Skill without rehydrating chat. */
export function refreshIntentArtifactLinks(): Promise<boolean | undefined> {
	return discoverSources(intents.environmentRevision)
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
		// Intent Service has no file projection. Restore immutable source links
		// before deciding which loaded documents need their runtime restored.
		await discoverSources(revision)

		for (const detail of details) {
			if (revision !== intents.environmentRevision) return
			if (!detail) continue
			const sources = new Map<string, { artifactId?: string; title?: string }>([
				...detail.artifacts
					.filter((artifact) => artifact.relation === 'source')
					.map((artifact) => [artifact.artifactId, artifact] as const),
				...(intents.items.find((intent) => intent.id === detail.id)?.artifacts ?? [])
					.filter(
						(artifact) =>
							artifact.typeKey === 'core.file' && !artifact.stageKey && artifact.artifactId
					)
					.map((artifact) => [artifact.artifactId!, artifact] as const)
			])
			for (const source of sources.values()) {
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
					chat.adoptArtifact(source.artifactId, source.title ?? detail.title)
					void processClientDocument(
						source.artifactId,
						source.title ?? detail.title,
						undefined,
						executionEnvironment,
						false
					)
					void watchArtifactProcessing(source.artifactId)
				}
			}
			if (
				detail.fileSkill &&
				detail.sourceArtifactId &&
				(!detail.fileSkill.presentation ||
					!isTerminalProcessing(detail.fileSkill.presentation.state))
			)
				void watchArtifactProcessing(detail.sourceArtifactId)
		}
		if (revision === intents.environmentRevision) {
			// Initial hydration must not navigate away from an inbox opened during upload.
			if (!shell.inboxOpen && !intents.selectedId && intents.items[0]) {
				intents.select(intents.items[0].id)
				chat.use(intents.items[0].id)
			}
			persistentIntentPages.cursor = page.nextCursor
			persistentIntentPages.hasMore = page.hasMore
		}
	} finally {
		if (revision === intents.environmentRevision) persistentIntentPages.loading = false
	}
}

export async function watchArtifactProcessing(artifactId: string): Promise<void> {
	const epoch = workspaceEpoch
	if (processingWatchers.has(artifactId)) return
	processingWatchers.add(artifactId)
	let delay = 300
	let consecutiveFailures = 0
	try {
		while (epoch === workspaceEpoch && chat.hasArtifact(artifactId)) {
			try {
				// Both device and server execution are observed by the document runtime.
				// Its admission is async: absence here means it has not restored yet,
				// not that the retired facade processing endpoint should be queried.
				const lookup = clientDocumentProcessingStatus(artifactId)
				if (epoch !== workspaceEpoch) return
				consecutiveFailures = 0
				if (!lookup || lookup.pending || !lookup.presentation) {
					chat.markArtifactProcessingPending(artifactId)
					delay = Math.min(2_000, Math.round(delay * 1.5))
				} else {
					chat.updateArtifactProcessing(artifactId, lookup.presentation)
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
	context?: Partial<FileImportContext>
): Promise<UploadedArtifactReceipt | null> {
	if (!context?.background) {
		shell.tab = 'intents'
		shell.detail = true
	}
	// A mailbox job waits for the shared upload slot instead of losing a file.
	while (context?.background && customerWork.uploads) await wait(100)

	if (customerWork.uploads) {
		chat.failure = 'Wait for the current file upload to finish.'
		return null
	}

	const uploadId = crypto.randomUUID()
	const publicationId = context?.publicationId ?? crypto.randomUUID()
	const intentId = context?.intentId ?? crypto.randomUUID()
	const observedAt = context?.observedAt ?? new Date().toISOString()
	const name = basename(path)
	const existingIntent = intents.items.some((intent) => intent.id === intentId)
	if (!existingIntent) intents.beginFileIntent(intentId, name, !context?.background)
	else if (!context?.background) intents.select(intentId)
	chat.beginArtifactUpload(uploadId, publicationId, name, intentId)
	customerWork.uploads = true
	let ownsUpload = true
	try {
		if (!existingIntent)
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
		customerWork.uploads = false
		ownsUpload = false
		const startProcessing = async () => {
			// A queued document remains bound to the account that uploaded it.
			if (
				context?.imapScope &&
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
			void watchArtifactProcessing(receipt.artifactId)
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
		if (ownsUpload) customerWork.uploads = false
	}
}

/** Untargeted batches stay quarantined; an explicit Intent target admits files serially. */
export async function ingestDroppedFiles(paths: string[], targetIntentId?: string): Promise<void> {
	if (!targetIntentId) {
		await quarantineUploads(paths)
		return
	}
	shell.tab = 'intents'
	shell.detail = true
	if (paths.length > 50) {
		chat.failure = 'Drop at most 50 regular files at a time.'
		return
	}
	// Capture the choice before upload begins. Changing the selector while this
	// run is active affects only a future upload.
	const environment = documentExecutionPreference.environment
	const epoch = workspaceEpoch
	const imapScope = await invoke<string>('imap_account_scope')
	for (const path of paths) {
		if (epoch !== workspaceEpoch) break
		await ingestFile(path, environment, { intentId: targetIntentId, imapScope })
	}
}

/** Promotion uses the ordinary processing lane, only after Store admission. */
export async function processAdmittedUpload(
	receipt: UploadedArtifactReceipt,
	environment: ExecutionEnvironment,
	imapScope: string
) {
	if ((await invoke<string>('imap_account_scope')) !== imapScope)
		throw Error('Open the original customer environment to process this upload.')
	// Promotion has no upload-progress entry. Register the committed source before
	// starting the watcher; the asynchronous Intent projection may not contain it yet.
	chat.adoptArtifact(receipt.artifactId, receipt.originalName, receipt.mediaType)
	intents.attachFileSource(receipt.intentId, receipt.artifactId, receipt.originalName)
	await refreshIntent(receipt.intentId)
	void watchArtifactProcessing(receipt.artifactId)
	emailDocumentQueue.setMaxParallelism(await clientDocumentParallelism().catch(() => 1))
	emailDocumentQueue.enqueue(receipt.artifactId, async () => {
		if ((await invoke<string>('imap_account_scope')) !== imapScope)
			throw Error('Open the original customer environment to process this upload.')
		await processClientDocument(
			receipt.artifactId,
			receipt.originalName,
			receipt.mediaType,
			environment
		)
	})
}
