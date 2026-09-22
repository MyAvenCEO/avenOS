import { expect, test } from 'bun:test'
import type { ArtifactProcessingPresentation } from '../src/lib/artifacts/processing'
import { readStoredSource } from '../src/lib/intents/stored-source'

test('bank CSV reads decode UTF-16 by filename even with a generic upload media type', async () => {
	const text = 'Booking date;Memo;Amount;Currency\r\n2026-09-01;Bürobedarf;-19,95;EUR\r\n'
	const bytes = Buffer.from(text, 'utf16le')
	const result = await readStoredSource(
		'csv',
		async <T>(command: string): Promise<T> =>
			(command === 'artifact_get'
				? {
						typeKey: 'core.file',
						payload: { originalName: 'bank.csv', declaredMediaType: 'application/octet-stream' },
						blob: { length: bytes.length }
					}
				: { base64: bytes.toString('base64') }) as T
	)
	expect(result.content).toBe(text)
	expect(result.complete).toBe(true)
})

test('generated Markdown and model payloads remain identified as generated evidence', async () => {
	for (const envelope of [
		{
			typeKey: 'ai.completion',
			payload: { text: 'Model knowledge', knowledgeMode: 'model-knowledge' }
		},
		{
			typeKey: 'core.file',
			payload: { sourceKind: 'actor-authored', declaredMediaType: 'text/markdown' },
			blob: { length: 4 }
		}
	]) {
		const source = await readStoredSource(
			'generated',
			async <T>(command: string): Promise<T> =>
				(command === 'artifact_get' ? envelope : { base64: btoa('text') }) as T
		)
		expect(source.generated).toBe(true)
	}
})

function fixture(state: ArtifactProcessingPresentation['state'] = 'succeeded', sizes = [4, 4]) {
	const reads: string[] = []
	const processing = {
		state,
		metadata: { pageCount: 2 },
		derivedArtifacts: [
			{
				artifactId: 'page',
				typeKey: 'docs.extracted-text',
				stageKey: 'native-text',
				typeVersion: 1
			},
			{
				artifactId: 'first',
				typeKey: 'docs.extracted-text',
				stageKey: 'assemble-document',
				typeVersion: 1
			},
			{
				artifactId: 'second',
				typeKey: 'docs.extracted-text',
				stageKey: 'assemble-document-2',
				typeVersion: 1
			},
			{
				artifactId: 'first',
				typeKey: 'docs.extracted-text',
				stageKey: 'assemble-document',
				typeVersion: 1
			}
		]
	}
	const invoke = async <T>(command: string, args: Record<string, unknown>): Promise<T> => {
		if (command === 'artifact_get')
			return args.artifactId === 'pdf'
				? ({
						typeKey: 'core.file',
						blob: { length: 100 },
						payload: { declaredMediaType: 'application/pdf' }
					} as T)
				: ({
						typeKey: 'docs.extracted-text',
						blob: { length: sizes[args.artifactId === 'first' ? 0 : 1] },
						payload: { complete: true, pageCount: 1 }
					} as T)
		if (command !== 'artifact_content_get') throw Error(`Unexpected command: ${command}`)
		reads.push(String(args.artifactId))
		return { base64: btoa(args.artifactId === 'first' ? 'one.' : 'two.') } as T
	}
	return { invoke, reads, processing }
}
test('reads every assembled chunk once, with exact source ranges', async () => {
	const f = fixture()
	expect(await readStoredSource('pdf', f.invoke, f.processing)).toEqual({
		content: 'one.\n\ntwo.',
		complete: true,
		chunks: [
			{ artifactId: 'first', start: 0, endExclusive: 4 },
			{ artifactId: 'second', start: 6, endExclusive: 10 }
		]
	})
	expect(f.reads).toEqual(['first', 'second'])
})
test('chunk success never overrides incomplete whole-document coverage', async () => {
	for (const state of ['needs_review', 'failed', 'succeeded', 'active'] as const) {
		const f = fixture(state)
		f.processing.metadata.pageCount = 3
		expect((await readStoredSource('pdf', f.invoke, f.processing)).complete).toBe(false)
	}
})
test('complete text is searchable independently of unresolved business review', async () => {
	for (const state of ['needs_review', 'failed', 'succeeded'] as const) {
		const f = fixture(state)
		expect((await readStoredSource('pdf', f.invoke, f.processing)).complete).toBe(true)
	}
	const active = fixture('active')
	expect((await readStoredSource('pdf', active.invoke, active.processing)).complete).toBe(false)
	const unknown = fixture()
	delete (unknown.processing.metadata as { pageCount?: number }).pageCount
	expect((await readStoredSource('pdf', unknown.invoke, unknown.processing)).complete).toBe(false)
})
test('read limit applies to the combined document, not separately to each chunk', async () => {
	const f = fixture('succeeded', [4, 1024 * 1024])
	await expect(readStoredSource('pdf', f.invoke, f.processing)).rejects.toThrow('1 MiB')
	expect(f.reads).toEqual(['first'])
})

test('missing runtime state is explicit and never calls the removed processing endpoint', async () => {
	const calls: string[] = []
	await expect(
		readStoredSource('pdf', async <T>(command: string): Promise<T> => {
			calls.push(command)
			return {
				typeKey: 'core.file',
				blob: { length: 100 },
				payload: { declaredMediaType: 'application/pdf' }
			} as T
		})
	).rejects.toThrow('not restored yet')
	expect(calls).toEqual(['artifact_get'])
})
