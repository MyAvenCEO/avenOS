import { describe, expect, test } from 'bun:test'
import {
	addChapterEvidence,
	choiceButtons,
	isProviderNameLine,
	navigationButtons,
	progressChipText,
	selectInputColors,
	stationTreeRows,
	TUI_TEXT_INPUT_KEY_BINDINGS,
	terminalColorContrast,
	wrapTerminalText
} from './deployment-bootstrap-tui.js'

describe('deployment bootstrap terminal forms', () => {
	test('wraps prose and provider URLs without dropping content', () => {
		const lines = wrapTerminalText(
			'Provider access must be ready\nhttps://console.hetzner.com/projects/1234567/servers',
			24
		)
		expect(lines.every((line) => line.length <= 24)).toBe(true)
		expect(lines.join('').replaceAll(' ', '')).toContain('Provideraccessmustbeready')
		expect(lines.join('')).toContain('https://console.hetzner')
	})

	test('makes forward movement the default while keeping explicit back navigation', () => {
		expect(navigationButtons(false)).toEqual([{ content: 'Next >', value: 'next' }])
		expect(navigationButtons(true)).toEqual([
			{ content: 'Next >', value: 'next' },
			{ content: '< Back', value: 'back' }
		])
		expect(choiceButtons([{ content: 'Apply now', value: 'apply' }], true)).toEqual([
			{ content: 'Apply now', value: 'apply' },
			{ content: '< Back', value: 'back' }
		])
		expect(TUI_TEXT_INPUT_KEY_BINDINGS).toEqual({ ENTER: 'submit', KP_ENTER: 'submit' })
	})

	test('selects the terminal palette color with strongest input-background contrast', () => {
		const darkBluePalette = Array.from({ length: 16 }, () => ({ r: 120, g: 120, b: 120 }))
		darkBluePalette[0] = { r: 0, g: 0, b: 0 }
		darkBluePalette[4] = { r: 0, g: 0, b: 170 }
		darkBluePalette[15] = { r: 255, g: 255, b: 255 }
		expect(selectInputColors(darkBluePalette)).toEqual({
			color: 15,
			bgColor: 4,
			contrast: terminalColorContrast(darkBluePalette[15], darkBluePalette[4])
		})

		const paleBluePalette = darkBluePalette.map((color) => ({ ...color }))
		paleBluePalette[4] = { r: 220, g: 235, b: 255 }
		expect(selectInputColors(paleBluePalette).color).toBe(0)
		expect(selectInputColors(paleBluePalette).contrast).toBeGreaterThan(7)

		const middleBluePalette = darkBluePalette.map(() => ({ r: 119, g: 119, b: 119 }))
		middleBluePalette[0] = { r: 0, g: 0, b: 0 }
		middleBluePalette[15] = { r: 255, g: 255, b: 255 }
		expect(selectInputColors(middleBluePalette)).toEqual({
			color: 15,
			bgColor: 0,
			contrast: 21
		})
	})

	test('uses an explicit readable fallback when palette reporting is unavailable', () => {
		expect(selectInputColors([])).toEqual({
			color: 'brightWhite',
			bgColor: 'blue',
			contrast: 0
		})
		const malformed = Array.from({ length: 16 }, () => ({ r: 0, g: 0, b: 0 }))
		malformed[4] = { r: Number.NaN, g: 0, b: 0 }
		expect(selectInputColors(malformed).color).toBe('brightWhite')
	})

	test('keeps only relevant, unique evidence for a chapter', () => {
		let evidence: string[] = []
		for (const item of ['account', 'repository', 'region', 'region'])
			evidence = addChapterEvidence(evidence, `✓ ${item}`)
		expect(evidence).toEqual(['✓ account', '✓ repository', '✓ region'])
		evidence = addChapterEvidence(evidence, '✓ project')
		expect(evidence).toEqual(['✓ repository', '✓ region', '✓ project'])
	})

	test('renders a clipped chapter, subchapter, and item tree around the current station', () => {
		const stations = Array.from({ length: 40 }, (_, index) => ({
			chapter: index < 2 ? 'GitHub' : index < 24 ? 'Hetzner' : 'Operations',
			subchapter:
				index < 2
					? undefined
					: index < 7
						? 'identity project'
						: index < 12
							? 'next project'
							: index < 17
								? 'production project'
								: index < 24
									? 'aven.ceo DNS project'
									: undefined,
			item: `Item ${index + 1}`
		}))
		const visible = stationTreeRows(stations, 20, 12)
		expect(visible.length).toBeLessThanOrEqual(12)
		expect(visible[0]).toEqual({ kind: 'ellipsis' })
		expect(visible.at(-1)).toEqual({ kind: 'ellipsis' })
		expect(visible.find((station) => station.kind === 'station' && station.current)).toMatchObject({
			index: 20
		})
		expect(visible).toContainEqual({ kind: 'chapter', label: 'Hetzner', current: true })
		expect(visible).toContainEqual({
			kind: 'subchapter',
			label: 'aven.ceo DNS project',
			current: true
		})
		expect(stationTreeRows(stations, 1, 9).at(-1)).toEqual({ kind: 'ellipsis' })
		expect(stationTreeRows(stations, 40, 9)[0]).toEqual({ kind: 'ellipsis' })
	})

	test('renders a compact progress chip with a changing spinner and stable operation label', () => {
		expect(progressChipText('Checking GitHub login…', 0)).toBe(' ⠋ Checking GitHub login… ')
		expect(progressChipText('Checking GitHub login…', 1)).toBe(' ⠙ Checking GitHub login… ')
		expect(progressChipText('  Applying\nbootstrap  ', 10)).toBe(' ⠋ Applying bootstrap ')
	})

	test('recognizes provider-side names that the form renders in bold', () => {
		expect(isProviderNameLine('Description: avenOS identity bootstrap administrator')).toBe(true)
		expect(isProviderNameLine('Name: avenOS production DNS deployment')).toBe(true)
		expect(isProviderNameLine('Purpose: Creates the identity buckets.')).toBe(false)
	})
})
