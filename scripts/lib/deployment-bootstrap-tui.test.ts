import { describe, expect, test } from 'bun:test'
import {
	addChapterEvidence,
	choiceButtons,
	isProviderNameLine,
	navigationButtons,
	progressChipText,
	TUI_TEXT_INPUT_KEY_BINDINGS,
	visibleStations,
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

	test('keeps only relevant, unique evidence for a chapter', () => {
		let evidence: string[] = []
		for (const item of ['account', 'repository', 'region', 'region'])
			evidence = addChapterEvidence(evidence, `✓ ${item}`)
		expect(evidence).toEqual(['✓ account', '✓ repository', '✓ region'])
		evidence = addChapterEvidence(evidence, '✓ project')
		expect(evidence).toEqual(['✓ repository', '✓ region', '✓ project'])
	})

	test('centers a long station rail and marks hidden stations at both edges', () => {
		const stations = Array.from({ length: 40 }, (_, index) => `Station ${index + 1}`)
		const visible = visibleStations(stations, 20, 9)
		expect(visible).toHaveLength(9)
		expect(visible[0]).toEqual({ kind: 'ellipsis' })
		expect(visible.at(-1)).toEqual({ kind: 'ellipsis' })
		expect(visible.find((station) => station.current)).toMatchObject({ index: 20 })
		expect(visibleStations(stations, 1, 9).at(-1)).toEqual({ kind: 'ellipsis' })
		expect(visibleStations(stations, 40, 9)[0]).toEqual({ kind: 'ellipsis' })
		const tallMiddle = visibleStations(stations, 20, 35)
		expect(tallMiddle[0]).toEqual({ kind: 'ellipsis' })
		expect(tallMiddle.at(-1)).toEqual({ kind: 'ellipsis' })
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
