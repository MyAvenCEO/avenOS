/**
 * Mock actor list + thin helper around {@link ./beam-avatar.ts} (same “beam” algorithm as boring-avatars, MIT).
 */
import { beamAvatarSvg, paletteFromCommaString } from './beam-avatar'

export { paletteFromCommaString }

export type MockInvolvedActor = {
	id: string
	label: string
	seed: string
	colors: string
}

/** Neutral greys only — sits on sage `#e8ede1` without accent hues. */
export const MOCK_BEAM_COLORS = 'eceee9,e0e2dd,d4d6d0,b8bab4,8a8d87'

export const MOCK_INVOLVED_ACTORS: MockInvolvedActor[] = [
	{
		id: 'mock-avenceo',
		label: 'AvenCEO',
		seed: 'Margaret Brent',
		colors: MOCK_BEAM_COLORS
	},
	{
		id: 'mock-dispatch',
		label: 'Dispatcher',
		seed: 'Amelia Earhart',
		colors: MOCK_BEAM_COLORS
	},
	{
		id: 'mock-ocr',
		label: 'OCR worker',
		seed: 'Mary Edwards',
		colors: MOCK_BEAM_COLORS
	},
	{
		id: 'mock-qa',
		label: 'QA checker',
		seed: 'Lucy Stone',
		colors: MOCK_BEAM_COLORS
	},
	{
		id: 'mock-tools',
		label: 'Tool runtime',
		seed: 'Mahalia Jackson',
		colors: MOCK_BEAM_COLORS
	}
]

/** SVG markup for {@html} — mask id scoped per actor. */
export function mockActorBeamSvg(actor: MockInvolvedActor, sizePx: number): string {
	const palette = paletteFromCommaString(actor.colors)
	const maskId = `beam-mask-${actor.id.replace(/[^a-zA-Z0-9_-]/g, '')}`
	return beamAvatarSvg(actor.seed, palette, sizePx, maskId)
}
