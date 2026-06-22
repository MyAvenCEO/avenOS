import { expect, test } from 'bun:test'
import { meetsTier } from './tier'

// The vault is gated to avenFOUNDER and above (board 0055/0052). meetsTier is the pure
// rank check the endpoints use before any DB access; a sub-tier session → 403.
test('vault tier gate: only avenFOUNDER and above pass', () => {
	expect(meetsTier('avenFOUNDER', 'avenFOUNDER')).toBe(true)
	expect(meetsTier('avenCEO', 'avenFOUNDER')).toBe(true)
	// below the bar → rejected (the endpoint returns 403)
	expect(meetsTier('avenME', 'avenFOUNDER')).toBe(false)
	expect(meetsTier('free', 'avenFOUNDER')).toBe(false)
	expect(meetsTier(null, 'avenFOUNDER')).toBe(false)
	expect(meetsTier(undefined, 'avenFOUNDER')).toBe(false)
})
