import { expect, test } from 'bun:test'
import { moneyFromMinor } from '../src/money'

test('typed money preserves reported minor units and uses the declared currency scale', () => {
	expect(moneyFromMinor('12400', 'EUR')).toEqual({
		value: '124.00',
		unit: 'currency:EUR',
		minorUnits: '12400',
		minorDigits: 2
	})
	expect(moneyFromMinor('-1', 'EUR')?.value).toBe('-0.01')
	expect(moneyFromMinor('12400', 'JPY')?.value).toBe('12400')
	expect(moneyFromMinor('12400', 'KWD')?.value).toBe('12.400')
	expect(moneyFromMinor('13092687039092598', 'EUR')?.value).toBe('130926870390925.98')
	expect(moneyFromMinor('0', 'EUR')?.value).toBe('0.00')
	for (const [minor, currency] of [
		[null, 'EUR'],
		['1200', null],
		['1200', 'ZZZ'],
		['1.2', 'EUR'],
		[Number.MAX_SAFE_INTEGER + 1, 'EUR']
	])
		expect(moneyFromMinor(minor, currency)).toBeNull()
})
