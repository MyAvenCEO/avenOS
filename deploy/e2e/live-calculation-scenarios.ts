/** Real Qwen, production chat/Actor adapters and an isolated durable Studio. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { parseReview, ResearchRecord, reviewTokenBudget } from '@avenos/chat-engine/research'
import {
	type ChatMessage,
	openAiGatewayRequest,
	streamEvents,
	type ToolSpec
} from '../../app/src/lib/chat/redpill'
import {
	createCalculationActor,
	MessageBus,
	newStudioSkillV2,
	type StudioCatalogEntry,
	type StudioSkillV2
} from '../../libs/aven-actors/src'
import type { SqlPlanRunner } from '../../services/actor-runner/src/sql-runner'
import type { StudioArtifacts } from '../../services/actor-runner/src/studio-artifacts'

export async function liveCalculationScenarios(context: {
	call: <T = any>(operation: string, data?: Record<string, unknown>) => Promise<T>
	artifacts: StudioArtifacts
	runner: SqlPlanRunner
	subject: string
	publish: (definition: StudioSkillV2) => Promise<any>
	operation: (actor: string, method: string) => StudioCatalogEntry
	evidence: Record<string, any>
}) {
	const { call, artifacts, runner, publish, operation, evidence, subject } = context
	const base = process.env.LIVE_LLM_BASE_URL?.replace(/\/$/, '')
	assert(base, 'Set LIVE_LLM_BASE_URL to the trusted real Qwen /v1 endpoint')
	const modelsResponse = await fetch(base + '/models', {
		signal: AbortSignal.timeout(15000)
	})
	assert(modelsResponse.ok)
	const models = (await modelsResponse.json()) as any
	const model = models.data.find((m: any) => /qwen/i.test(m.id))?.id
	assert(model, 'A real Qwen provider is required, never a mock')
	async function* stream(
		messages: ChatMessage[],
		tools: ToolSpec[],
		signal?: AbortSignal,
		_model?: string,
		options = {}
	) {
		const response = await fetch(base + '/chat/completions', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(
				openAiGatewayRequest({
					messages,
					tools,
					model,
					thinking: false,
					...options
				})
			),
			signal: signal
				? AbortSignal.any([signal, AbortSignal.timeout(180000)])
				: AbortSignal.timeout(180000)
		})
		assert(response.ok, `Qwen HTTP ${response.status}`)
		async function* chunks() {
			const decoder = new TextDecoder()
			for await (const bytes of response.body as any) yield decoder.decode(bytes, { stream: true })
			yield decoder.decode()
		}
		yield* streamEvents(chunks())
	}
	;(globalThis as any).$state = (value: unknown) => value
	const { Chat } = await import('../../app/src/lib/chat/chat.svelte')
	const { StudioActor } = await import('../../libs/aven-actors/src/studio/agent')
	const bus = new MessageBus(),
		calculator = createCalculationActor(),
		studio = new StudioActor(call)
	bus.register(calculator)
	bus.register(studio)
	const chat = new Chat(
		{},
		{
			get specs() {
				return bus.toolSpecs()
			},
			run: (name, args) => bus.dispatch('chat', name, JSON.parse(args))
		},
		stream
	)
	evidence.calculations = { model, turns: [] }
	const turns = evidence.calculations.turns
	const ask = async (question: string) => {
		await chat.send(question)
		const answer = chat.turns.at(-1)!
		turns.push({
			question,
			answer: answer.content,
			calls: answer.calls,
			diagnostics: chat.diagnostics,
			failure: chat.failure
		})
		assert.equal(chat.failure, null, JSON.stringify(turns.at(-1)))
		assert(answer.content.trim(), 'No empty or unfinished answer')
		const recoveries = (answer.calls ?? []).filter((c) => c.status !== 'completed')
		// A rejected, non-dispatched call may be corrected once. Retain it in evidence;
		// success still requires a verified final answer and the exact productive result.
		assert(recoveries.length <= 1, JSON.stringify(recoveries))
		if (recoveries.length) console.log('RECOVERED tool rejection', recoveries[0]!.name)
		console.log('PASS live calculation turn', question.slice(0, 75))
		return answer
	}
	try {
		// Reproduce an observed prose error while keeping the actual arithmetic
		// receipt and reviewer real. No model completion is substituted.
		const review = new ResearchRecord()
		const division = await bus.dispatch('chat', 'calculate', {
			operation: 'divide',
			operands: [
				{ value: '1', unit: 'currency:EUR' },
				{ value: '3', unit: '1' }
			],
			decimal_places: 2,
			rounding: 'half-up'
		})
		review.observe('calculate', division.record)
		evidence.calculations.proseReviews = []
		for (const scenario of [
			{
				draft: '0.33 EUR. Restdifferenz zu exakt 1 EUR: 0.01 EUR.',
				verdict: 'revise'
			},
			{
				draft: '0,33 EUR — auf zwei Dezimalstellen mit half-up gerundet.',
				verdict: 'pass'
			}
		]) {
			let response = ''
			for await (const event of stream(
				review.verifierMessages(
					'Teile 1 EUR durch 3 mit 2 Dezimalstellen und half-up.',
					scenario.draft
				),
				[],
				undefined,
				undefined,
				{ thinking: true, max_tokens: reviewTokenBudget(0) }
			))
				if (event.kind === 'text') response += event.text
			const assessment = parseReview(response, 0)
			evidence.calculations.proseReviews.push({ ...scenario, assessment })
			assert.equal(assessment.verdict, scenario.verdict, response)
		}
		console.log(
			'PASS live review rejects an invented remainder and accepts the bounded calculation answer'
		)
		const capability = await ask('Kannst du auch multiplizieren?')
		assert.equal(
			capability.calls?.length ?? 0,
			0,
			'Capability questions must not start unsolicited work'
		)
		for (const scenario of [
			{
				question: '234567 * 87654.21 * 4321',
				result: '88843152318019.47',
				unit: '1'
			},
			{
				question:
					'Ein synthetisches Test-Abo kostet 2300 USD pro Monat. Was kosten 7 Monate? Nur diese erfundenen Zahlen verwenden.',
				result: '16100',
				unit: 'currency:USD'
			},
			{
				question:
					'In einem erfundenen Brettspiel: 17 Packungen mit je 43 Spielmarken. Wie viele Spielmarken sind das? Keine Umrechnung in Geld; verwende quantity:game-token.',
				result: '731',
				unit: 'quantity:game-token'
			},
			{
				question:
					'Ein fiktiver Auftrag hat 12 Stück zu jeweils 25.50 EUR. Berechne den Gesamtpreis ohne weitere Steuern.',
				result: '306',
				unit: 'currency:EUR'
			},
			{
				question:
					'Ejemplo inventado: alquilo una mesa por 6,75 EUR al día durante 8 días. ¿Cuánto pagaré, sin gastos adicionales?',
				result: '54',
				unit: 'currency:EUR'
			},
			{
				question:
					'Pour un atelier fictif, je prends 14 sachets contenant chacun 23 perles. Combien de perles en tout ?',
				result: '322',
				unit: /^quantity:[A-Za-z][A-Za-z0-9._-]*$/
			}
		]) {
			const answer = await ask(scenario.question)
			const calls = (answer.calls ?? []).filter((c) => c.name === 'calculate')
			assert.equal(calls.length, 1, 'One arithmetic request should need one successful calculation')
			const result = JSON.parse(calls[0]!.result).outputs.calculation
			assert.equal(result.operation, 'multiply')
			assert.equal(result.result.value, scenario.result)
			if (scenario.unit instanceof RegExp) assert.match(result.result.unit, scenario.unit)
			else assert.equal(result.result.unit, scenario.unit)
		}
		const authoredTurn = await ask(
			'Die Berechnung von Menge mal Einzelpreis brauche ich öfter. Mach daraus einen wiederverwendbaren Skill "Auftragssumme". Die Operanden mit ihren Einheiten sollen einstellbar sein, die Operation bleibt multiplizieren. Veröffentliche ihn und teste ihn mit 8 Stück zu je 19.95 EUR. Keine automatische Verbindung, keine Modellaufrufe im Skill.'
		)
		const assertAgentRun = (answer: typeof authoredTurn, expected: string) => {
			const receipt = answer.calls
				?.filter((c) => c.name === 'studio_run_status')
				.map((c) => JSON.parse(c.result))
				.find((r) => r.state === 'succeeded')
			assert(receipt, 'The agent must observe completion, not merely start a run')
			assert.deepEqual(receipt.outputs.artifact.payload.result, {
				value: expected,
				unit: 'currency:EUR'
			})
		}
		assertAgentRun(authoredTurn, '159.6')
		const state = await call('state')
		const draft = state.drafts.find((d: any) => d.definition.name === 'Auftragssumme')
		assert(draft?.publishedArtifactId, 'Qwen must actually publish its Skill')
		const skill = await artifacts.get(draft.publishedArtifactId)
		assert.equal((skill.payload as any).steps.length, 1)
		assert.equal(
			(skill.payload as any).steps[0].capabilityId,
			operation('calculator', 'calculate').capabilityId
		)
		assert.equal((skill.payload as any).policy.allowModel, false)
		const authoredDefinition = skill.payload as any
		const bindings = authoredDefinition.steps[0].parameters
		assert.deepEqual(bindings.operation, { kind: 'literal', value: 'multiply' })
		assert.equal(bindings.operands.kind, 'parameter')
		const operandsSetting = bindings.operands.name
		assert.equal(authoredDefinition.parametersSchema.properties[operandsSetting]?.type, 'array')
		assert.deepEqual(authoredDefinition.parametersSchema.required, [operandsSetting])
		// An optional title is presentation metadata, not another arithmetic control.
		// Locate settings by their actual binding, never object-key ordering.
		const purposeSetting = bindings.purpose?.kind === 'parameter' ? bindings.purpose.name : null
		if (purposeSetting)
			assert.equal(authoredDefinition.parametersSchema.properties[purposeSetting]?.type, 'string')
		assert(
			Object.keys(authoredDefinition.parametersSchema.properties).every(
				(name) => name === operandsSetting || name === purposeSetting
			),
			'Only operands and optional purpose may remain adjustable'
		)
		const request = {
			requestId: randomUUID(),
			skillArtifactId: skill.artifactId,
			inputs: {},
			parameters: {
				[operandsSetting]: [
					{ value: '7', unit: '1' },
					{ value: '23.45', unit: 'currency:EUR' }
				]
			}
		}
		const runAndWait = async (request: any) => {
			const handle = await call('start', request)
			let run: any
			const deadline = Date.now() + 180000
			do {
				run = await runner.status(handle.runId)
				if (['failed', 'succeeded'].includes(run?.state)) break
				await Bun.sleep(150)
			} while (Date.now() < deadline)
			assert.equal(run?.state, 'succeeded', JSON.stringify(run))
			return run
		}
		const run = await runAndWait(request)
		const outputs = Object.values(run.checkpoints.at(-1).output.outputs).flat() as string[]
		const saved = await artifacts.get(outputs[0]!)
		assert.equal(saved.typeKey, 'values.calculation')
		assert.deepEqual(saved.payload.result, {
			value: '164.15',
			unit: 'currency:EUR'
		})
		assert.equal((await call('start', request)).runId, run.runId)
		const producer: any = await artifacts.client.producerInputs(artifacts.scope, saved.artifactId)
		assert(
			producer.inputs.some((i: any) => i.role === 'activation'),
			'Stored calculation must retain its activation'
		)
		evidence.calculations.authored = {
			skillId: skill.artifactId,
			definition: skill.payload,
			request,
			runId: run.runId,
			result: saved,
			lineage: producer
		}
		const variantTurn = await ask(
			'Erstelle eine Variante davon mit dem Namen "Summe der Beträge", die stattdessen addiert. Veröffentliche sie; den ursprünglichen Skill unverändert lassen. Teste die Variante mit 12.10 EUR plus 2.20 EUR.'
		)
		assertAgentRun(variantTurn, '14.3')
		const after = await call('state')
		const original = after.drafts.find((d: any) => d.id === draft.id)
		assert.equal(original.revision, draft.revision)
		assert.equal(original.publishedArtifactId, draft.publishedArtifactId)
		const variant = after.drafts.find((d: any) => d.definition.name === 'Summe der Beträge')
		assert(variant?.publishedArtifactId)
		assert.equal(variant.originArtifactId, skill.artifactId)
		assert.equal(variant.definition.steps[0].parameters.operation.value, 'add')
		evidence.calculations.variant = {
			skillId: variant.publishedArtifactId,
			definition: variant.definition
		}
		for (const scenario of [
			{
				question: 'Rechne 45.10 EUR minus 12.20 EUR. Keine anderen Zahlen.',
				operation: 'subtract',
				value: '32.9',
				unit: 'currency:EUR',
				exact: true
			},
			{
				question: 'Teile 12.50 EUR durch 4, exakt und ohne Rundung.',
				operation: 'divide',
				value: '3.125',
				unit: 'currency:EUR',
				exact: true
			},
			{
				question: 'Vergleiche exakt 9007199254740993 mit 9007199254740992.',
				operation: 'compare',
				value: '1',
				unit: '1',
				exact: true
			},
			{
				question: 'Runde -2.345 EUR auf 2 Dezimalstellen mit half-even.',
				operation: 'round',
				value: '-2.34',
				unit: 'currency:EUR',
				exact: false
			},
			{
				question: 'Teile 1 EUR durch 3 mit 2 Dezimalstellen und half-up.',
				operation: 'divide',
				value: '0.33',
				unit: 'currency:EUR',
				exact: false
			}
		]) {
			const turn = await ask(scenario.question)
			const calls = turn.calls?.filter((c) => c.name === 'calculate') ?? []
			assert.equal(calls.length, 1)
			const result = JSON.parse(calls[0]!.result).outputs.calculation
			assert.equal(result.operation, scenario.operation)
			assert.equal(result.exact, scenario.exact)
			assert.deepEqual(result.result, {
				value: scenario.value,
				unit: scenario.unit
			})
		}

		const labeled = await ask(
			'Synthetische Prüfung mit ausschließlich erfundenen Daten: Sechs Lager-CSVs enthalten folgende Anzahlen von Lieferungen: Testlager-A.csv 7, Testlager-B.csv 23, Testlager-C.csv 16, Testlager-D.csv 38, Testlager-E.csv 29, Testlager-F.csv 54. Summiere nur die Anzahl der Lieferungen, keine Geldbeträge. Zeige bei jeder Eingabe, aus welcher Datei sie stammt, und benenne das Ergebnis. Die Dateien liegen hier nicht als Artefakte vor; erfinde keine Verweise.'
		)
		const labeledCall = labeled.calls?.findLast(
			(c) => c.name === 'calculate' && c.status === 'completed'
		)
		assert(labeledCall)
		const labeledResult = JSON.parse(labeledCall.result).outputs.calculation
		assert.equal(labeledResult.result.value, '167')
		assert.match(labeledResult.result.unit, /^quantity:/)
		assert(labeledResult.purpose?.length)
		assert.equal(labeledResult.operands.length, 6)
		const remainingSources = new Map([
			['Testlager-A.csv', '7'],
			['Testlager-B.csv', '23'],
			['Testlager-C.csv', '16'],
			['Testlager-D.csv', '38'],
			['Testlager-E.csv', '29'],
			['Testlager-F.csv', '54']
		])
		for (const operand of labeledResult.operands) {
			assert(operand.label?.length)
			// Both fields are visible on the card. Either can identify the file;
			// require the correct per-file value, not a particular wording/location.
			const labels = `${operand.label} ${operand.source?.label ?? ''}`
			const matches = [...remainingSources].filter(([file]) => labels.includes(file))
			assert.equal(matches.length, 1, 'Each input must identify its own distinct file')
			const [file, value] = matches[0]!
			assert.equal(operand.value, value, `Incorrect count associated with ${file}`)
			remainingSources.delete(file)
			assert.equal(operand.source?.artifactId, undefined, 'No invented source references')
			assert.equal(operand.source?.pointer, undefined, 'No invented source locations')
		}
		assert.equal(remainingSources.size, 0)
		evidence.calculations.labeled = labeledResult

		// A source-based chain uses the real model only for extraction. Arithmetic is
		// the SAME Actor; a saved Markdown report retains both calculation and source.
		const llm = operation('llm', 'llm_complete'),
			calc = operation('calculator', 'calculate'),
			md = operation('markdown', 'write')
		const port = (p: any) => ({
			schema: p.schema,
			type: p.type,
			predicate: p.predicate,
			role: p.role,
			cardinality: p.cardinality
		})
		const completion = port(llm.outputs[0]),
			calculation = port(calc.outputs[0]),
			document = port(md.outputs[0])
		const literal = (value: unknown) => ({ kind: 'literal' as const, value })
		const definition: StudioSkillV2 = {
			...newStudioSkillV2('Compute quoted order total'),
			inputs: {
				file: {
					...port(llm.inputs.find((p) => p.name === 'files')),
					cardinality: 'one'
				}
			},
			steps: [
				{
					id: 'extract',
					label: 'Read quantity and price',
					kind: 'invoke',
					capabilityId: llm.capabilityId,
					inputs: {
						files: { kind: 'input', port: 'file' },
						sources: { kind: 'none' },
						context: { kind: 'none' }
					},
					parameters: {
						question: literal(
							'Extract ONLY the explicitly ordered quantity and the per-item EUR price. Do not calculate or use cancelled alternatives. Return operands in order: quantity with unit 1, price as a decimal string in major currency units with unit currency:EUR. Preserve exact decimals; no numbers.'
						),
						response_schema: literal(
							JSON.stringify({
								type: 'object',
								additionalProperties: false,
								properties: { operands: CALCULATION_OPERANDS },
								required: ['operands']
							})
						)
					},
					outputs: { completion }
				},
				{
					id: 'compute',
					label: 'Compute exact total',
					kind: 'invoke',
					capabilityId: calc.capabilityId,
					inputs: {
						source: { kind: 'step', stepId: 'extract', port: 'completion' },
						previous: { kind: 'none' }
					},
					parameters: {
						operation: literal('multiply'),
						operands: {
							kind: 'input-field',
							port: 'source',
							path: '/data/operands'
						}
					},
					outputs: { calculation }
				},
				{
					id: 'save',
					label: 'Save calculation',
					kind: 'invoke',
					capabilityId: md.capabilityId,
					inputs: {
						source: { kind: 'none' },
						calculation: {
							kind: 'step',
							stepId: 'compute',
							port: 'calculation'
						}
					},
					parameters: {
						title: literal('Order total'),
						content: {
							kind: 'input-field',
							port: 'calculation',
							path: '/text'
						}
					},
					outputs: { document }
				}
			],
			outputs: {
				document: {
					...document,
					from: { kind: 'step', stepId: 'save', port: 'document' }
				}
			}
		}
		definition.policy.allowModel = true
		const pipeline = await publish(definition)
		for (const sourceText of [
			'FICTIONAL ORDER. Ordered: 13 items at EUR 17.35 per item. Cancelled alternative: 100 items at EUR 1.00.',
			'FIKTIVER AUFTRAG. Bestellt: 6 Stück. Stückpreis: 12,40 EUR. Frühere, verworfene Variante: 100 Stück für je 1,00 EUR.'
		]) {
			const source = (
				await artifacts.publish({
					id: randomUUID(),
					procedure: 'test.order',
					principal: subject,
					inputs: [],
					parameters: {},
					artifacts: [
						{
							key: 'file',
							type: 'core.file',
							payload: {
								originalName: 'order.txt',
								declaredMediaType: 'text/plain',
								sourceKind: 'test'
							},
							bytes: new TextEncoder().encode(sourceText),
							mediaType: 'text/plain'
						}
					]
				})
			)[0]!
			const run = await runAndWait({
				requestId: randomUUID(),
				skillArtifactId: pipeline.artifactId,
				inputs: { file: source.artifactId },
				parameters: {}
			})
			const output = await artifacts.get(run.checkpoints.at(-1).output.outputs.document[0])
			const text = new TextDecoder().decode(
				await artifacts.client.content(artifacts.scope, output.artifactId)
			)
			assert(text.includes(sourceText.startsWith('FICTIONAL') ? '225.55 EUR' : '74.4 EUR'), text)
			const lineage: any = await artifacts.client.producerInputs(artifacts.scope, output.artifactId)
			const calculated = await artifacts.get(
				lineage.inputs.find((i: any) => i.role === 'calculation').artifactId
			)
			assert.equal(calculated.typeKey, 'values.calculation')
			const calculationInputs: any = await artifacts.client.producerInputs(
				artifacts.scope,
				calculated.artifactId
			)
			const extracted = calculationInputs.inputs.find((i: any) => i.role === 'source').artifactId
			const extractionInputs: any = await artifacts.client.producerInputs(
				artifacts.scope,
				extracted
			)
			assert(extractionInputs.inputs.some((i: any) => i.artifactId === source.artifactId))
			evidence.calculations.sourceRuns ??= []
			evidence.calculations.sourceRuns.push({
				runId: run.runId,
				sourceId: source.artifactId,
				document: output.artifactId,
				text,
				calculation: calculated.payload
			})
			console.log('PASS live extraction → exact calculation → Markdown with complete lineage')
		}
	} finally {
		calculator.dispose()
		studio.dispose()
	}
}
const CALCULATION_OPERANDS = {
	type: 'array',
	minItems: 2,
	maxItems: 2,
	items: {
		type: 'object',
		additionalProperties: false,
		properties: {
			value: { type: 'string', maxLength: 163 },
			unit: { type: 'string', maxLength: 64 }
		},
		required: ['value', 'unit']
	}
}
