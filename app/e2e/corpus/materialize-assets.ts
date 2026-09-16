/** Turn stored Qwen source records into files that document ingestion can open. */
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { readQwenEpisodes } from './enriched'
import { generatePersonaCorpus } from './persona-model'

const root = join(import.meta.dir, 'generated')
const assetRoot = join(root, 'assets')
const episodes = await readQwenEpisodes()
if (!episodes.length) throw new Error('Generate qwen-episodes.jsonl first.')
const personas = new Map(generatePersonaCorpus().personas.map((persona) => [persona.id, persona]))
await mkdir(assetRoot, { recursive: true })

const html = (value: string) =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
const cleanHeader = (value: string) => value.replace(/[\r\n<>]/g, ' ').trim()
const csv = (value: string) => `"${value.replaceAll('"', '""')}"`
const financialKinds = new Set([
	'receipt',
	'transaction',
	'invoice',
	'payment',
	'card-statement',
	'bank-statement',
	'order',
	'return',
	'voucher',
	'booking',
	'transport-ticket',
	'event-ticket'
])

function htmlAsset(episode: (typeof episodes)[number]): string {
	const body = episode.artifact.body
		.split(/\n\s*\n/)
		.map((paragraph) => `<p>${html(paragraph).replaceAll('\n', '<br>')}</p>`)
		.join('\n')
	const bars = [...createHash('sha256').update(episode.id).digest()]
		.slice(0, 24)
		.map((byte) => `<i style="width:${2 + (byte % 4)}px"></i>`)
		.join('')
	return `<!doctype html><html lang="${episode.artifact.language}"><head><meta charset="utf-8"><title>${html(episode.artifact.title)}</title><style>
body{font:16px/1.5 system-ui,Arial,sans-serif;background:#f4f5f7;color:#192436;margin:0;padding:3rem}main{max-width:760px;margin:auto;background:white;border:1px solid #d7dce4;box-shadow:0 8px 30px #17243a15;padding:2.6rem}h1{font-size:1.65rem;line-height:1.2;margin:.4rem 0 1.5rem}.meta{display:grid;grid-template-columns:8rem 1fr;gap:.5rem;border-top:1px solid #e1e5eb;padding-top:1rem}.kind{font-size:.72rem;letter-spacing:.16em;color:#516b7a;text-transform:uppercase}.body{white-space:normal;margin-top:2rem}.barcode{height:44px;display:flex;align-items:stretch;gap:2px;margin-top:2rem}.barcode i{display:block;background:#243446}footer{border-top:1px solid #e1e5eb;margin-top:2rem;padding-top:1rem;font-size:.72rem;color:#647184}
</style></head><body><main><div class="kind">${html(episode.kind.replaceAll('-', ' '))}</div><h1>${html(episode.artifact.title)}</h1><div class="meta"><b>Date</b><span>${episode.date}</span><b>From</b><span>${html(episode.artifact.from)}</span><b>To</b><span>${html(episode.artifact.to ?? '-')}</span><b>Matter</b><span>${html(episode.intentId)}</span></div><section class="body">${body}</section>${['transport-ticket', 'event-ticket', 'voucher', 'booking'].includes(episode.kind) ? `<div class="barcode" aria-label="Synthetic reference bars">${bars}</div>` : ''}<footer>Synthetic test fixture - no valid ticket, voucher, payment, or agreement is created by this file. Source: ${html(episode.id)}</footer></main></body></html>\n`
}

function emailAsset(episode: (typeof episodes)[number]): string {
	const subject = `=?UTF-8?B?${Buffer.from(episode.artifact.title).toString('base64')}?=`
	const date = new Date(`${episode.date}T18:02:00Z`).toUTCString()
	const mailbox = (value: string, fallback: string) => {
		const address = value.match(/[\w.+-]+@[\w.-]+\.test\b/i)?.[0] ?? fallback
		const name = cleanHeader(value.replace(address, '')) || 'Synthetic contact'
		return `"${name.replaceAll('"', '')}" <${address}>`
	}
	return `From: ${mailbox(episode.artifact.from, 'sender@synthetic.test')}\r\nTo: ${mailbox(episode.artifact.to ?? '', 'recipient@synthetic.test')}\r\nDate: ${date}\r\nSubject: ${subject}\r\nMessage-ID: <${episode.id}@synthetic.test>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nX-Synthetic-Test-Record: true\r\nX-Intent-ID: ${episode.intentId}\r\n\r\n${episode.artifact.body.replaceAll('\n', '\r\n')}\r\n`
}

function calendarAsset(episode: (typeof episodes)[number]): string {
	const body = episode.artifact.body
	const isoDate = body.match(/20\d{2}-\d{2}-\d{2}/)?.[0]
	const localDate = body.match(/\b(\d{1,2})[./](\d{1,2})[./](20\d{2})\b/)
	const sourceDate =
		isoDate ??
		(localDate
			? `${localDate[3]}-${localDate[2].padStart(2, '0')}-${localDate[1].padStart(2, '0')}`
			: episode.date)
	const date = sourceDate.replaceAll('-', '')
	const times = [...body.matchAll(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g)].map((match) => match[0])
	const start = (times[0] ?? '16:30').replace(':', '').padStart(4, '0')
	const end = (
		times[1] ?? `${String((Number(start.slice(0, 2)) + 1) % 24).padStart(2, '0')}:${start.slice(2)}`
	)
		.replace(':', '')
		.padStart(4, '0')
	const timezone =
		episode.personaId === 'rowan-chen'
			? 'Europe/London'
			: episode.personaId === 'sofia-morales'
				? 'Europe/Madrid'
				: 'Europe/Berlin'
	const escapeIcs = (value: string) =>
		value
			.replaceAll('\\', '\\\\')
			.replaceAll('\n', '\\n')
			.replaceAll(',', '\\,')
			.replaceAll(';', '\\;')
	return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//avenOS//Synthetic Corpus//EN\r\nBEGIN:VEVENT\r\nUID:${episode.id}@synthetic.test\r\nDTSTAMP:${episode.date.replaceAll('-', '')}T180200Z\r\nDTSTART;TZID=${timezone}:${date}T${start}00\r\nDTEND;TZID=${timezone}:${date}T${end}00\r\nSUMMARY:${escapeIcs(episode.artifact.title)}\r\nDESCRIPTION:${escapeIcs(episode.artifact.body)}\r\nX-SYNTHETIC-TEST-RECORD:TRUE\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`
}

const assetRows: Array<{
	episodeId: string
	personaId: string
	intentId: string
	kind: string
	path: string
	mediaType: string
	sha256: string
}> = []
const financialRows: string[][] = []
for (const episode of episodes) {
	const folder = join(assetRoot, episode.personaId)
	await mkdir(folder, { recursive: true })
	const extension = ['email', 'support'].includes(episode.kind)
		? 'eml'
		: episode.kind === 'calendar'
			? 'ics'
			: episode.kind === 'todo'
				? 'md'
				: 'html'
	const path = join(folder, `${episode.date}-${episode.id}.${extension}`)
	const rawContent =
		extension === 'eml'
			? emailAsset(episode)
			: extension === 'ics'
				? calendarAsset(episode)
				: extension === 'md'
					? `# ${episode.artifact.title}\n\n- Date: ${episode.date}\n- Intent: ${episode.intentId}\n- Owner: ${episode.artifact.from}\n\n${episode.artifact.body}\n\n_Synthetic test fixture._\n`
					: htmlAsset(episode)
	const content = rawContent.replace(/[ \t]+(?=\r?$)/gm, '')
	await Bun.write(path, content)
	const sha256 = createHash('sha256').update(content).digest('hex')
	const mediaType =
		extension === 'eml'
			? 'message/rfc822'
			: extension === 'ics'
				? 'text/calendar'
				: extension === 'md'
					? 'text/markdown'
					: 'text/html'
	assetRows.push({
		episodeId: episode.id,
		personaId: episode.personaId,
		intentId: episode.intentId,
		kind: episode.kind,
		path: relative(join(import.meta.dir, '..', '..', '..'), path),
		mediaType,
		sha256
	})
	if (financialKinds.has(episode.kind)) {
		const persona = personas.get(episode.personaId)
		const amount =
			episode.artifact.body.match(
				/(?:€|£)\s?\d[\d.,]*|\d[\d.,]*\s?(?:EUR|GBP|Euro|euros|pounds)/i
			)?.[0] ?? ''
		const method =
			persona?.paymentMethods.find((entry) =>
				episode.artifact.body.toLowerCase().includes(entry.split(' ')[0].toLowerCase())
			) ?? ''
		financialRows.push([
			episode.id,
			episode.personaId,
			episode.date,
			episode.kind,
			episode.intentId,
			episode.artifact.title,
			amount,
			method,
			episode.artifact.body
		])
	}
}
await Bun.write(
	join(root, 'asset-manifest.jsonl'),
	`${assetRows.map((row) => JSON.stringify(row)).join('\n')}\n`
)
const ledgerHeader = [
	'episodeId',
	'personaId',
	'date',
	'kind',
	'intentId',
	'title',
	'amountText',
	'paymentMethod',
	'sourceText'
]
await Bun.write(
	join(root, 'financial-events.csv'),
	`${[ledgerHeader, ...financialRows].map((row) => row.map(csv).join(',')).join('\n')}\n`
)
console.log(
	JSON.stringify({ assets: assetRows.length, financialRows: financialRows.length, assetRoot })
)
