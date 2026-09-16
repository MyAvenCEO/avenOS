/** Hand-authored counterfactuals, frozen before live runs. Evaluation rubric stays outside tools. */
import type { CorpusArtifact } from './persona-model'

interface Scenario {
	name: string
	personaId: string
	intentId: string
	language: 'en' | 'de' | 'es'
	question: string
	rubric: string[]
	sources: Array<[string, string, string]>
}
const scenarios: Scenario[] = [
	{
		name: 'Heldout Bergen coverage survives cancellation and timezone handoff',
		personaId: 'rowan-chen',
		intentId: 'rowan-chen:family-visit',
		language: 'en',
		question:
			"Before I tell Mum Bergen is sorted, can you check Pip's cover against the final travel times? Bea pulled out, Al sent a correction and Jules offered to bridge it. Say exactly where we're covered, whether there's still a gap, and what actually changed. Don't assume paying a deposit fixes the dates.",
		rubric: [
			'Final Bergen journey requires care from 24 June 2026 17:30 BST (16:30Z) until 27 June 00:30 BST (26 June 23:30Z). Superseded rail times do not govern.',
			'Bea cancelled and her deposit was returned; she provides no coverage. Al/Alex corrected the start to 24 June 17:00 BST and covers until 26 June 22:00 BST, unlike the old 25 June start.',
			'Jules/J. Pereira confirmed coverage from 26 June 23:00 CEST (21:00Z, 22:00 BST) to 27 June 02:00 CEST (00:00Z, 01:00 BST). It joins Alex exactly, covers the return and leaves no documentary gap. Do not invent a one-hour gap by comparing wall clocks in different zones.',
			'A separate July deposit does not extend June dates; cite the correction, Jules acceptance and final travel itinerary, distinguishing offer from acceptance.'
		],
		sources: [
			[
				'berg-intro',
				'Bergen: contacts and emergency key',
				'From: Rowan to Mum, 02/06. Al is Alex Turner, our usual sitter. Jules (J. Pereira) is the neighbour in flat 3; she is visiting Spain but back for our trip. Pip knows both. I use Al in messages.'
			],
			[
				'berg-old',
				'Bergen original itinerary / BK-624',
				'Issued 03/06. Leave home 24/06 19:00 BST; home 26/06 21:00 BST. BK-624 version 1.'
			],
			[
				'berg-new',
				'BK-624 schedule change accepted',
				'Issued 19/06. BK-624 version 2 replaces version 1. Required door-to-door absence: 24/06/2026 17:30 BST (UTC+01:00) to 27/06/2026 00:30 BST (UTC+01:00). Rowan accepted 19/06. Flight delay adds a late return.'
			],
			[
				'berg-bea',
				'Bea / cancellation receipt',
				'BK-624 pet care BE-624 cancelled by Bea 11/06. £30 deposit refunded, transaction BR-11. No substitute sitter supplied.'
			],
			[
				'berg-al-old',
				'Al booking AT-624',
				'Confirmed 12/06: Pip at Alex, 25/06 09:00 BST through 26/06 22:00 BST. £25 paid.'
			],
			[
				'berg-al-fix',
				'Re: AT-624, earlier handover',
				'Alex to Rowan, 20/06: yep typo on my form sorry! AT-624 is confirmed from 24 June 17:00 BST to 26 June 22:00 BST. replaces the 25th start, no extra charge. key same place 👍'
			],
			[
				'berg-jules-offer',
				'Re: late flight',
				'Jules, 20/06: Puedo coger a Pip el viernes por la noche, but wait till I confirm my train. The times on my calendar are Madrid time.'
			],
			[
				'berg-jules-ok',
				'Pip Friday confirmed',
				'J. Pereira to Rowan, 22/06: Train booked. Confirmado: I cover Pip 26 June 23:00 CEST (UTC+02:00) to 27 June 02:00 CEST (UTC+02:00). Al confirmed the handover at my start time; no gap. Key collected.'
			],
			[
				'berg-july',
				'Alex summer deposit',
				'27/06 receipt: £40 deposit, AT-JUL-08. Dates 08–10 July, not BK-624.'
			]
		]
	},
	{
		name: 'Heldout kiln split tender separates void authorization cash voucher and debt',
		personaId: 'lena-weber',
		intentId: 'lena-weber:studio-lease',
		language: 'de',
		question:
			'Kannst du den Brennofen von Nordwerk für den Juniabschluss auseinanderziehen? Auf der Karte steht erst 900 und dann 760, später kam diese Teilretoure. Was hat mich der Auftrag tatsächlich an Geld gekostet, was ist mit dem Gutschein und schulde ich denen noch etwas? Bitte auch die angeblich volle Erstattung prüfen; T. hatte dazu mehrere Mails.',
		rubric: [
			'Order NW-0612 total 1000 EUR funded by 240 EUR voucher and 760 EUR posted card charge. 900 EUR was a void authorization, not another posted charge.',
			'Return R-0618 requested/authorized 300 EUR, split refund confirmed as 180 EUR card and 120 EUR voucher. This documented split fully reconciles 300 EUR, unlike an unexplained authorization/settlement mismatch.',
			'Card cash net expenditure is 760 minus 180 = 580 EUR. Voucher consumed net is 240 minus 120 = 120 EUR. Net economic cost is 700 EUR; do not call 700 the cash outflow or mix the voucher into cash.',
			'Voucher opening balance 300 minus 240 plus 120 leaves 180 EUR, expires 31 December 2026. It is store credit, not a bank refund.',
			'Signed final account NW-0612 confirms no outstanding debt after tender and refund. Do not infer another 700/580 EUR payment from the adjusted invoice. Tobias/T. support explicitly explains the split, so do not invent an unresolved 120 EUR difference.'
		],
		sources: [
			[
				'kiln-order',
				'Nordwerk NW-0612 Auftragsbestätigung',
				'12.06.2026. Ofenauftrag NW-0612: Gesamt 1.000,00 EUR. Gutschein GV-LW-9: 240,00 EUR eingelöst; Rest 760,00 EUR Visa 8821. Ansprechpartner Tobias Rehm (Signatur T.).'
			],
			[
				'kiln-hold',
				'Visa 8821: Autorisierungsverlauf',
				'NW-0612. 11.06: 900,00 EUR reserviert, Auth H-11. 12.06: H-11 storniert, 0,00 EUR gebucht. 12.06: 760,00 EUR gebuchter Umsatz C-12. Eine Reservierung ist kein gebuchter Umsatz.'
			],
			[
				'kiln-return',
				'R-0618 Annahme Teilretoure',
				'18.06: NW-0612, beschädigtes Untergestell angenommen. Erstattungsbetrag 300,00 EUR genehmigt. Rückzahlung nach Prüfung der ursprünglichen Zahlmittel.'
			],
			[
				'kiln-conflict',
				'Re: R-0618, full refund',
				'19.06 Tobias: Your full €300 refund is approved. Please allow processing time. Beste Grüße, T.'
			],
			[
				'kiln-split',
				'Re: nur 180 auf Visa?',
				'21.06 T. Rehm: Ja, vollständig, aber aufgeteilt wie vereinbart: R-0618 = 180 EUR auf Visa 8821 (CR-21) plus 120 EUR auf GV-LW-9 (VR-21). Kein weiterer Kartenbetrag offen. Die 300 waren die Summe, kein Versprechen von 300 aufs Bankkonto.'
			],
			[
				'kiln-card',
				'Visa Monatsauszug Juni',
				'Visa 8821, gebucht: 12.06 C-12 Nordwerk +760,00 EUR Belastung; 22.06 CR-21 Nordwerk -180,00 EUR Gutschrift. Autorisierung H-11 nicht im Umsatz enthalten.'
			],
			[
				'kiln-voucher',
				'Gutschein GV-LW-9 Bewegungen',
				'Anfang 300,00 EUR. 12.06 NW-0612 -240,00; 21.06 VR-21/R-0618 +120,00. Ende 180,00 EUR. Einlösbar bis 31.12.2026, keine Barauszahlung.'
			],
			[
				'kiln-balance',
				'Nordwerk Schlussabrechnung NW-0612',
				'24.06, final signiert Tobias Rehm. Rechnung 1.000,00 minus Retoure 300,00 = 700,00 EUR. Zahlmittel nach Erstattung: Visa netto 580,00; Gutschein netto 120,00. Offener Saldo 0,00 EUR. Keine weitere Zahlung fällig.'
			],
			[
				'kiln-decoy',
				'Nordwerk Kursgutschein',
				'NW-KURS-17: 90 EUR Guthaben für einen Töpferkurs. Nicht auf Warenkäufe oder NW-0612 anrechenbar.'
			]
		]
	},
	{
		name: 'Heldout signed wedding amendment overrides old date but not capacity permit',
		personaId: 'sofia-morales',
		intentId: 'sofia-morales:valencia-wedding',
		language: 'es',
		question:
			'Lo de Inés se parece al lío de Clara, pero no quiero copiar la conclusión. ¿Qué fecha manda al final para Inés, quién aceptó el cambio y podemos montar ya para 140 invitados? La abogada usa iniciales y hay un calendario que sigue con la fecha vieja. Separa la reserva, los permisos y cualquier cosa que aún falte.',
		rubric: [
			'For Inés Salas (not Clara) original 20 June changed to 28 June 2026 by signed amendment IS-2 dated 10 June, countersigned by client Inés, Sofia and venue manager Raúl Costa. Old staff calendar does not override it.',
			'M.A./Marta Abad lawyer email dated 11 June confirms executed date amendment. Earlier unsigned draft is superseded. Do not reuse Clara no-signed-change conclusion.',
			'140 guests is only a requested plan. Current permit authorizes 100 people; capacity extension to 140 remains pending municipal inspection as of 25 June. Paid date-change fee and confirmed reservation do not authorize 140.',
			'Venue manager consent satisfies landlord/venue consent but not municipal capacity sign-off. Identify the outstanding inspection approval and state 100 is the currently documented authorized limit, not zero and not 140.'
		],
		sources: [
			[
				'ines-contract',
				'IS-BASE reserva Inés Salas',
				'Contrato firmado 02/04/2026. Inés Salas, 20/06/2026, aforo autorizado 100. Cambios: documento firmado por cliente, floristería y gestor del recinto.'
			],
			[
				'ines-alias',
				'Presentaciones: asesoría',
				'Sofía, 03/04: Marta Abad es nuestra abogada, firma M.A. Raúl Costa gestiona El Naranjal y firma RC. Inés no es Clara, expedientes separados.'
			],
			[
				'ines-draft',
				'IS-2 borrador sin firmar',
				'05/06: Propuesta 28/06, 140 personas. Borrador, pendiente de aceptación y permiso de ampliación.'
			],
			[
				'ines-signed',
				'IS-2 adenda ejecutada',
				'10/06/2026. IS-BASE: fecha sustituida por 28/06/2026. Firmas verificadas: Inés Salas (cliente), Sofía Morales (floristería), Raúl Costa (gestor). El cambio de fecha es efectivo al firmar. Aforo de 140 propuesto, condicionado a autorización municipal; sigue vigente 100 hasta entonces.'
			],
			[
				'ines-lawyer',
				'Re: IS-2 signed copy',
				'11/06 M.A.: I checked all three signatures. June 28 now governs the reservation. Capacity condition survives unchanged: 100 until the municipality approves 140. Marta.'
			],
			[
				'ines-calendar',
				'Equipo junio versión anterior',
				'Calendario creado 04/06: Inés, montaje boda 20/06, dos auxiliares. No actualizado desde 04/06.'
			],
			[
				'ines-payment',
				'Recibo RC-12 cambio fecha',
				'12/06: 80 EUR recibidos por cambio de reserva IS-2. No constituye licencia ni autoriza ampliar aforo.'
			],
			[
				'ines-permit',
				'Expediente AF-140 inspección',
				'Ayuntamiento, estado 25/06: ampliación a 140 pendiente de visita y resolución. Licencia existente: 100 personas. No consta resolución aprobatoria.'
			],
			[
				'ines-venue',
				'RC / acceso 28 junio',
				'24/06: confirmado acceso el 28 según IS-2. Yo ya autoricé la fecha. No puedo dar el visto bueno municipal a 140. Raúl.'
			]
		]
	}
]
export const heldoutCases = scenarios.map((s) => ({
	name: s.name,
	personaId: s.personaId,
	language: s.language,
	question: s.question,
	difficulty: 'extreme' as const,
	requiresLookup: true,
	requiresArtifact: true,
	minimumArtifactReads: 5
}))
export const heldoutRubrics = Object.fromEntries(scenarios.map((s) => [s.name, s.rubric]))
export const heldoutArtifacts: CorpusArtifact[] = scenarios.flatMap((s) =>
	s.sources.map(([id, title, body]) => ({
		id: `heldout:${id}`,
		personaId: s.personaId,
		intentId: s.intentId,
		dayIndex: 177,
		createdAt: '2026-06-27',
		kind: 'document' as const,
		title,
		body,
		from: 'Synthetic source archive',
		to: s.personaId,
		supersedesId: null,
		language: s.language
	}))
)
