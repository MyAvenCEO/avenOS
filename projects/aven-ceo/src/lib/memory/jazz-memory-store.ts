import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createDb, type Db, type DbConfig, type WriteHandle, type WriteResult } from 'jazz-tools'
import { app } from '../schema'
import { bodyAfterFrontmatter, parseMarkdownFrontmatter } from './frontmatter'
import { appendMemoryProvenance } from './memory-provenance'
import { ensureSeedRuntimeSynced } from '../seed/seed-service'
import {
	forEachWikilinkPath,
	isTalkTurnWikilinkPath,
	normalizeWikilinkPath,
	resolveWikilinkToVaultPath
} from './wikilink-parse'

type MemoryArtifactRow = typeof app.memoryArtifacts._rowType
type MemoryNoteRow = typeof app.memoryNotes._rowType
type MemoryLinkRow = typeof app.memoryLinks._rowType
type ExtractionRunRow = typeof app.extractionRuns._rowType

export type ArtifactInput = {
	sha256: string
	originalName: string
	mimeType: string
	sizeBytes: number
	storageUri: string
}

export type DocumentNoteInput = {
	kind: string
	slug: string
	title: string
	bodyMarkdown: string
	sourceArtifactId?: string | null
	archived?: boolean
}

export type MemoryChunkInput = string[]

export type MemorySearchHit = {
	kind: 'note' | 'chunk'
	noteId: string
	path: string
	line: number
	snippet: string
	title: string
}

export type MemorySearchResult = {
	hits: MemorySearchHit[]
}

export type MemoryIngestInput = {
	artifact: ArtifactInput
	extraction: {
		extractor: string
		summary: string
		bodyMarkdown: string
		chunks: string[]
	}
}

export type MemoryIngestResult = {
	ok: true
	artifactId: string
	noteId: string
	chunkCount: number
}

type StoreConfig = {
	appId: string
	serverUrl?: string
	adminSecret?: string
	secret?: string
	env?: string
	userBranch?: string
	driver?: DbConfig['driver']
	dbName?: string
}

let dbPromise: Promise<Db> | null = null
let storeConfigOverride: StoreConfig | null = null

const SECRET_PATTERN =
	/(-----BEGIN [A-Z ]+PRIVATE KEY-----|seed phrase|mnemonic phrase|api[_-]?key|access[_-]?token|secret[_-]?key)/i

function bufferToBase64Url(buf: Buffer): string {
	return buf
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '')
}

function tryDecodeBase64UrlToBuffer(s: string): Buffer | null {
	const normalized = s.trim()
	if (!normalized) return null
	const b64 = normalized.replace(/-/g, '+').replace(/_/g, '/')
	const pad = (4 - (b64.length % 4)) % 4
	try {
		return Buffer.from(b64 + '='.repeat(pad), 'base64')
	} catch {
		return null
	}
}

/**
 * Jazz `createDb({ secret })` requires a **base64url** string that decodes to **32 bytes**
 * (same as `generateAuthSecret()`). Raw `.env` values are often human-readable; normalize
 * so vault APIs do not throw `seed must be exactly 32 bytes`.
 */
export function normalizeJazzBackendSecretFromEnv(raw: string | undefined): string | undefined {
	const trimmed = typeof raw === 'string' ? raw.trim() : ''
	if (!trimmed) return undefined

	const fromB64 = tryDecodeBase64UrlToBuffer(trimmed)
	if (fromB64 && fromB64.length === 32) return trimmed

	if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
		return bufferToBase64Url(Buffer.from(trimmed, 'hex'))
	}

	const utf8 = Buffer.from(trimmed, 'utf8')
	if (utf8.length === 32) return bufferToBase64Url(utf8)

	const derived = createHash('sha256').update(trimmed, 'utf8').digest()
	return bufferToBase64Url(derived)
}

function defaultStoreConfig(): StoreConfig {
	const appId = String(process.env.PUBLIC_JAZZ_APP_ID ?? '').trim()
	if (!appId) {
		throw new Error('Missing PUBLIC_JAZZ_APP_ID for Jazz memory store.')
	}
	return {
		appId,
		serverUrl: String(process.env.PUBLIC_JAZZ_SERVER_URL ?? '').trim() || undefined,
		adminSecret: String(process.env.JAZZ_ADMIN_SECRET ?? '').trim() || undefined,
		secret: normalizeJazzBackendSecretFromEnv(process.env.BACKEND_SECRET),
		env: process.env.NODE_ENV === 'production' ? 'prod' : 'dev',
		userBranch: 'main',
		driver: { type: 'persistent', dbName: 'aven-ceo-memory' },
		dbName: 'aven-ceo-memory'
	}
}

function effectiveStoreConfig(): StoreConfig {
	return storeConfigOverride ?? defaultStoreConfig()
}

async function getDb(): Promise<Db> {
	if (!dbPromise) {
		const config = effectiveStoreConfig()
		dbPromise = createDb({
			appId: config.appId,
			serverUrl: config.serverUrl,
			adminSecret: config.adminSecret,
			secret: config.secret,
			env: config.env,
			userBranch: config.userBranch,
			driver: config.driver,
			dbName: config.dbName
		})
	}
	try {
		return await dbPromise
	} catch (err) {
		dbPromise = null
		throw err
	}
}

export async function configureJazzMemoryStoreForTests(config: StoreConfig): Promise<void> {
	storeConfigOverride = config
	if (dbPromise) {
		const db = await dbPromise
		await db.shutdown()
	}
	dbPromise = null
}

export async function resetJazzMemoryStoreForTests(): Promise<void> {
	storeConfigOverride = null
	if (dbPromise) {
		const db = await dbPromise
		await db.shutdown()
	}
	dbPromise = null
}

function ensureNoSecrets(text: string): void {
	if (SECRET_PATTERN.test(text)) {
		throw new Error('Refusing to store likely secrets in memory.')
	}
}

function notePathFromSlug(slug: string): string {
	const trimmed = slug.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.md$/i, '')
	return `${trimmed}.md`
}

function slugFromNotePath(notePath: string): string {
	return notePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.md$/i, '')
}

function titleFromMarkdown(markdown: string, fallback: string): string {
	const body = bodyAfterFrontmatter(markdown)
	const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim()
	return heading || fallback
}

function hashText(text: string): string {
	return createHash('sha256').update(text).digest('hex')
}

function projectionRoot(): string {
	ensureSeedRuntimeSynced()
	return path.join(process.cwd(), '.data', 'knowledge')
}

function ensureProjectionRoot(): string {
	const root = projectionRoot()
	if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true })
	return root
}

async function waitForLocal<T>(result: WriteHandle<T> | WriteResult<T>): Promise<T> {
	return result.wait({ tier: 'local' })
}

async function allNotes(): Promise<MemoryNoteRow[]> {
	const db = await getDb()
	return (await db.all(app.memoryNotes.where({ archived: false }).orderBy('slug', 'asc'))) as MemoryNoteRow[]
}

async function allLinks(): Promise<MemoryLinkRow[]> {
	const db = await getDb()
	return (await db.all(app.memoryLinks.where({}).orderBy('createdAt', 'asc'))) as MemoryLinkRow[]
}

async function findArtifactBySha256(sha256: string): Promise<MemoryArtifactRow | null> {
	const db = await getDb()
	return db.one(app.memoryArtifacts.where({ sha256 }).limit(1))
}

async function findNoteBySourceArtifactId(sourceArtifactId: string): Promise<MemoryNoteRow | null> {
	const db = await getDb()
	return db.one(app.memoryNotes.where({ sourceArtifactId }).limit(1))
}

async function findNoteBySlug(slug: string): Promise<MemoryNoteRow | null> {
	const db = await getDb()
	return db.one(app.memoryNotes.where({ slug }).limit(1))
}

async function writeProjectionForNote(note: Pick<MemoryNoteRow, 'slug' | 'bodyMarkdown'>): Promise<void> {
	const root = ensureProjectionRoot()
	const rel = notePathFromSlug(note.slug)
	const full = path.join(root, ...rel.split('/'))
	fs.mkdirSync(path.dirname(full), { recursive: true })
	fs.writeFileSync(full, note.bodyMarkdown, 'utf8')
}

async function deleteProjectionForNote(slug: string): Promise<void> {
	const full = path.join(ensureProjectionRoot(), ...notePathFromSlug(slug).split('/'))
	if (fs.existsSync(full)) fs.unlinkSync(full)
}

export async function createOrGetArtifact(input: ArtifactInput): Promise<MemoryArtifactRow> {
	ensureNoSecrets(input.originalName)
	ensureNoSecrets(input.storageUri)
	const db = await getDb()
	const existing = await findArtifactBySha256(input.sha256)
	if (existing) {
		await waitForLocal(
			db.update(app.memoryArtifacts, existing.id, {
				originalName: input.originalName,
				mimeType: input.mimeType,
				sizeBytes: input.sizeBytes,
				storageUri: input.storageUri
			})
		)
		return (await findArtifactBySha256(input.sha256)) ?? existing
	}
	const createdAt = new Date().toISOString()
	const inserted = db.insert(app.memoryArtifacts, {
		sha256: input.sha256,
		originalName: input.originalName,
		mimeType: input.mimeType,
		sizeBytes: input.sizeBytes,
		storageUri: input.storageUri,
		createdAt
	})
	return (await waitForLocal(inserted)) as MemoryArtifactRow
}

export async function createOrUpdateDocumentNote(input: DocumentNoteInput): Promise<MemoryNoteRow> {
	ensureNoSecrets(input.bodyMarkdown)
	ensureNoSecrets(input.title)
	ensureNoSecrets(input.slug)
	const db = await getDb()
	const now = new Date().toISOString()
	const slug = slugFromNotePath(input.slug)
	const existing = input.sourceArtifactId
		? ((await findNoteBySourceArtifactId(input.sourceArtifactId)) ?? (await findNoteBySlug(slug)))
		: await findNoteBySlug(slug)
	if (existing) {
		await waitForLocal(
			db.update(app.memoryNotes, existing.id, {
				kind: input.kind,
				slug,
				title: input.title,
				bodyMarkdown: input.bodyMarkdown,
				sourceArtifactId: input.sourceArtifactId ?? null,
				updatedAt: now,
				archived: input.archived ?? false
			})
		)
		const updated = await findNoteBySlug(slug)
		if (!updated) throw new Error('Failed to reload updated note.')
		await writeProjectionForNote(updated)
		return updated
	}
	const inserted = db.insert(app.memoryNotes, {
		kind: input.kind,
		slug,
		title: input.title,
		bodyMarkdown: input.bodyMarkdown,
		sourceArtifactId: input.sourceArtifactId ?? null,
		createdAt: now,
		updatedAt: now,
		archived: input.archived ?? false
	})
	const note = (await waitForLocal(inserted)) as MemoryNoteRow
	await writeProjectionForNote(note)
	return note
}

export async function upsertChunks(noteId: string, chunks: MemoryChunkInput): Promise<void> {
	const db = await getDb()
	const note = await readMemoryNote(noteId)
	const existing = (await db.all(
		app.memoryChunks.where({ noteId }).orderBy('chunkIndex', 'asc')
	)) as Array<{ id: string }>
	for (const row of existing) {
		await waitForLocal(db.delete(app.memoryChunks, row.id))
	}
	const createdAt = new Date().toISOString()
	for (const [chunkIndex, text] of chunks.entries()) {
		await waitForLocal(
			db.insert(app.memoryChunks, {
				noteId,
				sourceArtifactId: note.sourceArtifactId ?? null,
				chunkIndex,
				text,
				contentHash: hashText(text),
				createdAt
			})
		)
	}
}

export async function rebuildLinksForNote(noteId: string): Promise<void> {
	const db = await getDb()
	const note = await readMemoryNote(noteId)
	const existing = (await db.all(app.memoryLinks.where({ sourceNoteId: noteId }))) as Array<{ id: string }>
	for (const row of existing) {
		await waitForLocal(db.delete(app.memoryLinks, row.id))
	}
	const notes = await allNotes()
	const allPaths = notes.map((item) => notePathFromSlug(item.slug))
	const byPath = new Map(notes.map((item) => [notePathFromSlug(item.slug), item]))
	const seen = new Set<string>()
	const createdAt = new Date().toISOString()
	const pendingWrites: Array<Promise<unknown>> = []
	forEachWikilinkPath(bodyAfterFrontmatter(note.bodyMarkdown), (raw) => {
		if (isTalkTurnWikilinkPath(raw)) return
		const resolved = resolveWikilinkToVaultPath(raw, allPaths)
		if (resolved.status !== 'resolved') return
		const target = byPath.get(resolved.vaultPath)
		if (!target || target.id === noteId) return
		const key = `${noteId}:${target.id}:${normalizeWikilinkPath(raw)}`
		if (seen.has(key)) return
		seen.add(key)
		pendingWrites.push(
			waitForLocal(
				db.insert(app.memoryLinks, {
					sourceNoteId: noteId,
					targetNoteId: target.id,
					label: raw.trim(),
					createdAt
				})
			)
		)
	})
	await Promise.all(pendingWrites)
}

export async function searchMemory(query: string, limit = 20): Promise<MemorySearchResult> {
	const q = query.trim().toLowerCase()
	if (!q) return { hits: [] }
	const db = await getDb()
	const [notes, chunks] = await Promise.all([
		allNotes(),
		db.all(app.memoryChunks.where({}).orderBy('chunkIndex', 'asc')) as Promise<
			Array<{ noteId: string; chunkIndex: number; text: string }>
		>
	])
	const notesById = new Map(notes.map((note) => [note.id, note]))
	const hits: MemorySearchHit[] = []
	for (const note of notes) {
		const path = notePathFromSlug(note.slug)
		if (path.toLowerCase().includes(q)) {
			hits.push({ kind: 'note', noteId: note.id, path, line: 0, snippet: `(filename) ${path}`, title: note.title })
		}
		const lines = note.bodyMarkdown.split(/\r?\n/)
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].toLowerCase().includes(q)) {
				hits.push({
					kind: 'note',
					noteId: note.id,
					path,
					line: i + 1,
					snippet: lines[i].trim().slice(0, 200),
					title: note.title
				})
			}
			if (hits.length >= limit) return { hits: hits.slice(0, limit) }
		}
	}
	for (const chunk of chunks) {
		const note = notesById.get(chunk.noteId)
		if (!note || !chunk.text.toLowerCase().includes(q)) continue
		hits.push({
			kind: 'chunk',
			noteId: note.id,
			path: notePathFromSlug(note.slug),
			line: chunk.chunkIndex + 1,
			snippet: chunk.text.slice(0, 200),
			title: note.title
		})
		if (hits.length >= limit) break
	}
	return { hits: hits.slice(0, limit) }
}

export async function readMemoryNote(noteId: string): Promise<MemoryNoteRow> {
	const db = await getDb()
	const note = await db.one(app.memoryNotes.where({ id: noteId }).limit(1))
	if (!note) throw new Error('Note not found.')
	return note
}

export async function listMemoryNotes(): Promise<Array<{ id: string; path: string; title: string }>> {
	const notes = await allNotes()
	return notes.map((note) => ({ id: note.id, path: notePathFromSlug(note.slug), title: note.title }))
}

export async function readMemoryNoteByPath(notePath: string): Promise<MemoryNoteRow> {
	const note = await findNoteBySlug(slugFromNotePath(notePath))
	if (!note || note.archived) throw new Error('Note not found.')
	return note
}

export async function writeMemoryNoteByPath(
	notePath: string,
	content: string,
	source: { type: 'talk'; messageTurn: number } | { type: 'memory_ui' }
): Promise<MemoryNoteRow> {
	const slug = slugFromNotePath(notePath)
	const parsed = parseMarkdownFrontmatter(content)
	const existing = await findNoteBySlug(slug)
	const merged = appendMemoryProvenance(content, source)
	const note = await createOrUpdateDocumentNote({
		kind: parsed.meta.kind?.trim() || existing?.kind || 'topic',
		slug,
		title: titleFromMarkdown(merged, existing?.title ?? path.posix.basename(slug)),
		bodyMarkdown: merged,
		sourceArtifactId: existing?.sourceArtifactId ?? null,
		archived: false
	})
	await upsertChunks(note.id, deriveChunksFromMarkdown(note.bodyMarkdown))
	await rebuildLinksForNote(note.id)
	await writeProjectionForNote(note)
	return note
}

export function deriveChunksFromMarkdown(markdown: string, maxChunkChars = 600): string[] {
	const lines = bodyAfterFrontmatter(markdown)
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
	if (!lines.length) return []
	const chunks: string[] = []
	let current = ''
	for (const line of lines) {
		const next = current ? `${current}\n${line}` : line
		if (next.length > maxChunkChars && current) {
			chunks.push(current)
			current = line
		} else {
			current = next
		}
	}
	if (current) chunks.push(current)
	return chunks
}

function slugFromArtifactName(originalName: string): string {
	return originalName.replace(/\.[^.]+$/, '').trim().replace(/\\/g, '/').replace(/\s+/g, ' ')
}

export async function createExtractionRun(input: {
	artifactId: string
	skillId: string
	status: string
	extractor: string
	summary?: string
	error?: string
}): Promise<ExtractionRunRow> {
	const db = await getDb()
	const now = new Date().toISOString()
	const inserted = db.insert(app.extractionRuns, {
		artifactId: input.artifactId,
		skillId: input.skillId,
		status: input.status,
		extractor: input.extractor,
		summary: input.summary ?? null,
		error: input.error ?? null,
		startedAt: now,
		completedAt: input.status === 'pending' ? null : now
	})
	return (await waitForLocal(inserted)) as ExtractionRunRow
}

export async function memoryIngestDocument(input: MemoryIngestInput): Promise<MemoryIngestResult> {
	const artifact = await createOrGetArtifact(input.artifact)
	await createExtractionRun({
		artifactId: artifact.id,
		skillId: 'file-analyzer',
		status: 'pending',
		extractor: input.extraction.extractor,
		summary: input.extraction.summary
	})
	const note = await createOrUpdateDocumentNote({
		kind: 'document',
		slug: slugFromArtifactName(input.artifact.originalName),
		title: titleFromMarkdown(input.extraction.bodyMarkdown, slugFromArtifactName(input.artifact.originalName)),
		bodyMarkdown: input.extraction.bodyMarkdown,
		sourceArtifactId: artifact.id,
		archived: false
	})
	const chunks = input.extraction.chunks.length
		? input.extraction.chunks
		: deriveChunksFromMarkdown(input.extraction.bodyMarkdown)
	await upsertChunks(note.id, chunks)
	await rebuildLinksForNote(note.id)
	await createExtractionRun({
		artifactId: artifact.id,
		skillId: 'file-analyzer',
		status: 'completed',
		extractor: input.extraction.extractor,
		summary: input.extraction.summary
	})
	return { ok: true, artifactId: artifact.id, noteId: note.id, chunkCount: chunks.length }
}

export async function recordExtractionFailure(input: {
	artifact: ArtifactInput
	extractor: string
	error: string
	skillId?: string
}): Promise<ExtractionRunRow> {
	const artifact = await createOrGetArtifact(input.artifact)
	return createExtractionRun({
		artifactId: artifact.id,
		skillId: input.skillId ?? 'file-analyzer',
		status: 'failed',
		extractor: input.extractor,
		error: input.error
	})
}

export async function listMemoryLinksForPath(notePath: string): Promise<{
	outgoing: string[]
	backlinks: string[]
	unresolved: string[]
}> {
	const current = await readMemoryNoteByPath(notePath)
	const [notes, links] = await Promise.all([allNotes(), allLinks()])
	const byId = new Map(notes.map((note) => [note.id, note]))
	const outgoing = links
		.filter((link) => link.sourceNoteId === current.id)
		.map((link) => byId.get(link.targetNoteId))
		.filter((note): note is MemoryNoteRow => Boolean(note))
		.map((note) => notePathFromSlug(note.slug))
		.sort((a, b) => a.localeCompare(b))
	const backlinks = links
		.filter((link) => link.targetNoteId === current.id)
		.map((link) => byId.get(link.sourceNoteId))
		.filter((note): note is MemoryNoteRow => Boolean(note))
		.map((note) => notePathFromSlug(note.slug))
		.sort((a, b) => a.localeCompare(b))
	const allPaths = notes.map((note) => notePathFromSlug(note.slug))
	const unresolved = new Set<string>()
	forEachWikilinkPath(bodyAfterFrontmatter(current.bodyMarkdown), (raw) => {
		if (isTalkTurnWikilinkPath(raw)) return
		const res = resolveWikilinkToVaultPath(raw, allPaths)
		if (res.status !== 'resolved') unresolved.add(res.attempted)
	})
	return { outgoing, backlinks, unresolved: [...unresolved].sort((a, b) => a.localeCompare(b)) }
}

export async function rebuildAllMemoryProjections(): Promise<void> {
	const notes = await allNotes()
	for (const note of notes) {
		if (note.archived) {
			await deleteProjectionForNote(note.slug)
			continue
		}
		await writeProjectionForNote(note)
	}
}