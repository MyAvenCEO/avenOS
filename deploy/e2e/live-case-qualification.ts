/** Calibrate the independent plan oracle, not the production answer reviewer. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { chatGatewayRequest, createGatewayModelStream } from '@avenos/chat-engine/gateway'
import { answerReviewOptions } from '@avenos/chat-engine/research'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'
import { PLAN_AUDIT_INSTRUCTIONS, parsePlanAudit, planAuditMessages } from './plan-qualification'

const path = process.argv[2],
	base = process.env.LIVE_LLM_BASE_URL,
	model = process.env.LIVE_LLM_MODEL
assert(path && base && model && /qwen/i.test(model))
const bytes = await readFile(path),
	source = JSON.parse(bytes.toString())
assert(source.synthetic === true && source.caseProposals?.length === 2)
const directory = await mkdtemp('/tmp/aven-live-case-qualification-')
const evidence: any = {
	synthetic: true,
	completed: false,
	sourcePath: path,
	sourceHash: createHash('sha256').update(bytes).digest('hex'),
	scriptHash: createHash('sha256')
		.update(await readFile(import.meta.path))
		.digest('hex'),
	oracleHash: createHash('sha256')
		.update(await readFile(new URL('./plan-qualification.ts', import.meta.url)))
		.digest('hex'),
	model,
	runs: [],
	scope:
		'Independent model-oracle calibration over actual synthetic saved cases and deliberately defective evaluation inputs. No saved artifacts changed and no tools executed. Not production answer-review qualification.'
}
const save = () =>
	writeFile(`${directory}/evidence.json`, JSON.stringify(evidence, null, 2), { mode: 0o600 })
const gateway = LlmGatewayService.fromConfig(
	testConfig({
		LLM_GATEWAY_ENABLED: 'true',
		LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
		LLM_GATEWAY_TIMEOUT_SECONDS: '180',
		LLM_GATEWAY_MODELS_JSON: JSON.stringify([
			{
				id: 'oracle-qwen',
				label: 'Qwen',
				baseUrl: base,
				upstreamModel: model,
				profile: 'qwen-tools',
				authMode: 'none',
				capabilities: ['text-generation', 'streaming', 'tool-calling', 'structured-output']
			}
		])
	})
)!
const stream = createGatewayModelStream({
	request: (input) => chatGatewayRequest({ ...input, model: 'oracle-qwen', temperature: 0 }),
	open: async function* (request, signal) {
		const response = await gateway.openAiChatCompletion(request, signal)
		assert(response.ok && response.body)
		const decoder = new TextDecoder()
		for await (const chunk of response.body) yield decoder.decode(chunk, { stream: true })
		yield decoder.decode()
	}
})
const schema = {
	type: 'object',
	additionalProperties: false,
	properties: {
		verdict: { type: 'string', enum: ['pass', 'revise'] },
		issues: { type: 'array', items: { type: 'string' }, maxItems: 16 }
	},
	required: ['verdict', 'issues']
}
const checksSchema = {
	...schema,
	properties: {
		checks: {
			type: 'array',
			minItems: 1,
			maxItems: 16,
			items: {
				type: 'object',
				additionalProperties: false,
				properties: {
					requirement: { type: 'string' },
					evidence: {
						type: 'string',
						description:
							'Specific saved field and its relevant condition, including conflicting acceptance alternatives.'
					},
					verdict: { type: 'string', enum: ['pass', 'revise'] }
				},
				required: ['requirement', 'evidence', 'verdict']
			}
		},
		...schema.properties
	},
	required: ['checks', ...schema.required]
}
const original = source.caseProposals.map((proposal: any, index: number) => ({
	request: proposal.request,
	previousCase: index ? source.caseProposals[index - 1].saved.case : null,
	saved: proposal.saved,
	whatIf: proposal.simulation,
	actualAnswer: source.turns.find((turn: any) => turn.input === proposal.request)?.text
}))
const stale = structuredClone(original[1])
stale.saved = original[0].saved
stale.whatIf = original[0].whatIf
const bypass = structuredClone(original[1])
for (const steps of [bypass.saved.case.steps, bypass.whatIf.steps]) {
	const step = steps.find((step: any) => step.id === 'review-handover')
	assert(step?.kind === 'ideal')
	step.acceptance =
		'Either a person reviews uncertain counts, OR the note is automatically handed over without review and with a warning. Both paths satisfy this step.'
	step.produces =
		'A handed-over note, with a review record if somebody reviewed it, otherwise just a warning.'
}
const cases = [
	{ name: 'intact-original', data: original[0], expected: 'pass' },
	{ name: 'intact-revision', data: original[1], expected: 'pass' },
	{ name: 'missing-requested-revision', data: stale, expected: 'revise' },
	{ name: 'optional-review-bypass', data: bypass, expected: 'revise' }
]
// A prior independently generated failure is held out from the hand-written
// mutations above. Keep its saved state, not a model-repaired substitute.
const heldOutPath = process.argv[3]
if (heldOutPath) {
	const heldOutBytes = await readFile(heldOutPath)
	const heldOut = JSON.parse(heldOutBytes.toString())
	assert(heldOut.synthetic === true && heldOut.caseProposals?.length === 2)
	assert.equal(heldOut.caseProposals[0].semanticReview.verdict, 'pass')
	assert.equal(heldOut.caseProposals[1].semanticReview.verdict, 'revise')
	evidence.heldOut = {
		path: heldOutPath,
		hash: createHash('sha256').update(heldOutBytes).digest('hex')
	}
	for (const [index, proposal] of heldOut.caseProposals.entries())
		cases.push({
			name: index ? 'held-out-generated-review-bypass' : 'held-out-original',
			expected: index ? 'revise' : 'pass',
			data: {
				request: proposal.request,
				previousCase: index ? heldOut.caseProposals[0].saved.case : null,
				saved: proposal.saved,
				whatIf: proposal.simulation
			}
		})
}
const variants = process.env.PLAN_ORACLE_VARIANT
	? [process.env.PLAN_ORACLE_VARIANT]
	: ['baseline', 'data-only', 'structured']
assert(
	variants.every((variant) =>
		[
			'baseline',
			'data-only',
			'structured',
			'structured-checks',
			'reasoned-checks',
			'reasoned-envelope'
		].includes(variant)
	)
)
try {
	for (let repetition = 0; repetition < 2; repetition++)
		for (const item of cases)
			for (const variant of repetition ? [...variants].reverse() : variants) {
				const run: any = {
					name: item.name,
					expected: item.expected,
					repetition,
					variant,
					passed: false,
					text: ''
				}
				evidence.runs.push(run)
				const began = performance.now()
				try {
					const data = structuredClone(item.data)
					if (variant !== 'baseline') delete data.actualAnswer
					const instructions =
						PLAN_AUDIT_INSTRUCTIONS +
						(variant.endsWith('-checks')
							? '\nAssess each requested requirement against the saved fields in checks, with one concise evidence statement and pass/revise verdict per requirement. A step label or stated intention is not sufficient if its acceptance permits a conflicting outcome. Check all allowed alternatives in acceptance and produced outputs. An unresolved item deliberately accepted by a human AFTER review differs from an unreviewed item merely labelled unresolved. A warning, unknown value or truthful label does not satisfy a required review. Conversely, do not impose a review requirement where the user requested only a warning or add unstated requirements. Overall pass requires every check to pass, with no issues; every failed check needs a specific issue. Do not rewrite the supplied plan.'
							: '')
					const messages =
						variant === 'reasoned-envelope'
							? planAuditMessages(data)
							: [
									{ role: 'system' as const, content: instructions },
									{ role: 'user' as const, content: JSON.stringify(data) }
								]
					run.messages = messages
					if (variant === 'structured' || variant === 'structured-checks') {
						const response = await gateway.complete({
							modelId: 'oracle-qwen',
							instructions,
							messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(data) }] }],
							output: {
								format: 'json',
								name: 'plan_assessment',
								schema: variant === 'structured-checks' ? checksSchema : schema
							},
							temperature: 0,
							maxOutputTokens: 4096
						})
						assert.equal(response.output.format, 'json')
						if (response.output.format !== 'json') throw Error('Expected structured result')
						run.result = response.output.value
						run.receipt = response.receipt
					} else {
						for await (const event of stream(
							messages,
							[],
							AbortSignal.timeout(180_000),
							undefined,
							answerReviewOptions(0)
						)) {
							if (event.kind === 'text') run.text += event.text
							if (event.kind === 'finish') run.finish = event.reason
						}
						assert.equal(run.finish, 'stop')
						run.result =
							variant === 'reasoned-envelope' ? parsePlanAudit(run.text) : JSON.parse(run.text)
					}
					const result = run.result
					assert(result && result.verdict === item.expected && Array.isArray(result.issues))
					assert(
						Object.keys(result).sort().join() ===
							(variant.endsWith('-checks') ? 'checks,issues,verdict' : 'issues,verdict')
					)
					if (variant.endsWith('-checks')) {
						assert(Array.isArray(result.checks) && result.checks.length > 0)
						assert.equal(
							result.checks.every((check: any) => check.verdict === 'pass'),
							result.verdict === 'pass'
						)
					}
					assert(result.issues.every((issue: unknown) => typeof issue === 'string' && issue.trim()))
					assert(item.expected === 'pass' ? result.issues.length === 0 : result.issues.length > 0)
					run.passed = true
				} catch (error) {
					run.error = String(error)
				}
				run.durationMs = performance.now() - began
				await save()
			}
	evidence.completed = true
} finally {
	await save()
	console.log(
		JSON.stringify({
			evidence: `${directory}/evidence.json`,
			completed: evidence.completed,
			results: variants.map((variant) => ({
				variant,
				passed: evidence.runs.filter((r: any) => r.variant === variant && r.passed).length,
				total: evidence.runs.filter((r: any) => r.variant === variant).length
			}))
		})
	)
}
