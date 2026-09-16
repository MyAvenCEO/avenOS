/** Replay stored Qwen episodes onto the deterministic 180-day timeline. */
import { join } from 'node:path'
import { generatePersonaCorpus, type PersonaCorpus } from './persona-model'
import type { QwenEpisode } from './qwen-episode'

export function questionLanguage(
	question: string,
	fallback: 'en' | 'de' | 'es'
): 'en' | 'de' | 'es' {
	const words = question.toLocaleLowerCase().match(/[\p{L}]+/gu) ?? []
	const score = (vocabulary: string[]) => words.filter((word) => vocabulary.includes(word)).length
	const scores = {
		de: score([
			'was',
			'wann',
			'wie',
			'welche',
			'welcher',
			'wer',
			'wo',
			'ist',
			'hat',
			'haben',
			'für',
			'mit',
			'ich'
		]),
		es: score([
			'qué',
			'cuándo',
			'cómo',
			'cuál',
			'quién',
			'dónde',
			'para',
			'con',
			'fue',
			'era',
			'hemos'
		]),
		en: score(['what', 'when', 'how', 'which', 'who', 'where', 'the', 'was', 'did', 'we', 'for'])
	}
	const best = (Object.entries(scores) as Array<['en' | 'de' | 'es', number]>).sort(
		(a, b) => b[1] - a[1]
	)[0]
	return best[1] > 0 ? best[0] : fallback
}

export async function readQwenEpisodes(
	path = join(import.meta.dir, 'generated', 'qwen-episodes.jsonl')
): Promise<QwenEpisode[]> {
	const file = Bun.file(path)
	if (!(await file.exists())) return []
	const episodes = (await file.text())
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as QwenEpisode)
	const revisionsFile = Bun.file(join(import.meta.dir, 'generated', 'qwen-revisions.jsonl'))
	if (!(await revisionsFile.exists())) return episodes
	const revisions = (await revisionsFile.text())
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as QwenEpisode)
	const byId = new Map(revisions.map((episode) => [episode.id, episode]))
	if (byId.size !== revisions.length) throw new Error('Duplicate Qwen revision id')
	if (revisions.some((episode) => !episodes.some((base) => base.id === episode.id)))
		throw new Error('Qwen revision points to an unknown episode')
	return episodes.map((episode) => byId.get(episode.id) ?? episode)
}

export async function loadEnrichedPersonaCorpus(): Promise<{
	corpus: PersonaCorpus
	episodes: QwenEpisode[]
}> {
	const corpus = generatePersonaCorpus()
	const episodes = await readQwenEpisodes()
	const assetsFile = Bun.file(join(import.meta.dir, 'generated', 'asset-manifest.jsonl'))
	const assetRows = (await assetsFile.exists())
		? (await assetsFile.text())
				.split('\n')
				.filter(Boolean)
				.map((line) => JSON.parse(line) as { episodeId: string; path: string })
		: []
	const assetByEpisode = new Map(assetRows.map((row) => [row.episodeId, row.path]))
	const byIntent = new Map(corpus.intents.map((intent) => [intent.id, intent]))
	const byPersona = new Map(corpus.personas.map((persona) => [persona.id, persona]))
	const byDay = new Map(corpus.days.map((day) => [`${day.personaId}:${day.dayIndex}`, day]))
	for (const episode of episodes) {
		const intent = byIntent.get(episode.intentId)
		const persona = byPersona.get(episode.personaId)
		const day = byDay.get(`${episode.personaId}:${episode.dayIndex}`)
		if (!intent || !persona || !day || intent.personaId !== persona.id || day.date !== episode.date)
			throw new Error(`Invalid Qwen episode routing/date: ${episode.id}`)
		if (!episode.artifact.body.includes(episode.probe.answer))
			throw new Error(`Ungrounded Qwen answer: ${episode.id}`)
		const artifactId = `${episode.id}:artifact`
		corpus.messages.push(
			{
				id: `${episode.id}:user`,
				personaId: persona.id,
				intentId: intent.id,
				createdAt: `${episode.date}T18:00:00Z`,
				dayIndex: episode.dayIndex,
				role: 'user',
				kind: 'episode',
				content: episode.user
			},
			{
				id: `${episode.id}:assistant`,
				personaId: persona.id,
				intentId: intent.id,
				createdAt: `${episode.date}T18:01:00Z`,
				dayIndex: episode.dayIndex,
				role: 'assistant',
				kind: 'episode',
				content: episode.assistant
			}
		)
		corpus.artifacts.push({
			id: artifactId,
			personaId: persona.id,
			intentId: intent.id,
			dayIndex: episode.dayIndex,
			createdAt: `${episode.date}T18:02:00Z`,
			kind: episode.kind,
			language: episode.artifact.language,
			title: episode.artifact.title,
			from: episode.artifact.from,
			to: episode.artifact.to,
			body: episode.artifact.body,
			supersedesId: null,
			...(assetByEpisode.get(episode.id) ? { assetPath: assetByEpisode.get(episode.id) } : {})
		})
		corpus.probes.push({
			id: `${episode.id}:probe`,
			personaId: persona.id,
			language: questionLanguage(episode.probe.question, persona.language),
			question: episode.probe.question,
			expectedAnswer: episode.probe.answer,
			answerMode: 'historical',
			anchorDay: episode.dayIndex,
			askDayIndex: episode.askDayIndex,
			askDate: episode.askDate,
			targetIntentId: intent.id,
			targetArtifactId: artifactId
		})
		day.createdArtifactIds.push(artifactId)
		if (!day.touchedIntentIds.includes(intent.id)) day.touchedIntentIds.push(intent.id)
	}
	for (const persona of corpus.personas) {
		let recent: string[] = []
		for (const day of corpus.days.filter((entry) => entry.personaId === persona.id)) {
			for (const id of day.touchedIntentIds) {
				recent = [id, ...recent.filter((old) => old !== id)].slice(0, 8)
			}
			day.selectedIntentId = recent[0]
			day.recentIntentIds = [...recent]
		}
	}
	corpus.messages.sort(
		(a, b) =>
			a.personaId.localeCompare(b.personaId) ||
			a.createdAt.localeCompare(b.createdAt) ||
			a.id.localeCompare(b.id)
	)
	corpus.artifacts.sort(
		(a, b) =>
			a.personaId.localeCompare(b.personaId) ||
			a.createdAt.localeCompare(b.createdAt) ||
			a.id.localeCompare(b.id)
	)
	return { corpus, episodes }
}
