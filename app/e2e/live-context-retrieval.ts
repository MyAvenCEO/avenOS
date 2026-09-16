import { researchSpecs } from '../src/lib/chat/research'
import { cleanRetrievalChatTools } from '../src/lib/intents/retrieval-tools'
import { heldoutArtifacts, heldoutCases, heldoutRubrics } from './corpus/heldout-retrieval'
import { openAIEvaluationStream } from './openai-evaluation'
import 'fake-indexeddb/auto'
import { DiskSourceIndex } from '../src/lib/intents/source-index'
import {
	readSource,
	type SourceProvider,
	searchSources,
	sourceToolSpecs
} from '../src/lib/intents/source-retrieval'
import { breakingRubrics, gradeRubric, rubricFingerprint } from './retrieval-grading'
/**
 * Live-model retrieval probe with synthetic, crowded Intent and chat histories.
 * Run with LIVE_LLM_BASE_URL and LIVE_LLM_MODEL set to an OpenAI-compatible server.
 * This exercises the production Chat turn loop and context-selection helpers.
 */

import { pageMessages, recentWireMessages } from '../src/lib/chat/history-selection'
import {
	type ChatMessage,
	type StreamEvent,
	streamEvents,
	type ToolSpec
} from '../src/lib/chat/redpill'
import { lookupArtifacts } from '../src/lib/intents/artifact-manifest'
import { lookupIntents, selectContextIntents } from '../src/lib/intents/context-selection'
import { loadEnrichedPersonaCorpus, questionLanguage } from './corpus/enriched'
import { generatePersonaCorpus } from './corpus/persona-model'

const baseUrl = process.env.LIVE_LLM_BASE_URL?.replace(/\/$/, '')
const model = process.env.LIVE_LLM_MODEL
if (!baseUrl || !model)
	throw new Error('Set LIVE_LLM_BASE_URL and LIVE_LLM_MODEL.')

	// The desktop uses Svelte state. For this isolated Bun probe, plain arrays are enough.
;(globalThis as typeof globalThis & { $state: <T>(value: T) => T }).$state = <T>(value: T) => value
const { Chat, MAX_TOOL_ROUNDS } = await import('../src/lib/chat/chat.svelte')

type State = 'working' | 'waiting' | 'done' | 'archive'
interface SyntheticIntent {
	id: string
	title: string
	type: string
	status: State
	source: string
	routingSummary: string
	messages: Array<{ id: string; role: 'user' | 'assistant'; content: string }>
}

const independentStream = process.env.OPENAI_EVALUATION_MODEL
	? openAIEvaluationStream(process.env.OPENAI_EVALUATION_MODEL)
	: undefined
const repairStream = process.env.OPENAI_REPAIR_MODEL
	? openAIEvaluationStream(process.env.OPENAI_REPAIR_MODEL)
	: undefined
const corpusMode = process.env.LIVE_LLM_CORPUS
const isPersonaCorpus =
	corpusMode === 'personas' ||
	corpusMode === 'persona-temporal' ||
	corpusMode === 'persona-hard' ||
	corpusMode === 'persona-breaking' ||
	corpusMode === 'persona-heldout'
const enriched = isPersonaCorpus ? await loadEnrichedPersonaCorpus() : null
const personaCorpus = enriched?.corpus ?? generatePersonaCorpus()

function makePersonaWorkspace(personaId: string, asOfDay = 179): SyntheticIntent[] {
	const asOfDate = personaCorpus.days.find(
		(day) => day.personaId === personaId && day.dayIndex === asOfDay
	)?.date
	if (!asOfDate) throw new Error(`Unknown persona date ${personaId}:${asOfDay}`)
	return personaCorpus.intents
		.filter((intent) => intent.personaId === personaId && intent.createdAt <= asOfDate)
		.map((intent) => ({
			id: intent.id,
			title: intent.title,
			type: intent.type,
			status: intent.status,
			source: intent.source,
			routingSummary: intent.routingSummary,
			messages: personaCorpus.messages
				.filter((message) => message.intentId === intent.id && message.dayIndex <= asOfDay)
				.map((message) => ({ id: message.id, role: message.role, content: message.content }))
		}))
}

const topics = [
	'fleet maintenance',
	'contract review',
	'office move',
	'customer onboarding',
	'budget forecast',
	'supplier renewal',
	'permit filing',
	'document cleanup',
	'product launch',
	'invoice reconciliation',
	'hiring plan',
	'conference travel',
	'warehouse audit',
	'insurance update',
	'website copy',
	'security review',
	'calendar planning',
	'bank statement review',
	'team training',
	'shipment tracking'
]
const states: State[] = ['working', 'waiting', 'done', 'archive']
const sources = ['Email', 'Meeting', 'Chat', 'File upload', 'Voice note']

function backgroundMessages(topic: string, number: number, count = 44) {
	return Array.from({ length: count }, (_, index) => ({
		id: `synthetic-${number}-${index}`,
		role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
		content:
			index % 2 === 0
				? `For ${topic} case ${number}, review update ${index}: what happened with the schedule and owner?`
				: `For ${topic} case ${number}, update ${index}: the owner logged a routine change, and the next review is pending.`
	}))
}

function makeWorkspace(): SyntheticIntent[] {
	const items = Array.from({ length: 260 }, (_, index): SyntheticIntent => {
		const topic = topics[index % topics.length]
		return {
			id: `intent-${String(index).padStart(3, '0')}`,
			title: `${topic} · workstream ${index + 1}`,
			type: topic.includes('invoice') ? 'abgleich' : 'auftrag',
			status: states[index % states.length],
			source: sources[index % sources.length],
			routingSummary: `Ongoing ${topic} coordination, workstream ${index + 1}`,
			messages: backgroundMessages(topic, index)
		}
	})
	const set = (index: number, patch: Partial<SyntheticIntent>, oldFact?: string) => {
		Object.assign(items[index], patch)
		if (oldFact) items[index].messages[6].content = oldFact
	}
	set(
		0,
		{
			title: 'Operations roadmap',
			status: 'working',
			routingSummary: 'Quarterly operations planning'
		},
		'For the Harbor launch plan, we agreed the exception budget is 17 percent. This is final.'
	)
	set(
		71,
		{
			title: 'Harbor logistics thread',
			status: 'waiting',
			routingSummary: 'Old customs clearance work'
		},
		'The blue-envelope customs broker reference for Harbor clearance is KITE-742. Keep this reference for the handoff.'
	)
	set(
		4,
		{
			title: 'Pioneer permit renewal',
			status: 'waiting',
			routingSummary: 'Permit renewal still underway'
		},
		'The Pioneer permit renewal is blocked waiting on Marta’s signed Form M-4. Do not submit until that form arrives.'
	)
	set(
		97,
		{
			title: 'Atlas supplier agreement 2025',
			status: 'done',
			routingSummary: 'Older Atlas rebate negotiations'
		},
		'In the 2025 Atlas supplier agreement, the rebate was 4 percent. This was later superseded.'
	)
	set(
		233,
		{
			title: 'Atlas supplier agreement 2026',
			status: 'working',
			routingSummary: 'Current Atlas supplier terms'
		},
		'The latest 2026 Atlas supplier agreement sets the rebate at 7 percent, replacing the 2025 figure.'
	)
	set(
		149,
		{
			title: 'Proyecto Valencia · entrega',
			status: 'archive',
			routingSummary: 'Entregas antiguas del proyecto Valencia'
		},
		'La clave de entrega acordada para la carpeta naranja de Valencia es SOL-983. Guárdala para el relevo.'
	)
	return items
}

function assertCrowdedFixture(workspace: SyntheticIntent[]): void {
	const totalMessages = workspace.reduce((count, intent) => count + intent.messages.length, 0)
	if (workspace.length < 200 || totalMessages < 10_000)
		throw new Error('Synthetic workspace is no longer crowded enough for this probe.')
	const recent = selectContextIntents(workspace, workspace[0].id, [
		workspace[0].id,
		workspace[4].id
	])
	if (
		[workspace[71].id, workspace[97].id, workspace[149].id, workspace[233].id].some((id) =>
			recent.some((item) => item.id === id)
		)
	)
		throw new Error('An older target leaked into the default Intent index.')
	const wire = workspace[0].messages.map(({ role, content }) => ({ role, content }))
	if (
		recentWireMessages(wire, wire.length).messages.some((message) =>
			message.content.includes('17 percent')
		)
	)
		throw new Error('The current Intent answer leaked into the default chat window.')
}

const specs: ToolSpec[] = [
	{
		name: 'artifact_list',
		description:
			'Searches metadata for all older and archived source files, including tickets, vouchers, bookings and financial records omitted from the default context. Returns bounded pages with their Intent and title. Switch to that Intent before reading a file.',
		parameters: {
			type: 'object',
			properties: {
				query: { type: 'string' },
				intent: { type: 'string' },
				offset: { type: 'integer' },
				limit: { type: 'integer' }
			}
		}
	},
	...sourceToolSpecs,
	{
		name: 'intent_list',
		description:
			'Searches all intents, including older and archived ones, by metadata or conversation text. Returns bounded pages; omit query to browse.',
		parameters: {
			type: 'object',
			properties: {
				query: { type: 'string' },
				offset: { type: 'integer' },
				limit: { type: 'integer' }
			}
		}
	},
	{
		name: 'intent_messages',
		description:
			'Searches or browses the full conversation of an intent, including messages omitted from default history. Newest-first bounded pages; does not switch intents.',
		parameters: {
			type: 'object',
			properties: {
				intent: { type: 'string' },
				query: { type: 'string' },
				offset: { type: 'integer' },
				limit: { type: 'integer' }
			}
		}
	},
	{
		name: 'intent_detail',
		description:
			'Reads one intent on demand, including recent conversation and activity, without switching it. Use after intent_list for older work.',
		parameters: {
			type: 'object',
			properties: { intent: { type: 'string' }, query: { type: 'string' } },
			required: ['intent']
		}
	},
	{
		name: 'intent_switch',
		description:
			'Switches to another intent by id or title part. Call first when the request concerns another intent than the one on screen.',
		parameters: { type: 'object', properties: { intent: { type: 'string' } }, required: ['intent'] }
	},
	{
		name: 'intent_create',
		description: 'Creates a new intent when the work matches no existing intent.',
		parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }
	}
]

async function* liveStream(
	messages: ChatMessage[],
	tools: ToolSpec[],
	signal?: AbortSignal,
	_model?: string,
	options: { json?: boolean; thinking?: boolean; max_tokens?: number } = {}
): AsyncGenerator<StreamEvent> {
	const response = await fetch(`${baseUrl}/v1/chat/completions`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			model,
			stream: true,
			temperature: 0,
			max_tokens: options.max_tokens ?? Number(process.env.LIVE_LLM_MAX_TOKENS ?? 8192),
			...(options.thinking !== undefined && {
				chat_template_kwargs: { enable_thinking: options.thinking }
			}),
			...(options.json && { response_format: { type: 'json_object' } }),
			stream_options: { include_usage: true },
			messages,
			tools: tools.map((tool) => ({ type: 'function', function: tool }))
		}),
		signal: signal
			? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
			: AbortSignal.timeout(120_000)
	})
	if (!response.ok)
		throw new Error(
			`Live LLM returned ${response.status}: ${(await response.text()).slice(0, 500)}`
		)
	if (!response.body) throw new Error('Live LLM returned no stream body.')
	const reader = response.body.getReader()
	const decoder = new TextDecoder()
	async function* chunks() {
		while (true) {
			const { done, value } = await reader.read()
			if (done) {
				yield decoder.decode()
				return
			}
			yield decoder.decode(value, { stream: true })
		}
	}
	try {
		yield* streamEvents(chunks(), signal)
	} finally {
		await reader.cancel().catch(() => {})
	}
}

interface Case {
	name: string
	difficulty?: 'hard' | 'very-hard' | 'extreme' | 'breaking'
	language: 'en' | 'de' | 'es'
	question: string
	answer?: RegExp
	expectedText?: string
	requiresLookup: boolean
	expectsSwitch?: boolean
	personaId?: string
	requiresArtifact?: boolean
	requiredAnswers?: RegExp[]
	forbiddenAnswer?: RegExp
	minimumArtifactReads?: number
	asOfDay?: number
}

const EVAL_STOPWORDS = new Set([
	'the',
	'a',
	'an',
	'and',
	'or',
	'to',
	'of',
	'in',
	'on',
	'is',
	'are',
	'be',
	'as',
	'by',
	'der',
	'die',
	'das',
	'den',
	'dem',
	'ein',
	'eine',
	'einer',
	'und',
	'oder',
	'im',
	'im',
	'ist',
	'sind',
	'wird',
	'muss',
	'mit',
	'von',
	'vor',
	'fuer',
	'fur',
	'el',
	'la',
	'los',
	'las',
	'un',
	'una',
	'y',
	'o',
	'de',
	'del',
	'en',
	'es',
	'esta',
	'como',
	'por',
	'para',
	'que'
])

function evaluationTokens(value: string): string[] {
	const normalized = value
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLocaleLowerCase()
		.replace(/\b(?:january|januar|enero)\b/g, '01')
		.replace(/\b(?:february|februar|febrero)\b/g, '02')
		.replace(/\b(?:march|maerz|marz|marzo)\b/g, '03')
		.replace(/\b(?:april|abril)\b/g, '04')
		.replace(/\b(?:may|mai|mayo)\b/g, '05')
		.replace(/\b(?:june|juni|junio)\b/g, '06')
		.replace(/\b(?:july|juli|julio)\b/g, '07')
		.replace(/\b(?:august|agosto)\b/g, '08')
		.replace(/\b(?:september|septiembre)\b/g, '09')
		.replace(/\b(?:october|oktober|octubre)\b/g, '10')
		.replace(/\b(?:november|noviembre)\b/g, '11')
		.replace(/\b(?:december|dezember|diciembre)\b/g, '12')
		.replace(/\bboth sides\b|\bambas partes\b/g, ' full ')
		.replace(/\b(?:countersigned|signed|unterzeichnet|unterschrieben|firmad[oa])\b/g, ' signed ')
		.replace(/\b(?:eur|euro|euros)\b/g, ' euro ')
		.replace(/%/g, ' percent ')
		.replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, '')
		.replace(/(?<=\d),(?=\d{2}(?:\D|$))/g, '.')
	const tokens = normalized.match(/[a-z0-9]+(?:[.-][a-z0-9]+)*/g) ?? []
	return [...new Set(tokens.filter((token) => token.length > 1 && !EVAL_STOPWORDS.has(token)))]
}

function supportsExpectedText(answer: string, expected: string): boolean {
	const expectedTokens = evaluationTokens(expected)
	const answerTokens = new Set(evaluationTokens(answer))
	if (expectedTokens.length === 0) return false
	const numeric = expectedTokens.filter((token) => /\d/.test(token))
	if (numeric.some((token) => !answerTokens.has(token))) return false
	const matched = expectedTokens.filter((token) => answerTokens.has(token)).length
	return matched / expectedTokens.length >= 0.5
}
const cases: Case[] = [
	{
		name: 'hidden fact in an old waiting intent',
		language: 'en',
		question:
			'The blue-envelope customs broker reference should be somewhere in our older work. What was it?',
		answer: /KITE-742/i,
		requiresLookup: true,
		expectsSwitch: true
	},
	{
		name: 'old message in the current long conversation',
		language: 'en',
		question:
			'Earlier in this thread, what exception budget did we settle on for the Harbor launch plan?',
		answer: /(17|seventeen)\s*(percent|%)/i,
		requiresLookup: true
	},
	{
		name: 'ongoing task with an older blocker',
		language: 'en',
		question: 'Pioneer permit renewal is still underway. What exactly is blocking it right now?',
		answer: /Marta.{0,60}M-4|M-4.{0,60}Marta/i,
		requiresLookup: true,
		expectsSwitch: true
	},
	{
		name: 'conflicting older and newer supplier terms',
		language: 'en',
		question:
			'For Atlas supplier, what is the latest agreed rebate? I remember we discussed more than one figure.',
		answer: /(7|seven)\s*(percent|%)/i,
		requiresLookup: true,
		expectsSwitch: true
	},
	{
		name: 'missing secret must not be invented',
		language: 'en',
		question: 'We agreed an emergency vault override PIN somewhere already. What was it?',
		requiresLookup: true
	},
	{
		name: 'German question about an older English blocker',
		language: 'de',
		question:
			'Die Pioneer-Genehmigung läuft noch. Was blockiert sie genau? Das hatten wir früher besprochen.',
		answer: /Marta.{0,70}M-4|M-4.{0,70}Marta/i,
		requiresLookup: true,
		expectsSwitch: true
	},
	{
		name: 'German question about an old current-thread decision',
		language: 'de',
		question:
			'Welches Ausnahmebudget hatten wir für den Harbor-Start festgelegt? Das steht weiter oben im Gespräch.',
		answer: /(17|siebzehn)\s*(Prozent|%)/i,
		requiresLookup: true
	},
	{
		name: 'Spanish question about an archived conversation',
		language: 'es',
		question:
			'La clave de entrega de la carpeta naranja de Valencia debería estar en un hilo antiguo. ¿Cuál era?',
		answer: /SOL-983/i,
		requiresLookup: true,
		expectsSwitch: true
	}
]

const personaCases: Case[] = [
	{
		name: 'German signed supplier document supersedes old price',
		language: 'de',
		personaId: 'lena-weber',
		question:
			'Die Nordton-Zahl wurde geändert. Was steht im freigegebenen Dokument zu den aktuellen Konditionen je Kilo?',
		answer: /4[,.]65\s*Euro/i,
		requiresLookup: true,
		requiresArtifact: true
	},
	{
		name: 'German question retrieves an English supplier email',
		language: 'de',
		personaId: 'lena-weber',
		question:
			'Die Freigabenummer müsste in einer älteren englischen Nordton-Mail stehen. Welche Nummer nennt die Mail?',
		answer: /BLUE-271/i,
		requiresLookup: true,
		requiresArtifact: true
	},
	{
		name: 'Spanish archived handoff document',
		language: 'es',
		personaId: 'sofia-morales',
		question:
			'Busca la hoja de relevo antigua de la carpeta naranja de la boda Valencia. ¿Qué clave de entrega figura en ese documento?',
		answer: /SOL-983/i,
		requiresLookup: true,
		requiresArtifact: true
	},
	{
		name: 'Spanish clinic email cancels old appointment',
		language: 'es',
		personaId: 'sofia-morales',
		question: 'La clínica cambió la cita de mamá. ¿Qué día y hora confirma el correo nuevo?',
		answer: /jueves.{0,30}19:00/i,
		requiresLookup: true,
		requiresArtifact: true
	},
	{
		name: 'English signed renewal versus historic appendix',
		language: 'en',
		personaId: 'rowan-chen',
		question:
			'The Atlas rebate changed. Find the signed 2026 renewal document: what current rebate supersedes the old appendix?',
		answer: /(7|seven)\s*(percent|%)/i,
		requiresLookup: true,
		requiresArtifact: true
	},
	{
		name: 'English question retrieves a Spanish migration email',
		language: 'en',
		personaId: 'rowan-chen',
		question:
			'In March there was an old Spanish partner email titled “Referencia del lote de prueba” for the migration dry run. What shipping reference did it give?',
		answer: /RIO-588/i,
		requiresLookup: true,
		requiresArtifact: true
	}
]

const hardPersonaCases: Case[] = [
	{
		name: 'German as-of cutoff rejects a later Nordton commercial term',
		language: 'de',
		personaId: 'lena-weber',
		asOfDay: 100,
		question:
			'Am 11. April: Welche Kennung soll ich auf die aktuellen Nordton-Frühjahrsmuster schreiben? Bitte nur den damaligen Stand nennen; spätere Konditionen dürfen nicht einfließen.',
		requiredAnswers: [/BLUE-271/i, /Frühjahr|spring/i],
		forbiddenAnswer: /4[,.]65/,
		requiresLookup: true
	},
	{
		name: 'German separates customer refund from later carrier compensation',
		language: 'de',
		personaId: 'lena-weber',
		asOfDay: 162,
		question:
			'Bei Amiras kaputtem Nordblau-Teller verwechsle ich zwei Zahlungen. Was passierte mit ihrer Kundenerstattung, und was passierte später mit unserer DHL-Entschädigung? Bitte Betrag, Zahlungsweg beziehungsweise Ziel und Status getrennt nennen.',
		requiredAnswers: [
			/42[,.]50\s*(EUR|Euro|€)/i,
			/PayPal/i,
			/(Geschäftskonto|business account|Gutschrift)/i,
			/((Erstattung|Kundenerstattung).{0,160}(veranlasst|raus|zurück)|veranlasst.{0,80}Erstattung|refunded)/i,
			/(Entschädigung.{0,300}(genehmigt|Genehmigung|gutgeschrieben|Gutschrift)|(genehmigt|Genehmigung|Gutschrift).{0,300}Entschädigung|DHL.{0,300}(genehmigt|Genehmigung|Gutschrift))/is
		],
		requiresLookup: true,
		requiresArtifact: true,
		minimumArtifactReads: 2
	},
	{
		name: 'Spanish distinguishes wedding date, post-event order and unsigned addendum',
		language: 'es',
		personaId: 'sofia-morales',
		asOfDay: 165,
		question:
			'Me estoy liando con Clara: ¿la boda se cambió a junio? Dime la fecha real del evento, qué era exactamente el pedido del 21 de mayo y si el borrador del 28 de mayo sustituyó el contrato principal.',
		requiredAnswers: [
			/15[/. -]?(?:05|mayo)[/. -]?2026|15 de mayo de 2026/i,
			/(post-boda|después de la boda|cena del 30|arreglos.{0,40}adicional)/i,
			/29(?:[/. -](?:05|mayo)(?:[/. -]2026)?| de mayo(?: de 2026)?)/i,
			/(borrador|pendiente de aprobación)/i,
			/(no (sustituy|modific|cambi)|independiente|no se cambió)/i
		],
		forbiddenAnswer: /boda (?:fue )?(?:cambiada|movida|trasladada) a junio/i,
		requiresLookup: true,
		requiresArtifact: true,
		minimumArtifactReads: 2
	},
	{
		name: 'English keeps April commercial rebate separate from data authorization',
		language: 'en',
		personaId: 'rowan-chen',
		asOfDay: 110,
		question:
			'As of 21 April, what rebate belongs on the April Atlas invoice, and does that commercial position authorize the production migration? Cite the separate blocker.',
		requiredAnswers: [
			/(5|five)\s*(percent|%)/i,
			/DPA-42/i,
			/(does not|doesn't|still blocked|not authori[sz]ed|remains blocked|authori[sz]es nothing)/i
		],
		forbiddenAnswer: /(7|seven)\s*(percent|%)/i,
		requiresLookup: true,
		requiresArtifact: true,
		minimumArtifactReads: 2
	},
	{
		name: 'German negative evidence for unsigned evening-course approval',
		language: 'de',
		personaId: 'lena-weber',
		asOfDay: 110,
		question:
			'Stand 21. April: Haben wir irgendwo schon eine unterschriebene Freigabe für Abendkurse in der neuen Werkstatt? Falls nicht, sag klar, was die Unterlagen tatsächlich belegen und was noch fehlt.',
		requiredAnswers: [
			/B[-‑]17/i,
			/(keine.{0,50}(unterschriebene )?(Freigabe|Genehmigung)|nicht (genehmigt|freigegeben|unterzeichnet)|unterschrieben.{0,20}nicht|nicht.{0,20}unterschrieben|steht aus|noch fehlt)/i,
			/(Paul Neumann|Ingenieur|Hausverwaltung)/i
		],
		forbiddenAnswer: /(Abendkurse|Nutzung).{0,30}(ist|sind) (bereits )?(genehmigt|freigegeben)/i,
		requiresLookup: true,
		requiresArtifact: true,
		minimumArtifactReads: 2
	},
	{
		name: 'English disambiguates two migration references and rejects production use',
		language: 'en',
		personaId: 'rowan-chen',
		asOfDay: 179,
		question:
			'I have TEST-ATLAS-001 and RIO-588 in my notes. What does each refer to, and does either reference mean we may move production data now?',
		requiredAnswers: [
			/TEST-ATLAS-001/i,
			/RIO-588/i,
			/DPA-42/i,
			/(neither|does not|do not|still blocked|no production data)/i,
			/(TEST-ATLAS-001.{0,180}(staging|customer fields|test batch v1[.]2)|(staging|customer fields|test batch v1[.]2).{0,180}TEST-ATLAS-001)/is
		],
		forbiddenAnswer:
			/(find nowhere|(?:can(?:no|')?t|couldn.t|didn.t) find (?:it )?(?:anywhere|in)|same thing as RIO|same as RIO)/i,
		requiresLookup: true,
		requiresArtifact: true,
		minimumArtifactReads: 2
	},
	{
		name: 'English return journey avoids outbound and Underground distractors',
		language: 'en',
		personaId: 'rowan-chen',
		asOfDay: 179,
		question:
			'For the return from Jamie’s place in Glasgow, what taxi voucher is included, and which Underground line does the ticket specify for the London transfer? I may be mixing it up with the outbound trip and the Piccadilly line.',
		requiredAnswers: [
			/TAXI-GLA-2026-0628/i,
			/(£|GBP\s*)15(?:\.00)?|15(?:\.00)?\s*GBP/i,
			/Circle/i,
			/Hammersmith\s*(?:&|and)\s*City/i,
			/(not|rather than|doesn.t say|instead of).{0,30}Piccadilly|Piccadilly.{0,30}(not|isn.t|mix-up)/i
		],
		requiresLookup: true,
		requiresArtifact: true
	},
	{
		name: 'German resolves Amira, Olivia and DHL as three linked outcomes',
		language: 'de',
		personaId: 'lena-weber',
		asOfDay: 179,
		question:
			'Ich muss den Schadenfall sauber erklären und verwechsle Amira, Olivia und DHL. Wer bekam eine PayPal-Erstattung, wer zusätzlich Ersatz ohne weitere offene Zahlung, und welche separate Zahlung ging an uns? Nenne die drei Vorgangsnummern und Beträge beziehungsweise Status.',
		requiredAnswers: [
			/Amira|Yilmaz/i,
			/REF-2026-0328-AY/i,
			/42[,.]50\s*(EUR|Euro|€)/i,
			/PayPal/i,
			/Olivia|Grant/i,
			/RMA-2026-0524-OG/i,
			/(Ersatz|replacement|Kulanz)/i,
			/CASE-2026-0209-DHL/i,
			/(Geschäftskonto|business account|Gutschrift)/i
		],
		requiresLookup: true,
		requiresArtifact: true,
		minimumArtifactReads: 3
	}
]

const breakingPointCases: Case[] = [
	{
		name: 'Kitchen orders reconcile paid items, free replacement and total cash',
		difficulty: 'hard',
		language: 'en',
		personaId: 'rowan-chen',
		asOfDay: 179,
		question:
			'Reconcile the March and May kitchen-supplier orders for me. Give both order references and cash totals, explain what happened to the missing roller, say whether it was charged twice, and calculate the total cash actually paid across the two orders.',
		requiredAnswers: [
			/KS-2026-0327-88/i,
			/45[.]50/i,
			/KS-SUP-2026-0403-01/i,
			/KS-2026-0521-44/i,
			/14[.]50/i,
			/(0[.]00|free|goodwill)/i,
			/60(?:[.]00)?/i,
			/(not charged twice|wasn.t charged twice|no double charge|replacement)/i,
			/SALT-312/i
		],
		requiresLookup: true,
		requiresArtifact: true,
		minimumArtifactReads: 3
	},
	{
		name: 'Latest clinic ticket resists earlier RE1 and future Leipzig booking',
		difficulty: 'hard',
		language: 'de',
		personaId: 'lena-weber',
		asOfDay: 179,
		question:
			'Für Vaters Klinikfahrt am 29. Juni: Welche konkrete Fahrkarte gilt? Nenne Buchungsreferenz, Zug, Abfahrt, Ankunft, Preis und Sitzplatzsituation. Verwechsle sie weder mit seinen früheren RE1-Fahrten noch mit unserer späteren Leipzig-Familienreise.',
		requiredAnswers: [
			/DB-2026-0628-CLIN-09/i,
			/S\s*7/i,
			/09:45/,
			/10:25/,
			/4[,.]70\s*(EUR|Euro|€)/i,
			/(kein.{0,30}(reserviert|Sitzplatz)|no reserved seat)/i,
			/(RE\s*1.{0,40}(nicht mehr aktuell|früher|älter)|Leipzig.{0,50}(nichts zu tun|andere|separate|später)|nicht.{0,30}(RE\s*1|ICE|Leipzig)|weder.{0,80}(RE\s*1|Leipzig))/i
		],
		requiresLookup: true,
		requiresArtifact: true,
		minimumArtifactReads: 3
	},
	{
		name: 'Atlas rate changes across April and May without unlocking production',
		difficulty: 'hard',
		language: 'en',
		personaId: 'rowan-chen',
		asOfDay: 179,
		question:
			'Give me the two-snapshot Atlas answer: which rebate governed April, which governed May services, what document and effective date changed it, and did that commercial change ever clear production data transfer?',
		requiredAnswers: [
			/(5|five)\s*(percent|%)/i,
			/(7|seven)\s*(percent|%)/i,
			/(28 May|May 28|2026-05-28)/i,
			/(1 May|May 1|2026-05-01)/i,
			/(Implementation Addendum|v2[.]2)/i,
			/DPA-42/i,
			/(still|remains|stayed).{0,40}(blocked|suspended)|did not.{0,40}(clear|authori[sz]e)/i
		],
		forbiddenAnswer:
			/April(?: 2026)?(?: services| invoices| rebate)?\s*(?:—|:|=|was|is|were|at|had|governed by)\s*7\s*%/i,
		requiresLookup: true,
		requiresArtifact: true,
		minimumArtifactReads: 4
	},
	{
		name: 'Three identical-value travel and dog-care credits stay separate',
		difficulty: 'very-hard',
		language: 'en',
		personaId: 'rowan-chen',
		asOfDay: 179,
		question:
			'I have several £25 entries around Glasgow and Pip. Separate all three: the February delay compensation and how it paid for the 28 March rail booking, Bea’s cancelled sitting refund, and the later still-active GWR voucher. Give every reference, destination or use, and the remaining Monzo contribution to the rail fare.',
		requiredAnswers: [
			/GWR-VCH-2026-0318-9921/i,
			/NRC-2026-0321-GLA/i,
			/60(?:[.]00)?/i,
			/BEA-DOG-2026-03/i,
			/(PayPal)/i,
			/VOUCHER-GWR-2026-0512-44/i,
			/(active|still active|unused)/i,
			/(three|3).{0,40}(separate|different)|separate.{0,60}(£25|25)/i
		],
		requiresLookup: true,
		requiresArtifact: true,
		minimumArtifactReads: 5
	},
	{
		name: 'Two Mar Azul return cycles preserve their documentary contradictions',
		difficulty: 'very-hard',
		language: 'es',
		personaId: 'sofia-morales',
		asOfDay: 179,
		question:
			'Audita las dos devoluciones de peonías sin suavizar las contradicciones. Para MA-2026-0203 y MA-2026-0325, enlaza cada RMA, importe solicitado o estimado, crédito que realmente aparece después y método de pago. Señala expresamente dónde los documentos no cuadran y no mezcles ORANGE-64 con el primer caso.',
		requiredAnswers: [
			/MA-2026-0203/i,
			/RA-2026-0206/i,
			/196[,.]50\s*(EUR|Euro|€)/i,
			/150[,.]00\s*(EUR|Euro|€)/i,
			/150[,.]00.{0,100}pendiente|pendiente.{0,100}150[,.]00/is,
			/MA-2026-0325/i,
			/RA-2026-0328/i,
			/450[,.]00\s*(EUR|Euro|€)/i,
			/180[,.]00\s*(EUR|Euro|€)/i,
			/Visa.{0,30}6418|6418.{0,30}Visa/i,
			/ORANGE-64/i,
			/(no cuadra|contradic|inconsisten|discrepan)/i
		],
		requiresLookup: true,
		requiresArtifact: true,
		minimumArtifactReads: 6
	},
	{
		name: 'Amira refund, merchant settlement and unrelated fifteen-euro entries',
		difficulty: 'very-hard',
		language: 'de',
		personaId: 'lena-weber',
		asOfDay: 179,
		question:
			'Erstelle eine saubere Zahlungsprüfung für Amiras 42,50-Euro-Erstattung bis 12. Juni. Trenne Kundenerstattung, offenen Händlerabgang, DHL-Händlerentschädigung und die beiden 15-Euro-Positionen. Was ist nachweislich verarbeitet, was gebucht und was bleibt ohne eindeutigen Abschlussbeleg?',
		requiredAnswers: [
			/REF-2026-0328-AY/i,
			/PP-2026-0328-AY/i,
			/CASE-2026-0209-DHL/i,
			/42[,.]50\s*(EUR|Euro|€)/i,
			/(31[.]03|31\. März|March 31)/i,
			/(08[.]06|8\. Juni|June 8)/i,
			/PayPal[- ]Business/i,
			/(Kartengebühr|card fee)/i,
			/(offen|nicht verbucht|kein.{0,40}Abschluss|unresolved)/i
		],
		requiresLookup: true,
		requiresArtifact: true,
		minimumArtifactReads: 4
	},
	{
		name: 'Wedding authority conflict distinguishes contract from impossible later roster',
		difficulty: 'extreme',
		language: 'es',
		personaId: 'sofia-morales',
		asOfDay: 179,
		question:
			'Al cerrar junio aparecen dos cronologías incompatibles para Clara. Determina cuál es la fecha contractual respaldada por la cadena de documentos, explica qué pasó después del evento y localiza el registro que vuelve a llamar “boda” al 27 de junio. ¿Ese turno tardío modifica el contrato? Cita la evidencia que permite decidirlo.',
		requiredAnswers: [
			/15(?:[/. -]05(?:[/. -]2026)?| de mayo(?: de 2026)?)/i,
			/27 de junio(?: de 2026)?|27[/. -]06[/. -]2026/i,
			/(pedido|arreglos).{0,80}(post-boda|después|adicional|aparte)|post-boda|servicio adicional independiente/i,
			/(ORD-)?2026-0521-MA/i,
			/(borrador|pendiente de aprobación)/i,
			/(turno|roster|registro de personal|staff)/i,
			/(no modifica|no sustituye|no cambia|no puede modificar)/i,
			/(contradic|inconsisten|erróne|incompatible|clon|conflicto|sin contraparte ni firma)/i
		],
		forbiddenAnswer:
			/fecha contractual.{0,50}27 de junio|boda (?:real|contractual).{0,40}27 de junio/i,
		requiresLookup: true,
		requiresArtifact: true,
		minimumArtifactReads: 5
	},
	{
		name: 'Lease chronology resolves signed claims against later authoritative blockers',
		difficulty: 'extreme',
		language: 'de',
		personaId: 'lena-weber',
		asOfDay: 179,
		question:
			'Baue die widersprüchliche Werkstatt-Akte chronologisch auf: die angebliche Freigabe vom März, den gegenteiligen April-Entwurf, die anwaltliche Empfehlung vom 28. Mai, Beckers Juni-Mail und den Beleg vom 27. Juni. Was darf Lena Ende Juni unterschreiben beziehungsweise nutzen, und welche zwei Voraussetzungen fehlen weiterhin für Abendkurse?',
		requiredAnswers: [
			/(25[.]03|25\. März|March 25)/i,
			/(06[.]04|6\. April|April 6)/i,
			/(28[.]05|28\. Mai|May 28)/i,
			/(15[.]06|15\. Juni|June 15)/i,
			/(27[.]06|27\. Juni|June 27)/i,
			/B[-‑]17/i,
			/Paul Neumann/i,
			/(schriftliche Freigabe|written approval)/i,
			/(Vertrag.{0,50}unterschreiben|sign.{0,40}lease)/i,
			/(Abendkurse.{0,50}(nicht|ausgesetzt|untersagt)|keine.{0,40}Abendkurse)/i,
			/(widerspr|contradic)/i
		],
		forbiddenAnswer: /Abendkurse.{0,30}(sind|ist)\s+(freigegeben|genehmigt)/i,
		requiresLookup: true,
		requiresArtifact: true,
		minimumArtifactReads: 5
	},
	{
		name: 'Three Atlas billing periods reconcile rates, VAT credits and cash total',
		difficulty: 'extreme',
		language: 'en',
		personaId: 'rowan-chen',
		asOfDay: 179,
		question:
			'Reconcile the Atlas cash received for January, February and May services. For each period give invoice or payment reference, rebate rate, rebate amount and final cash paid; explain why January was not restated and calculate the combined cash received. Keep the still-unsigned data-processing permission separate.',
		requiredAnswers: [
			/INV-2026-02-001/i,
			/4\s*%|4 percent/i,
			/2[,]?320(?:[.]00)?/i,
			/ATLAS-PAY-2026-0309-02/i,
			/5\s*%|5 percent/i,
			/2[,]?300(?:[.]00)?/i,
			/ATLAS-PAY-2026-0627-01/i,
			/7\s*%|7 percent/i,
			/140(?:[.]00)?/i,
			/28(?:[.]00)?/i,
			/2[,]?232(?:[.]00)?/i,
			/6[,]?852(?:[.]00)?/i,
			/DPA-42/i,
			/(still|remains).{0,30}(unsigned|blocked|pending)/i
		],
		requiresLookup: true,
		requiresArtifact: true,
		minimumArtifactReads: 6
	},
	{
		name: 'All Glasgow journeys and dog-care bookings align without cross-wiring',
		forbiddenAnswer:
			/dog care aligns cleanly|dates line up|Dates align with the 21 May arrival|March and May are fully evidenced end to end/i,
		difficulty: 'breaking',
		language: 'en',
		personaId: 'rowan-chen',
		asOfDay: 179,
		question:
			'Build a compact audit trail for every Glasgow rail booking and the dog care that actually aligns with each trip. Include the 28 March fare split and cancelled Bea booking, the 21 May itinerary and Alex booking for Pip, and the 28 June return including taxi voucher and London line. Exclude the unrelated April Alex deposit by identifying why it does not cover the May journey.',
		requiredAnswers: [
			/NRC-2026-0321-GLA/i,
			/85[.]00/i,
			/25[.]00.{0,60}(voucher|GWR)|voucher.{0,60}25[.]00/is,
			/60[.]00/i,
			/BEA-DOG-2026-03/i,
			/NR-2026-0506-GLA-01/i,
			/145[.]00/i,
			/BOOK-DOG-2026-0515-AT/i,
			/20[.]00/i,
			/PAY-2026-0412-DOG/i,
			/(April 28|28(?: to 29)? April|2026-04-28)/i,
			/NR-2026-0628-BRI-02/i,
			/138[.]50/i,
			/TAXI-GLA-2026-0628/i,
			/15[.]00/i,
			/Circle/i,
			/Hammersmith\s*(?:&|and)\s*City/i,
			/(?:21 May|May 21|2026-05-21).{0,140}(?:uncovered|gap|not covered|no (?:confirmed |documented )?cover)|(?:uncovered|gap|not covered|no (?:confirmed |documented )?cover).{0,140}(?:21 May|May 21|2026-05-21)/is
		],
		requiresLookup: true,
		requiresArtifact: true,
		minimumArtifactReads: 7
	},
	{
		name: 'Supplier audit proves net May liability while isolating earlier refund cycle',
		forbiddenAnswer:
			/dejar[ií]a.{0,40}(?:en )?cero|140.{0,30}menos 180.{0,20}(?:es|=) 0|ciclo propio y cerrado/is,
		difficulty: 'breaking',
		language: 'es',
		personaId: 'sofia-morales',
		asOfDay: 179,
		question:
			'Para el cierre contable, demuestra con documentos cuánto quedó realmente a pagar por MA-2026-0510: enlaza devolución, soporte, proforma y extracto Visa, y calcula el neto. Después demuestra por qué el reembolso anterior de MA-2026-0325 y la referencia ORANGE-64 no deben contabilizarse otra vez en ese neto.',
		requiredAnswers: [
			/MA-2026-0510/i,
			/RA-2026-0524/i,
			/MA-EXP-2026-0527/i,
			/320[,.]00/i,
			/180[,.]00\s*(EUR|Euro|€)/i,
			/140[,.]00\s*(EUR|Euro|€)/i,
			/(03[./]06|3 de junio|June 3)/i,
			/MA-2026-0325/i,
			/RA-2026-0328/i,
			/ORANGE-64/i,
			/(anterior|separad|distint|no.{0,30}(sumar|contabilizar))/i
		],
		requiresLookup: true,
		requiresArtifact: true,
		minimumArtifactReads: 5
	},
	{
		name: 'May liquidity note exposes a paid-versus-unpaid Atlas contradiction',
		difficulty: 'breaking',
		language: 'en',
		personaId: 'rowan-chen',
		asOfDay: 179,
		question:
			'Prepare the 1 June liquidity note from Rowan’s May business account and company card. Reconcile every May bank movement, closing balance and open card amount with its due date. Then identify the exact Atlas invoice whose March paid receipt conflicts with the May statement’s “unpaid” note; do not silently choose one status.',
		requiredAnswers: [
			/1[,]?450[.]00/i,
			/1[,]?475[.]00/i,
			/25[.]00/i,
			/400[.]00/i,
			/1[,]?200[.]00/i,
			/INV-2026-04-002/i,
			/92[.]50/i,
			/(15 June|June 15|2026-06-15)/i,
			/INV-2026-03-001/i,
			/ATLAS-PAY-2026-0309-02/i,
			/(contradic|conflict|inconsisten)/i,
			/(paid|completed)/i,
			/unpaid/i
		],
		requiresLookup: true,
		requiresArtifact: true,
		minimumArtifactReads: 4
	}
]

const temporalCases: Case[] = []
if (corpusMode === 'persona-temporal') {
	for (const personaId of ['lena-weber', 'sofia-morales', 'rowan-chen']) {
		const candidates =
			enriched?.episodes.filter(
				(episode) =>
					episode.personaId === personaId &&
					episode.askDayIndex - episode.dayIndex >= 8 &&
					!['todo', 'calendar'].includes(episode.kind) &&
					personaCorpus.days.find(
						(day) => day.personaId === personaId && day.dayIndex === episode.askDayIndex
					)?.selectedIntentId !== episode.intentId
			) ?? []
		const sorted = [...candidates].sort((a, b) => a.dayIndex - b.dayIndex)
		const chosen = [60, 115, 165].map(
			(target) =>
				[...sorted].sort(
					(a, b) => Math.abs(a.askDayIndex - target) - Math.abs(b.askDayIndex - target)
				)[0]
		)
		for (const episode of chosen) {
			if (!episode) continue
			temporalCases.push({
				name: `${personaId} ${episode.askDate} ${episode.kind}`,
				language: questionLanguage(
					episode.probe.question,
					personaCorpus.personas.find((persona) => persona.id === personaId)
						?.language as Case['language']
				),
				personaId,
				asOfDay: episode.askDayIndex,
				question: episode.probe.question,
				expectedText: episode.probe.answer,
				requiresLookup: true,
				requiresArtifact: true
			})
		}
	}
	if (temporalCases.length !== 9)
		throw new Error(`Expected nine temporal cases, got ${temporalCases.length}`)
}

const results: Array<Record<string, unknown>> = []
const selectedCases =
	corpusMode === 'persona-heldout'
		? heldoutCases
		: corpusMode === 'persona-temporal'
			? temporalCases
			: corpusMode === 'persona-hard'
				? hardPersonaCases
				: corpusMode === 'persona-breaking'
					? breakingPointCases
					: corpusMode === 'personas'
						? personaCases
						: cases
const replayPath = process.env.LIVE_LLM_REPLAY_PATH
const replayResults = replayPath
	? ((JSON.parse(await Bun.file(replayPath).text()).results ?? []) as Array<{
			case: string
			answer: string
			calls: Array<{ name: string; args: Record<string, unknown> }>
			error: string | null
			elapsedMs: number
			gradingElapsedMs?: number
			modelCalls?: Array<{ name: string; args: Record<string, unknown> }>
			distinctSourceReads?: string[]
			toolResults?: Array<{
				name: string
				args: Record<string, unknown>
				result: Record<string, unknown>
			}>
			diagnostics?: unknown[]
			rubricReview?: { pass: boolean; fingerprint?: string; checks?: unknown[]; error?: string }
		}>)
	: []
const replayByCase = new Map(replayResults.map((result) => [result.case, result]))
for (const testCase of selectedCases.filter(
	(c) =>
		!process.env.LIVE_LLM_CASE_FILTER || c.name.match(new RegExp(process.env.LIVE_LLM_CASE_FILTER))
)) {
	const workspace = testCase.personaId
		? makePersonaWorkspace(testCase.personaId, testCase.asOfDay)
		: makeWorkspace()
	if (testCase.personaId) {
		const datedSnapshot = testCase.asOfDay !== undefined
		if (
			workspace.length < (datedSnapshot ? 35 : 100) ||
			workspace.reduce((total, intent) => total + intent.messages.length, 0) <
				(datedSnapshot ? 600 : 1_500)
		)
			throw new Error(`Persona workspace is not crowded enough: ${testCase.personaId}`)
	} else assertCrowdedFixture(workspace)
	const finalDay = testCase.personaId
		? personaCorpus.days.find(
				(day) => day.personaId === testCase.personaId && day.dayIndex === (testCase.asOfDay ?? 179)
			)
		: undefined
	let selectedId = finalDay?.selectedIntentId ?? workspace[0].id
	const recentIds = finalDay?.recentIntentIds ?? [
		selectedId,
		workspace[4].id,
		workspace[2].id,
		workspace[3].id
	]
	const artifacts = testCase.personaId
		? [
				...personaCorpus.artifacts,
				...(corpusMode === 'persona-heldout' ? heldoutArtifacts : [])
			].filter(
				(artifact) =>
					artifact.personaId === testCase.personaId &&
					artifact.dayIndex <= (testCase.asOfDay ?? 179)
			)
		: []
	const index = new DiskSourceIndex(`live-${crypto.randomUUID()}`)
	const sourceEntries = artifacts.map((a) => ({
		artifactId: a.id,
		intentId: a.intentId,
		title: a.title,
		kind: a.kind,
		summary: a.from,
		createdAt: a.createdAt
	}))
	const byId = new Map(artifacts.map((a) => [a.id, a]))
	for (const entry of sourceEntries)
		await index.put(entry, { content: byId.get(entry.artifactId)?.body, complete: true })
	const provider: SourceProvider = {
		entries: () => sourceEntries,
		index,
		read: async (entry) => ({ content: byId.get(entry.artifactId)?.body, complete: true })
	}
	const sourceReads = new Set<string>()
	const toolResults: Array<{
		name: string
		args: Record<string, unknown>
		result: Record<string, unknown>
	}> = []
	const calls: Array<{ name: string; args: Record<string, unknown> }> = []
	let finalAnswer = ''
	let chat: InstanceType<typeof Chat>
	const backendTools = {
		specs,
		run: async (name: string, raw: string) => {
			let args: Record<string, unknown>
			try {
				args = JSON.parse(raw || '{}')
			} catch {
				args = {}
			}
			calls.push({ name, args })
			const query = String(args.query ?? '').trim()
			const hit = (key: string) =>
				workspace.find((item) => item.id === key) ??
				workspace.find((item) => item.title.toLocaleLowerCase().includes(key.toLocaleLowerCase()))
			let result: Record<string, unknown>
			if (name === 'artifact_search') {
				result = await searchSources(provider, args)
			} else if (name === 'artifact_list') {
				const scope = String(args.intent ?? '').trim()
				const entries = artifacts
					.filter(
						(artifact) =>
							!scope || artifact.intentId === scope || hit(scope)?.id === artifact.intentId
					)
					.sort((a, b) => b.dayIndex - a.dayIndex)
					.map((artifact) => ({
						intentId: artifact.intentId,
						artifactId: artifact.id,
						title: artifact.title,
						kind: artifact.kind,
						summary: artifact.from
					}))
				const page = lookupArtifacts(
					entries,
					query,
					Number(args.offset ?? 0),
					Number(args.limit ?? 20)
				)
				result = {
					ok: true,
					files: page.rows,
					total: page.total,
					offset: page.offset,
					hasMore: page.hasMore,
					nextOffset: page.hasMore ? page.offset + page.rows.length : null
				}
			} else if (name === 'intent_list') {
				const page = lookupIntents(
					workspace,
					query,
					Number(args.offset ?? 0),
					Number(args.limit ?? 20)
				)
				result = {
					ok: true,
					intents: page.rows.map((item) => ({
						id: item.id,
						title: item.title,
						status: item.status,
						type: item.type
					})),
					selected: selectedId,
					total: page.total,
					offset: page.offset,
					hasMore: page.hasMore
				}
			} else if (name === 'message_detail') {
				const message = workspace
					.flatMap((i) => i.messages.map((m) => ({ ...m, intentId: i.id })))
					.find((m) => m.id === args.id)
				if (!message) result = { ok: false, error: 'Message not found' }
				else {
					const offset = Number(args.offset ?? 0)
					result = {
						ok: true,
						...message,
						content: message.content.slice(offset, offset + 12000),
						offset,
						nextOffset: offset + 12000 < message.content.length ? offset + 12000 : null
					}
				}
			} else if (name === 'intent_messages') {
				const scope = args.intent ? hit(String(args.intent)) : null
				const candidates = workspace
					.filter((i) => !args.intent || i.id === scope?.id)
					.flatMap((i) => i.messages.map((m) => ({ ...m, intentId: i.id })))
				const terms =
					query
						.normalize('NFD')
						.replace(/[\u0300-\u036f]/g, '')
						.toLowerCase()
						.match(/[\p{L}\p{N}]+/gu) ?? []
				const matching = candidates
					.filter((m) =>
						terms.every((t) =>
							m.content
								.normalize('NFD')
								.replace(/[\u0300-\u036f]/g, '')
								.toLowerCase()
								.includes(t)
						)
					)
					.reverse()
				const offset = Number(args.offset ?? 0),
					rows = matching.slice(offset, offset + 20)
				result = {
					ok: true,
					messages: rows.map((m) => ({
						...m,
						content: m.content.slice(0, 700),
						hasMoreText: m.content.length > 700
					})),
					offset,
					hasMore: offset + rows.length < matching.length,
					matchMode: query ? 'all-terms' : 'recent'
				}
			} else if (name === 'intent_detail') {
				const intent = hit(String(args.intent ?? selectedId))
				if (!intent) result = { ok: false, error: 'intent not found' }
				else {
					const page = pageMessages(chat.messageHistory(intent.id), query, 0, 10)
					result = {
						ok: true,
						id: intent.id,
						title: intent.title,
						status: intent.status,
						source: intent.source,
						conversation: page.rows,
						conversationMatches: page.total,
						matchMode: page.matchMode,
						activity: [],
						artifacts: artifacts
							.filter((artifact) => artifact.intentId === intent.id)
							.sort(
								(a, b) =>
									Number(a.id.includes(':artifact-')) - Number(b.id.includes(':artifact-')) ||
									b.dayIndex - a.dayIndex
							)
							.slice(0, 10)
							.map((artifact) => ({
								id: artifact.id,
								title: artifact.title,
								kind: artifact.kind
							}))
					}
				}
			} else if (name === 'intent_switch') {
				const intent = hit(String(args.intent ?? ''))
				if (!intent) result = { ok: false, error: 'intent not found' }
				else {
					selectedId = intent.id
					chat.relocateTurn(intent.id)
					result = { ok: true, selected: selectedId }
				}
			} else if (name === 'artifact_detail') {
				result = await readSource(provider, args)
				if (result.ok && 'artifactId' in result) sourceReads.add(String(result.artifactId))
			} else if (name === 'intent_create') {
				result = { ok: true, created: String(args.title ?? '') }
			} else result = { ok: false, error: 'unknown tool' }
			toolResults.push({ name, args, result })
			return { record: JSON.stringify(result), wire: JSON.stringify(result) }
		}
	}
	const cleanTools = cleanRetrievalChatTools(backendTools)
	const modelCalls: Array<{ name: string; args: Record<string, unknown> }> = []
	chat = new Chat(
		{},
		{
			specs: cleanTools.specs,
			run: (name, raw) => {
				modelCalls.push({ name, args: JSON.parse(raw || '{}') })
				return cleanTools.run(name, raw)
			}
		},
		liveStream,
		process.env.LIVE_LLM_INDEPENDENT_REVIEW === 'true' ? independentStream : undefined,
		repairStream
	)

	for (const intent of workspace) chat.hydrate(intent.id, intent.messages)
	chat.use(selectedId)
	chat.onExchange = (_session, _user, assistant) => {
		finalAnswer = assistant.content
	}
	chat.context = () => {
		const shown = selectContextIntents(workspace, selectedId, recentIds)
		return (
			`RECENT INTENTS (${shown.length} of ${workspace.length}):\n` +
			shown
				.map(
					(item) =>
						`- ${item.id}: "${item.title}" (${item.type}, ${item.status}) — ${item.routingSummary}`
				)
				.join('\n') +
			`\nON SCREEN: ${selectedId}. The recent list is incomplete. Search tasks with workspace_search (kind intent) when older work may contain the answer. ` +
			`Use workspace_search (kind message) to search earlier conversation, including this intent's omitted messages. ` +
			`Use workspace_search (kind document) to search all source contents and metadata. Use workspace_read (kind intent) for linked sources, and workspace_read (kind document) to read the actual source file when the question depends on a ticket, booking, email, legal draft or financial record. ` +
			`If another intent is relevant, call intent_switch before answering.`
		)
	}
	const started = Date.now()
	const replay = replayByCase.get(testCase.name)
	if (replayPath && !replay) throw Error(`Replay case is missing: ${testCase.name}`)
	let error: string | null = replay?.error ?? null
	if (replay) {
		finalAnswer = replay.answer
		calls.push(...replay.calls)
		modelCalls.push(...(replay.modelCalls ?? []))
		for (const id of replay.distinctSourceReads ?? []) sourceReads.add(id)
		toolResults.push(...(replay.toolResults ?? []))
	} else {
		try {
			await chat.send(testCase.question)
		} catch (caught) {
			error = String(caught)
		}
		if (!error && chat.failure) error = chat.failure
	}
	const answerElapsedMs = replay?.elapsedMs ?? Date.now() - started
	const answer = finalAnswer || chat.routingReply
	const gradingAnswer = answer.replace(/[‐‑‒–—−]/g, '-')
	const names = calls.map((call) => call.name)
	const retrieved = names.some(
		(name) => name === 'intent_messages' || name === 'intent_detail' || name === 'artifact_detail'
	)
	const lookedUp =
		names.includes('artifact_search') ||
		names.includes('intent_list') ||
		names.includes('artifact_list') ||
		retrieved
	const noCreation = !names.includes('intent_create')
	const requiredChecks =
		testCase.requiredAnswers?.map((pattern) => ({
			pattern: pattern.source,
			matched: pattern.test(gradingAnswer)
		})) ?? []
	const forbiddenHit = testCase.forbiddenAnswer?.test(gradingAnswer) ?? false
	const rubric = heldoutRubrics[testCase.name] ?? breakingRubrics[testCase.name]
	const fingerprint = rubric
		? rubricFingerprint(
				testCase.question,
				answer,
				rubric,
				process.env.OPENAI_EVALUATION_MODEL ?? model
			)
		: undefined
	let rubricReview =
		replay?.rubricReview?.fingerprint === fingerprint ? replay?.rubricReview : undefined
	const gradingStarted = Date.now()
	if (rubric && (!replay || process.env.LIVE_LLM_REGRADE_MODEL === 'true')) {
		try {
			rubricReview = {
				...(await gradeRubric(testCase.question, answer, rubric, independentStream ?? liveStream)),
				fingerprint
			}
		} catch (error) {
			rubricReview = { pass: false, fingerprint, error: String(error) }
		}
	}
	const correctAnswer = rubric
		? rubricReview?.pass === true
		: testCase.answer
			? testCase.answer.test(gradingAnswer)
			: testCase.expectedText
				? supportsExpectedText(gradingAnswer, testCase.expectedText)
				: testCase.requiredAnswers
					? requiredChecks.every((check) => check.matched) && !forbiddenHit
					: /don.t (have|know|find)|couldn.t find|no (record|match)|nicht (gefunden|bekannt)|kein(e|en)? (eintrag|pin|hinweis)/i.test(
							answer
						) && !/\b\d{4,8}\b/.test(answer)
	const switched = names.includes('intent_switch')
	const routingPass = !testCase.expectsSwitch || switched
	const validToolCalls =
		modelCalls.length > 0
			? modelCalls.every(({ name }) => cleanTools.specs.some((spec) => spec.name === name))
			: names.every((name) => name === 'message_detail' || specs.some((spec) => spec.name === name))
	const correctLanguage =
		testCase.language === 'de'
			? /\b(der|die|das|ist|wartet|formular|auf|noch|prozent)\b/i.test(answer)
			: testCase.language === 'es'
				? /\b(la|el|es|está|en|para|clave|encontré|fue)\b/i.test(answer)
				: true
	const passed =
		!error &&
		routingPass &&
		validToolCalls &&
		noCreation &&
		correctAnswer &&
		correctLanguage &&
		(!testCase.requiresLookup || lookedUp) &&
		(!testCase.requiresArtifact || names.includes('artifact_detail')) &&
		(!replay || Array.isArray(replay.distinctSourceReads)) &&
		sourceReads.size >= (testCase.minimumArtifactReads ?? 0)
	const result = {
		case: testCase.name,
		question: testCase.question,
		rubricReview,
		diagnostics: replay?.diagnostics ?? chat.diagnostics,
		toolResults,
		modelCalls,
		toolSurface: [...cleanTools.specs, ...researchSpecs].map((t) => t.name),
		repairModel: process.env.OPENAI_REPAIR_MODEL ?? null,
		distinctSourceReads: [...sourceReads],
		difficulty: testCase.difficulty ?? null,
		language: testCase.language,
		pass: Boolean(passed),
		answer,
		calls,
		error,
		model,
		elapsedMs: answerElapsedMs,
		gradingElapsedMs:
			rubric && (!replay || process.env.LIVE_LLM_REGRADE_MODEL === 'true')
				? Date.now() - gradingStarted
				: (replay?.gradingElapsedMs ?? 0),
		retrieved,
		lookedUp,
		correctLanguage,
		selected: selectedId,
		switchExpected: Boolean(testCase.expectsSwitch),
		switched,
		routingPass,
		validToolCalls,
		artifactUsed: names.includes('artifact_detail'),
		artifactReadCount: sourceReads.size,
		minimumArtifactReads: testCase.minimumArtifactReads ?? 0,
		requiredChecks,
		forbiddenHit
	}
	results.push(result)
	if (process.env.LIVE_LLM_EVIDENCE_PATH)
		await Bun.write(
			process.env.LIVE_LLM_EVIDENCE_PATH,
			JSON.stringify(
				{
					execution: 'live-checkpoint',
					model,
					evaluatorModel: process.env.OPENAI_EVALUATION_MODEL ?? model,
					results
				},
				null,
				2
			)
		)
	index.close()
	process.stdout.write(`${passed ? 'PASS' : 'FAIL'} ${testCase.name} (${result.elapsedMs}ms)\n`)
	process.stdout.write(
		`  tools: ${modelCalls.map((call) => call.name).join(', ') || names.join(', ') || 'none'}\n  answer: ${answer.replace(/\s+/g, ' ').slice(0, 250)}\n`
	)
	if (!routingPass || !validToolCalls)
		process.stdout.write(
			`  routing: ${routingPass ? 'ok' : 'missed switch'}; tool names: ${validToolCalls ? 'valid' : 'invalid call'}\n`
		)
}

const outputPath = process.env.LIVE_LLM_EVIDENCE_PATH
if (outputPath)
	await Bun.write(
		outputPath,
		JSON.stringify(
			{
				baseUrl,
				model,
				toolRoundLimit: MAX_TOOL_ROUNDS,
				maxOutputTokens: Number(process.env.LIVE_LLM_MAX_TOKENS ?? 8192),
				rubricVersion: 6,
				evaluatorModel: process.env.OPENAI_EVALUATION_MODEL ?? model,
				reviewerModel:
					process.env.LIVE_LLM_INDEPENDENT_REVIEW === 'true'
						? process.env.OPENAI_EVALUATION_MODEL
						: model,
				execution: replayPath ? 'regraded-live-output' : 'live',
				grading: {
					requiresEveryExpectedFact: true,
					rejectsForbiddenConclusions: true,
					normalizesUnicodeHyphens: true
				},
				intentCount: isPersonaCorpus ? personaCorpus.intents.length : 260,
				corpus: isPersonaCorpus ? corpusMode : 'crowded-intents',
				results,
				passed: results.filter((result) => result.pass).length
			},
			null,
			2
		)
	)
process.stdout.write(
	`${results.filter((result) => result.pass).length}/${results.length} cases passed.\n`
)
if (results.some((result) => !result.pass)) process.exitCode = 1
