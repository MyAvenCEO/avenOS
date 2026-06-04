/**
 * Hardcoded example restaurant orders for the "H auf H" project.
 * Shape mirrors the POS export (Journal_Zahlungen_Bezahlpositionen…csv):
 * an order (Bestellung) groups line items (Bezahlpositionen) with category,
 * price, qty, VAT (MwSt) and optional staff/to-go flags.
 */

export type OrderLine = {
	/** ID Bestellposition */
	positionId: number
	product: string
	category: string
	/** MwSt, e.g. "19%" */
	vat: string
	/** Einzelpreis in EUR (0 for staff comps). */
	price: number
	/** Anzahl */
	qty: number
	/** Optional note, e.g. "Personal 100%". */
	note?: string
	toGo?: boolean
}

export type Order = {
	/** ID Bestellung */
	id: number
	/** Rechnungs-Nr, e.g. "#008836" */
	invoiceNo: string
	/** Ort (table / area), e.g. "Service 2" */
	location: string
	/** Bedienung who took the order. */
	server: string
	/** Mitarbeiter who closed/paid it. */
	cashier: string
	/** Bestelldatum (ISO). */
	orderedAt: string
	/** Bezahldatum (ISO), null while still open. */
	paidAt: string | null
	status: 'open' | 'paid'
	lines: OrderLine[]
}

export const ORDERS: Order[] = [
	{
		id: 20613,
		invoiceNo: '#008836',
		location: 'Service 2',
		server: 'Mitarbeiter',
		cashier: 'Service 1',
		orderedAt: '2026-05-30T22:46:14',
		paidAt: '2026-05-30T23:37:06',
		status: 'paid',
		lines: [
			{ positionId: 43643, product: 'Helles 0,5l', category: 'Bier', vat: '19%', price: 4.9, qty: 1 },
			{ positionId: 43642, product: 'Helles klein 0,3l', category: 'Bier', vat: '19%', price: 3.9, qty: 1 },
			{ positionId: 43645, product: 'Schorle Apfel 0,4l', category: 'Saftschorle', vat: '19%', price: 3.6, qty: 1 },
			{ positionId: 43644, product: 'Hausgemachte Limo Basilikum Limette', category: 'AFG', vat: '19%', price: 4.2, qty: 1 },
		],
	},
	{
		id: 20612,
		invoiceNo: '#008836',
		location: 'Service 2',
		server: 'Mitarbeiter',
		cashier: 'Service 1',
		orderedAt: '2026-05-30T22:42:04',
		paidAt: '2026-05-30T23:37:06',
		status: 'paid',
		lines: [
			{ positionId: 43635, product: 'Helles 0,5l', category: 'Bier', vat: '19%', price: 4.9, qty: 1 },
			{ positionId: 43634, product: 'Helles klein 0,3l', category: 'Bier', vat: '19%', price: 3.9, qty: 1 },
			{ positionId: 43641, product: 'Schorle Rhabarber 0,4l', category: 'Saftschorle', vat: '19%', price: 3.6, qty: 1 },
			{ positionId: 43640, product: 'Schorle Maracuja 0,4l', category: 'Saftschorle', vat: '19%', price: 3.6, qty: 1 },
			{ positionId: 43639, product: 'Weinschorle weiss 0,2', category: 'Wein weiss', vat: '19%', price: 4.5, qty: 1 },
			{ positionId: 43638, product: 'Cafe Creme', category: 'Heissgetränke', vat: '19%', price: 2.8, qty: 1 },
			{ positionId: 43637, product: 'Paulaner Spezi 0,4l', category: 'AFG', vat: '19%', price: 3.9, qty: 1 },
			{ positionId: 43636, product: 'Radler 0,5l', category: 'Bier', vat: '19%', price: 4.9, qty: 1 },
		],
	},
	{
		id: 20615,
		invoiceNo: '#008835',
		location: 'Service 2',
		server: '304',
		cashier: 'Service 1',
		orderedAt: '2026-05-30T23:07:30',
		paidAt: '2026-05-30T23:36:43',
		status: 'paid',
		lines: [
			{ positionId: 43647, product: 'Helles klein 0,3l', category: 'Bier', vat: '19%', price: 3.9, qty: 1 },
			{ positionId: 43648, product: 'Spitzkohl', category: 'Herzhaftes', vat: '7%', price: 14.5, qty: 1 },
			{ positionId: 43649, product: 'Süsse Versuchung', category: 'Dessert', vat: '7%', price: 7.5, qty: 2 },
		],
	},
	{
		id: 20591,
		invoiceNo: '#008834',
		location: 'Service 4',
		server: '211',
		cashier: 'Service 1',
		orderedAt: '2026-05-30T19:33:03',
		paidAt: '2026-05-30T21:05:12',
		status: 'paid',
		lines: [
			{ positionId: 43589, product: 'Spitzkohl', category: 'Herzhaftes', vat: '7%', price: 14.5, qty: 1 },
			{ positionId: 43590, product: 'Wiener Schnitzel', category: 'Herzhaftes', vat: '7%', price: 19.5, qty: 2 },
			{ positionId: 43591, product: 'Pommes', category: 'Beilagen', vat: '7%', price: 4.5, qty: 2 },
			{ positionId: 43592, product: 'Helles 0,5l', category: 'Bier', vat: '19%', price: 4.9, qty: 3 },
			{ positionId: 43593, product: 'Weinschorle weiss 0,2', category: 'Wein weiss', vat: '19%', price: 4.5, qty: 1 },
		],
	},
	{
		id: 20620,
		invoiceNo: '—',
		location: 'Service 1',
		server: 'Mitarbeiter',
		cashier: 'Service 1',
		orderedAt: '2026-05-30T23:55:41',
		paidAt: null,
		status: 'open',
		lines: [
			{ positionId: 43660, product: 'Helles 0,5l', category: 'Bier', vat: '19%', price: 0, qty: 2, note: 'Personal 100%' },
			{ positionId: 43661, product: 'Cafe Creme', category: 'Heissgetränke', vat: '19%', price: 0, qty: 2, note: 'Personal 100%' },
		],
	},
	{
		id: 20622,
		invoiceNo: '—',
		location: 'Terrasse 7',
		server: '118',
		cashier: '—',
		orderedAt: '2026-05-31T12:18:55',
		paidAt: null,
		status: 'open',
		lines: [
			{ positionId: 43671, product: 'Schorle Apfel 0,4l', category: 'Saftschorle', vat: '19%', price: 3.6, qty: 2 },
			{ positionId: 43672, product: 'Paulaner Spezi 0,4l', category: 'AFG', vat: '19%', price: 3.9, qty: 1 },
			{ positionId: 43673, product: 'Wiener Schnitzel', category: 'Herzhaftes', vat: '7%', price: 19.5, qty: 1 },
			{ positionId: 43674, product: 'Pommes', category: 'Beilagen', vat: '7%', price: 4.5, qty: 1, toGo: true },
		],
	},
]

export function orderTotal(order: Order): number {
	return order.lines.reduce((sum, l) => sum + l.price * l.qty, 0)
}

export function orderItemCount(order: Order): number {
	return order.lines.reduce((sum, l) => sum + l.qty, 0)
}

const EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
export function formatEur(value: number): string {
	return EUR.format(value)
}

export function formatTime(iso: string): string {
	// "2026-05-30T22:46:14" -> "22:46"
	return iso.slice(11, 16)
}

export function formatDate(iso: string): string {
	// "2026-05-30T22:46:14" -> "30.05.2026"
	const [y, m, d] = iso.slice(0, 10).split('-')
	return `${d}.${m}.${y}`
}
