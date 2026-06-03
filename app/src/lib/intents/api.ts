import { grooveRuntime } from '$lib/runtime/groove-ipc'

export type IntentAttachmentInput = {
	filename: string
	mediaRole?: string
	mimeType?: string
	bytesBase64: string
}

export type HumanCommunicationProjection = {
	communicationId: string
	kind: string
	title?: string
	body?: string
	open: boolean
	payload: unknown
}

export type ActivityProjection = {
	id: string
	atMs: number
	skillName: string
	text: string
	data?: unknown
}

export type IntentProjection = {
	id: string
	title: string
	summary: string
	resultMessage?: string
	body?: string
	status: 'working' | 'hitl' | 'success' | 'archived' | 'error'
	updatedAtMs: number
	lastWorkDurationMs?: number
	openCommunicationCount: number
	openCommunication?: HumanCommunicationProjection
	artifactRefs: unknown[]
	logs: ActivityProjection[]
}

export type IntentRuntimeSnapshot = {
	intents: Array<{
		id: string
		title: string
		summary: string
		resultMessage?: string
		status: 'working' | 'hitl' | 'success' | 'archived' | 'error'
		updatedAtMs: number
		lastWorkDurationMs?: number
		openCommunicationCount: number
	}>
}

async function fileToBase64(file: File): Promise<string> {
	const bytes = new Uint8Array(await file.arrayBuffer())
	return Buffer.from(bytes).toString('base64')
}

async function toAttachmentInputs(files: File[]): Promise<IntentAttachmentInput[]> {
	return Promise.all(
		files.map(async (file) => ({
			filename: file.name,
			mimeType: file.type || undefined,
			mediaRole: 'attachment',
			bytesBase64: await fileToBase64(file),
		})),
	)
}

export async function intentStatus(): Promise<{ ready: boolean }> {
	return grooveRuntime<{ ready: boolean }>('intentStatus', {})
}

export async function intentList(): Promise<IntentRuntimeSnapshot> {
	return grooveRuntime<IntentRuntimeSnapshot>('intentList', {})
}

export async function intentGet(intentId: string): Promise<IntentProjection | null> {
	return grooveRuntime<IntentProjection | null>('intentGet', { intentId })
}

export async function intentStart(message: string, files: File[]): Promise<IntentProjection | null> {
	const attachments = await toAttachmentInputs(files)
	const result = await grooveRuntime<{ type?: string; value?: { intentId?: string } }>('intentStart', {
		message,
		attachments,
	})
	const intentId = result?.type === 'ok' ? result.value?.intentId : undefined
	return typeof intentId === 'string' ? intentGet(intentId) : null
}

export async function intentRetrain(
	intentId: string,
	communicationId: string,
	feedback: string,
	files: File[],
): Promise<IntentProjection | null> {
	const attachments = await toAttachmentInputs(files)
	await grooveRuntime('intentRetrain', {
		intentId,
		communicationId,
		feedback,
		attachments,
	})
	return intentGet(intentId)
}