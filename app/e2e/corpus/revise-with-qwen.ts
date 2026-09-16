/** Repair connected synthetic episodes with a dated story canon and their full thread. */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { generatePersonaCorpus } from './persona-model'
import type { QwenEpisode } from './qwen-episode'

type Revision = Pick<QwenEpisode, 'id' | 'user' | 'assistant' | 'artifact' | 'probe'>
interface Group {
	id: string
	personaId: string
	intentKeys: string[]
	targets: string[]
	canon: string
}

const groups: Group[] = [
	{
		id: 'clara-early',
		personaId: 'sofia-morales',
		intentKeys: ['valencia-wedding', 'quotes'],
		targets: [
			'qwen-sofia-morales-3-4',
			'qwen-sofia-morales-3-5',
			'qwen-sofia-morales-4-4',
			'qwen-sofia-morales-6-4'
		],
		canon:
			'Clara Beltrán’s Valencia wedding is scheduled for 15 May 2026 and actually takes place then. In February she asks whether June would be possible, but no date change is signed; by early April she chooses to keep 15 May. The February invoice is an advance/proforma for the May wedding, not a final invoice for a February wedding. The 28 February venue access is a site walk-through, not wedding-day setup. The March record is an online/material order for the May event, not an invoice mislabeled as an order. SOL-983 was agreed on 24 January for the eventual venue handoff. No wedding completion before 15 May.'
	},
	{
		id: 'clara-late',
		personaId: 'sofia-morales',
		intentKeys: ['valencia-wedding', 'quotes'],
		targets: ['qwen-sofia-morales-7-2', 'qwen-sofia-morales-10-2', 'qwen-sofia-morales-10-5'],
		canon:
			'Clara Beltrán’s wedding stays on 15 May 2026. Her proposed June move was never signed; by April she keeps 15 May, and the 21 April venue note confirms that. The wedding occurs on 15 May and handoff closes by 4 June. The 6 April legal draft addresses load-in/logistics and cancellation conditions while date remains 15 May; it is not a signed June reschedule. The 21 May order is a separate post-wedding request such as thank-you flowers or extra arrangements for a later gathering, with its own future delivery and price. The 28 May legal draft settles the additional post-event scope or payment, not an unsigned pre-wedding date amendment. Keep SOL-983 only as the May handoff reference.'
	},
	{
		id: 'atlas-spring',
		personaId: 'rowan-chen',
		intentKeys: ['atlas-contract', 'security-audit'],
		targets: ['qwen-rowan-chen-7-2', 'qwen-rowan-chen-8-2'],
		canon:
			'The 2025 Atlas appendix has a 4% rebate. An interim renewal v2.0 proposed 5% on 12 February and was countersigned on 26 February, so 5% applies to March/April invoicing. On 6 April a new v2.1 draft proposes a further increase for May onward but the numerical rate is still being negotiated; it is pending signature on 21 April. Do not reveal 7% in either April source. On 3 May the signed 2026 renewal first confirms the current rebate as 7%, superseding both 4% historic and 5% interim. Do not say 5% is inactive in April; the unsigned April draft concerns a future change. DPA-42 is a separate data-transfer approval and remains pending until evidenced, not a rebate condition.'
	},
	{
		id: 'atlas-summer',
		personaId: 'rowan-chen',
		intentKeys: ['atlas-contract', 'security-audit'],
		targets: ['qwen-rowan-chen-10-5', 'qwen-rowan-chen-11-5', 'qwen-rowan-chen-12-4'],
		canon:
			'The 2025 Atlas rebate was 4%; the February 2026 interim signed rate was 5%; a signed renewal on 3 May sets the CURRENT 7% rebate for May and later invoices. The 28 May legal source is a signed copy or implementation addendum referencing that 3 May approval, not an unsigned draft. The 15 June email confirms 7% is active. The 27 June payment receipt applies or reconciles the 7% term; if an invoice was initially billed at standard rate, show the credit/adjustment and status. DPA-42 production-data approval is independent of the rebate and may still be pending.'
	},
	{
		id: 'nordton-dhl',
		personaId: 'lena-weber',
		intentKeys: ['glaze-supplier', 'orders'],
		targets: ['qwen-lena-weber-6-5', 'qwen-lena-weber-7-1', 'qwen-lena-weber-10-4'],
		canon:
			'Nordton’s January sample kit NT-SMP-2026-04 was held for quality control and released around 10 February; an April support record must concern a NEW spring batch or a later defect, not repeat the same pending February release. Price was 4.20 EUR/kg confirmed on 15 January, and the updated approved price becomes 4.65 EUR/kg on 27 April. BLUE-271 was known from 2 April as a batch release code. Separately, Amira’s plate shipped with DHL on 15 January, she requested a damage return on 6 February, and DHL investigated with photos on 9 February. Amira originally paid Weber Keramik through PayPal; Lena’s own Visa Debit ending 4821 paid the DHL SHIPPING LABEL and must never be described as Amira’s original payment card. By 28 March the returned plate can be received and the CUSTOMER refund can be initiated to Amira’s original PayPal transaction. A May carrier-claim reply concerns DHL compensation to Lena as seller, separate from Amira’s refund; do not repeat an unresolved February support script months later. Keep order, tracking, return and carrier case references consistent.'
	},
	{
		id: 'lena-cashflow',
		personaId: 'lena-weber',
		intentKeys: ['cashflow', 'orders'],
		targets: ['qwen-lena-weber-8-1'],
		canon:
			'On 18 April 2026 Lena is reviewing her business cashflow after the March return of Amira Yilmaz’s damaged Nordblau plate. She initiated a EUR 42.50 customer refund to Amira’s original PayPal transaction on 28 March; a separate PayPal merchant-settlement or reconciliation issue may still be open in April, but a statement issued 18 April must cover a recent April period, not end in February while citing an April reference. Business bank account and Lena’s DHL-label Visa Debit ending 4821 are distinct. The account statement needs at least three April entries and an arithmetic opening/closing balance. Do not say Amira never got a refund if the March return record says the refund was sent.'
	},
	{
		id: 'rowan-kitchen',
		personaId: 'rowan-chen',
		intentKeys: ['kitchen'],
		targets: ['qwen-rowan-chen-10-2'],
		canon:
			'Rowan chose wall colour SALT-312 on 13 February. The 27 March kitchen paint/roller order KS-2026-0327-88 had a missing roller; support case KS-SUP-2026-0403-01 investigated it on 3 April. The 21 May order is a distinct replacement or final touch-up purchase linked to that resolution, with different quantities, a new reference and its own delivery window. It should not copy the March order’s entire item list and boilerplate.'
	},
	{
		id: 'lena-rail',
		personaId: 'lena-weber',
		intentKeys: ['clinic'],
		targets: ['qwen-lena-weber-2-1'],
		canon:
			'Klaus Weber has a clinic-related trip from Berlin Hbf to Potsdam Hbf on 20 January 2026. The booking made on 18 January must use a plausible local/regional Berlin–Potsdam service such as RE1 or S7, never a long-distance ICE. Show credible local fare and accessibility arrangements without claiming a guaranteed wheelchair space or onboard bistro. The ticket holder is Klaus; Lena may ask about the connection or arrival for the appointment.'
	},
	{
		id: 'lena-variety',
		personaId: 'lena-weber',
		intentKeys: [],
		targets: ['qwen-lena-weber-9-3', 'qwen-lena-weber-7-2', 'qwen-lena-weber-10-2'],
		canon:
			'Target qwen-lena-weber-9-3, issued 9 May, is an EVENT TICKET for Britta or Lena to a new concert, theatre show or museum evening happening after 9 May. It is not a property viewing or key handover. Include venue, holder, event date/time, ticket reference, price, admission conditions and enough text to exceed 180 characters. Target qwen-lena-weber-7-2, dated 6 April, is a VERSIONED LEGAL DRAFT of the Prenzlauer Berg studio lease. B-17 fire-safety clearance is still unsigned; the evening-course clause remains conditional and signature state is draft. It cannot be a copied landlord email. Target qwen-lena-weber-10-2, dated 21 May, is an ONLINE GOODS ORDER for the studio fire-safety work such as signs, extinguishers or detectors; include a distinct merchant, at least two priced items, tax, order total, payment, future delivery and status. It is not a signed lease or key handover. Preserve only decisions known by each target date.'
	},
	{
		id: 'sofia-variety',
		personaId: 'sofia-morales',
		intentKeys: [],
		targets: [
			'qwen-sofia-morales-6-3',
			'qwen-sofia-morales-9-3',
			'qwen-sofia-morales-12-5',
			'qwen-sofia-morales-11-3'
		],
		canon:
			'Make these distinct personal/business records rather than repeating an older bank entry, race ticket, rail ticket or card statement with a new date. Sofía uses Bizum/SEPA/Visa last four 6418; realistic records reconcile amounts and include different counterparties and references. A Valencia–Porto rail journey needs changes via Spain and CP Celta, never one direct Renfe train; from April 2026 the Vigo–Valença section has a replacement bus. Each later ticket should be for a genuine new trip or event and each statement a new period with new line items and closing figure.'
	},
	{
		id: 'rowan-variety',
		personaId: 'rowan-chen',
		intentKeys: [],
		targets: [
			'qwen-rowan-chen-8-5',
			'qwen-rowan-chen-9-2',
			'qwen-rowan-chen-9-3',
			'qwen-rowan-chen-12-5'
		],
		canon:
			'These later task, rail and event records copied earlier ones. Each needs a distinct dated development and reference, with the fixed kind respected. GWR can operate London Paddington–Bristol Temple Meads; a Glasgow journey needs changes/other operators. A new event admission must name a real kind of event, venue, holder, time and price. Casual user chat can say Jo, Jamie, Malik or initials rather than full names every time.'
	},
	{
		id: 'lena-dedupe',
		personaId: 'lena-weber',
		intentKeys: [],
		targets: [
			'qwen-lena-weber-4-3',
			'qwen-lena-weber-7-5',
			'qwen-lena-weber-9-5',
			'qwen-lena-weber-10-3',
			'qwen-lena-weber-10-5',
			'qwen-lena-weber-11-4',
			'qwen-lena-weber-12-5'
		],
		canon:
			'These fixed-kind records must each advance a different event and must not copy an earlier template. Lena’s BUSINESS BANK account may use fictional last four 5602; her separate Visa Debit ends 4821. The 24 February bank statement covers 15–24 February with three transactions and mathematically correct opening/closing balances. The 15 April card statement covers a recent March/April period with new purchases, card 4821, statement total and due date; it is not the February bank statement. The 15 May family booking is made that day for a FUTURE summer Berlin trip such as Leipzig, not the already-past April Stralsund trip. The 24 May customer return record closes Olivia Grant’s April damaged-plates replacement case with return/replacement evidence and a distinct RMA; do not copy a receipt. The 28 May legal record is a versioned studio-lease decision: the lease may be executed while evening classes stay prohibited pending B-17 inspection after the 21 May safety-equipment order; it must not copy the 21 April email. The 12 June business bank statement uses account 5602, has new June entries and correct arithmetic, and must not revive Amira’s closed refund. The 28 June clinic ticket is for Klaus’s 29 June Berlin–Potsdam trip but has a different plausible S7 or RE1 connection, fare and reference from his March ticket; no guaranteed wheelchair place.'
	},
	{
		id: 'sofia-running-dedupe',
		personaId: 'sofia-morales',
		intentKeys: ['running'],
		targets: ['qwen-sofia-morales-5-5', 'qwen-sofia-morales-9-2'],
		canon:
			'These are new running-related records, not repeats. The 15 March event ticket is a distinct race after 15 March, with a new race name, distance, venue, holder, date/time, price and reference; it cannot reuse the January Barrio del Carmen event or CPV-2026-0991. The 6 May transport ticket is for a new 9 May day trip from Valencia Nord to Xàtiva for a race or training event, with a plausible Renfe regional service, fare and new reference; it cannot repeat the March Valencia–Sagunt trip. Questions should sound like Sofía checking practical details with Inés.'
	}
]

const baseUrl = process.env.LIVE_LLM_BASE_URL?.replace(/\/$/, '')
const model = process.env.LIVE_LLM_MODEL
if (!baseUrl || !model) throw new Error('Set LIVE_LLM_BASE_URL and LIVE_LLM_MODEL.')
const root = join(import.meta.dir, 'generated')
const packetRoot = join(root, 'revision-packets')
const REVISION_VERSION = 3
await mkdir(packetRoot, { recursive: true })
const raw = (await Bun.file(join(root, 'qwen-episodes.jsonl')).text())
	.trim()
	.split('\n')
	.map((line) => JSON.parse(line) as QwenEpisode)
if (raw.length !== 180)
	throw new Error('Generate the complete first-pass corpus before revising it.')
const corpus = generatePersonaCorpus()
const working = new Map(raw.map((episode) => [episode.id, episode]))
const changed = new Map<string, QwenEpisode>()

const checks: Record<string, { required?: RegExp[]; forbidden?: RegExp[] }> = {
	'qwen-sofia-morales-3-4': { required: [/15[./-]05[./-]2026|2026-05-15|15 de mayo/i] },
	'qwen-sofia-morales-3-5': {
		required: [
			/15[./-]05[./-]2026|2026-05-15|15 de mayo/i,
			/anticipo|proforma|dep[oó]sito|advance/i
		],
		forbidden: [/(?:^|\n)\s*(?:FACTURA FINAL|FINAL INVOICE)\b/im]
	},
	'qwen-sofia-morales-4-4': {
		required: [/visita|recorrido|ensayo|site walk|inspection/i],
		forbidden: [/montaje boda 28[./-]02|wedding setup on 28 February/i]
	},
	'qwen-sofia-morales-6-4': {
		required: [/pedido|order|orden/i, /15[./-]05[./-]2026|2026-05-15|15 de mayo/i],
		forbidden: [/(?:^|\n)\s*(?:FACTURA FINAL|FINAL INVOICE)\b/im]
	},
	'qwen-sofia-morales-7-2': {
		required: [/15[./-]05[./-]2026|2026-05-15|15 de mayo/i, /borrador|draft|pendiente/i],
		forbidden: [/solicita.{0,60}(?:junio|June)/i]
	},
	'qwen-sofia-morales-10-2': {
		required: [
			/pedido|order|orden/i,
			/2[2-9][./]05[./]2026|3[01][./]05[./]2026|2026-05-(?:2[2-9]|3[01])|junio|June|2026-06/i
		]
	},
	'qwen-sofia-morales-10-5': {
		required: [/adicional|extra|complementari|supplement/i],
		forbidden: [/Cambio de Fecha|Date Change/i]
	},
	'qwen-rowan-chen-7-2': {
		required: [/5\s*(?:percent|%)/i, /active|vigente|signed|agreed|applies/i]
	},
	'qwen-rowan-chen-8-2': {
		required: [/5\s*(?:percent|%)/i, /active|signed|agreed|applies/i],
		forbidden: [/5\s*(?:percent|%).{0,50}(?:not active|inactive|not yet active)/i]
	},
	'qwen-rowan-chen-10-5': {
		required: [/7\s*(?:percent|%)/i, /signed|countersigned|active/i],
		forbidden: [/not countersigned|unsigned|not binding|remains in draft/i]
	},
	'qwen-rowan-chen-11-5': {
		required: [/7\s*(?:percent|%)/i, /active|signed|applies/i],
		forbidden: [/not yet active|unsigned|not countersigned|remains in draft/i]
	},
	'qwen-rowan-chen-12-4': {
		required: [/7\s*(?:percent|%)/i, /paid|payment|credit|rebate applied/i],
		forbidden: [/not applied|unsigned|not countersigned|remains in draft/i]
	},
	'qwen-lena-weber-6-5': {
		required: [/erhalten|eingegangen|received|erstattet|refund/i],
		forbidden: [/Status:\s*In Prüfung|in Bearbeitung/i]
	},
	'qwen-lena-weber-7-1': {
		required: [/spring|Frühjahr|neue Charge|new batch/i],
		forbidden: [/February 10|Feb 10|NT-SMP-2026-04\b/i]
	},
	'qwen-lena-weber-10-4': {
		required: [
			/Entschädigung|carrier compensation|Schadensersatz/i,
			/Abgeschlossen|paid|settled|ausgezahlt/i
		],
		forbidden: [/Status:\s*In Prüfung/i]
	},
	'qwen-rowan-chen-10-2': { required: [/replacement|roller|Ersatz|touch-up/i] },
	'qwen-lena-weber-7-2': {
		required: [/mietvertrag|lease/i, /Entwurf|draft|pending|offen/i],
		forbidden: [
			/unterschrieben.{0,60}B-17|signed.{0,60}B-17|B-17.{0,60}(?:erhalten|received|signed)/i
		]
	},
	'qwen-lena-weber-10-2': {
		required: [
			/Bestellung|order|pedido|Artikel|items/i,
			/Brandschutz|fire safety|Werkstatt|studio/i
		],
		forbidden: [/unterzeichneten Mietvertrag|signed lease/i]
	},
	'qwen-lena-weber-9-3': {
		required: [/Konzert|concert|Museum|museum|Ausstellung|theatre|Theater|festival/i],
		forbidden: [/Besichtigungstermin|viewing appointment/i]
	},
	'qwen-lena-weber-2-1': {
		required: [/RE1|S7/i, /Potsdam Hbf/i],
		forbidden: [/ICE\s*1234|Bordbistro|Rollstuhlplatz, Wagen 4/i]
	},
	'qwen-lena-weber-4-3': { required: [/5602/, /Saldo|balance/i] },
	'qwen-lena-weber-7-5': {
		required: [/4821/, /fällig|due date|Zahlungsziel/i],
		forbidden: [/15\.02\.2026\s*-\s*24\.02\.2026/i]
	},
	'qwen-lena-weber-9-5': {
		required: [/Leipzig/i],
		forbidden: [/Stralsund|24\.04\.2026|DB-2026-03-21-9902/i]
	},
	'qwen-lena-weber-10-3': { required: [/RMA|Rücksend|return/i, /Olivia Grant/i] },
	'qwen-lena-weber-10-5': {
		required: [/B-17/i, /Unterzeichnung|unterzeichnet|unterschrieben|executed|signed/i]
	},
	'qwen-lena-weber-11-4': {
		required: [/5602/, /Saldo|balance/i],
		forbidden: [/Amira|PP-2026-0527-AY/i]
	},
	'qwen-lena-weber-12-5': {
		required: [/S\s*7|RE\s*1/i, /29[./]06[./]2026|2026-06-29/i],
		forbidden: [/Rollstuhlplatz, Wagen 2|DB-2026-03-12-4451/i]
	},
	'qwen-sofia-morales-5-5': {
		forbidden: [/Barrio del Carmen|CPV-2026-0991/i]
	},
	'qwen-sofia-morales-9-2': {
		required: [/Xàtiva|Xativa/i],
		forbidden: [/Sagunt|REN-20260312-4419/i]
	}
}

const specificInstructions: Record<string, string> = {
	'qwen-sofia-morales-3-4':
		'The 12 February legal draft must explicitly name the reserved event date as 15/05/2026, even while it discusses a possible June change.',
	'qwen-sofia-morales-3-5':
		'The 15 February invoice is a proforma/advance for the wedding on 15/05/2026, with a numeric amount and due date.',
	'qwen-sofia-morales-4-4':
		'The 28 February venue access record is a site walk-through, not wedding-day setup.',
	'qwen-sofia-morales-6-4':
		'The 27 March file is an itemized order for the 15/05/2026 wedding, not an invoice.',
	'qwen-lena-weber-2-1':
		'The 18 January Berlin–Potsdam ticket must use RE1 or S7, never ICE; it is for Klaus on 20 January.',
	'qwen-rowan-chen-7-2':
		'The 6 April legal source must say the February 5% rebate is active while a newer rate remains unsigned.',
	'qwen-rowan-chen-8-2':
		'The 21 April email must say 5% remains active; no 7% figure can appear before May.',
	'qwen-rowan-chen-10-5':
		'The 28 May legal file refers to the signed 3 May 7% renewal; it is no longer an unsigned draft.',
	'qwen-rowan-chen-11-5': 'The 15 June message confirms the signed 7% rebate applies.',
	'qwen-rowan-chen-12-4':
		'The 27 June receipt records payment or a credit incorporating the active 7% rebate.'
}

function ticketDate(body: string): string | null {
	const match = body.match(
		/(?:Travel Date|Event Date|Date of Event|Reisedatum|Datum|Fecha(?: de viaje| del evento)?|Date)\s*:\s*(20\d{2}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]20\d{2})/i
	)
	if (!match) return null
	if (/^20\d{2}-/.test(match[1])) return match[1]
	const [day, month, year] = match[1].split(/[./]/)
	return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function textSimilarity(left: string, right: string): number {
	const normalize = (value: string) =>
		value
			.toLocaleLowerCase()
			.replace(/20\d{2}[./-]\d{1,2}[./-]\d{1,2}/g, '<date>')
			.replace(/\d+[,.]\d+/g, '<amount>')
			.replace(/\b[A-Z]{2,}(?:-[A-Z0-9]+)+\b/gi, '<ref>')
			.replace(/\s+/g, ' ')
	const grams = (value: string) => {
		const clean = normalize(value)
		return new Set(
			Array.from({ length: Math.max(0, clean.length - 3) }, (_, i) => clean.slice(i, i + 4))
		)
	}
	const a = grams(left)
	const b = grams(right)
	const common = [...a].filter((gram) => b.has(gram)).length
	return common / Math.max(1, a.size + b.size - common)
}

function promptFor(group: Group): string {
	const profile = corpus.personas.find((persona) => persona.id === group.personaId)
	if (!profile) throw new Error(`Unknown person ${group.personaId}`)
	const targets = group.targets.map((id) => working.get(id))
	if (targets.some((episode) => !episode)) throw new Error(`Unknown target in ${group.id}`)
	const first = Math.min(...targets.map((episode) => episode?.dayIndex ?? 0))
	const last = Math.max(...targets.map((episode) => episode?.dayIndex ?? 0))
	const related = [...working.values()]
		.filter(
			(episode) =>
				episode.personaId === group.personaId &&
				!group.targets.includes(episode.id) &&
				(group.intentKeys.length === 0
					? episode.dayIndex >= first - 24 && episode.dayIndex <= last + 20
					: group.intentKeys.some((key) => episode.intentId.endsWith(`:${key}`)))
		)
		.sort((a, b) => a.dayIndex - b.dayIndex)
		.map((episode) => ({
			id: episode.id,
			date: episode.date,
			intentId: episode.intentId,
			kind: episode.kind,
			user: episode.user.slice(0, 180),
			title: episode.artifact.title,
			source: episode.artifact.body.slice(0, 430)
		}))
	const anchors = corpus.messages
		.filter(
			(message) =>
				message.personaId === group.personaId &&
				message.role === 'user' &&
				['decision', 'correction', 'blocker', 'resolution'].includes(message.kind) &&
				(group.intentKeys.length === 0 ||
					group.intentKeys.some((key) => message.intentId.endsWith(`:${key}`)))
		)
		.map((message) => `${message.createdAt.slice(0, 10)} ${message.intentId}: ${message.content}`)
	const assigned = targets.map((episode) => ({
		id: episode?.id,
		date: episode?.date,
		intentId: episode?.intentId,
		kind: episode?.kind,
		artifactLanguage: episode?.artifact.language,
		askDate: episode?.askDate
	}))
	return `Rewrite the assigned episodes from scratch in this entirely fictional 180-day test life. Return JSON only. Their previous source text contained factual errors or repeated boilerplate and has deliberately been withheld. This is a continuity repair, not a new timeline.\n
PERSON: ${JSON.stringify(profile)}\n
RECURRING CONTACTS AND WRITING STYLES: ${JSON.stringify(corpus.contacts.filter((contact) => contact.personaId === group.personaId).map(({ name, role, language, relationship, writingStyle }) => ({ name, role, language, relationship, writingStyle })))}. Familiar names usually shorten in chat; formal file headers may use full names.\n
NON-NEGOTIABLE DATED STORY CANON: ${group.canon}\n
OTHER FIXED HUMAN DECISIONS: ${JSON.stringify(anchors)}. An event dated later is not known to a user in an earlier target message; plan the timeline without leaking future decisions.\n
CONNECTED UNASSIGNED RECORDS TO CHECK FOR CONTRADICTIONS: ${JSON.stringify(related)}. Keep these as given; rewrite the assigned missing records to fit around them. A new record can explicitly correct an earlier provisional draft, but cannot silently make a confirmed event happen months earlier or turn a signed term back into unsigned.\n
ASSIGNED TARGETS (copy each id exactly and preserve its date, Intent, source kind and artifact language; author user, assistant, source and natural follow-up anew): ${JSON.stringify(assigned)}\n
MUST APPEAR IN THE NAMED TARGET'S SOURCE: ${JSON.stringify(Object.fromEntries(group.targets.filter((id) => specificInstructions[id]).map((id) => [id, specificInstructions[id]])))}\n
Write a realistic source file for each fixed kind: an order is an itemized order confirmation, not an invoice; a return has original order and status; a support reply has case evidence and next step; an invoice has line items, tax, total and due date; a legal record names parties, version and signature state; a receipt proves completed payment; a ticket has traveller/holder, route or venue, date/time, fare and reference; a statement has a period, at least three transactions and balance or due figure. Each body should be 220-1,100 characters. Use distinct operational details and avoid copying an earlier file's prose or simply changing its date. Fix impossible rail routes. No full card number, IBAN, real email address or phone; .test domains only.\n
Write the user's chat as this person would actually write: occasional fragments, shorthand and spelling slips in informal chat, precise amounts and formal wording for legal/financial matters. The assistant reply should respond to the current state. For each target, write a believable question the person could ask on its existing askDate in a crowded inbox. Name the relevant trip, order, customer or matter naturally so the referent is clear. Put the exact contiguous probe.answer text in artifact.body. Do not use benchmark wording.\n
Shape: {"revisions":[{"id":"copy target id","user":"...","assistant":"...","artifact":{"title":"...","from":"...","to":null,"language":"en|de|es|pt","body":"..."},"probe":{"question":"...","answer":"..."}}]}`
}

function validate(content: string, group: Group): Revision[] {
	const cleaned = content
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/```\s*$/, '')
		.trim()
	const packet = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1)) as {
		revisions: Revision[]
	}
	if (!Array.isArray(packet.revisions) || packet.revisions.length !== group.targets.length)
		throw new Error(`Wrong revision count for ${group.id}`)
	for (let index = 0; index < group.targets.length; index++) {
		const target = working.get(group.targets[index])
		const revision = packet.revisions[index]
		if (!target || revision?.id !== target.id) throw new Error(`Wrong target order ${index}`)
		if (
			!revision.user ||
			revision.user.length < 25 ||
			!revision.assistant ||
			revision.assistant.length < 40
		)
			throw new Error(`Thin chat ${target.id}`)
		if (
			!revision.artifact?.title ||
			!revision.artifact?.from ||
			!revision.artifact?.body ||
			revision.artifact.body.length < 180
		)
			throw new Error(`Thin source ${target.id}`)
		if (revision.artifact.language !== target.artifact.language)
			throw new Error(`Wrong source language ${target.id}`)
		if (!revision.probe?.question || revision.probe.question.length < 24)
			throw new Error(`Vague question ${target.id}`)
		if (!revision.probe.answer || !revision.artifact.body.includes(revision.probe.answer))
			throw new Error(
				`Answer must copy an exact contiguous substring from artifact.body in ${target.id}; no paraphrase`
			)
		const addresses =
			`${revision.user} ${revision.assistant} ${revision.artifact.from} ${revision.artifact.to ?? ''} ${revision.artifact.body}`.match(
				/[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi
			) ?? []
		if (addresses.some((address) => !address.toLowerCase().endsWith('.test')))
			throw new Error(`Non-synthetic address ${target.id}`)
		const combined = `${revision.user} ${revision.assistant} ${revision.artifact.title} ${revision.artifact.body}`
		if (group.id === 'atlas-spring' && /7\s*(?:percent|%)/i.test(combined))
			throw new Error(`Future signed rebate leaked into ${target.id}`)
		if (group.id === 'nordton-dhl' && target.dayIndex < 116 && /4[,.]65\s*Euro/i.test(combined))
			throw new Error(`Future glaze price leaked into ${target.id}`)
		const rule = checks[target.id]
		const sourceText = `${revision.artifact.title} ${revision.artifact.body}`
		const absent = rule?.required?.find((pattern) => !pattern.test(sourceText))
		if (absent)
			throw new Error(`Missing ${specificInstructions[target.id] ?? absent.source} in ${target.id}`)
		const contradicted = rule?.forbidden?.find((pattern) => pattern.test(sourceText))
		if (contradicted) throw new Error(`Forbidden detail ${contradicted.source} in ${target.id}`)
		if (['transport-ticket', 'event-ticket'].includes(target.kind)) {
			const serviceDate = ticketDate(revision.artifact.body)
			if (serviceDate && serviceDate < target.date)
				throw new Error(`Ticket event precedes issue date in ${target.id}`)
		}
		if (
			(group.id.endsWith('variety') ||
				group.id === 'rowan-kitchen' ||
				group.id === 'nordton-dhl' ||
				group.id.endsWith('dedupe')) &&
			textSimilarity(revision.artifact.body, target.artifact.body) > 0.7
		)
			throw new Error(`Recycled old source prose in ${target.id}`)
	}
	return packet.revisions
}

async function generateGroup(group: Group): Promise<Revision[]> {
	let feedback = ''
	let lastError: unknown
	for (let attempt = 0; attempt < 5; attempt++) {
		try {
			const response = await fetch(`${baseUrl}/v1/chat/completions`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					model,
					temperature: 0.3,
					max_tokens: 8_000,
					response_format: { type: 'json_object' },
					chat_template_kwargs: { enable_thinking: false },
					messages: [
						{
							role: 'system',
							content:
								'You are a continuity editor for fictional longitudinal test records. Preserve fixed routing and source kinds.'
						},
						{
							role: 'user',
							content: `${promptFor(group)}${feedback ? `\nRETRY: Prior output failed because ${feedback}. Correct only that failure while preserving all story constraints.` : ''}`
						}
					]
				}),
				signal: AbortSignal.timeout(120_000)
			})
			if (!response.ok)
				throw new Error(`Qwen HTTP ${response.status}: ${(await response.text()).slice(0, 250)}`)
			const result = (await response.json()) as {
				choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
			}
			const content = result.choices?.[0]?.message?.content ?? ''
			try {
				return validate(content, group)
			} catch (error) {
				await Bun.write(
					join(packetRoot, `${group.id}-rejected-${attempt + 1}.json`),
					`${JSON.stringify({ error: String(error), content }, null, 2)}\n`
				)
				throw new Error(
					`${String(error)}; finish=${result.choices?.[0]?.finish_reason}; chars=${content.length}`
				)
			}
		} catch (error) {
			lastError = error
			feedback = String(error).slice(0, 220)
			await Bun.sleep(750 * (attempt + 1))
		}
	}
	throw new Error(`Revision group ${group.id} failed: ${String(lastError)}`)
}

for (const group of groups) {
	const checkpointPath = join(packetRoot, `${group.id}.json`)
	const checkpointFile = Bun.file(checkpointPath)
	const checkpoint = (await checkpointFile.exists())
		? ((await checkpointFile.json()) as { version: number; revisions: Revision[] })
		: null
	const revisions =
		checkpoint?.version === REVISION_VERSION
			? validate(JSON.stringify(checkpoint), group)
			: await generateGroup(group)
	if (checkpoint?.version !== REVISION_VERSION)
		await Bun.write(
			checkpointPath,
			`${JSON.stringify({ version: REVISION_VERSION, revisions }, null, 2)}\n`
		)
	for (const revision of revisions) {
		const original = working.get(revision.id)
		if (!original) throw new Error(`Missing revised record ${revision.id}`)
		const updated = { ...original, ...revision }
		working.set(revision.id, updated)
		changed.set(revision.id, updated)
	}
	console.log(
		`${group.id}: ${revisions.length} connected records revised${checkpoint?.version === REVISION_VERSION ? ' (checkpoint)' : ''}`
	)
}

await Bun.write(
	join(root, 'qwen-revisions.jsonl'),
	`${[...changed.values()].map((episode) => JSON.stringify(episode)).join('\n')}\n`
)
await Bun.write(
	join(root, 'qwen-revision-generation.json'),
	`${JSON.stringify({ synthetic: true, model, baseUrl, revisionCount: changed.size, groups: groups.map(({ id, targets }) => ({ id, targets })) }, null, 2)}\n`
)
console.log(`Wrote ${changed.size} connected Qwen revisions.`)
