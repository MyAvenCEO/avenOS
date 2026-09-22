/** Currency scale is representation metadata, never an exchange-rate conversion. */
export function currencyMinorDigits(currency: unknown): number | null {
	if (
		typeof currency !== 'string' ||
		!/^[A-Z]{3}$/.test(currency) ||
		!Intl.supportedValuesOf('currency').includes(currency)
	)
		return null
	return (
		new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
			.maximumFractionDigits ?? null
	)
}

/** Exact typed major-unit value, retaining the reported integer and its scale. */
export function moneyFromMinor(minor: unknown, currency: unknown) {
	const raw =
		typeof minor === 'string'
			? minor
			: typeof minor === 'number' && Number.isSafeInteger(minor)
				? String(minor)
				: ''
	const digits = currencyMinorDigits(currency)
	if (digits === null || !/^-?(0|[1-9]\d{0,127})$/.test(raw)) return null
	const amount = BigInt(raw)
	const absolute = (amount < 0n ? -amount : amount).toString().padStart(digits + 1, '0')
	return {
		value:
			(amount < 0n ? '-' : '') +
			(digits ? `${absolute.slice(0, -digits)}.${absolute.slice(-digits)}` : absolute),
		unit: `currency:${currency}`,
		minorUnits: raw,
		minorDigits: digits
	}
}
