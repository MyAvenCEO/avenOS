import { Actor, type Manifest } from './actor'
import { resourceId } from './ids'
import { parseStudioSkillParameters } from './studio/v2'

export const CALCULATION_SCHEMA = resourceId({
	authority: 'ceo.aven',
	kind: 'schema',
	namespace: 'values',
	name: 'calculation',
	version: '2'
})
export const CALCULATION_PARAMETERS = {
	type: 'object',
	additionalProperties: false,
	maxProperties: 5,
	properties: {
		purpose: {
			type: 'string',
			minLength: 1,
			maxLength: 240,
			description: "Briefly name what this requested result means, in the user's language."
		},
		operation: {
			type: 'string',
			maxLength: 16,
			enum: ['add', 'subtract', 'multiply', 'divide', 'compare', 'round']
		},
		operands: {
			type: 'array',
			description:
				'Ordered operands, never sorted by label or amount: subtract computes operands[0] minus each following operand; divide computes operands[0] / operands[1]; compare compares operands[0] to operands[1]. For multiply, supply all factors: at most ONE operand may have a unit other than 1. Repetition counts are scalar factors, with their meaning in label. Do not substitute repeated addition.',
			minItems: 1,
			maxItems: 64,
			items: {
				type: 'object',
				additionalProperties: false,
				maxProperties: 4,
				properties: {
					label: {
						type: 'string',
						minLength: 1,
						maxLength: 160,
						description:
							'What this operand represents, including the period or repetition count when applicable.'
					},
					source: {
						type: 'object',
						description:
							'Name the actual source or user statement. Include an artifact ID or RFC6901 pointer only if obtained from tools; a label is not proof of a source.',
						additionalProperties: false,
						maxProperties: 3,
						properties: {
							label: { type: 'string', minLength: 1, maxLength: 240 },
							artifactId: { type: 'string', minLength: 36, maxLength: 36 },
							pointer: { type: 'string', maxLength: 512 }
						},
						required: ['label']
					},
					value: {
						type: 'string',
						minLength: 1,
						maxLength: 163,
						description:
							'Exact decimal string, dot separator, no grouping or exponent. Currency is in major units, never implicit cents.'
					},
					unit: {
						type: 'string',
						minLength: 1,
						maxLength: 64,
						description:
							'1 for pure numbers and repetition factors; currency:<ISO code> for money; quantity:<name> for measured counts. In multiplication, a count of items, periods or packs uses 1, NOT quantity:<name>; label describes what repeats. Add/subtract/compare require identical units. No implicit conversion or compound units.'
					}
				},
				required: ['value', 'unit']
			}
		},
		decimal_places: { type: 'integer', minimum: 0, maximum: 32 },
		rounding: {
			type: 'string',
			maxLength: 16,
			enum: ['half-even', 'half-up', 'toward-zero', 'floor', 'ceiling']
		}
	},
	required: ['operation', 'operands']
}
export const CALCULATION_MANIFEST: Manifest = {
	id: 'calculator',
	authority: 'ceo.aven',
	namespace: 'values',
	version: '2',
	name: 'Exact calculations',
	tags: ['numbers', 'analysis'],
	description: 'Exact decimal arithmetic with explicit units, shared by chat and Skills.',
	methods: [
		{
			name: 'calculate',
			mode: 'transform',
			idempotency: 'pure',
			description:
				'Perform a requested exact calculation, not an unsolicited demonstration. For contextual calculations supply purpose and a label for EACH operand; pure numeric expressions may omit them. Checks arithmetic, not source truth: explain exclusions, overlap and incompatible populations before adding. Same currency alone does not make facts summable. ' +
				'Divide accepts a scalar divisor or identical units (ratio). Round needs decimal_places and rounding; division is exact unless BOTH are supplied. Ask for a rounding choice for non-terminating division. Compare returns -1, 0 or 1. In Skills bind optional source and previous artifacts for provenance. Output includes /result/value, /result/unit and human-readable /text.',
			parameters: CALCULATION_PARAMETERS,
			requires: [],
			produces: ['ceo.aven.values.calculation(C)'],
			inputSlots: [
				{
					name: 'source',
					schema: resourceId({
						authority: 'ceo.aven',
						kind: 'schema',
						namespace: 'ai',
						name: 'completion',
						version: '1'
					}),
					predicate: 'ceo.aven.ai.completion(C)',
					role: 'source',
					cardinality: 'optional'
				},
				{
					name: 'previous',
					schema: CALCULATION_SCHEMA,
					predicate: 'ceo.aven.values.calculation(C)',
					role: 'previous',
					cardinality: 'optional'
				}
			],
			outputSlots: [
				{
					name: 'calculation',
					schema: CALCULATION_SCHEMA,
					predicate: 'ceo.aven.values.calculation(C)',
					role: 'calculation',
					cardinality: 'one'
				}
			]
		}
	]
}

type Decimal = { coefficient: bigint; scale: number }
export type MeasuredDecimal = { value: string; unit: string }
export type CalculationOperand = MeasuredDecimal & {
	label?: string
	source?: { label: string; artifactId?: string; pointer?: string }
}
export type CalculationResult = {
	purpose?: string
	operation: string
	operands: CalculationOperand[]
	result: MeasuredDecimal
	exact: boolean
	text: string
	decimal_places?: number
	rounding?: string
}
const fail = (message: string): never => {
	throw new Error(`CALCULATION_INVALID: ${message}`)
}
const pow = (n: number) => 10n ** BigInt(n)
const abs = (n: bigint) => (n < 0n ? -n : n)
function bounded(d: Decimal): Decimal {
	while (d.scale > 0 && d.coefficient % 10n === 0n) {
		d.coefficient /= 10n
		d.scale--
	}
	if (d.scale > 32 || abs(d.coefficient).toString().length > 128)
		fail('Decimal exceeds 128 digits or 32 decimal places.')
	return d
}
function decimal(value: string): Decimal {
	if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))
		fail('Use decimal strings with a dot, without grouping or exponents.')
	const [whole, fraction = ''] = value.split('.')
	if (fraction.length > 32 || whole!.replace('-', '').length + fraction.length > 128)
		fail('Operand exceeds 128 digits or 32 decimal places.')
	return bounded({ coefficient: BigInt(whole! + fraction), scale: fraction.length })
}
function render(d: Decimal): string {
	const digits = abs(d.coefficient)
		.toString()
		.padStart(d.scale + 1, '0')
	return (
		(d.coefficient < 0n ? '-' : '') +
		(d.scale ? digits.slice(0, -d.scale) + '.' + digits.slice(-d.scale) : digits)
	)
}
function unit(value: string) {
	// Unit identities are explicit, case-sensitive tokens. Never guess conversion,
	// currency minor-unit scale, or equivalence of two quantity names.
	if (value === '1' || /^quantity:[A-Za-z][A-Za-z0-9._-]{0,47}$/.test(value)) return value
	if (
		/^currency:[A-Z]{3}$/.test(value) &&
		Intl.supportedValuesOf('currency').includes(value.slice(9))
	)
		return value
	return fail(
		'Use unit 1, currency:<supported ISO code>, or quantity:<name>. Game tokens are quantities, not currencies.'
	)
}
const sameUnit = (a: string, b: string) => {
	if (a !== b) fail('Units differ. No currency or quantity conversion is implicit.')
}
function roundedQuotient(n: bigint, d: bigint, mode: string): bigint {
	const q = n / d,
		r = n % d
	if (!r) return q
	const sign = n < 0n !== d < 0n ? -1n : 1n
	const half = abs(r) * 2n - abs(d)
	const away =
		mode === 'ceiling'
			? sign > 0n
			: mode === 'floor'
				? sign < 0n
				: mode === 'half-up'
					? half >= 0n
					: mode === 'half-even'
						? half > 0n || (half === 0n && abs(q) % 2n === 1n)
						: false
	return away ? q + sign : q
}

/** No eval, models, network, persistence or binary floating-point arithmetic. */
export function calculate(raw: unknown): CalculationResult {
	const p = parseStudioSkillParameters({ parametersSchema: CALCULATION_PARAMETERS }, raw)
	const operation = String(p.operation),
		operands = p.operands as CalculationOperand[]
	const values = operands.map((o) => {
		if (
			o.source?.artifactId &&
			!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(o.source.artifactId)
		)
			fail('Source artifactId must be an actual artifact UUID.')
		if (
			o.source?.pointer !== undefined &&
			(!o.source.artifactId || !/^(?:\/(?:[^~]|~[01])*)*$/.test(o.source.pointer))
		)
			fail('A source pointer requires an artifactId and a valid RFC6901 pointer.')
		unit(o.unit)
		return decimal(o.value)
	})
	const places = p.decimal_places as number | undefined,
		rounding = p.rounding as string | undefined
	if ((places === undefined) !== (rounding === undefined))
		fail('Supply decimal_places and rounding together.')
	if (!['round', 'divide'].includes(operation) && places !== undefined)
		fail('Rounding is a separate round step except for division.')
	if (
		(operation === 'round' && operands.length !== 1) ||
		(['divide', 'compare'].includes(operation) && operands.length !== 2) ||
		(!['round', 'divide', 'compare'].includes(operation) && operands.length < 2)
	)
		fail('round takes one operand; divide/compare take two; other operations take 2–64.')
	if (operation === 'round' && places === undefined)
		fail('Choose decimal_places and rounding explicitly.')
	let result = values[0]!,
		resultUnit = operands[0]!.unit,
		exact = true
	for (let i = 1; i < values.length; i++) {
		const b = values[i]!,
			bUnit = operands[i]!.unit
		if (['add', 'subtract', 'compare'].includes(operation)) {
			sameUnit(resultUnit, bUnit)
			const scale = Math.max(result.scale, b.scale),
				aN = result.coefficient * pow(scale - result.scale),
				bN = b.coefficient * pow(scale - b.scale)
			result =
				operation === 'compare'
					? { coefficient: aN < bN ? -1n : aN > bN ? 1n : 0n, scale: 0 }
					: bounded({ coefficient: operation === 'add' ? aN + bN : aN - bN, scale })
			if (operation === 'compare') resultUnit = '1'
		} else if (operation === 'multiply') {
			if (resultUnit !== '1' && bUnit !== '1')
				fail(
					'Multiply supports one measured quantity and scalar factors. Compound units need an explicit conversion or price schema.'
				)
			if (resultUnit === '1') resultUnit = bUnit
			result = bounded({
				coefficient: result.coefficient * b.coefficient,
				scale: result.scale + b.scale
			})
		} else if (operation === 'divide') {
			if (!b.coefficient) fail('Cannot divide by zero.')
			if (bUnit !== '1') {
				sameUnit(resultUnit, bUnit)
				resultUnit = '1'
			}
			const n = result.coefficient * pow(b.scale),
				d = b.coefficient * pow(result.scale)
			if (places !== undefined) {
				exact = (n * pow(places)) % d === 0n
				result = bounded({
					coefficient: roundedQuotient(n * pow(places), d, rounding!),
					scale: places
				})
			} else {
				let scale = 0
				while (scale <= 32 && (n * pow(scale)) % d !== 0n) scale++
				if (scale > 32)
					fail(
						'Division does not terminate within 32 decimal places. Choose decimal_places and rounding.'
					)
				result = bounded({ coefficient: (n * pow(scale)) / d, scale })
			}
		}
	}
	if (operation === 'round' && result.scale > places!) {
		const divisor = pow(result.scale - places!)
		exact = result.coefficient % divisor === 0n
		result = bounded({
			coefficient: roundedQuotient(result.coefficient, divisor, rounding!),
			scale: places!
		})
	}
	const measured = { value: render(result), unit: resultUnit }
	const label = (o: MeasuredDecimal) => o.value + (o.unit === '1' ? '' : ' ' + o.unit.split(':')[1])
	const symbol = {
		add: '+',
		subtract: '−',
		multiply: '×',
		divide: '÷',
		compare: 'compared with',
		round: ''
	}[operation]
	return {
		...(p.purpose ? { purpose: String(p.purpose) } : {}),
		operation,
		operands,
		result: measured,
		exact,
		text: `${operation === 'round' ? 'Round ' : ''}${operands.map(label).join(` ${symbol} `)} ${exact ? '=' : '≈'} ${label(measured)}`,
		...(places === undefined ? {} : { decimal_places: places, rounding })
	}
}

/** Chat's bus and the durable runtime use this same Actor implementation. */
export function createCalculationActor(
	parameters: (raw: Record<string, unknown>) => unknown = (raw) => raw
) {
	return new Actor(CALCULATION_MANIFEST, {
		calculate: (raw) => {
			// The host adapts named artifact ports to resolved public parameters.
			const result = calculate(parameters(raw))
			return {
				record: JSON.stringify({ ok: true, outputs: { calculation: result } }),
				wire: result.text
			}
		}
	})
}
