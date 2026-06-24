import { BOOKING_SCHEMA, buildOutgoingBooking } from '@avenos/aven-vibes/booking'
import { fileRef } from '@avenos/aven-vibes/file-ref'
import { computeInvoiceTotals, type InvoiceDoc } from '@avenos/aven-vibes/invoice-doc'
import { PRIVATE_SPARK } from '$lib/avendb/intent-files'
import { sparkWriteBytes } from '$lib/composer/spark-ipc'
import { createValue, ensureSchema, listValues, updateValue } from '$lib/data/client'

// board 0082 — render an outgoing invoice to a real, laid-out PDF (header / recipient / positions
// table / totals / §14 Pflichtangaben footer) and store it in the mainnet PRIVATE content-addressed
// file store, stamping `pdf_file_hash`. Dependency-free: a single A4 Helvetica page with absolutely
// positioned text + rule lines. (No pdf-writer dependency exists; pixel-identical HTML→PDF is a follow-up.)

const STATE_LABEL: Record<string, string> = {
	entwurf: 'Entwurf',
	angebot: 'Angebot',
	rechnung: 'Rechnung'
}

// PDF text is Latin-1; transliterate the few non-ASCII chars we emit so the bytes stay valid.
function ascii(s: string): string {
	return s
		.replace(/ä/g, 'ae')
		.replace(/ö/g, 'oe')
		.replace(/ü/g, 'ue')
		.replace(/Ä/g, 'Ae')
		.replace(/Ö/g, 'Oe')
		.replace(/Ü/g, 'Ue')
		.replace(/ß/g, 'ss')
		.replace(/€/g, 'EUR')
		.replace(/[^\x20-\x7e]/g, '?')
}

function esc(s: string): string {
	return ascii(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function money(n: number | null | undefined): string {
	return typeof n === 'number'
		? n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
		: '—'
}

/** One absolutely-positioned text run. */
function txt(x: number, y: number, s: string, size = 10): string {
	return `BT /F1 ${size} Tf ${x} ${y} Td (${esc(s)}) Tj ET\n`
}
/** A horizontal rule. */
function hr(y: number): string {
	return `0.5 w 50 ${y} m 545 ${y} l S\n`
}

/** Build a laid-out single-page A4 PDF for the invoice. Returns the raw bytes. */
export function buildInvoicePdf(doc: InvoiceDoc): Uint8Array {
	const totals = doc.totals ?? computeInvoiceTotals(doc.lines ?? [])
	const cur = doc.currency || 'EUR'
	const s = doc.seller
	const b = doc.buyer
	let c = ''

	// Seller header (top-left) + document title block (top-right).
	c += txt(50, 800, [s?.name, s?.legal_form].filter(Boolean).join(' ') || '', 14)
	let y = 784
	const sellerLine = (str: string | null | undefined) => {
		if (str) {
			c += txt(50, y, str, 9)
			y -= 12
		}
	}
	sellerLine(s?.street)
	sellerLine([s?.zip, s?.city].filter(Boolean).join(' ') || null)
	sellerLine(s?.country)
	sellerLine(s?.vat_id ? `USt-IdNr.: ${s.vat_id}` : null)

	c += txt(400, 800, STATE_LABEL[doc.state] ?? 'Rechnung', 16)
	c += txt(400, 782, `Nr. ${doc.number}`, 10)
	if (doc.issue_date) c += txt(400, 768, `Datum: ${doc.issue_date}`, 10)
	// §14 UStG Leistungs-/Lieferzeitraum (mandatory) — fall back to "= Rechnungsdatum".
	c += txt(
		400,
		754,
		`Leistung: ${doc.service_period ?? doc.service_date ?? 'entspricht dem Rechnungsdatum'}`,
		9
	)

	// Recipient.
	c += txt(50, 712, 'RECHNUNGSEMPFAENGER', 8)
	let ry = 696
	const buyerLine = (str: string | null | undefined, size = 9) => {
		if (str) {
			c += txt(50, ry, str, size)
			ry -= size + 3
		}
	}
	buyerLine([b?.name, b?.legal_form].filter(Boolean).join(' ') || null, 11)
	buyerLine(b?.street)
	buyerLine([b?.zip, b?.city].filter(Boolean).join(' ') || null)
	if (b?.vat_id) buyerLine(`USt-IdNr.: ${b.vat_id}`)

	// Positions table.
	let ty = 630
	c += hr(ty + 12)
	c +=
		txt(50, ty, 'Pos', 8) +
		txt(80, ty, 'Bezeichnung', 8) +
		txt(330, ty, 'Menge', 8) +
		txt(385, ty, 'Einzelpreis', 8) +
		txt(465, ty, 'USt', 8) +
		txt(505, ty, 'Betrag', 8)
	c += hr(ty - 5)
	ty -= 18
	for (let i = 0; i < (doc.lines ?? []).length; i++) {
		const l = doc.lines[i]
		const amt = (l.quantity || 0) * (l.unit_price || 0)
		c +=
			txt(50, ty, String(i + 1), 9) +
			txt(80, ty, (l.description ?? '').slice(0, 42), 9) +
			txt(330, ty, String(l.quantity ?? ''), 9) +
			txt(385, ty, money(l.unit_price), 9) +
			txt(465, ty, `${l.vat_rate ?? 0}%`, 9) +
			txt(505, ty, money(amt), 9)
		ty -= 15
	}
	c += hr(ty + 3)

	// Totals (right column).
	ty -= 16
	for (const r of totals.by_rate) {
		c += txt(380, ty, `Netto ${r.rate}%`, 9) + txt(505, ty, `${money(r.net)} ${cur}`, 9)
		ty -= 13
	}
	c += txt(380, ty, 'Netto gesamt', 9) + txt(505, ty, `${money(totals.net_total)} ${cur}`, 9)
	ty -= 13
	c += txt(380, ty, 'USt. gesamt', 9) + txt(505, ty, `${money(totals.vat_total)} ${cur}`, 9)
	ty -= 14
	c += txt(380, ty, 'Rechnungsbetrag', 11) + txt(505, ty, `${money(totals.gross_total)} ${cur}`, 11)

	// §14 Pflichtangaben footer.
	let fy = 120
	c += hr(fy + 14)
	const foot: string[] = []
	if (s?.vat_id) foot.push(`USt-IdNr.: ${s.vat_id}`)
	if (s?.tax_number) foot.push(`Steuernr.: ${s.tax_number}`)
	if (s?.register_number || s?.register_court)
		foot.push(
			`Handelsregister: ${[s?.register_number, s?.register_court].filter(Boolean).join(', ')}`
		)
	if (s?.managing_director) foot.push(`Geschäftsführer: ${s.managing_director}`)
	if (s?.iban) foot.push(`IBAN: ${s.iban}${s.bic ? `   BIC: ${s.bic}` : ''}`)
	if (s?.bank_name) foot.push(`Bank: ${s.bank_name}`)
	for (const f of foot) {
		c += txt(50, fy, f, 8)
		fy -= 11
	}

	const objs = [
		'<</Type/Catalog/Pages 2 0 R>>',
		'<</Type/Pages/Kids[3 0 R]/Count 1>>',
		'<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>',
		'<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>',
		`<</Length ${c.length}>>\nstream\n${c}\nendstream`
	]
	let pdf = '%PDF-1.4\n'
	const offsets: number[] = []
	objs.forEach((o, i) => {
		offsets.push(pdf.length)
		pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
	})
	const xrefStart = pdf.length
	pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
	for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`
	pdf += `trailer<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`
	const bytes = new Uint8Array(pdf.length)
	for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff
	return bytes
}

/**
 * Render → store in PRIVATE (content-addressed) → stamp `pdf_file_hash` on the invoice_doc row.
 * `rowId` is the data_value id of the (latest) invoice_doc version.
 */
export async function saveInvoicePdf(doc: InvoiceDoc, rowId: string): Promise<string> {
	const bytes = buildInvoicePdf(doc)
	const ref = await fileRef(bytes, `${doc.number}.pdf`, 'application/pdf')
	await sparkWriteBytes(PRIVATE_SPARK, ref.path.replace(/^sparks\/PRIVATE\//, ''), bytes)
	await updateValue(rowId, { ...doc, pdf_file_hash: ref.hash })
	// board 0082 — a FINAL Rechnung also flows into the bookkeeping (Erlös booking), idempotently:
	// storing the outgoing invoice books it on the revenue side so it appears in Buchungen + BWA.
	if (doc.state === 'rechnung') {
		try {
			const bookingSchemaId = await ensureSchema(
				'booking',
				BOOKING_SCHEMA as unknown as Record<string, unknown>
			)
			const existing = await listValues<{ invoice_number?: string }>(bookingSchemaId)
			if (!existing.some((r) => r.data.invoice_number === doc.number)) {
				const totals = doc.totals ?? computeInvoiceTotals(doc.lines ?? [])
				const booking = buildOutgoingBooking({
					invoiceValueId: rowId,
					number: doc.number,
					buyer: doc.buyer?.name ?? null,
					currency: doc.currency,
					byRate: totals.by_rate
				})
				await createValue(bookingSchemaId, booking as unknown as Record<string, unknown>)
			}
		} catch (e) {
			console.error('[invoice-pdf] outgoing booking failed:', e)
		}
	}
	return ref.hash
}
