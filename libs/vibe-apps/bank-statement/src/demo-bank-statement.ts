/** Demo payload shaped like OCR headless `bank_statement` extracted document. */
export const bankStatementDemoToolArguments = {
	statement_kind: 'periodic_account_statement' as const,
	statement_id: 'KA-2026-04-9812',
	statement_issue_date: '2026-05-02',
	currency: 'EUR',
	period_start: '2026-04-01',
	period_end: '2026-04-30',
	payment_due_date: null as string | null,
	opening_balance: 4280.55,
	closing_balance: 5124.18,
	account_holder: {
		name: 'Dr. Elena Vogt',
		contact_name: null as string | null,
		street: 'Eichenweg 7',
		postal_code: '10439',
		city: 'Berlin',
		country: 'Germany',
		email: null as string | null,
		phone: null as string | null,
		tax_id: null as string | null
	},
	institution: {
		name: 'Stadtsparkasse Berlin',
		contact_name: null as string | null,
		street: 'ABC-Platz 16',
		postal_code: '10172',
		city: 'Berlin',
		country: 'Germany',
		email: 'service@stadtsparkasse.example',
		phone: '+49 30 9876543',
		tax_id: null as string | null
	},
	account_overview: {
		branch_name: 'Filiale Mitte',
		iban: 'DE89 3704 0044 0532 0130 00',
		bic: 'COBADEFFXXX',
		account_number: null as string | null,
		domestic_bank_code: '10050000',
		product_name: 'Girokonto Business',
		card_last_four: '9912'
	},
	transactions: [
		{
			value_date: '2026-04-01',
			booking_date: '2026-04-02',
			title: 'Incoming transfer',
			description: 'REF 77821 · Acme Consulting AG\nRechnung R-2026-1842',
			amount: 4403.0,
			balance_after: 8683.55,
			counterparty_name: 'Acme Consulting AG'
		},
		{
			value_date: '2026-04-03',
			booking_date: '2026-04-03',
			title: null as string | null,
			description: 'Monthly software subscription\nADYEN NV · Amsterdam',
			amount: -89.0,
			balance_after: 8594.55,
			original_amount: -96.79,
			original_currency: 'USD',
			exchange_rate: '1,1573',
			fx_surcharge_eur: -1.69,
			foreign_exchange_fee_percent: 1.75
		},
		{
			value_date: '2026-04-15',
			booking_date: '2026-04-15',
			description: 'Office rent April',
			amount: -2850.0,
			balance_after: 5744.55
		},
		{
			value_date: '2026-04-28',
			booking_date: '2026-04-28',
			description: 'Card purchase SUPERMARKT MITTE BERLIN',
			amount: -52.37,
			balance_after: 5692.18
		},
		{
			value_date: '2026-04-30',
			booking_date: '2026-04-30',
			description: 'Account maintenance fee',
			amount: -12.0,
			balance_after: 5124.18
		}
	],
	notes:
		'Zinsen für den Zeitraum 01.04.–30.04.: nicht angefallen.\nSollzinssatz p.a. bei Überziehung: 8,9 % (Stand Auszug).'
} as const
