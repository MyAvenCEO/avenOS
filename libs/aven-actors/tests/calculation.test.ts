import { describe, expect, test } from 'bun:test'
import {
	CALCULATION_MANIFEST,
	CALCULATION_PARAMETERS,
	calculate,
	createCalculationActor,
	MessageBus,
	parseStudioPublicParametersSchema
} from '../src'

const value = (value: string, unit = '1') => ({ value, unit })
const run = (operation: string, operands: ReturnType<typeof value>[], extra = {}) =>
	calculate({ operation, operands, ...extra })
describe('shared exact calculation Actor', () => {
	test('preserves meaning and source references without changing arithmetic or asserting source truth', () => {
		const operands = [
			{
				value: '7',
				unit: 'quantity:transactions',
				label: 'Synthetic warehouse A deliveries',
				source: {
					label: 'Test-warehouse-A.csv',
					artifactId: '11111111-1111-4111-8111-111111111111',
					pointer: '/statement/transactions'
				}
			},
			{
				value: '23',
				unit: 'quantity:transactions',
				label: 'Synthetic warehouse B deliveries',
				source: { label: 'Test-warehouse-B.csv' }
			}
		]
		const result = calculate({
			operation: 'add',
			purpose: 'Deliveries in two synthetic CSVs',
			operands
		})
		expect(result.operands).toEqual(operands)
		expect(result.purpose).toBe('Deliveries in two synthetic CSVs')
		expect(result.result).toEqual({ value: '30', unit: 'quantity:transactions' })
		expect(() =>
			calculate({
				operation: 'add',
				operands: [
					{ ...operands[0], source: { label: 'Invented', artifactId: 'not-an-artifact' } },
					operands[1]
				]
			})
		).toThrow()
		expect(() =>
			calculate({
				operation: 'add',
				operands: [
					{ ...operands[0], source: { label: 'Missing ID', pointer: '/rows' } },
					operands[1]
				]
			})
		).toThrow()
		expect(() =>
			calculate({
				operation: 'add',
				operands: [operands[0], { ...operands[1], unit: 'quantity:invoices' }]
			})
		).toThrow('Units differ')
	})
	test('the public contract is authorable and the bus invokes the same arithmetic', async () => {
		expect(parseStudioPublicParametersSchema(CALCULATION_PARAMETERS)).toEqual(
			CALCULATION_PARAMETERS
		)
		const actor = createCalculationActor(),
			bus = new MessageBus()
		bus.register(actor)
		const args = {
			operation: 'multiply',
			operands: ['234567', '87654.21', '4321'].map((n) => value(n))
		}
		const reply = JSON.parse((await bus.dispatch('test', 'calculate', args)).record)
		expect(reply.outputs.calculation).toEqual(calculate(args))
		expect(reply.outputs.calculation.result.value).toBe('88843152318019.47')
		expect(CALCULATION_MANIFEST.methods[0]!.idempotency).toBe('pure')
		actor.dispose()
	})
	test('major amounts, dimensionless factors and token quantities never become cents', () => {
		expect(run('multiply', [value('2300', 'currency:USD'), value('7')]).result).toEqual(
			value('16100', 'currency:USD')
		)
		expect(run('multiply', [value('43', 'quantity:game-token'), value('17')]).result).toEqual(
			value('731', 'quantity:game-token')
		)
		expect(run('add', [value('0.1'), value('0.2')]).result.value).toBe('0.3')
		expect(run('add', [value('9007199254740993'), value('1')]).result.value).toBe(
			'9007199254740994'
		)
		expect(run('subtract', [value('320'), value('180'), value('180')]).result.value).toBe('-40')
		expect(run('divide', [value('1', 'currency:EUR'), value('8', 'currency:EUR')]).result).toEqual(
			value('0.125')
		)
		expect(run('compare', [value('1.01'), value('1.010')]).result.value).toBe('0')
	})
	test('rejects mismatched, ambiguous, oversized and executable inputs', () => {
		for (const operands of [
			[value('1', 'currency:EUR'), value('2', 'currency:USD')],
			[value('1', 'currency:FAKE'), value('2', 'currency:FAKE')],
			[value('1,000'), value('2')],
			[value('1e3'), value('2')],
			[value('1+2'), value('2')],
			[value('0.' + '1'.repeat(33)), value('2')],
			[value('9'.repeat(129)), value('2')]
		])
			expect(() => run('add', operands)).toThrow()
		expect(() => run('multiply', [value('2', 'currency:EUR'), value('3', 'quantity:kg')])).toThrow(
			'Compound units'
		)
		expect(() => run('divide', [value('1'), value('0')])).toThrow('zero')
		expect(() => run('multiply', [value('9'.repeat(128)), value('2')])).toThrow('128 digits')
		expect(() => run('add', [value('1'), value('2')], { unknown: 2 })).toThrow()
		expect(() =>
			calculate({ operation: 'add', operands: [{ value: 0.1, unit: '1' }, value('2')] })
		).toThrow()
	})
	test('division and rounding are explicit, signed and exact about loss of precision', () => {
		expect(() => run('divide', [value('1'), value('3')])).toThrow('Choose decimal_places')
		expect(() => run('divide', [value('1'), value('3')], { decimal_places: 2 })).toThrow('together')
		for (const [input, mode, expected] of [
			['2.345', 'half-even', '2.34'],
			['2.355', 'half-even', '2.36'],
			['-2.345', 'half-up', '-2.35'],
			['-2.341', 'floor', '-2.35'],
			['-2.349', 'ceiling', '-2.34'],
			['-2.349', 'toward-zero', '-2.34']
		]) {
			expect(run('round', [value(input!)], { decimal_places: 2, rounding: mode })).toMatchObject({
				result: { value: expected },
				exact: false
			})
		}
		expect(
			run('divide', [value('1'), value('3')], { decimal_places: 2, rounding: 'half-even' })
		).toMatchObject({ result: { value: '0.33' }, exact: false })
		expect(
			run('divide', [value('1'), value('4')], { decimal_places: 2, rounding: 'half-even' })
		).toMatchObject({ result: { value: '0.25' }, exact: true })
		expect(
			run('round', [value('-0.001')], { decimal_places: 2, rounding: 'toward-zero' }).result.value
		).toBe('0')
	})
})
