import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
	ACTOR_RUN_PROTOCOL,
	composeCatalogOperation,
	newStudioSkillV2,
	parseStudioSkillV2,
	StudioCatalog,
	type StudioSkillPort,
	type StudioSkillV2,
	TrustedActorInstallations
} from '@avenos/actors'
import { describe, expect, test } from 'vitest'
import {
	createDocumentRuntimeFactories,
	installDocumentRuntimeActors
} from '../src/document-runtime'
import { installedAuthorizer, installedRegistry } from '../src/installed-runtime'
import { createMarkdownRuntimeFactory, installMarkdownRuntimeActor } from '../src/markdown-runtime'
import { StudioArtifacts } from '../src/studio-artifacts'
import { createStudioV2Executor, STUDIO_SKILL_V2 } from '../src/studio-v2-executor'
import { StudioV2SkillValidator } from '../src/studio-v2-validation'
import { GoldenInvoiceModel } from './support/golden-document-model'
import { invoiceReviewSkills } from './support/studio-scenarios'
import { studioStoreFixture } from './support/studio-store'

async function fixture() {
	const wire = studioStoreFixture(),
		store = new StudioArtifacts(wire.client, wire.scope),
		subject = randomUUID()
	const installations = new TrustedActorInstallations()
	await installDocumentRuntimeActors(installations)
	await installMarkdownRuntimeActor(installations)
	const factories = [
		...createDocumentRuntimeFactories(store, new GoldenInvoiceModel()),
		createMarkdownRuntimeFactory(store)
	]
	const registry = installedRegistry(
		installations,
		factories.map((f) => f.offer)
	)
	const authorizer = installedAuthorizer(wire.scope, installations)
	const security = {
		principal: { kind: 'user' as const, subjectId: subject, assurance: [] },
		access: { tenantId: wire.scope },
		establishedBy: 'test',
		authorizedAt: new Date().toISOString()
	}
	const catalog = await new StudioCatalog().page({
		registry: registry.snapshot(),
		authorizer,
		...security,
		installationFor: (id) => installations.get(id),
		runtimeSupports: () => true,
		limit: 100
	})
	const operation = (method: string) => {
		const entry = catalog.entries.find((e) => e.capabilityId.endsWith(':' + method + '@1'))!
		expect(entry, method).toMatchObject({ canAuthor: true, canPlan: true })
		return entry
	}
	const compose = (method: string, definition = newStudioSkillV2(method)) =>
		composeCatalogOperation(definition, operation(method)).definition
	const save = async (definition: StudioSkillV2) => {
		const checked = await new StudioV2SkillValidator(wire.scope, installations).validate(
			definition,
			{
				...security,
				actorAuthorizer: authorizer,
				resolveReadableSkill: (id) => store.get(id)
			}
		)
		expect(checked.issues).toEqual([])
		return (
			await store.publish({
				id: randomUUID(),
				principal: subject,
				procedure: 'studio.test-publish',
				inputs: [],
				parameters: {},
				artifacts: [{ key: 'skill', type: 'studio.skill', version: 3, payload: definition }]
			})
		)[0]!
	}
	const execute = createStudioV2Executor(store, {
		installations,
		registryFor: () => registry.snapshot(),
		authorizerFor: () => authorizer,
		factoriesFor: () => ({ resolve: (id) => factories.find((f) => f.offer.factoryId === id) })
	})
	const run = async (
		definition: StudioSkillV2,
		inputs: Record<string, string | string[] | null>,
		parameters: Record<string, unknown> = {}
	) => {
		const skill = await save(definition)
		const activation = (
			await store.publish({
				id: randomUUID(),
				principal: subject,
				procedure: 'studio.activate',
				inputs: [{ role: 'program', id: skill.artifactId }],
				parameters: {},
				artifacts: [
					{
						key: 'activation',
						type: 'studio.activation',
						version: 2,
						payload: {
							contractVersion: 2,
							initiator: subject,
							skillArtifactId: skill.artifactId,
							inputs,
							parameters
						}
					}
				]
			})
		)[0]!
		const request = {
			protocol: ACTOR_RUN_PROTOCOL,
			requestId: randomUUID(),
			requestedAt: new Date().toISOString(),
			idempotencyKey: randomUUID(),
			skillRef: STUDIO_SKILL_V2,
			executionEnvironment: 'server' as const,
			security,
			parameters: { activationArtifactId: activation.artifactId },
			ingredients: [],
			goals: []
		}
		const result = await execute(request)
		return { result, replay: () => execute(request) }
	}
	const source = async (content: string) =>
		(
			await store.publish({
				id: randomUUID(),
				principal: subject,
				procedure: 'source.capture',
				inputs: [],
				parameters: {},
				artifacts: [
					{
						key: 'file',
						type: 'core.file',
						payload: {
							originalName: 'notes.txt',
							declaredMediaType: 'text/plain',
							sourceKind: 'test'
						},
						bytes: Buffer.from(content)
					}
				]
			})
		)[0]!
	return { wire, store, compose, save, run, source, operation, catalog }
}

describe('installed document and Markdown Actors in Studio', () => {
	test('nested supplier invoice pipeline executes real PDF decoding, validation and a review checklist', async () => {
		const f = await fixture()
		const skills = await invoiceReviewSkills(
			f.catalog.entries,
			async (definition) => (await f.save(definition)).artifactId
		)
		const pdf = await readFile(
			new URL('../../../deploy/e2e/fixtures/e2e-invoice.pdf', import.meta.url)
		)
		const [source] = await f.store.publish({
			id: randomUUID(),
			principal: randomUUID(),
			procedure: 'source.capture',
			inputs: [],
			parameters: {},
			artifacts: [
				{
					key: 'file',
					type: 'core.file',
					payload: {
						originalName: 'invoice.pdf',
						declaredMediaType: 'application/pdf',
						sourceKind: 'synthetic-test'
					},
					bytes: pdf
				}
			]
		})
		const run = await f.run(skills.parent, { source: source!.artifactId })
		const output = run.result.output as any
		expect((await f.store.get(output.outputs.invoice[0])).payload.grossMinor).toBe(11900)
		expect((await f.store.get(output.outputs['open-item'][0])).typeKey).toBe(
			'bookkeeping.open-item'
		)
		expect(
			new TextDecoder().decode(
				await f.wire.client.content(f.wire.scope, output.outputs.checklist[0])
			)
		).toContain('Approve payment manually')
		// Two separately extracted revisions of the same PDF page are not two chunks.
		// Their page artifact IDs differ; merge must compare owned source page numbers.
		const second = await f.run(skills.parent, { source: source!.artifactId })
		const candidates = [output.outputs.invoice[0], (second.result.output as any).outputs.invoice[0]]
		const details = candidates.map((id) => {
			const candidate = f.wire.artifacts.get(id)
			return [...f.wire.artifacts.values()].find(
				(a) =>
					a.typeKey === 'bookkeeping.invoice-details' && a.producerRunId === candidate.producerRunId
			)!.artifactId
		})
		await expect(
			f.run(f.compose('document_merge_invoice'), {
				source: source!.artifactId,
				candidate: candidates,
				details
			})
		).rejects.toThrow('DOCUMENT_CHUNK_PAGES_OVERLAP')
	})
	test('all document methods, chunk merges and both Markdown methods are authorable and validate as skills', async () => {
		const f = await fixture()
		expect(f.catalog.entries).toHaveLength(24)
		for (const entry of f.catalog.entries) {
			expect(entry.reasonCodes, entry.label).not.toContain('INSTALLATION_UNAVAILABLE')
			const definition = composeCatalogOperation(newStudioSkillV2(entry.label), entry).definition
			definition.policy.allowModel = true
			await f.save(definition)
		}
	})
	test('composes inspect → decompose → reusable per-page skill → assembly; exact bytes, evidence, ordered ports and replay', async () => {
		const f = await fixture()
		const file = await f.source('A real procedure.\nKeep all its evidence.')
		const child = f.compose('document_extract_native_text')
		const childArtifact = await f.save(child)
		let parent = f.compose('document_decompose', f.compose('document_inspect'))
		const decompose = parent.steps.at(-1)!
		const ports = Object.fromEntries(
			Object.entries(child.outputs).map(([name, { from: _, ...port }]) => [
				name,
				{ ...port, cardinality: 'many' as const }
			])
		)
		parent.steps.push({
			kind: 'forEach',
			id: 'pages',
			label: 'Read each page',
			collection: { kind: 'step', stepId: decompose.id, port: 'page' },
			itemName: 'page',
			childSkillArtifactId: childArtifact.artifactId,
			childInputs: {
				source: { kind: 'input', port: 'source' },
				page: { kind: 'item', loopId: 'pages' }
			},
			concurrency: 1,
			failureMode: 'fail-fast',
			outputs: ports
		})
		parent = f.compose('document_assemble', parent)
		const assembled = parent.steps.at(-1)!
		parent.outputs = Object.fromEntries(
			Object.entries(assembled.outputs).map(([name, port]) => [
				name,
				{ ...port, from: { kind: 'step' as const, stepId: assembled.id, port: name } }
			])
		)
		const run = await f.run(parseStudioSkillV2(parent), { source: file.artifactId })
		const outputs = (run.result.output as any).outputs
		expect(outputs.text).toHaveLength(1)
		expect(
			new TextDecoder().decode(await f.wire.client.content(f.wire.scope, outputs.text[0]))
		).toBe('A real procedure.\nKeep all its evidence.')
		const count = f.wire.publications.size
		expect((await run.replay()).output).toEqual(run.result.output)
		expect(f.wire.publications.size).toBe(count)
		const production = [...f.wire.publications.values()].find(
			(p) => p.run.procedureKey === 'client.assemble-document-representation'
		)!
		expect(
			production.run.inputs.some(
				(i: any) => i.role === 'source' && i.artifactId === file.artifactId
			)
		).toBe(true)
		expect(production.intent.evidence).toHaveLength(2)
		expect(
			production.intent.artifacts.filter((a: any) => a.typeKey === 'actors.port-result')
		).toHaveLength(2)
	})
	test('writes and patches Markdown as immutable artifacts, keeping the base as a causal input', async () => {
		const f = await fixture()
		const written = await f.run(
			f.compose('write'),
			{},
			{ title: 'Procedure', content: '# Procedure\n\nFirst draft.' }
		)
		const id = (written.result.output as any).outputs.document[0]
		const patched = await f.run(
			f.compose('patch'),
			{ document: id },
			{ edits: [{ find: 'First draft.', replace: 'Reviewed procedure.' }] }
		)
		const next = (patched.result.output as any).outputs.document[0]
		expect(next).not.toBe(id)
		expect(new TextDecoder().decode(await f.wire.client.content(f.wire.scope, id))).toContain(
			'First draft.'
		)
		expect(new TextDecoder().decode(await f.wire.client.content(f.wire.scope, next))).toContain(
			'Reviewed procedure.'
		)
		const production = [...f.wire.publications.values()].find(
			(p) => p.run.procedureKey === 'artifacts.markdown.patch'
		)!
		expect(production.run.inputs).toContainEqual({ role: 'document', ordinal: 0, artifactId: id })
		await expect(
			f.run(
				f.compose('patch'),
				{ document: id },
				{ edits: [{ find: 'Missing', replace: 'wrong' }] }
			)
		).rejects.toThrow('MARKDOWN_PATCH_TEXT_NOT_FOUND')
		expect(
			[...f.wire.publications.values()].filter(
				(p) => p.run.procedureKey === 'artifacts.markdown.patch'
			)
		).toHaveLength(1)
	})
})
