import { afterEach, expect, test } from 'bun:test'
import { generateAuthSecret } from 'jazz-tools'
import {
	configureJazzMemoryStoreForTests,
	createOrGetArtifact,
	createOrUpdateDocumentNote,
	deriveChunksFromMarkdown,
	listMemoryLinksForPath,
	memoryIngestDocument,
	readMemoryNote,
	recordExtractionFailure,
	resetJazzMemoryStoreForTests,
	searchMemory,
	upsertChunks,
	writeMemoryNoteByPath
} from './jazz-memory-store'

let counter = 0

async function freshStore() {
	counter += 1
	await configureJazzMemoryStoreForTests({
		appId: `aven-ceo-memory-test-${counter}`,
		driver: { type: 'persistent', dbName: `aven-ceo-memory-test-${counter}` },
		env: 'test',
		userBranch: 'main',
		secret: generateAuthSecret()
	})
}

afterEach(async () => {
	await resetJazzMemoryStoreForTests()
})

test('create artifact once by sha256', async () => {
	await freshStore()
	const input = {
		sha256: 'abc123',
		originalName: 'ticket.pdf',
		mimeType: 'application/pdf',
		sizeBytes: 42,
		storageUri: 'attachment://ticket-1'
	}
	const first = await createOrGetArtifact(input)
	const second = await createOrGetArtifact({ ...input, sizeBytes: 99 })
	expect(first.id).toBe(second.id)
	expect(second.sizeBytes).toBe(99)
})

test('same PDF upload does not duplicate document note', async () => {
	await freshStore()
	const first = await memoryIngestDocument({
		artifact: {
			sha256: 'pdf-1',
			originalName: 'report.pdf',
			mimeType: 'application/pdf',
			sizeBytes: 10,
			storageUri: 'attachment://report'
		},
		extraction: {
			extractor: 'file-analyzer',
			summary: 'first summary',
			bodyMarkdown: '# Report\n\nfirst body',
			chunks: ['first body']
		}
	})
	const second = await memoryIngestDocument({
		artifact: {
			sha256: 'pdf-1',
			originalName: 'report.pdf',
			mimeType: 'application/pdf',
			sizeBytes: 10,
			storageUri: 'attachment://report'
		},
		extraction: {
			extractor: 'file-analyzer',
			summary: 'updated summary',
			bodyMarkdown: '# Report\n\nupdated body',
			chunks: ['updated body']
		}
	})
	expect(first.artifactId).toBe(second.artifactId)
	expect(first.noteId).toBe(second.noteId)
	const note = await readMemoryNote(second.noteId)
	expect(note.bodyMarkdown).toContain('updated body')
})

test('Markdown wikilinks produce memoryLinks rows', async () => {
	await freshStore()
	await writeMemoryNoteByPath('People/Daniel Janz.md', '# Daniel Janz\n\nPerson note', { type: 'memory_ui' })
	await writeMemoryNoteByPath(
		'Documents/Ticket.md',
		'# Ticket\n\nPassenger: [[People/Daniel Janz]]',
		{ type: 'memory_ui' }
	)
	const links = await listMemoryLinksForPath('Documents/Ticket.md')
	expect(links.outgoing).toEqual(['People/Daniel Janz.md'])
})

test('memory_search finds chunk text', async () => {
	await freshStore()
	const note = await createOrUpdateDocumentNote({
		kind: 'document',
		slug: 'Docs/Searchable',
		title: 'Searchable',
		bodyMarkdown: '# Searchable\n\nBerlin Südkreuz to München Hbf',
		archived: false
	})
	await upsertChunks(note.id, ['Berlin Südkreuz to München Hbf'])
	const result = await searchMemory('Südkreuz')
	expect(result.hits.some((hit) => hit.snippet.includes('Südkreuz'))).toBe(true)
})

test('memory_edit equivalent updates note and rebuilds chunks/links', async () => {
	await freshStore()
	await writeMemoryNoteByPath('People/Alice.md', '# Alice\n\nPerson', { type: 'memory_ui' })
	const note = await writeMemoryNoteByPath(
		'Notes/Trip.md',
		'# Trip\n\nMeet [[People/Alice]] in Berlin.',
		{ type: 'memory_ui' }
	)
	const updated = await writeMemoryNoteByPath(
		'Notes/Trip.md',
		note.bodyMarkdown.replace('Berlin', 'Munich'),
		{ type: 'memory_ui' }
	)
	const links = await listMemoryLinksForPath('Notes/Trip.md')
	const result = await searchMemory('Munich')
	expect(updated.bodyMarkdown).toContain('Munich')
	expect(links.outgoing).toEqual(['People/Alice.md'])
	expect(result.hits.some((hit) => hit.path === 'Notes/Trip.md')).toBe(true)
})

test('failed extraction creates extractionRuns row with status=failed', async () => {
	await freshStore()
	const run = await recordExtractionFailure({
		artifact: {
			sha256: 'fail-1',
			originalName: 'bad.pdf',
			mimeType: 'application/pdf',
			sizeBytes: 11,
			storageUri: 'attachment://bad'
		},
		extractor: 'file-analyzer',
		error: 'OCR failed'
	})
	expect(run.status).toBe('failed')
	expect(run.error).toBe('OCR failed')
})

test('file-analyzer style ingestion returns summary-compatible result', async () => {
	await freshStore()
	const result = await memoryIngestDocument({
		artifact: {
			sha256: 'summary-1',
			originalName: 'summary.pdf',
			mimeType: 'application/pdf',
			sizeBytes: 25,
			storageUri: 'attachment://summary'
		},
		extraction: {
			extractor: 'file-analyzer',
			summary: 'PDF attachment inspected and content extracted',
			bodyMarkdown: '# Summary\n\nExtracted body',
			chunks: deriveChunksFromMarkdown('# Summary\n\nExtracted body')
		}
	})
	expect(result.ok).toBe(true)
	expect(result.chunkCount).toBeGreaterThan(0)
})