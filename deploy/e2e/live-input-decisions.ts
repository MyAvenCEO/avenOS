/** Independently invented routing cases. Real configured Qwen, production gateway, no model doubles. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { InputRoute } from '@avenos/llm-client/input-decision'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'

const base = process.env.LIVE_LLM_BASE_URL
assert(base, 'Set LIVE_LLM_BASE_URL to the trusted Qwen server; no customer input is used.')
const available = await fetch(`${base!.replace(/\/$/, '')}/models`, {
	signal: AbortSignal.timeout(10_000)
}).then((r) => {
	assert(r.ok)
	return r.json()
})
const upstream =
	process.env.LIVE_LLM_MODEL ?? available.data.find((m: { id: string }) => /qwen/i.test(m.id))?.id
assert(upstream && /qwen/i.test(upstream), 'This qualification requires the real Qwen model.')
const providerDecisions: unknown[] = []
const gateway = LlmGatewayService.fromConfig(
	testConfig({
		LLM_GATEWAY_ENABLED: 'true',
		LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
		LLM_GATEWAY_MODELS_JSON: JSON.stringify([
			{
				id: 'input-qwen',
				label: 'Qwen qualification',
				baseUrl: base,
				upstreamModel: upstream,
				profile: 'qwen-tools',
				authMode: 'none',
				capabilities: ['text-generation', 'structured-output', 'streaming', 'tool-calling']
			}
		])
	}),
	async (url, options) => {
		const response = await fetch(url, options)
		// Retain actual synthetic decisions, including malformed ones rejected by
		// the gateway. Do not alter or substitute a provider response.
		const body = await response
			.clone()
			.json()
			.catch(() => null)
		providerDecisions.push({ status: response.status, choices: body?.choices ?? null })
		return response
	}
)!
const context = {
	selectedId: 'pottery',
	intents: [
		{
			id: 'pottery',
			title: 'Pottery workshop',
			summary: 'Clay stock, kiln repairs, classes and tools.'
		},
		{
			id: 'orchard',
			title: 'Community orchard',
			summary: 'Fruit trees, pruning, irrigation and harvest.'
		},
		{ id: 'roofs', title: 'Roof maintenance', summary: 'Inspections and leaks at the workshop.' }
	],
	recent: [
		{ role: 'user', content: 'We need clay for the next pottery class.' },
		{ role: 'assistant', content: 'Would you like to compare the clay already in stock?' }
	]
}
// These vary intent semantics, not customer names/values lifted from a diagnosis.
const cases: [string, string, boolean, string, ('clarify' | 'work')?][] = [
	['Yes, please.', 'pottery', false, 'en-GB'],
	['Ja, bitte vergleichen.', 'pottery', false, 'de-DE'],
	['And include the unopened bags.', 'pottery', false, 'en-GB'],
	['What about the kiln?', 'pottery', false, 'en-GB'],
	['I meant clay for beginners, not experts.', 'pottery', false, 'en-GB'],
	['Please keep this discussion here.', 'pottery', false, 'en-GB'],
	[
		'Use the roof conversation only as evidence for workshop repair costs.',
		'pottery',
		false,
		'en-GB'
	],
	['Do not create a new Intent. Compare our clay here.', 'pottery', false, 'en-GB'],
	[
		'For example, someone might say "open a new Intent". I just need clay advice.',
		'pottery',
		false,
		'en-GB'
	],
	[
		'If we created a new Intent later, could we reuse this workshop history?',
		'pottery',
		false,
		'en-GB'
	],
	['How should we prune the apple trees this season?', 'orchard', false, 'en-GB'],
	[
		'Wie planen wir die Bewässerung im Gemeinschaftsgarten mit den Obstbäumen?',
		'orchard',
		false,
		'de-DE'
	],
	['The roof is leaking again. What did the last inspection say?', 'roofs', false, 'en-GB'],
	['Please put this in Community orchard: when should we prune?', 'orchard', true, 'en-GB'],
	['Frag im Intent Roof maintenance nach dem nächsten Prüftermin.', 'roofs', true, 'de-DE'],
	[
		'Create a new Intent named Astronomy club. I want to discuss telescopes.',
		'new',
		true,
		'en-GB',
		'clarify'
	],
	[
		'Mach einen neuen Intent auf: Eine Brettspielrunde organisieren.',
		'new',
		true,
		'de-DE',
		'clarify'
	],
	['new thread pls. Learning the cello.', 'new', true, 'en-GB', 'clarify'],
	['I want a separate conversation about the pottery exhibition.', 'new', true, 'en-GB', 'clarify'],
	['How do I care for a pet gecko?', 'new', false, 'en-GB'],
	['Können wir über einen Sprachkurs reden?', 'new', false, 'de-DE', 'clarify'],
	['neuer intent "Werkstattferien" bitte, erst mal nur Ideen sammeln', 'new', true, 'de-DE'],
	['Back to the unopened clay: are both types suitable?', 'pottery', false, 'en-GB'],
	['Not that one. I meant the heavier clay.', 'pottery', false, 'en-GB'],
	[
		'The orchard notes mention wooden signs; could we make ceramic ones in class?',
		'pottery',
		false,
		'en-GB'
	],
	[
		'Please move the discussion to Community orchard and compare fruit yields there.',
		'orchard',
		true,
		'en-GB'
	],
	['No new Intent, just explain this clay comparison.', 'pottery', false, 'en-GB'],
	['Ich brauche einen eigenen Intent für die Fahrradwerkstatt.', 'new', true, 'de-DE', 'clarify'],
	['Would a different clay save energy in the kiln?', 'pottery', false, 'en-GB'],
	[
		'Never mind the comparison; list the tools needed for the class instead.',
		'pottery',
		false,
		'en-GB'
	],
	[
		'Quiero hablar del huerto comunitario y sus árboles frutales, pero aún no tengo una pregunta concreta.',
		'orchard',
		false,
		'es-ES',
		'clarify'
	],
	[
		'Crée un nouvel Intent pour la soirée cinéma et ajoute une tâche personnelle : vérifier le câble du projecteur. Pas de date.',
		'new',
		true,
		'fr-FR',
		'work'
	],
	[
		'Just a new topic: home ceramics. I do not know what I want to ask yet.',
		'new',
		true,
		'en-GB',
		'clarify'
	],
	// Held-out topic/action and overlapping-scope contrasts; not prompt examples.
	[
		'Neuer Chat: Einen Chor gründen. Ich will erst mal darüber reden.',
		'new',
		true,
		'de-DE',
		'clarify'
	],
	[
		'Neuer Chat für den Chor: Schreib mir drei Ideen für einen Probenraum.',
		'new',
		true,
		'de-DE',
		'work'
	],
	['Ouvre une discussion : apprendre la photographie.', 'new', true, 'fr-FR', 'clarify'],
	[
		'Ouvre une discussion photo et explique la différence entre focale et ouverture.',
		'new',
		true,
		'fr-FR',
		'work'
	],
	['Quiero conversar sobre aprender a nadar.', 'new', false, 'es-ES', 'clarify'],
	['¿Cómo debería empezar a nadar sin agotarme tan pronto?', 'new', false, 'es-ES', 'work'],
	['Can the fruit trees share one watering schedule?', 'orchard', false, 'en-GB', 'work'],
	[
		'Open a separate Intent for comparing fruit-tree watering schedules.',
		'new',
		true,
		'en-GB',
		'clarify'
	],
	[
		'Was stand bei der letzten Dachinspektion über die Regenrinne?',
		'roofs',
		false,
		'de-DE',
		'work'
	],
	['Same question for the blue clay, please.', 'pottery', false, 'en-GB', 'work'],
	// Conversation destination is independent of the source/target of an action.
	[
		'Please move the task "Check the pruning ladder" into Community orchard. Keep its date and status.',
		'pottery',
		false,
		'en-GB'
	],
	[
		'Quédate en este chat. Reasigna la tarea "Revisar la escalera" al Intent "Roof maintenance", sin duplicarla.',
		'pottery',
		false,
		'es-ES'
	],
	[
		'Wir bleiben hier. Ordne die gespeicherte Notiz dem Intent Community orchard zu.',
		'pottery',
		false,
		'de-DE'
	],
	[
		'Déplace le rapport dans Roof maintenance et confirme ici. Ne déplace pas notre discussion.',
		'pottery',
		false,
		'fr-FR'
	],
	[
		'Sposta soltanto il documento in Community orchard, non questa conversazione.',
		'pottery',
		false,
		'it-IT'
	],
	['Add a task to Roof maintenance: inspect the gutter. No due date.', 'pottery', false, 'en-GB'],
	[
		'Bitte die Aufgabe aus Roof maintenance hierher holen, nicht den Chat wechseln.',
		'pottery',
		false,
		'de-DE'
	],
	[
		'Could you compare the notes stored in Community orchard and Roof maintenance here?',
		'pottery',
		false,
		'en-GB'
	],
	[
		'Actually take this question to Roof maintenance: should the task stay assigned to Pottery workshop?',
		'roofs',
		true,
		'en-GB'
	],
	[
		'Ahora cambia nuestra conversación a Community orchard. Allí discutimos la tarea de este taller.',
		'orchard',
		true,
		'es-ES'
	],
	[
		'Beantworte das im Intent Roof maintenance: Was bedeutet diese Notiz aus der Werkstatt?',
		'roofs',
		true,
		'de-DE'
	],
	[
		'Ouvre une nouvelle discussion intitulée Atelier mobile et compare les tâches de Community orchard.',
		'new',
		true,
		'fr-FR'
	]
]
const replies: [string, string][] = [
	['yes', 'accept-suggested'],
	['Ja, dort bitte.', 'accept-suggested'],
	['No, keep it here.', 'keep-current'],
	['Nein, hier lassen.', 'keep-current'],
	['Cancel that request.', 'cancel'],
	['That was the radio, ignore it.', 'ignore'],
	['Put that question in a new Intent called Inspection planning.', 'amend'],
	['Also, add paper cups to the workshop list.', 'independent'],
	['What temperature should the kiln use?', 'independent'],
	['Was meinst du?', 'clarify']
]
const duplicateContext = {
	...context,
	intents: [
		...context.intents,
		{
			id: 'older-pottery',
			title: 'Pottery workshop',
			summary: 'Clay stock, kiln repairs, classes and tools.'
		}
	]
}
const duplicateCases = [
	['Yes, compare those two clay types here.', 'C'],
	['Deine Antwort zur Ton-Auswahl war wirklich hilfreich.', 'de-DE'],
	['That first answer was excellent; it explained the comparison clearly.', 'en-GB'],
	['Incluye también las bolsas sin abrir.', 'es-419']
]
// Held-out context: vague current title, more candidates and different languages.
// These are not examples in the production prompt.
const fieldContext = {
	selectedId: 'field',
	intents: [
		{
			id: 'field',
			title: 'Field journal',
			summary: 'Organizing records and tasks from our volunteer workshop.'
		},
		{
			id: 'festival',
			title: 'Lantern festival',
			summary: 'Lighting, tables and the volunteer schedule.'
		},
		{ id: 'survey', title: 'Garden survey', summary: 'Plant counts, paths and labels.' },
		...[
			'Telescope lens care',
			'Library program',
			'Choir rehearsal',
			'Ceramic display',
			'Bicycle storage',
			'Pond maintenance',
			'Costume catalog',
			'Board game cabinet'
		].map((title, index) => ({ id: `other-${index}`, title }))
	],
	recent: [
		{ role: 'user', content: 'We are organizing existing workshop records and tasks here.' },
		{ role: 'assistant', content: 'Which saved items would you like to organize?' }
	]
}
const heldOutCases: typeof cases = [
	[
		'Verplaats de taak over tafels naar Lantern festival. Laat dit gesprek hier staan.',
		'field',
		false,
		'nl-NL'
	],
	['Mova só a nota para Garden survey, sem trocar esta conversa.', 'field', false, 'pt-BR'],
	[
		'Перенеси задачу о табличках в Garden survey. Сам разговор оставь здесь.',
		'field',
		false,
		'ru-RU'
	],
	[
		'Store the table sketch in Lantern festival and the plant notes in Garden survey. Confirm here.',
		'field',
		false,
		'en-GB'
	],
	[
		'Go to Lantern festival and discuss whether its table task should be moved back to Field journal.',
		'festival',
		true,
		'en-GB'
	],
	[
		'Bitte diese Frage im Intent Garden survey stellen: Wie viele Pflanzen wurden gezählt?',
		'survey',
		true,
		'de-DE'
	],
	[
		'Crée une discussion séparée intitulée Lantern festival et compare les idées. Ne réutilise pas celle qui existe.',
		'new',
		true,
		'fr-FR'
	],
	[
		'Ouvre seulement une nouvelle discussion Lantern festival, sans commencer le travail. Je préciserai ma demande ensuite.',
		'new',
		true,
		'fr-FR',
		'clarify'
	],
	['How should we organize volunteers for the lantern event?', 'festival', false, 'en-GB']
]
const out = await mkdtemp(join(tmpdir(), 'aven-input-decisions-'))
const evidence: any = {
	synthetic: true,
	scope: 'production gateway and decision contracts; not native/ASR',
	startedAt: new Date().toISOString(),
	upstreamModel: upstream,
	providerDecisions,
	cases: [],
	passed: false,
	fingerprints: {}
}
for (const path of [
	'libs/aven-llm-client/src/input-decision.ts',
	'services/aven-api/src/lib/server/llm-gateway.ts',
	'services/aven-api/src/lib/server/llm-permits.ts',
	'deploy/e2e/live-input-decisions.ts'
])
	evidence.fingerprints[path] = createHash('sha256')
		.update(await readFile(path))
		.digest('hex')
const save = () =>
	writeFile(join(out, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 })
try {
	for (let repetition = 0; repetition < 3; repetition++) {
		for (const [text, locale] of duplicateCases) {
			try {
				const result = await gateway.inputDecision(
					{ kind: 'route', modelId: 'input-qwen', locale, text, context: duplicateContext },
					'synthetic-observer'
				)
				const route = result.decision as InputRoute
				evidence.cases.push({
					repetition,
					text,
					locale,
					scenario: 'selected-follow-up-with-duplicate-title',
					...result,
					passed:
						route.fit && route.target?.kind === 'existing' && route.target.id === context.selectedId
				})
			} catch (error) {
				evidence.cases.push({ repetition, text, error: String(error), passed: false })
			}
			await save()
		}
		for (const { scenario, context: routingContext } of [
			...cases.map((scenario) => ({ scenario, context })),
			...heldOutCases.map((scenario) => ({ scenario, context: fieldContext }))
		]) {
			const [text, expected, explicit, locale, responseMode = 'work'] = scenario
			try {
				const result = await gateway.inputDecision(
					{ kind: 'route', modelId: 'input-qwen', locale, text, context: routingContext },
					'synthetic-observer'
				)
				const route = result.decision as InputRoute
				const target = route.target?.kind === 'existing' ? route.target.id : route.target?.kind
				evidence.cases.push({
					repetition,
					text,
					expected,
					explicit,
					responseMode,
					selectedId: routingContext.selectedId,
					...result,
					// Staying in the default never needs confirmation; its explicit flag is immaterial.
					passed:
						target === expected &&
						route.responseMode === responseMode &&
						(target === routingContext.selectedId || route.explicit === explicit)
				})
			} catch (error) {
				evidence.cases.push({
					repetition,
					text,
					expected,
					explicit,
					error: String(error),
					passed: false
				})
			}
			await save()
		}
		for (const [text, expected] of replies) {
			try {
				const result = await gateway.inputDecision(
					{
						kind: 'reply',
						modelId: 'input-qwen',
						locale: 'en-GB',
						text,
						pending: {
							text: 'What does the inspection say?',
							current: 'Pottery workshop',
							suggested: 'Roof maintenance',
							canKeep: true
						}
					},
					'synthetic-observer'
				)
				evidence.cases.push({
					repetition,
					text,
					expected,
					...result,
					passed: result.decision === expected
				})
			} catch (error) {
				evidence.cases.push({ repetition, text, expected, error: String(error), passed: false })
			}
			await save()
		}
	}
	const times = evidence.cases
		.flatMap((c: any) => (c.timing ? [c.timing.totalMs] : []))
		.sort((a: number, b: number) => a - b)
	evidence.latency = {
		p50: times[Math.ceil(times.length * 0.5) - 1],
		p95: times[Math.ceil(times.length * 0.95) - 1]
	}
	evidence.passed =
		evidence.cases.length ===
			(cases.length + heldOutCases.length + replies.length + duplicateCases.length) * 3 &&
		evidence.cases.every((c: any) => c.passed)
	evidence.finishedAt = new Date().toISOString()
	await save()
	console.log(
		JSON.stringify({
			evidence: join(out, 'evidence.json'),
			passed: evidence.passed,
			latency: evidence.latency,
			failures: evidence.cases.filter((c: any) => !c.passed)
		})
	)
	assert(
		evidence.passed,
		'At least one routing case failed. Inspect all attempts; do not discard failures.'
	)
} catch (error) {
	evidence.failure = String(error)
	evidence.passed = false
	await save()
	throw error
}
