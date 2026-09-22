// Real startup coordinator with delayed inventory and a fake document runtime.
// No native account, model calls or stored workspace data is touched.
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

const browser = await chromium.launch({ headless: true })
try {
	const page = await browser.newPage()
	await page.goto(`${process.env.AVEN_STUDIO_UI_URL ?? 'http://127.0.0.1:1420'}/dashboard`)
	await page.getByRole('button', { name: 'Start conversation', exact: true }).waitFor()
	const result = await page.evaluate(async () => {
		const { loadPersistentIntents } = await import('/src/lib/artifacts/ingest.svelte.ts')
		const { intents } = await import('/src/lib/intents/intents.svelte.ts')
		const { chatActor } = await import('/src/lib/actors/chat.actor.svelte.ts')
		const { clientDocumentRuntime } = await import(
			'/src/lib/artifacts/client-document-processing.ts'
		)
		const calls = []
		const presentation = {
			caseId: 'restored',
			state: 'succeeded',
			projectionVersion: '1',
			preferredType: 'document',
			label: 'Restored document',
			summary: 'Restored',
			metadata: {},
			warnings: [],
			stages: [],
			derivedArtifacts: []
		}
		let started = false
		clientDocumentRuntime.start = async () => {
			calls.push('runtime-start')
			started = true
			return presentation
		}
		clientDocumentRuntime.status = () => (started ? presentation : null)
		intents.initializeSourceSearch = async () => {}
		window.__TAURI_INTERNALS__ = {
			invoke: async (command, args) => {
				calls.push(command)
				if (command === 'intent_search')
					return { intents: [{ id: 'restore-intent' }], nextCursor: null, hasMore: false }
				if (command === 'intent_get')
					return {
						id: 'restore-intent',
						title: 'restored.pdf',
						routingSummary: '',
						state: 'active',
						version: 1,
						intentType: 'file',
						sourceLabel: 'Upload',
						deadline: null,
						sourceArtifactId: null,
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
						contributions: [],
						artifacts: [],
						fileSkill: null
					}
				if (command === 'artifact_inventory_page') {
					await new Promise((resolve) => setTimeout(resolve, 50))
					calls.push('inventory-arrived')
					return {
						artifacts: [
							{
								artifactId: 'declaration',
								typeKey: 'intent.declaration',
								localKey: 'intent',
								publicationId: 'publication',
								scopeSequence: 1,
								publicationOrdinal: 0
							},
							{
								artifactId: 'source',
								typeKey: 'core.file',
								localKey: 'file',
								publicationId: 'publication',
								scopeSequence: 1,
								publicationOrdinal: 1
							}
						],
						nextCursor: null
					}
				}
				if (command === 'artifact_get' && args.artifactId === 'declaration')
					return { payload: { intentId: 'restore-intent', title: 'restored.pdf' } }
				if (command === 'artifact_get' && args.artifactId === 'source')
					return {
						payload: {
							sourceKind: 'client-actor-ingest',
							executionEnvironment: 'local',
							originalName: 'restored.pdf',
							declaredMediaType: 'application/pdf'
						}
					}
				throw Error(`Unexpected native call ${command}`)
			}
		}
		await loadPersistentIntents()
		// The watcher intentionally polls; wait for its first post-restore update.
		for (let i = 0; i < 50 && !chatActor.core.artifactInfo('source')?.processing; i++)
			await new Promise((resolve) => setTimeout(resolve, 20))
		return {
			calls,
			adopted: chatActor.core.hasArtifact('source'),
			state: chatActor.core.artifactInfo('source')?.processing?.state
		}
	})
	assert.equal(result.adopted, true)
	assert.equal(result.state, 'succeeded')
	assert.ok(result.calls.indexOf('runtime-start') > result.calls.indexOf('inventory-arrived'))
	assert.ok(!result.calls.includes('artifact_processing_status'))
	console.log(
		'Delayed source discovery restores the loaded document and its processing watcher before reporting completion.'
	)
} finally {
	await browser.close()
}
