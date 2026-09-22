import { currencyMinorDigits } from '@avenos/actors'

export type ArtifactLocator =
	| { kind: 'artifact-root' }
	| { kind: 'json-pointer'; pointer: string }
	| { kind: 'byte-range'; start: number; endExclusive: number }
	| { kind: 'page-region'; page: number; x: number; y: number; width: number; height: number }

export interface ArtifactEvidence {
	ordinal: number
	outputArtifactId: string
	outputLocator: ArtifactLocator
	inputRole: string
	inputOrdinal: number
	inputArtifactId: string
	inputLocator: ArtifactLocator
}

export interface EvidenceResource {
	artifactId: string
	evidence: ArtifactEvidence[]
}

export function objectValue(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {}
}

export function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : []
}

export function stringValue(value: unknown, fallback = '—'): string {
	return typeof value === 'string' && value.length > 0 ? value : fallback
}

export function numberValue(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function formatMoney(
	minor: unknown,
	currency: unknown,
	currencyDisplay: 'symbol' | 'code' = 'symbol'
): string {
	const raw =
		typeof minor === 'string'
			? minor
			: typeof minor === 'number' && Number.isSafeInteger(minor)
				? String(minor)
				: ''
	if (!/^-?(0|[1-9]\d{0,127})$/.test(raw)) return '—'
	if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency))
		return `${raw} minor units · currency unknown`
	const digits = currencyMinorDigits(currency)
	if (digits === null) return `${raw} minor units · currency ${currency} not recognized`
	try {
		const formatter = new Intl.NumberFormat('de-DE', {
			style: 'currency',
			currency,
			currencyDisplay
		})
		const value = BigInt(raw),
			negative = value < 0n
		const absolute = negative ? -value : value,
			scale = 10n ** BigInt(digits)
		const whole = absolute / scale
		// BigInt formatting preserves every digit; avoid a float conversion even for cents.
		const template = negative ? -(whole || 1n) : whole
		return formatter
			.formatToParts(template)
			.map((part) => {
				if (part.type === 'fraction') return (absolute % scale).toString().padStart(digits, '0')
				if (part.type === 'integer' && negative && whole === 0n) return '0'
				return part.value
			})
			.join('')
	} catch {
		return `${raw} minor units · ${currency}`
	}
}

export function formatConfidence(basisPoints: unknown): string {
	const value = numberValue(basisPoints)
	return value === null
		? '—'
		: `${Math.max(0, Math.min(100, value / 100)).toLocaleString('de-DE')} %`
}

export function labelForKey(key: string): string {
	return key
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[-_]/g, ' ')
		.replace(/^./, (letter) => letter.toUpperCase())
}

export function displayValue(value: unknown): string {
	if (value === null || value === undefined || value === '') return '—'
	if (typeof value === 'boolean') return value ? 'Ja' : 'Nein'
	if (typeof value === 'number') return value.toLocaleString('de-DE')
	if (typeof value === 'string') return value
	if (Array.isArray(value)) return value.map(displayValue).join(', ')
	return JSON.stringify(value)
}

function pointerIsWithin(candidate: string, requested: string): boolean {
	return candidate === requested || requested.startsWith(`${candidate}/`)
}

export function evidenceForPointer(
	evidence: ArtifactEvidence[],
	pointer: string
): ArtifactEvidence | null {
	const candidates = evidence.filter(
		(edge) =>
			edge.outputLocator.kind === 'json-pointer' &&
			pointerIsWithin(edge.outputLocator.pointer, pointer)
	)
	return (
		candidates.sort((left, right) => {
			const leftPointer =
				left.outputLocator.kind === 'json-pointer' ? left.outputLocator.pointer : ''
			const rightPointer =
				right.outputLocator.kind === 'json-pointer' ? right.outputLocator.pointer : ''
			return rightPointer.length - leftPointer.length || left.ordinal - right.ordinal
		})[0] ?? null
	)
}

export function splitUtf8Range(
	bytes: Uint8Array,
	start: number,
	endExclusive: number
): { before: string; marked: string; after: string } | null {
	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(endExclusive) ||
		start < 0 ||
		endExclusive <= start ||
		endExclusive > bytes.byteLength
	) {
		return null
	}
	const decoder = new TextDecoder('utf-8', { fatal: true })
	try {
		return {
			before: decoder.decode(bytes.slice(0, start)),
			marked: decoder.decode(bytes.slice(start, endExclusive)),
			after: decoder.decode(bytes.slice(endExclusive))
		}
	} catch {
		return null
	}
}

export function isPreviewableMedia(mediaType: string): boolean {
	return (
		mediaType === 'application/pdf' ||
		mediaType.startsWith('image/') ||
		mediaType.startsWith('text/') ||
		mediaType.includes('json')
	)
}
