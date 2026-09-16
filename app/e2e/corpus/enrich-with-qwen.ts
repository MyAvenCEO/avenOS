/** Generate fictional fortnightly episodes with a live OpenAI-compatible Qwen model. */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
	type CorpusArtifact,
	type CorpusDomain,
	type CorpusLanguage,
	generatePersonaCorpus
} from './persona-model'
import type { QwenEpisode } from './qwen-episode'

interface ModelPacket {
	episodes: Array<{
		date: string
		intentId: string
		kind: CorpusArtifact['kind']
		user: string
		assistant: string
		artifact: {
			title: string
			from: string
			to: string | null
			language: CorpusLanguage
			body: string
		}
		probe: { question: string; answer: string }
	}>
	continuity: string
}

const corpus = generatePersonaCorpus()
const baseUrl = process.env.LIVE_LLM_BASE_URL?.replace(/\/$/, '')
const model = process.env.LIVE_LLM_MODEL
if (!baseUrl || !model) throw new Error('Set LIVE_LLM_BASE_URL and LIVE_LLM_MODEL.')
const PROMPT_VERSION = 9
const checkpointDirectory = join(import.meta.dir, 'generated', 'qwen-packets')
await mkdir(checkpointDirectory, { recursive: true })

const sourceKinds: CorpusArtifact['kind'][] = [
	'email',
	'document',
	'calendar',
	'todo',
	'receipt',
	'transport-ticket',
	'event-ticket',
	'voucher',
	'booking',
	'transaction',
	'order',
	'return',
	'support',
	'legal',
	'invoice',
	'payment',
	'card-statement',
	'bank-statement'
]
const firstHalfDays = [3, 6, 9, 12, 15]
const secondHalfDays = [18, 21, 24, 27, 28]

const sourceRules: Record<CorpusArtifact['kind'], string> = {
	email:
		'A provider, customer, supplier, friend, or colleague email with greeting, subject and a specific next step.',
	document: 'A dated working document with sections or bullets and a version/status; not an email.',
	calendar:
		'A calendar entry, not an email: event, start and end time in HH:MM, place/channel, attendees and status.',
	todo: 'A task entry, not a booking or email: owner, concrete action, due date, status and linked matter.',
	receipt:
		'Proof of a completed purchase/payment, not a refund promise or support reply: merchant, item, date, total, currency and method.',
	'transport-ticket':
		'A booked rail/transit ticket, not an order or generic reservation: operator, traveller, route, travel date, departure time, fare, class/seat or accessibility detail, booking reference.',
	'event-ticket':
		'An event admission ticket for a concert, museum, theatre, race or community event; never a rail journey: event, venue, holder, date/time, admission category, price and ticket reference.',
	voucher:
		'A standalone credit/voucher notice, not another ticket or booking: issuer, original reason, value, currency, expiry, redemption limits and reference.',
	booking:
		'A booking confirmation: provider, party, dates/times, service, price, payment or deposit status, cancellation terms and reference.',
	transaction:
		'A posted payment entry: payer/payee, merchant, date, amount/currency, method, posting status and reference; no full account details.',
	order:
		'An online order confirmation: merchant, items, quantity, gross/tax/shipping, paid method, delivery window and order reference.',
	return:
		'A return authorization or drop-off record: original order, items, reason, received/pending status, refund destination and timing.',
	support:
		'A support-thread reply from a named employee: company, case/order reference, what was investigated, evidence, current outcome and next action.',
	legal:
		'A legal contract or draft with parties, dated version, obligations/terms, approval/signature state and what remains open; never pretend a draft is signed.',
	invoice:
		'A business invoice: issuer/client, invoice number, line items, subtotal, tax, total/currency, payment due date and status.',
	payment:
		'A payment confirmation: invoice/order linked, sender/recipient, amount/currency, method, posted/pending state and settlement reference.',
	'card-statement':
		'A credit card statement excerpt with card last four, period, at least three dated line items, total due and payment date.',
	'bank-statement':
		'A bank statement excerpt with account label only, period, opening/closing balance and at least three dated debit/credit entries.'
}

const protectedFacts: Array<{
	personaId: string
	intentKey: string
	firstDay: number
	pattern: RegExp
}> = [
	{
		personaId: 'lena-weber',
		intentKey: 'glaze-supplier',
		firstDay: 14,
		pattern: /4[,.]20\s*Euro/i
	},
	{
		personaId: 'lena-weber',
		intentKey: 'glaze-supplier',
		firstDay: 116,
		pattern: /4[,.]65\s*Euro/i
	},
	{ personaId: 'lena-weber', intentKey: 'father-clinic', firstDay: 38, pattern: /Eingang Nord/i },
	{ personaId: 'lena-weber', intentKey: 'glaze-supplier', firstDay: 91, pattern: /BLUE-271/i },
	{ personaId: 'sofia-morales', intentKey: 'valencia-wedding', firstDay: 23, pattern: /SOL-983/i },
	{
		personaId: 'sofia-morales',
		intentKey: 'quotes',
		firstDay: 48,
		pattern: /12\s*(?:por ciento|%)/i
	},
	{
		personaId: 'sofia-morales',
		intentKey: 'quotes',
		firstDay: 121,
		pattern: /15\s*(?:por ciento|%)/i
	},
	{ personaId: 'sofia-morales', intentKey: 'flower-supplier', firstDay: 67, pattern: /ORANGE-64/i },
	{ personaId: 'sofia-morales', intentKey: 'cold-room', firstDay: 143, pattern: /R-9/i },
	{
		personaId: 'sofia-morales',
		intentKey: 'mother-clinic',
		firstDay: 132,
		pattern: /jueves.{0,20}19:00/i
	},
	{
		personaId: 'rowan-chen',
		intentKey: 'atlas-contract',
		firstDay: 12,
		pattern: /4\s*(?:percent|%)/i
	},
	{
		personaId: 'rowan-chen',
		intentKey: 'atlas-contract',
		firstDay: 122,
		pattern: /7\s*(?:percent|%)/i
	},
	{ personaId: 'rowan-chen', intentKey: 'kitchen', firstDay: 43, pattern: /SALT-312/i },
	{ personaId: 'rowan-chen', intentKey: 'migration', firstDay: 70, pattern: /RIO-588/i },
	{ personaId: 'rowan-chen', intentKey: 'garden', firstDay: 58, pattern: /GREEN-806/i }
]

function sourceLooksRight(kind: CorpusArtifact['kind'], body: string): boolean {
	const time = /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/.test(body)
	const money = /(?:€|£|\bEUR\b|\bGBP\b|\bEuro\b|\beuros\b|\bpounds\b)/i.test(body)
	if (kind === 'calendar')
		return (
			time &&
			/termin|cita|appointment|meeting|evento|event|reuni[aã]o|uhrzeit|teilnehmer|attendees/i.test(
				body
			)
		)
	if (kind === 'todo')
		return /aufgabe|fällig|pendiente|tarea|due|task|prazo|action|erledigen/i.test(body)
	if (kind === 'receipt')
		return (
			money &&
			/quittung|beleg|recibo|receipt|comprovativo|comprobante|justificante|paid|bezahlt|pagado|zahlungsbeleg|zahlungsbestätigung|zahlung bestätigt|payment completed/i.test(
				body
			)
		)
	if (kind === 'transport-ticket')
		return (
			time &&
			money &&
			/train|zug|bahn|renfe|gwr|billete|ticket|fahrkarte|traveller|reisende|viajero/i.test(body) &&
			/route|strecke|ruta|from|nach|to|departure|abfahrt|salida/i.test(body)
		)
	if (kind === 'event-ticket')
		return (
			time &&
			money &&
			/ticket|entrada|eintritt|evento|event|veranstaltung|admission|konzert|concert|museum|museo|theatre|teatro|race|carrera/i.test(
				body
			) &&
			/venue|ort|lugar|stadium|stadion|museum|museo|theatre|teatro|halle|hall|park/i.test(body)
		)
	if (kind === 'voucher') return money && /voucher|gutschein|vale|crédito|credit/i.test(body)
	if (kind === 'card-statement' || kind === 'bank-statement')
		return (body.match(/(?:€|£|\bEUR\b|\bGBP\b)/gi)?.length ?? 0) >= 3
	return true
}

const weekdays: Record<string, number> = {
	sunday: 0,
	sonntag: 0,
	domingo: 0,
	monday: 1,
	montag: 1,
	lunes: 1,
	'segunda-feira': 1,
	tuesday: 2,
	dienstag: 2,
	martes: 2,
	'terça-feira': 2,
	wednesday: 3,
	mittwoch: 3,
	miércoles: 3,
	'quarta-feira': 3,
	thursday: 4,
	donnerstag: 4,
	jueves: 4,
	'quinta-feira': 4,
	friday: 5,
	freitag: 5,
	viernes: 5,
	'sexta-feira': 5,
	saturday: 6,
	samstag: 6,
	sábado: 6
}
const months: Record<string, number> = {
	january: 1,
	januar: 1,
	enero: 1,
	janeiro: 1,
	february: 2,
	februar: 2,
	febrero: 2,
	fevereiro: 2,
	march: 3,
	märz: 3,
	marzo: 3,
	março: 3,
	april: 4,
	abril: 4,
	may: 5,
	mai: 5,
	mayo: 5,
	maio: 5,
	june: 6,
	juni: 6,
	junio: 6,
	junho: 6,
	july: 7,
	juli: 7,
	julio: 7,
	julho: 7,
	august: 8,
	agosto: 8,
	september: 9,
	septiembre: 9,
	setembro: 9,
	october: 10,
	oktober: 10,
	octubre: 10,
	outubro: 10,
	november: 11,
	noviembre: 11,
	novembro: 11,
	december: 12,
	dezember: 12,
	diciembre: 12,
	dezembro: 12
}
function weekdayMismatch(text: string): string | null {
	const pattern =
		/\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sonntag|Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|domingo|lunes|martes|miércoles|jueves|viernes|sábado|segunda-feira|terça-feira|quarta-feira|quinta-feira|sexta-feira)[,\s]+(\d{1,2})\.?\s+(?:de\s+)?([\p{L}]+)\s+(?:de\s+)?(20\d{2})\b/giu
	for (const match of text.matchAll(pattern)) {
		const expected = weekdays[match[1].toLowerCase()]
		const month = months[match[3].toLowerCase()]
		if (expected === undefined || !month) continue
		const actual = new Date(Date.UTC(Number(match[4]), month - 1, Number(match[2]))).getUTCDay()
		if (actual !== expected) return match[0]
	}
	return null
}

function implausibleRoute(personaId: string, kind: CorpusArtifact['kind'], body: string): boolean {
	if (kind !== 'transport-ticket') return false
	if (personaId === 'sofia-morales')
		return (
			/Valencia[\s\S]{0,90}Porto/i.test(body) &&
			/Renfe/i.test(body) &&
			!/Madrid|Vigo|transbordo|cambio|transfer|connection|conexión|conex[aã]o/i.test(body)
		)
	if (personaId === 'lena-weber')
		return /(?:Ankunft|Zielbahnhof|Arrival|Destination)\s*:\s*[^\n]*(?:Klinikum|Klinik|hospital|Praxis)/i.test(
			body
		)
	if (personaId === 'rowan-chen')
		return (
			/GWR[\s\S]{0,120}Bristol[\s\S]{0,100}Glasgow/i.test(body) &&
			!/change|connection|transfer|via|CrossCountry|Avanti|LNER/i.test(body)
		)
	return false
}

function dayIndexOf(date: string): number {
	return Math.round(
		(Date.parse(`${date}T12:00:00Z`) - Date.parse(`${corpus.startDate}T12:00:00Z`)) / 86_400_000
	)
}

function dateAt(dayIndex: number): string {
	const date = new Date(`${corpus.startDate}T12:00:00Z`)
	date.setUTCDate(date.getUTCDate() + dayIndex)
	return date.toISOString().slice(0, 10)
}

function periodSlots(personaId: string, period: number) {
	const month = Math.floor(period / 2)
	const dayNumbers = period % 2 === 0 ? firstHalfDays : secondHalfDays
	return dayNumbers.map((dayNumber, index) => {
		const profile = corpus.personas.find((persona) => persona.id === personaId)
		if (!profile) throw new Error(`Unknown persona ${personaId}`)
		const date = `2026-${String(month + 1).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`
		const dayIndex = dayIndexOf(date)
		const kind = sourceKinds[(period * 5 + index) % sourceKinds.length]
		const domain: CorpusDomain =
			personaId === 'sofia-morales' && period === 8 && index === 0
				? 'personal'
				: ['legal', 'invoice', 'card-statement', 'bank-statement'].includes(kind)
					? 'business'
					: ['transport-ticket', 'event-ticket', 'voucher', 'booking'].includes(kind)
						? 'personal'
						: ['order', 'return', 'support'].includes(kind)
							? personaId === 'rowan-chen'
								? 'personal'
								: 'business'
							: (period + index) % 2 === 0
								? 'business'
								: 'personal'
		const candidates = corpus.intents.filter(
			(intent) => intent.personaId === personaId && intent.core && intent.domain === domain
		)
		const eligible = candidates.filter((intent) =>
			corpus.messages.some(
				(message) =>
					message.intentId === intent.id &&
					message.dayIndex === dayIndex &&
					message.kind === 'check-in'
			)
		)
		const preferred: Partial<Record<CorpusArtifact['kind'], Record<string, string[]>>> = {
			'transport-ticket': {
				'lena-weber': ['family-weekend', 'father-clinic'],
				'sofia-morales': ['porto-visit', 'running'],
				'rowan-chen': ['family-visit', 'household']
			},
			'event-ticket': {
				'lena-weber': ['family-weekend', 'father-clinic'],
				'sofia-morales': ['running', 'porto-visit'],
				'rowan-chen': ['family-visit', 'garden']
			},
			voucher: {
				'lena-weber': ['family-weekend', 'home-budget'],
				'sofia-morales': ['porto-visit', 'running'],
				'rowan-chen': ['family-visit', 'household']
			},
			booking: {
				'lena-weber': ['family-weekend', 'classes'],
				'sofia-morales': ['porto-visit', 'valencia-wedding'],
				'rowan-chen': ['family-visit', 'migration']
			},
			order: {
				'lena-weber': ['orders'],
				'sofia-morales': ['flower-supplier'],
				'rowan-chen': ['kitchen']
			},
			return: {
				'lena-weber': ['orders'],
				'sofia-morales': ['flower-supplier'],
				'rowan-chen': ['kitchen']
			},
			support: {
				'lena-weber': ['orders'],
				'sofia-morales': ['flower-supplier'],
				'rowan-chen': ['kitchen']
			},
			legal: {
				'lena-weber': ['studio-lease'],
				'sofia-morales': ['quotes', 'valencia-wedding'],
				'rowan-chen': ['atlas-contract', 'security-audit']
			},
			invoice: {
				'lena-weber': ['cashflow'],
				'sofia-morales': ['quotes'],
				'rowan-chen': ['invoices']
			},
			'card-statement': {
				'lena-weber': ['cashflow'],
				'sofia-morales': ['quotes'],
				'rowan-chen': ['invoices']
			},
			'bank-statement': {
				'lena-weber': ['cashflow'],
				'sofia-morales': ['quotes'],
				'rowan-chen': ['invoices']
			}
		}
		const preferredKeys = preferred[kind]?.[personaId] ?? []
		const preferredIntent = preferredKeys
			.map((key) => eligible.find((candidate) => candidate.id === `${personaId}:${key}`))
			.find(Boolean)
		const foreignMode = period % 2 === 0 && index === 0
		const foreignContacts = corpus.contacts.filter(
			(contact) =>
				contact.personaId === personaId &&
				contact.language !== profile.language &&
				(personaId !== 'sofia-morales' || period !== 8 || contact.language === 'pt')
		)
		const foreignIntents = candidates.filter((candidate) =>
			foreignContacts.some((contact) => contact.intentKeys.includes(candidate.id.split(':')[1]))
		)
		const intent =
			preferredIntent ??
			(foreignMode && foreignIntents.length
				? foreignIntents[(period / 2) % foreignIntents.length]
				: eligible[(period + index) % eligible.length])
		if (!intent) throw new Error(`No active ${domain} Intent for ${personaId} on ${date}`)
		const intentKey = intent.id.split(':')[1]
		const foreignContact = foreignMode
			? foreignContacts.find((contact) => contact.intentKeys.includes(intentKey))
			: undefined
		const sourceLanguage = foreignContact?.language ?? profile.language
		const relatedContacts = corpus.contacts
			.filter(
				(contact) => contact.personaId === personaId && contact.intentKeys.includes(intentKey)
			)
			.sort((a, b) => Number(b.id === foreignContact?.id) - Number(a.id === foreignContact?.id))
			.slice(0, 3)
			.map((contact) => ({
				name: contact.name,
				role: contact.role,
				organization: contact.organization,
				relationship: contact.relationship,
				writingStyle: contact.writingStyle
			}))
		const delay = ['transport-ticket', 'event-ticket', 'booking', 'calendar', 'todo'].includes(kind)
			? 2
			: ['return', 'support', 'payment', 'order'].includes(kind)
				? 8
				: 18
		const askDayIndex = Math.min(corpus.dayCount - 1, dayIndex + delay)
		return {
			kind,
			sourceRule: sourceRules[kind],
			sourceLanguage,
			sourceContact: foreignContact
				? {
						name: foreignContact.name,
						role: foreignContact.role,
						organization: foreignContact.organization,
						writingStyle: foreignContact.writingStyle
					}
				: null,
			date,
			dayIndex,
			askDayIndex,
			askDate: dateAt(askDayIndex),
			domain,
			intentId: intent.id,
			title: intent.title,
			summary: intent.routingSummary,
			relatedContacts
		}
	})
}

function fixedFacts(personaId: string, endDay: number): string[] {
	return corpus.probes
		.filter(
			(probe) =>
				probe.personaId === personaId &&
				probe.expectedAnswer &&
				probe.anchorDay !== null &&
				probe.anchorDay <= endDay
		)
		.map((probe) => `${dateAt(probe.anchorDay ?? 0)}: ${probe.question} => ${probe.expectedAnswer}`)
}

function threadContext(slot: ReturnType<typeof periodSlots>[number], priorEpisodes: QwenEpisode[]) {
	const earlier = corpus.messages.filter(
		(message) => message.intentId === slot.intentId && message.dayIndex <= slot.dayIndex
	)
	const important = earlier
		.filter(
			(message) =>
				['decision', 'correction', 'blocker', 'resolution'].includes(message.kind) &&
				message.role === 'user'
		)
		.slice(-4)
	const recent = earlier.filter((message) => message.kind === 'check-in').slice(-4)
	const sources = corpus.artifacts
		.filter((artifact) => artifact.intentId === slot.intentId && artifact.dayIndex <= slot.dayIndex)
		.filter((artifact) => !artifact.id.includes(':artifact-') && !artifact.id.includes(':extra-'))
		.slice(-4)
	return {
		date: slot.date,
		intentId: slot.intentId,
		title: slot.title,
		summary: slot.summary,
		knownFacts: fixedFacts(slot.intentId.split(':')[0], slot.dayIndex),
		importantChat: important.map(
			(message) => `${message.createdAt.slice(0, 10)} ${message.content.slice(0, 320)}`
		),
		recentChat: recent.map(
			(message) =>
				`${message.createdAt.slice(0, 10)} ${message.role}: ${message.content.slice(0, 220)}`
		),
		priorGeneratedThread: priorEpisodes
			.filter((episode) => episode.intentId === slot.intentId && episode.dayIndex < slot.dayIndex)
			.slice(-3)
			.map((episode) => ({
				date: episode.date,
				user: episode.user,
				assistant: episode.assistant,
				source: `${episode.artifact.title}: ${episode.artifact.body.slice(0, 300)}`
			})),
		linkedSources: sources.map(
			(artifact) =>
				`${artifact.createdAt.slice(0, 10)} ${artifact.title}: ${artifact.body.slice(0, 330)}`
		)
	}
}

function promptFor(
	personaId: string,
	period: number,
	continuity: string,
	priorEpisodes: QwenEpisode[]
): string {
	const profile = corpus.personas.find((persona) => persona.id === personaId)
	if (!profile) throw new Error(`Unknown persona ${personaId}`)
	const assigned = periodSlots(personaId, period)
	const previousLife = priorEpisodes.slice(-8).map((episode) => ({
		date: episode.date,
		matter: episode.intentId,
		user: episode.user.slice(0, 200),
		source: `${episode.artifact.title}: ${episode.artifact.body.slice(0, 220)}`
	}))
	const crossThreadFacts = corpus.messages
		.filter(
			(message) =>
				message.personaId === personaId &&
				message.dayIndex < assigned[0].dayIndex &&
				message.role === 'user' &&
				['decision', 'correction', 'blocker', 'resolution'].includes(message.kind)
		)
		.slice(-8)
		.map(
			(message) =>
				`${message.createdAt.slice(0, 10)} ${message.intentId}: ${message.content.slice(0, 220)}`
		)
	return `Write a higher-fidelity but entirely fictional fortnight in this person's life. Return JSON only, with exactly five episodes in the assigned order and a concise continuity ledger of open/resolved threads.\n
PERSON: ${profile.name}, ${profile.city}; main language ${profile.language}. ${profile.personalLife} ${profile.businessLife} Writing habit: ${profile.writingStyle}\n
LIFE CANON: Household: ${profile.household} Business: ${profile.businessOperations} Payment methods: ${profile.paymentMethods.join(', ')}. Providers: ${profile.providers.join(', ')}. Recurring costs and duties: ${profile.recurringObligations.join(', ')}. Use believable real-world interactions with these providers, but all individual records are fictional. Card numbers may appear only as fictional last four digits.\n
TRANSPORT REALITY: ${personaId === 'lena-weber' ? 'A DB ticket must run between actual stations, e.g. Berlin Hbf to Potsdam Hbf; a clinic or hospital is reached by a separate local accessible transfer, never named as the destination rail station.' : personaId === 'sofia-morales' ? 'Renfe does not run one direct Valencia-to-Porto train. Valencia–Madrid is a domestic Renfe leg; an onward rail itinerary needs further changes to Vigo-Guixar and the CP Celta to Porto Campanhã. From April 2026 the Celta Vigo–Valença section has a replacement bus during works. A domestic Valencia trip or a separate air/bus booking is also fine. Do not invent a single Renfe Valencia–Porto service.' : 'GWR runs London Paddington–Bristol Temple Meads directly; Bristol–Glasgow needs changes and another operator, not a direct GWR train. Keep station, operator, route, travel date and fare consistent.'} Give realistic operators and connections, but invented booking references and transactions. Avoid claiming a venue, clinic or hotel is a railway station.\n
RECURRING PEOPLE: ${JSON.stringify(corpus.contacts.filter((contact) => contact.personaId === personaId).map((contact) => ({ name: contact.name, role: contact.role, organization: contact.organization, relationship: contact.relationship, writingStyle: contact.writingStyle })))}. These relationships are already known at the start of the corpus. In daily chat ${profile.name} normally refers to a familiar contact by first name, surname, initials, nickname or role according to context, rather than repeatedly saying the full name. A newly met person can be introduced once, then shortened thereafter. Formal contracts, invoices, headers and signatures use full legal names. Vary reference style naturally across episodes; a family chat may omit a name entirely. Reuse these people consistently in messages and sender/recipient lines. They have their own roles, priorities and knowledge; do not make every person agree with ${profile.name}.\n
RELEVANT CONVERSATION THREADS AS OF EACH ASSIGNED DATE: ${JSON.stringify(assigned.map((slot) => threadContext(slot, priorEpisodes)))}. Continue these threads. The last routine check-in is context, not an instruction to repeat its wording.\n
	PERSON-WIDE RECENT EVENTS: ${JSON.stringify(previousLife)}. OTHER THREAD DECISIONS KNOWN BEFORE THIS FORTNIGHT: ${JSON.stringify(crossThreadFacts)}. Do not contradict a known event in another matter; when status changes, explicitly record when and why.\n
PREVIOUS CONTINUITY LEDGER: ${continuity || 'New year; no prior generated episode.'}\n
Do not mention a fact or decision before it appears in that episode's dated thread context. A source from a later assigned episode is unavailable to an earlier one.\n
ASSIGNED EPISODES (copy date and intentId exactly; source kind and natural question date are fixed): ${JSON.stringify(assigned)}\n
For each episode, write a natural user message (25-350 characters) and a useful assistant reply (40-350 characters) tied to the assigned matter. Use ${profile.name}'s writing habits: some casual messages can be fragments, slangy or slightly misspelled; formal requests and all important amounts remain clear. Write a plausible source artifact (220-1,100 characters) with an informative title, sender, and recipient for email/support; other records may name a recipient if realistic. Follow the assigned sourceRule strictly: a calendar slot must be a calendar entry, a todo slot a task, and a receipt slot evidence of a completed payment. Do not put an email reply in those slots. Copy assigned sourceLanguage into artifact.language and write that artifact in that language. When sourceContact is assigned, make that contact the sender or a named participant and reflect their writing habit; ${profile.name} may reply in ${profile.language}. Legal and financial records should be precise even if chat is messy. Include realistic operational detail: an order can be delivered, returned, investigated by support, then refunded to the customer's original card; a carrier claim pays the seller separately. An invoice can be paid and reconciled against a bank entry; a booking can create a ticket or voucher; legal drafts can require a signature before work proceeds. Reuse references and amounts across related records, explain changes, and keep open issues open until evidence arrives. Include ordinary quiet life events alongside business pressure.\n
For financial artifacts include merchant/payee, amount and currency, date, payment method (only last four of a card), status, and a fictional reference. For invoice/legal include parties, document version and approval state; do not invent an approval before its fixed date. For transport/event ticket include operator, traveller, travel/event date, route or venue, fare, and booking reference. For voucher include value, expiry and restrictions. For booking include dates, guests/party, cancellation terms, and confirmation. For order/return/support include the order/case reference and outcome or pending next step. For card/bank statement include at least three short line items and an ending or closing figure. Check any written weekday against its actual 2026 calendar date; if unsure, give the date without a weekday. Do not invent secrets, full card numbers, full IBANs or account numbers, real street addresses, real email domains, or phone numbers. Use only fictional last-four account labels and .test email addresses if needed.\n
Each artifact must contain one short answerable fact. Put an ordinary follow-up question in probe.question that ${profile.name} could naturally ask on the assigned askDate, and the exact contiguous text of its answer in probe.answer. The answer must appear literally in artifact.body. The question should arise from work or life (e.g. what did the refund cover, which departure did we book, what remains unsigned), without benchmark wording such as 'find the source' or 'what is the code hidden in the document'. Preserve the supplied fixed facts and chronology.\n
Shape: {"episodes":[{"date":"YYYY-MM-DD","intentId":"...","kind":"copy assigned source kind exactly","user":"...","assistant":"...","artifact":{"title":"...","from":"...","to":null,"language":"en|de|es|pt","body":"..."},"probe":{"question":"...","answer":"..."}}],"continuity":"..."}`
}

function parsePacket(content: string, personaId: string, period: number): ModelPacket {
	const cleaned = content
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/```\s*$/, '')
		.trim()
	const first = cleaned.indexOf('{')
	const last = cleaned.lastIndexOf('}')
	const packet = JSON.parse(
		cleaned
			.slice(first, last + 1)
			.replaceAll('@example.com', '@example.test')
			.replaceAll('@example.org', '@example.test')
			.replaceAll('@example.net', '@example.test')
	) as ModelPacket
	const assigned = periodSlots(personaId, period)
	if (!Array.isArray(packet.episodes) || packet.episodes.length !== assigned.length)
		throw new Error('Wrong episode count')
	if (typeof packet.continuity !== 'string') throw new Error('Invalid continuity')
	packet.continuity = packet.continuity.slice(0, 1_200).trimEnd()
	for (let index = 0; index < assigned.length; index++) {
		const entry = packet.episodes[index]
		const slot = assigned[index]
		if (entry.date !== slot.date || entry.intentId !== slot.intentId || entry.kind !== slot.kind)
			throw new Error(`Wrong assigned slot ${index}`)
		if (!entry.user || entry.user.length < 25 || !entry.assistant || entry.assistant.length < 40)
			throw new Error(`Thin conversation ${index}`)
		if (
			!entry.artifact?.title ||
			!entry.artifact?.from ||
			!entry.artifact?.body ||
			entry.artifact.body.length < 120
		)
			throw new Error(`Thin artifact ${index}`)
		const foreignSupplierReply =
			personaId === 'sofia-morales' &&
			slot.kind === 'support' &&
			entry.artifact.language === 'en' &&
			/Mar Azul|Oliver Kent/i.test(`${entry.artifact.from} ${entry.artifact.body}`)
		if (entry.artifact.language !== slot.sourceLanguage && !foreignSupplierReply)
			throw new Error(`Wrong source language ${index}`)
		if (!sourceLooksRight(slot.kind, entry.artifact.body))
			throw new Error(`Source kind mismatch ${slot.kind} at ${index}`)
		if (implausibleRoute(personaId, slot.kind, entry.artifact.body))
			throw new Error(`Implausible rail route at ${index}`)
		if (['email', 'support'].includes(slot.kind) && !entry.artifact.to)
			throw new Error(`Email has no recipient ${index}`)
		if (
			!entry.probe?.question ||
			!entry.probe?.answer ||
			!entry.artifact.body.includes(entry.probe.answer)
		)
			throw new Error(`Ungrounded probe ${index}`)
		const combined = `${entry.user} ${entry.assistant} ${entry.artifact.title} ${entry.artifact.from} ${entry.artifact.to ?? ''} ${entry.artifact.body}`
		const wrongWeekday = weekdayMismatch(combined)
		if (wrongWeekday) throw new Error(`Weekday/date mismatch ${wrongWeekday} at ${index}`)
		const addresses = combined.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi) ?? []
		if (addresses.some((address) => !address.toLowerCase().endsWith('.test')))
			throw new Error(`Non-synthetic address ${index}`)
		if (/\b(?:DE\d{20}|ES\d{22}|GB\d{2}[A-Z]{4}\d{14})\b/i.test(combined))
			throw new Error(`Full bank account number ${index}`)
		if (
			protectedFacts.some(
				(fact) =>
					fact.personaId === personaId &&
					fact.intentKey === slot.intentId.split(':')[1] &&
					fact.firstDay > slot.dayIndex &&
					fact.pattern.test(combined)
			)
		)
			throw new Error(`Future fixed fact leaked into ${entry.date} at ${index}`)
	}
	return packet
}

async function requestPacket(
	personaId: string,
	period: number,
	continuity: string,
	priorEpisodes: QwenEpisode[]
): Promise<ModelPacket> {
	let lastError: unknown
	let feedback = ''
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const response = await fetch(`${baseUrl}/v1/chat/completions`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					model,
					temperature: 0.35,
					max_tokens: 8_000,
					response_format: { type: 'json_object' },
					chat_template_kwargs: { enable_thinking: false },
					messages: [
						{
							role: 'system',
							content:
								'You write fictional longitudinal test fixtures. Follow the JSON shape and fixed facts precisely.'
						},
						{
							role: 'user',
							content: `${promptFor(personaId, period, continuity, priorEpisodes)}${feedback ? `\nREGENERATION REQUIRED: Prior output failed validation because ${feedback}. Correct that while preserving all assigned dates, Intents and source kinds.` : ''}`
						}
					]
				}),
				signal: AbortSignal.timeout(120_000)
			})
			if (!response.ok)
				throw new Error(`Qwen HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`)
			const result = (await response.json()) as {
				choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
			}
			const content = result.choices?.[0]?.message?.content ?? ''
			try {
				return parsePacket(content, personaId, period)
			} catch (error) {
				await Bun.write(
					join(
						checkpointDirectory,
						`${personaId}-period-${period + 1}-rejected-${attempt + 1}.json`
					),
					`${JSON.stringify({ error: String(error), content }, null, 2)}\n`
				)
				throw new Error(
					`${String(error)}; finish=${result.choices?.[0]?.finish_reason}; contentChars=${content.length}`
				)
			}
		} catch (error) {
			lastError = error
			feedback = String(error).slice(0, 240)
			await Bun.sleep(750 * (attempt + 1))
		}
	}
	throw new Error(`${personaId} period ${period + 1} failed: ${String(lastError)}`)
}

async function makePerson(personaId: string): Promise<QwenEpisode[]> {
	const episodes: QwenEpisode[] = []
	let continuity = ''
	const periodCount = Math.max(1, Math.min(12, Number(process.env.QWEN_PERIOD_COUNT ?? 12)))
	for (let period = 0; period < periodCount; period++) {
		const checkpointPath = join(
			checkpointDirectory,
			`${personaId}-period-${String(period + 1).padStart(2, '0')}.json`
		)
		const checkpointFile = Bun.file(checkpointPath)
		const checkpoint = (await checkpointFile.exists())
			? ((await checkpointFile.json()) as { promptVersion: number; packet: ModelPacket })
			: null
		const packet =
			checkpoint?.promptVersion === PROMPT_VERSION
				? parsePacket(JSON.stringify(checkpoint.packet), personaId, period)
				: await requestPacket(personaId, period, continuity, episodes)
		if (checkpoint?.promptVersion !== PROMPT_VERSION)
			await Bun.write(
				checkpointPath,
				`${JSON.stringify({ promptVersion: PROMPT_VERSION, packet }, null, 2)}\n`
			)
		const assigned = periodSlots(personaId, period)
		for (let index = 0; index < assigned.length; index++) {
			const slot = assigned[index]
			const generated = packet.episodes[index]
			episodes.push({
				id: `qwen-${personaId}-${period + 1}-${index + 1}`,
				personaId,
				month: Math.floor(period / 2) + 1,
				period: period + 1,
				dayIndex: slot.dayIndex,
				date: slot.date,
				intentId: slot.intentId,
				domain: slot.domain,
				kind: slot.kind,
				user: generated.user,
				assistant: generated.assistant,
				artifact: generated.artifact,
				probe: generated.probe,
				askDayIndex: slot.askDayIndex,
				askDate: slot.askDate
			})
		}
		continuity = packet.continuity
		console.log(
			`${personaId}: period ${period + 1}/${periodCount} validated${checkpoint?.promptVersion === PROMPT_VERSION ? ' (checkpoint)' : ''}`
		)
	}
	return episodes
}

const results = await Promise.all(corpus.personas.map((persona) => makePerson(persona.id)))
const episodes = results
	.flat()
	.sort((a, b) => a.personaId.localeCompare(b.personaId) || a.dayIndex - b.dayIndex)
const outputPath = join(import.meta.dir, 'generated', 'qwen-episodes.jsonl')
await Bun.write(outputPath, `${episodes.map((episode) => JSON.stringify(episode)).join('\n')}\n`)
await Bun.write(
	join(import.meta.dir, 'generated', 'qwen-generation.json'),
	`${JSON.stringify({ synthetic: true, model, baseUrl, promptVersion: PROMPT_VERSION, episodeCount: episodes.length, dates: [corpus.startDate, '2026-06-29'] }, null, 2)}\n`
)
console.log(`Wrote ${episodes.length} validated Qwen episodes to ${outputPath}`)
