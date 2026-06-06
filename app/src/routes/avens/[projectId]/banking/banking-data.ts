/**
 * Hardcoded multi-provider banking snapshot for avenVICTORIO.
 *
 * Money lives across several payment/bank providers (bank account, cash drawer,
 * PayPal, card acquirers). The Banking view shows the combined balance, a
 * per-provider split, and the underlying transactions — filterable by provider.
 */

export type ProviderKind = 'bank' | 'cash' | 'wallet' | 'card'

export type BankProvider = {
	id: string
	name: string
	kind: ProviderKind
	/** Current balance in EUR. */
	balance: number
	/** Tailwind background class for the accent dot / bar segment. */
	accent: string
}

export type BankTxn = {
	id: string
	providerId: string
	/** ISO datetime. */
	date: string
	description: string
	category: string
	/** EUR — positive = money in, negative = money out. */
	amount: number
}

export const PROVIDERS: BankProvider[] = [
	{ id: 'bank', name: 'Girokonto (Bank)', kind: 'bank', balance: 38_250, accent: 'bg-slate-500' },
	{ id: 'visa', name: 'Visa', kind: 'card', balance: 5_640, accent: 'bg-indigo-500' },
	{ id: 'paypal', name: 'PayPal', kind: 'wallet', balance: 4_320, accent: 'bg-sky-500' },
	{ id: 'mastercard', name: 'Mastercard', kind: 'card', balance: 3_180, accent: 'bg-orange-500' },
	{ id: 'cash', name: 'Kasse (Cash)', kind: 'cash', balance: 2_150, accent: 'bg-amber-500' }
]

export const TRANSACTIONS: BankTxn[] = [
	// Bank account
	{ id: 't01', providerId: 'bank', date: '2026-06-05T08:10:00', description: 'Payroll run — kitchen & bar staff', category: 'Payroll', amount: -9_200 },
	{ id: 't02', providerId: 'bank', date: '2026-06-04T14:22:00', description: 'PayPal payout received', category: 'Transfer', amount: 2_800 },
	{ id: 't03', providerId: 'bank', date: '2026-06-03T11:05:00', description: 'Visa settlement payout', category: 'Transfer', amount: 5_200 },
	{ id: 't04', providerId: 'bank', date: '2026-06-02T09:00:00', description: 'Rent — June', category: 'Rent', amount: -6_800 },
	{ id: 't05', providerId: 'bank', date: '2026-06-01T16:40:00', description: 'Metro food supplier', category: 'Supplier', amount: -3_420 },
	{ id: 't06', providerId: 'bank', date: '2026-05-30T10:15:00', description: 'Beverage supplier', category: 'Supplier', amount: -1_860 },
	{ id: 't07', providerId: 'bank', date: '2026-05-29T07:50:00', description: 'Stadtwerke — utilities', category: 'Utilities', amount: -640 },

	// Visa (card acquiring)
	{ id: 't08', providerId: 'visa', date: '2026-06-04T23:40:00', description: 'Daily card sales', category: 'Card settlement', amount: 1_840 },
	{ id: 't09', providerId: 'visa', date: '2026-06-03T23:40:00', description: 'Daily card sales', category: 'Card settlement', amount: 2_210 },
	{ id: 't10', providerId: 'visa', date: '2026-06-03T11:05:00', description: 'Payout to bank', category: 'Transfer', amount: -5_200 },
	{ id: 't11', providerId: 'visa', date: '2026-06-02T23:40:00', description: 'Daily card sales', category: 'Card settlement', amount: 1_590 },
	{ id: 't12', providerId: 'visa', date: '2026-06-04T23:45:00', description: 'Processing fees', category: 'Fees', amount: -68 },

	// Mastercard (card acquiring)
	{ id: 't13', providerId: 'mastercard', date: '2026-06-04T23:40:00', description: 'Daily card sales', category: 'Card settlement', amount: 1_120 },
	{ id: 't14', providerId: 'mastercard', date: '2026-06-02T23:40:00', description: 'Daily card sales', category: 'Card settlement', amount: 980 },
	{ id: 't15', providerId: 'mastercard', date: '2026-06-04T23:45:00', description: 'Processing fees', category: 'Fees', amount: -39 },
	{ id: 't16', providerId: 'mastercard', date: '2026-06-01T12:30:00', description: 'Chargeback refund', category: 'Refund', amount: -45 },

	// PayPal
	{ id: 't17', providerId: 'paypal', date: '2026-06-04T19:12:00', description: 'Online pre-orders', category: 'Sales', amount: 860 },
	{ id: 't18', providerId: 'paypal', date: '2026-06-04T14:20:00', description: 'Payout to bank', category: 'Transfer', amount: -2_800 },
	{ id: 't19', providerId: 'paypal', date: '2026-06-03T18:05:00', description: 'Gift card top-ups', category: 'Sales', amount: 220 },
	{ id: 't20', providerId: 'paypal', date: '2026-06-03T18:06:00', description: 'PayPal fee', category: 'Fees', amount: -28 },

	// Cash (Kasse)
	{ id: 't21', providerId: 'cash', date: '2026-06-05T23:55:00', description: 'Cash sales — evening', category: 'Sales', amount: 740 },
	{ id: 't22', providerId: 'cash', date: '2026-06-04T23:55:00', description: 'Cash sales', category: 'Sales', amount: 610 },
	{ id: 't23', providerId: 'cash', date: '2026-06-03T17:30:00', description: 'Deposit to bank', category: 'Transfer', amount: -1_200 },
	{ id: 't24', providerId: 'cash', date: '2026-06-02T15:10:00', description: 'Petty cash — supplies', category: 'Supplier', amount: -85 }
]

export function providerById(id: string): BankProvider | undefined {
	return PROVIDERS.find((p) => p.id === id)
}
