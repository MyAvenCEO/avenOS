/** Held-out multi-turn feedback: real Qwen answers and assessments, no customer material. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import type { InputFeedback } from '@avenos/llm-client/input-decision'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'

const base = process.env.LIVE_LLM_BASE_URL
assert(base, 'Supply the trusted Qwen endpoint.')
const models = await fetch(`${base}/models`).then((r) => r.json())
const model = models.data.find((m: { id: string }) => /qwen/i.test(m.id))?.id
assert(model)
const gateway = LlmGatewayService.fromConfig(
	testConfig({
		LLM_GATEWAY_ENABLED: 'true',
		LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
		LLM_GATEWAY_MODELS_JSON: JSON.stringify([
			{
				id: 'proof',
				label: 'Synthetic feedback contexts',
				baseUrl: base,
				upstreamModel: model,
				profile: 'qwen-tools',
				authMode: 'none',
				capabilities: ['text-generation', 'structured-output', 'tool-calling']
			}
		])
	})
)!
const out = await mkdtemp('/tmp/aven-feedback-context-')
const evidence: any = {
	synthetic: true,
	model,
	startedAt: new Date().toISOString(),
	passed: false,
	cases: [],
	contexts: [],
	fingerprints: {}
}
for (const file of [
	'deploy/e2e/live-feedback-context.ts',
	'libs/aven-llm-client/src/input-decision.ts'
])
	evidence.fingerprints[file] = createHash('sha256')
		.update(await readFile(new URL('../../' + file, import.meta.url)))
		.digest('hex')
type Case = [string, 'up' | 'down' | null, 'first' | 'last' | null]
const scenarios: { prompts: string[]; cases: Case[] }[] = [
	{
		prompts: [
			'Suggest a name for an imaginary puppet theatre.',
			'Suggest two storage labels for its stage props.'
		],
		cases: [
			[
				'The name you suggested in your first answer was excellent. I am not rating the later storage labels.',
				'up',
				'first'
			],
			['Ces étiquettes sont très pratiques, exactement ce qu’il fallait.', 'up', 'last'],
			[
				'Die Antwort mit den Etiketten ist da, aber vorgelesen wurde wieder nichts.',
				'down',
				'last'
			],
			['Per le etichette preferisco caratteri più grandi. Ho cambiato idea.', null, null],
			[
				'I like the clarity and dislike the detail equally. Please do not rate this answer for me.',
				null,
				null
			],
			[
				'That first answer about the theatre name completely missed what I asked for.',
				'down',
				'first'
			]
		]
	},
	{
		prompts: [
			'Explain two ways to organize fictional seashell specimens.',
			'How could I describe their color differences without specialist jargon?'
		],
		cases: [
			[
				'Your first explanation about organizing the specimens really helped. Start a new Intent about kite painting.',
				'up',
				'first'
			],
			['这个颜色说明太绕了，我还是看不懂。', 'down', 'last'],
			['Obrigado. Pode dar um exemplo com uma concha verde?', null, null],
			['You say the color explanation is ready but nothing is showing up here.', 'down', 'last'],
			[
				'The collector wrote “your explanation is useless” in a fictional letter. What does that phrase mean?',
				null,
				null
			],
			['色の説明がとても分かりやすかったです。', 'up', 'last']
		]
	},
	{
		prompts: [
			'Suggest two fictional activities for an origami club.',
			'Describe a one-minute introduction to the paper-folding activity.'
		],
		cases: [
			['Ja precies, deze introductie is bruikbaar en duidelijk.', 'up', 'last'],
			['المقدمة جيدة لكنني لا أسمع ردك، الصوت لا يعمل هنا.', 'down', 'last'],
			['Нет, я имел в виду бумагу другого цвета. Изменим тему занятия.', null, null],
			['La introducción es útil aunque tenga una pequeña errata, eso no importa.', 'up', 'last'],
			['The club had a terrible week. Could we plan something cheerful?', null, null],
			[
				'äh ja danke aber ich warte ewig auf deine antwort und am ende fehlt die hälfte',
				'down',
				'last'
			]
		]
	}
]
try {
	for (const scenario of scenarios) {
		const recent: { role: string; content: string; responseId?: string }[] = []
		const ids: string[] = []
		for (const prompt of scenario.prompts) {
			const answer = await gateway.complete({
				modelId: 'proof',
				requiredCapabilities: ['text-generation'],
				instructions:
					'Answer briefly, in at most two sentences. This is an invented exercise; do not claim to save or send anything.',
				messages: [...recent, { role: 'user', content: prompt }].map((m) => ({
					role: m.role,
					content: [{ type: 'text', text: m.content }]
				})),
				output: { format: 'text' },
				maxOutputTokens: 4096,
				temperature: 0
			})
			assert.equal(answer.output.format, 'text')
			const id = randomUUID()
			ids.push(id)
			recent.push(
				{ role: 'user', content: prompt },
				{
					role: 'assistant',
					content: (answer.output as { text: string }).text.slice(0, 1200),
					responseId: id
				}
			)
		}
		evidence.contexts.push(recent)
		for (let repetition = 0; repetition < 2; repetition++)
			for (const [text, vote, target] of scenario.cases) {
				try {
					const result = await gateway.inputDecision(
						{ kind: 'feedback', modelId: 'proof', locale: 'en-GB', text, recent },
						'synthetic-context'
					)
					const actual = result.decision as InputFeedback | null
					const expectedId = target === 'first' ? ids[0] : target === 'last' ? ids.at(-1) : null
					evidence.cases.push({
						text,
						repetition,
						expectedVote: vote,
						expectedId,
						actual,
						timing: result.timing,
						passed: (actual?.vote ?? null) === vote && (actual?.responseId ?? null) === expectedId
					})
				} catch (error) {
					evidence.cases.push({ text, repetition, passed: false, error: String(error) })
				}
				await writeFile(`${out}/evidence.json`, JSON.stringify(evidence, null, 2))
			}
	}
	evidence.passed = evidence.cases.length === 36 && evidence.cases.every((c: any) => c.passed)
	evidence.finishedAt = new Date().toISOString()
	assert(evidence.passed, 'Retain failed cases; do not silently retry or discard them.')
} finally {
	await writeFile(`${out}/evidence.json`, JSON.stringify(evidence, null, 2))
	console.log(
		JSON.stringify({
			out,
			passed: evidence.passed,
			cases: evidence.cases.length,
			failures: evidence.cases.filter((c: any) => !c.passed)
		})
	)
}
