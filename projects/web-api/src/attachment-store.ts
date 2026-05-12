import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { UserAttachment } from '@jaensen/conversation-actors'

export const DEFAULT_ATTACHMENT_ROOT = '.jaensen/uploads'
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_MESSAGE = 5
export const ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const ALLOWED_MIME_TYPES = new Set([
	'application/json',
	'application/octet-stream',
	'application/pdf',
	'image/jpeg',
	'image/png',
	'text/csv',
	'text/markdown',
	'text/plain'
])

export type AttachmentClientInput = {
	id?: string
	name?: string
	mimeType?: string
	contentType?: string
	base64?: string
	path?: string
}

type AttachmentRecord = UserAttachment & {
	storedAt: string
	sessionId: string
	kind: 'staged' | 'request'
	scopeId: string
	consumedAt?: string
}

export class AttachmentValidationError extends Error {}

export interface AttachmentStore {
	issueSessionId(): string
	materializeForMessage(input: {
		sessionId: string
		attachments: unknown
		messageScopeId: string
	}): Promise<{ attachmentScopeId: string; attachments: UserAttachment[] }>
	stageUploads(input: { sessionId: string; attachments: unknown }): Promise<UserAttachment[]>
	cleanupExpired(): Promise<void>
	rootDir: string
}

export function createAttachmentStore(input: {
	workspaceRoot: string
	attachmentRoot?: string
	maxAttachmentBytes?: number
	maxAttachmentsPerMessage?: number
	ttlMs?: number
}): AttachmentStore {
	const rootDir = resolveAttachmentRoot(input.workspaceRoot, input.attachmentRoot)
	const maxAttachmentBytes = input.maxAttachmentBytes ?? MAX_ATTACHMENT_BYTES
	const maxAttachmentsPerMessage = input.maxAttachmentsPerMessage ?? MAX_ATTACHMENTS_PER_MESSAGE
	const ttlMs = input.ttlMs ?? ATTACHMENT_TTL_MS

	return {
		rootDir,
		issueSessionId() {
			return randomUUID()
		},
		async materializeForMessage(args) {
			assertSessionId(args.sessionId)
			assertScopeId(args.messageScopeId)
			const normalized = normalizeAttachmentInputs(args.attachments)
			if (normalized.length > maxAttachmentsPerMessage) {
				throw new AttachmentValidationError(
					`Too many attachments. Maximum is ${maxAttachmentsPerMessage} per message.`
				)
			}

			const attachments: UserAttachment[] = []
			for (const attachment of normalized) {
				if (attachment.base64) {
					attachments.push(
						await writeAttachment({
							rootDir,
							kind: 'request',
							sessionId: args.sessionId,
							scopeId: args.messageScopeId,
							attachment,
							maxAttachmentBytes
						})
					)
					continue
				}

				if (!attachment.id) {
					throw new AttachmentValidationError('Attachments must include either base64 content or an attachment id.')
				}

				attachments.push(
					await adoptStagedAttachment({
						rootDir,
						sessionId: args.sessionId,
						stagedId: attachment.id,
						messageScopeId: args.messageScopeId
					})
				)
			}

			return {
				attachmentScopeId: args.messageScopeId,
				attachments
			}
		},
		async stageUploads(args) {
			assertSessionId(args.sessionId)
			const normalized = normalizeAttachmentInputs(args.attachments)
			if (normalized.length === 0) {
				throw new AttachmentValidationError('At least one attachment is required.')
			}
			if (normalized.length > maxAttachmentsPerMessage) {
				throw new AttachmentValidationError(
					`Too many attachments. Maximum is ${maxAttachmentsPerMessage} per message.`
				)
			}

			const scopeId = randomUUID()
			const attachments: UserAttachment[] = []
			for (const attachment of normalized) {
				if (!attachment.base64) {
					throw new AttachmentValidationError('Upload endpoint accepts uploaded bytes only.')
				}
				attachments.push(
					await writeAttachment({
						rootDir,
						kind: 'staged',
						sessionId: args.sessionId,
						scopeId,
						attachment,
						maxAttachmentBytes
					})
				)
			}
			return attachments
		},
		async cleanupExpired() {
			await cleanupRoot(path.join(rootDir, 'requests'), ttlMs)
			await cleanupRoot(path.join(rootDir, 'staged'), ttlMs)
		}
	}
}

export function resolveAttachmentRoot(workspaceRoot: string, attachmentRoot = process.env.JAENSEN_UPLOAD_DIR ?? DEFAULT_ATTACHMENT_ROOT): string {
	return path.isAbsolute(attachmentRoot) ? path.resolve(attachmentRoot) : path.resolve(workspaceRoot, attachmentRoot)
}

function normalizeAttachmentInputs(value: unknown): AttachmentClientInput[] {
	if (!Array.isArray(value)) {
		return []
	}

	return value.map((item) => parseAttachmentInput(item))
}

function parseAttachmentInput(value: unknown): AttachmentClientInput {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new AttachmentValidationError('Each attachment must be an object.')
	}
	const record = value as Record<string, unknown>
	if (typeof record.path === 'string' && record.path.trim().length > 0) {
		throw new AttachmentValidationError('Client-provided attachment paths are not allowed.')
	}

	const id = typeof record.id === 'string' && record.id.trim().length > 0 ? record.id.trim() : undefined
	const base64 = typeof record.base64 === 'string' && record.base64.trim().length > 0 ? record.base64.trim() : undefined
	if (!id && !base64) {
		throw new AttachmentValidationError('Attachment must include an id or base64 content.')
	}

	return {
		id,
		name: typeof record.name === 'string' ? record.name : undefined,
		mimeType: typeof record.mimeType === 'string'
			? record.mimeType
			: typeof record.contentType === 'string'
				? record.contentType
				: undefined,
		contentType: typeof record.contentType === 'string' ? record.contentType : undefined,
		base64
	}
}

async function writeAttachment(input: {
	rootDir: string
	kind: 'staged' | 'request'
	sessionId: string
	scopeId: string
	attachment: AttachmentClientInput
	maxAttachmentBytes: number
}): Promise<UserAttachment> {
	const bytes = decodeBase64Strict(input.attachment.base64 ?? '')
	if (bytes.byteLength > input.maxAttachmentBytes) {
		throw new AttachmentValidationError(
			`Attachment exceeds maximum size of ${input.maxAttachmentBytes} bytes.`
		)
	}

	const id = randomUUID()
	const name = sanitizeFileName(input.attachment.name ?? 'upload.bin')
	const mimeType = normalizeMimeType(input.attachment.mimeType ?? input.attachment.contentType)
	const sha256 = createHash('sha256').update(bytes).digest('hex')
	const record: AttachmentRecord = {
		id,
		name,
		mimeType,
		sizeBytes: bytes.byteLength,
		sha256,
		storedAt: new Date().toISOString(),
		sessionId: input.sessionId,
		kind: input.kind,
		scopeId: input.scopeId
	}

	const dir =
		input.kind === 'staged'
			? stagedAttachmentDir(input.rootDir, input.sessionId, input.scopeId, id)
			: requestAttachmentDir(input.rootDir, input.scopeId, id)
	await mkdir(dir, { recursive: true })
	await writeFile(path.join(dir, 'blob'), bytes)
	await writeFile(path.join(dir, 'meta.json'), JSON.stringify(record, null, 2), 'utf8')
	return toUserAttachment(record)
}

async function adoptStagedAttachment(input: {
	rootDir: string
	sessionId: string
	stagedId: string
	messageScopeId: string
}): Promise<UserAttachment> {
	assertSessionId(input.sessionId)
	assertScopeId(input.messageScopeId)
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.stagedId)) {
		throw new AttachmentValidationError(`Invalid attachment id: ${input.stagedId}`)
	}

	const stagedRoot = path.join(input.rootDir, 'staged', input.sessionId)
	const stagedDir = await findAttachmentDirById(stagedRoot, input.stagedId)
	if (!stagedDir) {
		throw new AttachmentValidationError(`Unknown or expired attachment id: ${input.stagedId}`)
	}

	const metaPath = path.join(stagedDir, 'meta.json')
	const blobPath = path.join(stagedDir, 'blob')
	const meta = await readAttachmentRecord(metaPath)
	if (meta.sessionId !== input.sessionId || meta.kind !== 'staged') {
		throw new AttachmentValidationError(`Attachment is not available for this session: ${input.stagedId}`)
	}
	if (meta.consumedAt) {
		throw new AttachmentValidationError(`Attachment has already been consumed: ${input.stagedId}`)
	}

	const requestRecord: AttachmentRecord = {
		...meta,
		kind: 'request',
		scopeId: input.messageScopeId,
		storedAt: new Date().toISOString()
	}
	delete requestRecord.consumedAt

	const requestDir = requestAttachmentDir(input.rootDir, input.messageScopeId, meta.id)
	await mkdir(requestDir, { recursive: true })
	await copyValidatedBlob(blobPath, path.join(requestDir, 'blob'), input.rootDir)
	await writeFile(path.join(requestDir, 'meta.json'), JSON.stringify(requestRecord, null, 2), 'utf8')

	meta.consumedAt = new Date().toISOString()
	await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8')

	return toUserAttachment(requestRecord)
}

async function copyValidatedBlob(sourcePath: string, destinationPath: string, rootDir: string): Promise<void> {
	const realRoot = await ensureRealPath(rootDir)
	const realSource = await ensureRealPath(sourcePath)
	if (!isWithinRoot(realSource, realRoot)) {
		throw new AttachmentValidationError('Attachment symlink escapes the allowed root.')
	}
	await cp(realSource, destinationPath)
}

async function readAttachmentRecord(metaPath: string): Promise<AttachmentRecord> {
	const raw = JSON.parse(await readFile(metaPath, 'utf8')) as Record<string, unknown>
	if (
		typeof raw.id !== 'string' ||
		typeof raw.name !== 'string' ||
		typeof raw.mimeType !== 'string' ||
		typeof raw.sizeBytes !== 'number' ||
		typeof raw.sha256 !== 'string' ||
		typeof raw.storedAt !== 'string' ||
		typeof raw.sessionId !== 'string' ||
		(raw.kind !== 'staged' && raw.kind !== 'request') ||
		typeof raw.scopeId !== 'string'
	) {
		throw new AttachmentValidationError('Attachment metadata is invalid.')
	}

	return raw as unknown as AttachmentRecord
}

async function findAttachmentDirById(sessionRoot: string, attachmentId: string): Promise<string | null> {
	let scopes: string[]
	try {
		scopes = await readdir(sessionRoot)
	} catch {
		return null
	}

	for (const scope of scopes) {
		const candidate = path.join(sessionRoot, scope, attachmentId)
		try {
			const info = await stat(candidate)
			if (info.isDirectory()) {
				return candidate
			}
		} catch {
			// keep searching
		}
	}

	return null
}

async function cleanupRoot(root: string, ttlMs: number): Promise<void> {
	let entries: string[]
	try {
		entries = await readdir(root)
	} catch {
		return
	}

	await Promise.all(
		entries.map(async (entry) => {
			const candidate = path.join(root, entry)
			try {
				const info = await stat(candidate)
				if (Date.now() - info.mtimeMs > ttlMs) {
					await rm(candidate, { recursive: true, force: true })
				}
			} catch {
				// ignore cleanup races
			}
		})
	)
}

function stagedAttachmentDir(rootDir: string, sessionId: string, scopeId: string, attachmentId: string): string {
	assertSessionId(sessionId)
	assertScopeId(scopeId)
	return path.join(rootDir, 'staged', sessionId, scopeId, attachmentId)
}

function requestAttachmentDir(rootDir: string, scopeId: string, attachmentId: string): string {
	assertScopeId(scopeId)
	return path.join(rootDir, 'requests', scopeId, attachmentId)
}

function assertSessionId(sessionId: string): void {
	if (!UUID_RE.test(sessionId)) {
		throw new AttachmentValidationError('Invalid session id.')
	}
}

function assertScopeId(scopeId: string): void {
	if (!UUID_RE.test(scopeId)) {
		throw new AttachmentValidationError('Invalid attachment scope id.')
	}
}

function toUserAttachment(record: AttachmentRecord): UserAttachment {
	return {
		id: record.id,
		name: record.name,
		mimeType: record.mimeType,
		sizeBytes: record.sizeBytes,
		sha256: record.sha256
	}
}

function sanitizeFileName(name: string): string {
	const baseName = path.basename(name).replace(/[\\/]+/g, '-')
	return baseName.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'upload.bin'
}

function normalizeMimeType(value: string | undefined): string {
	const normalized = typeof value === 'string' && value.trim().length > 0 ? value.trim().toLowerCase() : 'application/octet-stream'
	if (!ALLOWED_MIME_TYPES.has(normalized)) {
		throw new AttachmentValidationError(`Attachment MIME type is not allowed: ${normalized}`)
	}
	return normalized
}

function decodeBase64Strict(value: string): Buffer {
	const normalized = value.replace(/\s+/g, '')
	if (normalized.length === 0 || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
		throw new AttachmentValidationError('Invalid base64 attachment content.')
	}

	const bytes = Buffer.from(normalized, 'base64')
	if (bytes.length === 0 && normalized !== '') {
		throw new AttachmentValidationError('Invalid base64 attachment content.')
	}
	if (bytes.toString('base64') !== normalized) {
		throw new AttachmentValidationError('Invalid base64 attachment content.')
	}
	return bytes
}

async function ensureRealPath(targetPath: string): Promise<string> {
	return realpath(targetPath)
}

function isWithinRoot(candidate: string, root: string): boolean {
	const relative = path.relative(root, candidate)
	return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}