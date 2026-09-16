import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { loadEnrichedPersonaCorpus } from './enriched'

const { corpus, episodes } = await loadEnrichedPersonaCorpus()
const outputDirectory = resolve(process.argv[2] ?? join(import.meta.dir, 'generated'))
await mkdir(outputDirectory, { recursive: true })

async function writeLines(name: string, records: object[]): Promise<void> {
	await Bun.write(
		join(outputDirectory, `${name}.jsonl`),
		`${records.map((record) => JSON.stringify(record)).join('\n')}\n`
	)
}

await writeLines('intents', corpus.intents)
await writeLines('contacts', corpus.contacts)
await writeLines('messages', corpus.messages)
await writeLines('artifacts', corpus.artifacts)
await writeLines('days', corpus.days)

const manifest = {
	version: corpus.version,
	synthetic: true,
	startDate: corpus.startDate,
	endDate: corpus.days.find(
		(day) => day.personaId === corpus.personas[0].id && day.dayIndex === corpus.dayCount - 1
	)?.date,
	dayCount: corpus.dayCount,
	personas: corpus.personas,
	contacts: corpus.contacts,
	counts: {
		qwenEpisodes: episodes.length,
		modelSourceKinds: Object.fromEntries(
			[...new Set(episodes.map((episode) => episode.kind))]
				.sort()
				.map((kind) => [kind, episodes.filter((episode) => episode.kind === kind).length])
		),
		contacts: corpus.contacts.length,
		contactLanguages: Object.fromEntries(
			[...new Set(corpus.contacts.map((contact) => contact.language))]
				.sort()
				.map((language) => [
					language,
					corpus.contacts.filter((contact) => contact.language === language).length
				])
		),
		intents: corpus.intents.length,
		messages: corpus.messages.length,
		artifacts: corpus.artifacts.length,
		assetFiles: corpus.artifacts.filter((artifact) => artifact.assetPath).length,
		emails: corpus.artifacts.filter((artifact) => artifact.kind === 'email').length,
		documents: corpus.artifacts.filter((artifact) => artifact.kind === 'document').length,
		calendarEvents: corpus.artifacts.filter((artifact) => artifact.kind === 'calendar').length,
		todos: corpus.artifacts.filter((artifact) => artifact.kind === 'todo').length,
		receipts: corpus.artifacts.filter((artifact) => artifact.kind === 'receipt').length,
		dailySnapshots: corpus.days.length,
		probes: corpus.probes.length
	},
	probes: corpus.probes,
	files: [
		'contacts.jsonl',
		'intents.jsonl',
		'messages.jsonl',
		'artifacts.jsonl',
		'days.jsonl',
		...(episodes.length ? ['qwen-episodes.jsonl'] : [])
	]
}
await Bun.write(join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(JSON.stringify({ outputDirectory, counts: manifest.counts }))
