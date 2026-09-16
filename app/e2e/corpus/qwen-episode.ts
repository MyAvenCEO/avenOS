import type { CorpusArtifact, CorpusDomain, CorpusLanguage } from './persona-model'

/** Stored model output, replayed without another model call. */
export interface QwenEpisode {
	id: string
	personaId: string
	month: number
	period: number
	dayIndex: number
	date: string
	intentId: string
	domain: CorpusDomain
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
	askDayIndex: number
	askDate: string
}
