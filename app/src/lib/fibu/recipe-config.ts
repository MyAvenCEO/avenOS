/**
 * Recipes — generic, abstract flow configs (board 0140).
 *
 * A recipe is a directed graph: n inputs → transformations → n outputs.
 * Every step is node/actor-shaped: it owns named ports and exactly one
 * `transform` — a type plus a JSON config, no code. The engine that will
 * later execute these does not exist yet; this file is the contract the
 * mocked UI renders, so everything here must stay JSON-serializable.
 *
 * Five semantics beyond plain pipes:
 * - In-ports carry a `mode`: `all` (join — every wire must deliver) or
 *   `any` (either/or — the first wire that delivers wins). A port fed by
 *   more than one edge MUST be `any`, otherwise the join is ambiguous.
 * - `route` nodes are switches: exactly ONE of their out-ports fires per
 *   item (the Belegweiche: E-Rechnung | PDF mit Text | Scan).
 * - Any step may carry an optional `llm` block — then the transformation
 *   is (or may fall back to) an LLM call, with its purpose and hard
 *   constraints declared. No block = deterministic, and the tax layer is
 *   REQUIRED to have none.
 * - `hitl` nodes are human gates: a person with a named role approves or
 *   rejects — nothing flows past them on its own. Chained gates are the
 *   Vier-Augen-Prinzip before Festschreibung.
 * - `subflow` nodes compose: a whole recipe folded into one summary node,
 *   its ports mapping onto the referenced recipe's inputs/outputs. This is
 *   the composite–leaf pattern: flows nest arbitrarily deep, the reference
 *   graph must stay acyclic, and a leaf is a recipe without subflow nodes.
 *   The canvas shows one level at a time — clicking a subflow opens it.
 *
 * - `handoff` nodes end a flow at a SKILL boundary: work leaves for another
 *   skill's entry flow instead of that skill being nested here. Skills are
 *   named sets over this flat registry (see `skill-config.ts`).
 *
 * Every step also carries an `autonomie` capability — absent means `hitl`,
 * so a new actor is supervised until a human whitelists it. Failures go to
 * a person, full stop: automatic repair is a later version, not a v1.
 *
 * The root is `inbox-triage`: everything enters through the one inbox, gets
 * classified once, and that classification travels WITH the item — it is
 * what tells the OCR which document schema and system prompt to use.
 */

export type NodeKind = 'input' | 'transform' | 'route' | 'hitl' | 'subflow' | 'handoff' | 'output'

export interface RecipePort {
	name: string
	/** In-ports only: `all` = join (default), `any` = either/or. */
	mode?: 'all' | 'any'
}

export interface RecipeNodeConfig {
	id: string
	kind: NodeKind
	name: string
	/** What this step does, in one honest sentence. */
	description: string
	/**
	 * The node's own transformation, actor-style: a type the engine will
	 * resolve to an implementation, and its declarative config. Inputs are
	 * sources (`source:*`), outputs sinks (`sink:*`), routes `route:*`,
	 * subflows `subflow`.
	 */
	transform: {
		type: string
		config: Record<string, unknown>
	}
	/**
	 * Present iff this step is (or may be) an LLM call: what the model is
	 * for, and the constraints that bound it. Deterministic steps omit it.
	 */
	llm?: {
		purpose: string
		constraints: string[]
	}
	/**
	 * Composition: this node IS the referenced recipe, drawn as one summary
	 * node — clicking it opens that recipe's own canvas. `portMap` binds
	 * this node's ports to the sub-recipe's input/output nodes, so the
	 * boundary stays explicit even while the innards stay out of sight.
	 */
	subflow?: {
		recipe: string
		portMap: {
			inputs: Record<string, string>
			outputs: Record<string, string>
		}
	}
	/**
	 * The skill boundary: work leaves here and enters another skill at its
	 * entry flow. Terminal like an output — which is what keeps the flow
	 * graph flat instead of one skill swallowing the next.
	 */
	handoff?: {
		skill: string
	}
	/**
	 * The actor capability: how much this step may do on its own, and what
	 * happens when it fails. **Absent means `hitl`** — a new actor is
	 * supervised until a human whitelists it, which is the whole point:
	 * autonomy is earned, never the default.
	 *
	 * `freigabe` is that whitelisting decision, and it is mandatory for
	 * anything past `hitl` — no provenance, no autonomy.
	 */
	autonomie?: {
		modus: 'hitl' | 'stichprobe' | 'auto'
		/** Who whitelisted this, when, and on what evidence. */
		freigabe?: { durch: string; seit: string; nachweis: string }
		/**
		 * On failure: ask a human, or retry when the step is idempotent. v1
		 * has no automatic repair — a failure is a message to a person.
		 */
		fehler: 'hitl' | 'retry'
	}
	/** Named in-ports; empty on `input` nodes. */
	inputs: RecipePort[]
	/** Named out-ports; empty on `output` and `handoff` nodes. On `route`: the branches. */
	outputs: RecipePort[]
}

export interface RecipeEdgeConfig {
	id: string
	from: string
	fromPort: string
	to: string
	toPort: string
}

export interface Recipe {
	id: string
	name: string
	description: string
	nodes: RecipeNodeConfig[]
	edges: RecipeEdgeConfig[]
}

/**
 * The reusable OCR leaf: image + document type → schema-conform data AND
 * full text. The type is not decoration — it selects the JSON schema and
 * the system prompt, so a Kontoauszug is read as transactions and a
 * Rechnung as positions by the SAME flow. No subflow nodes: this is where
 * the composite bottoms out.
 */
const scanZuDokument: Recipe = {
	id: 'scan-zu-dokument',
	name: 'Scan zu Dokument',
	description:
		'Bild + Dokumenttyp → typkonformes Datenmodell + Volltext. Der Typ aus der Triage wählt Schema und System-Prompt; derselbe Flow liest damit Rechnung, Kontoauszug oder Vertrag.',
	nodes: [
		{
			id: 'in-bild',
			kind: 'input',
			name: 'Bild',
			description: 'Ein Scan, Foto oder textloses PDF, wie es reinkommt: schief, verrauscht.',
			transform: {
				type: 'source:image',
				config: { accepts: ['jpg', 'png', 'tiff', 'pdf-ohne-textlayer'] }
			},
			inputs: [],
			outputs: [{ name: 'bild' }]
		},
		{
			id: 'in-typ',
			kind: 'input',
			name: 'Dokumenttyp',
			description:
				'Die Klassifikation aus der Inbox-Triage — rechnung, kontoauszug, vertrag, bescheid …',
			transform: {
				type: 'source:doc-type',
				config: { herkunft: 'inbox-triage' }
			},
			inputs: [],
			outputs: [{ name: 'typ' }]
		},
		{
			id: 'vorverarbeiten',
			kind: 'transform',
			name: 'Vorverarbeiten',
			description: 'Deterministische Bildaufbereitung: begradigen, entrauschen, binarisieren.',
			transform: {
				type: 'img:preprocess',
				config: { steps: ['deskew', 'denoise', 'binarize'] }
			},
			autonomie: {
				modus: 'auto',
				freigabe: {
					durch: 'system',
					seit: '2026-04-01',
					nachweis: 'reine Bildoperationen, am Original jederzeit nachvollziehbar'
				},
				fehler: 'retry'
			},
			inputs: [{ name: 'bild' }],
			outputs: [{ name: 'bereinigt' }]
		},
		{
			id: 'schema-waehlen',
			kind: 'transform',
			name: 'Schema wählen',
			description:
				'Deterministische Registry: Dokumenttyp → JSON-Schema + typspezifischer System-Prompt. Ein neuer Dokumenttyp ist ein Registry-Eintrag, kein neuer Flow.',
			transform: {
				type: 'registry:doc-schema',
				config: {
					registry: {
						rechnung: 'schema/rechnung + prompt/rechnung',
						kontoauszug: 'schema/kontoauszug + prompt/kontoauszug',
						vertrag: 'schema/vertrag + prompt/vertrag',
						bescheid: 'schema/bescheid + prompt/bescheid'
					},
					fallback: 'schema/generisch'
				}
			},
			inputs: [{ name: 'typ' }],
			outputs: [{ name: 'anweisung' }]
		},
		{
			id: 'ocr',
			kind: 'transform',
			name: 'Vision-OCR',
			description:
				'Vision-Modell liest das Bild gegen das gewählte Schema: strukturierte Daten UND Volltext mit Layout. Der Volltext bleibt der Beweis, an dem die Daten prüfbar sind.',
			transform: {
				type: 'ocr:vision-schema',
				config: {
					output: ['daten', 'text+layout'],
					schemaValidierung: 'hart',
					confidence: 'per-feld'
				}
			},
			llm: {
				purpose: 'Bild → typkonformes Datenmodell + Volltext',
				constraints: [
					'füllt nur Felder des übergebenen Schemas',
					'liest ab, erfindet nichts — leer statt geraten',
					'Konfidenz und Belegstelle pro Feld'
				]
			},
			autonomie: {
				modus: 'stichprobe',
				freigabe: {
					durch: 'buchhalter-stb',
					seit: '2026-07-01',
					nachweis: 'Korrekturquote 1,4 % über 800 Belege; jede 20. Seite bleibt Vollprüfung'
				},
				fehler: 'hitl'
			},
			inputs: [{ name: 'bild' }, { name: 'anweisung' }],
			outputs: [{ name: 'daten' }, { name: 'text' }]
		},
		{
			id: 'out-daten',
			kind: 'output',
			name: 'Strukturierte Daten',
			description: 'Das typkonforme Datenmodell — Positionen, Transaktionen, Vertragsdaten.',
			transform: {
				type: 'sink:structured',
				config: { schemakonform: true }
			},
			inputs: [{ name: 'daten' }],
			outputs: []
		},
		{
			id: 'out-text',
			kind: 'output',
			name: 'Volltext',
			description: 'Transkript samt Layout und Konfidenzen — für Suche, Archiv und Nachweis.',
			transform: {
				type: 'sink:text',
				config: { layout: true }
			},
			inputs: [{ name: 'text' }],
			outputs: []
		}
	],
	edges: [
		{ id: 's1', from: 'in-bild', fromPort: 'bild', to: 'vorverarbeiten', toPort: 'bild' },
		{ id: 's2', from: 'vorverarbeiten', fromPort: 'bereinigt', to: 'ocr', toPort: 'bild' },
		{ id: 's3', from: 'in-typ', fromPort: 'typ', to: 'schema-waehlen', toPort: 'typ' },
		{ id: 's4', from: 'schema-waehlen', fromPort: 'anweisung', to: 'ocr', toPort: 'anweisung' },
		{ id: 's5', from: 'ocr', fromPort: 'daten', to: 'out-daten', toPort: 'daten' },
		{ id: 's6', from: 'ocr', fromPort: 'text', to: 'out-text', toPort: 'text' }
	]
}

/**
 * Extraction: one document in, positions out — over a switch with priority
 * fallbacks. 1st: E-Rechnung, pure parser, lossless. 2nd: PDF with a text
 * layer, LLM extraction. 3rd: scan, the nested scan-zu-dokument subflow,
 * which returns schema-conform positions directly.
 */
const belegeExtrahieren: Recipe = {
	id: 'belege-extrahieren',
	name: 'Belege extrahieren',
	description:
		'Dokument + Typ → Positionen, mit Prioritäten-Weiche: E-Rechnung direkt geparst (verlustfrei), PDF mit Textlayer per LLM, Scan über den OCR-Subflow, der schon typkonforme Daten liefert.',
	nodes: [
		{
			id: 'in-dokumente',
			kind: 'input',
			name: 'Dokument',
			description: 'Ein Beleg aus der Triage: XML, PDF oder Foto/Scan.',
			transform: {
				type: 'source:document',
				config: { accepts: ['xml', 'pdf', 'image'] }
			},
			inputs: [],
			outputs: [{ name: 'dokument' }]
		},
		{
			id: 'in-typ',
			kind: 'input',
			name: 'Dokumenttyp',
			description: 'Die Klassifikation aus der Triage — wird an den OCR-Subflow durchgereicht.',
			transform: {
				type: 'source:doc-type',
				config: { herkunft: 'inbox-triage' }
			},
			inputs: [],
			outputs: [{ name: 'typ' }]
		},
		{
			id: 'weiche',
			kind: 'route',
			name: 'Belegweiche',
			description:
				'Genau ein Ausgang feuert: eingebettetes XML (XRechnung/ZUGFeRD) → e-rechnung; PDF mit Textlayer → pdf-text; sonst → scan.',
			transform: {
				type: 'route:by-format',
				config: {
					order: ['e-rechnung', 'pdf-text', 'scan'],
					detect: { 'e-rechnung': 'xml-vorhanden', 'pdf-text': 'textlayer', scan: 'fallback' }
				}
			},
			inputs: [{ name: 'dokument' }],
			outputs: [{ name: 'e-rechnung' }, { name: 'pdf-text' }, { name: 'scan' }]
		},
		{
			id: 'parse-erechnung',
			kind: 'transform',
			name: 'E-Rechnung parsen',
			description:
				'EN 16931: BG-25-Zeilen → Positionen, 1:1 und verlustfrei. Reiner Parser, Konfidenz immer 1.0 — hier hat kein Modell etwas verloren.',
			transform: {
				type: 'extract:structured',
				config: { standard: 'en16931', syntaxes: ['ubl', 'cii'], confidence: 1 }
			},
			autonomie: {
				modus: 'auto',
				freigabe: {
					durch: 'buchhalter-stb',
					seit: '2026-05-01',
					nachweis: 'reiner Parser gegen EN 16931, 0 Korrekturen in 1.200 Läufen'
				},
				fehler: 'hitl'
			},
			inputs: [{ name: 'xml' }],
			outputs: [{ name: 'positionen' }]
		},
		{
			id: 'ocr',
			kind: 'subflow',
			name: 'Scan lesen',
			description:
				'Derselbe OCR-Subflow wie überall — mit Typ »rechnung« liefert er direkt schemakonforme Positionen plus Volltext.',
			transform: {
				type: 'subflow',
				config: {}
			},
			subflow: {
				recipe: 'scan-zu-dokument',
				portMap: {
					inputs: { bild: 'in-bild', typ: 'in-typ' },
					outputs: { daten: 'out-daten', text: 'out-text' }
				}
			},
			inputs: [{ name: 'bild' }, { name: 'typ' }],
			outputs: [{ name: 'daten' }, { name: 'text' }]
		},
		{
			id: 'parse-pdf',
			kind: 'transform',
			name: 'Positionen aus Text',
			description:
				'Für PDFs mit Textlayer: kein OCR nötig, das Modell extrahiert Positionen direkt aus dem Text — Konfidenz pro Feld plus Belegstelle.',
			transform: {
				type: 'extract:llm',
				config: { output: 'positionen', confidence: 'per-field', belegstelle: true }
			},
			llm: {
				purpose: 'Belegtext mit Layer → Positions-Faktenobjekte',
				constraints: ['nur Fakten, keine Konten', 'Konfidenz pro Feld', 'Belegstelle pro Fakt']
			},
			inputs: [{ name: 'text' }],
			outputs: [{ name: 'positionen' }]
		},
		{
			id: 'out-positionen',
			kind: 'output',
			name: 'Positionen',
			description:
				'Rechnungspositionen mit Konfidenz — egal auf welchem der drei Wege sie entstanden.',
			transform: {
				type: 'sink:positions',
				config: { herkunft: ['e-rechnung', 'pdf-text', 'ocr'] }
			},
			inputs: [{ name: 'positionen', mode: 'any' }],
			outputs: []
		},
		{
			id: 'out-volltext',
			kind: 'output',
			name: 'Volltext',
			description: 'Der gelesene Belegtext für Suche und revisionssicheres Archiv.',
			transform: {
				type: 'sink:text',
				config: { archiv: true }
			},
			inputs: [{ name: 'text' }],
			outputs: []
		}
	],
	edges: [
		{ id: 'x1', from: 'in-dokumente', fromPort: 'dokument', to: 'weiche', toPort: 'dokument' },
		{ id: 'x2', from: 'weiche', fromPort: 'e-rechnung', to: 'parse-erechnung', toPort: 'xml' },
		{ id: 'x3', from: 'weiche', fromPort: 'pdf-text', to: 'parse-pdf', toPort: 'text' },
		{ id: 'x4', from: 'weiche', fromPort: 'scan', to: 'ocr', toPort: 'bild' },
		{ id: 'x5', from: 'in-typ', fromPort: 'typ', to: 'ocr', toPort: 'typ' },
		{
			id: 'x6',
			from: 'parse-erechnung',
			fromPort: 'positionen',
			to: 'out-positionen',
			toPort: 'positionen'
		},
		{ id: 'x7', from: 'ocr', fromPort: 'daten', to: 'out-positionen', toPort: 'positionen' },
		{
			id: 'x8',
			from: 'parse-pdf',
			fromPort: 'positionen',
			to: 'out-positionen',
			toPort: 'positionen'
		},
		{ id: 'x9', from: 'ocr', fromPort: 'text', to: 'out-volltext', toPort: 'text' }
	]
}

/**
 * Reconciliation — the Buchhaltung skill's generic half. Transactions
 * arrive already structured (the Inbox skill read them); this flow only
 * matches them against the open items.
 *
 * Open items arrive as STATE, not as a wire: the payment shows up days
 * after the invoice was booked, so this flow reads the OPOS balance
 * rather than taking it from the booking flow — which is also what keeps
 * the two halves a DAG instead of a loop.
 */
const zahlungsabgleich: Recipe = {
	id: 'zahlungsabgleich',
	name: 'Zahlungsabgleich',
	description:
		'Zahlungen gegen offene Posten: Transaktionen aus der Inbox oder direkt aus der Bank, gematcht auf Rechnung und Position — Skonto anteilig nach dem Aufteilungsschlüssel der Ursprungsrechnung.',
	nodes: [
		{
			id: 'in-transaktionen',
			kind: 'input',
			name: 'Transaktionen',
			description:
				'Aus dem Inbox-Skill: gelesene Kontoauszüge und CSV-Exporte, bereits strukturiert.',
			transform: { type: 'source:transactions', config: { herkunft: 'skill:inbox' } },
			inputs: [],
			outputs: [{ name: 'transaktionen' }]
		},
		{
			id: 'in-bank',
			kind: 'input',
			name: 'Bank-Feed',
			description:
				'Maschinelle Kontoumsätze über FinTS/EBICS — die einzige Quelle, die an der Inbox vorbeiläuft.',
			transform: { type: 'source:bank-feed', config: { protocol: 'fints' } },
			inputs: [],
			outputs: [{ name: 'transaktionen' }]
		},
		{
			id: 'in-opos',
			kind: 'input',
			name: 'Offene Posten (Bestand)',
			description:
				'Der OPOS-Bestand als Zustand, nicht als Leitung: die Zahlung kommt Tage nach der Buchung, also wird gelesen statt verdrahtet.',
			transform: { type: 'source:open-items', config: { bestand: true } },
			inputs: [],
			outputs: [{ name: 'offen' }]
		},
		{
			id: 'match',
			kind: 'transform',
			name: 'Zahlung matchen',
			description:
				'Transaktion ↔ Rechnung ↔ Position (Skonto braucht den Aufteilungsschlüssel der Ursprungsrechnung). Regel-Engine zuerst; das LLM darf nur bei unklarem Verwendungszweck Kandidaten vorschlagen.',
			transform: {
				type: 'match:tx-invoice',
				config: { keys: ['betrag', 'iban', 'verwendungszweck'], skonto: 'positionsanteilig' }
			},
			llm: {
				purpose: 'Fuzzy-Kandidaten bei unklarem Verwendungszweck',
				constraints: ['nur Vorschläge, nie Auto-Match', 'Regeln haben Vorrang']
			},
			inputs: [{ name: 'transaktionen', mode: 'any' }, { name: 'offen' }],
			outputs: [{ name: 'abgeglichen' }, { name: 'unklar' }]
		},
		{
			id: 'out-abgeglichen',
			kind: 'output',
			name: 'Abgeglichene Zahlungen',
			description: 'Zahlung ↔ Rechnung ↔ Position verknüpft — die Grundlage der Ist-Versteuerung.',
			transform: { type: 'sink:matched-payments', config: {} },
			inputs: [{ name: 'abgeglichen' }],
			outputs: []
		},
		{
			id: 'out-unklar',
			kind: 'handoff',
			name: '→ HITL',
			description:
				'Zahlungen ohne eindeutigen Posten: geparkt statt geraten — das Klärungskonto muss zum Jahresende auf null stehen. Der HITL-Skill entscheidet, nicht dieser Flow.',
			transform: { type: 'handoff:skill', config: { ziel: 'hitl', konto: 'klaerung' } },
			handoff: { skill: 'hitl' },
			inputs: [{ name: 'unklar' }],
			outputs: []
		}
	],
	edges: [
		{
			id: 'z1',
			from: 'in-transaktionen',
			fromPort: 'transaktionen',
			to: 'match',
			toPort: 'transaktionen'
		},
		{ id: 'z2', from: 'in-bank', fromPort: 'transaktionen', to: 'match', toPort: 'transaktionen' },
		{ id: 'z3', from: 'in-opos', fromPort: 'offen', to: 'match', toPort: 'offen' },
		{
			id: 'z4',
			from: 'match',
			fromPort: 'abgeglichen',
			to: 'out-abgeglichen',
			toPort: 'abgeglichen'
		},
		{ id: 'z5', from: 'match', fromPort: 'unklar', to: 'out-unklar', toPort: 'unklar' }
	]
}

/**
 * The tax half: positions and matched payments in, a sealed batch out.
 * This is where German bookkeeping lives — Kontenkategorie, the
 * deterministic tax tree, the n:m line derivation, Soll/Ist, and the two
 * pairs of eyes before the Festschreibung is anchored.
 */
const buchungsvorgang: Recipe = {
	id: 'buchungsvorgang',
	name: 'Buchungsvorgang',
	description:
		'Der steuerliche Teil: Kategorie → Steuerlogik → Buchungszeilen (n:m) → Validierung → Soll/Ist → Vier-Augen-Freigabe → Festschreibung mit Anker.',
	nodes: [
		{
			id: 'in-positionen',
			kind: 'input',
			name: 'Positionen',
			description: 'Rechnungspositionen aus der Erfassung — die Verarbeitungseinheit.',
			transform: { type: 'source:positions', config: {} },
			inputs: [],
			outputs: [{ name: 'positionen' }]
		},
		{
			id: 'in-stammdaten',
			kind: 'input',
			name: 'Kontenplan & Policy',
			description:
				'Mandanten-Kontenplan mit Mapping, Wahlrechte-Policy, Lieferantenhistorie — das Mandanten-Wissen.',
			transform: {
				type: 'source:master-data',
				config: { kontenplan: 'mandant', policy: 'versioniert', historie: true }
			},
			inputs: [],
			outputs: [{ name: 'kontext' }]
		},
		{
			id: 'in-abgeglichen',
			kind: 'input',
			name: 'Abgeglichene Zahlungen',
			description: 'Aus der Erfassung: Zahlung ↔ Rechnung ↔ Position, inklusive Skontoanteil.',
			transform: { type: 'source:matched-payments', config: {} },
			inputs: [],
			outputs: [{ name: 'zahlungen' }]
		},
		{
			id: 'classify',
			kind: 'transform',
			name: 'Leistungsart klassifizieren',
			description:
				'Position → Kontenkategorie. Retrieval über bisherige Buchungen vor LLM; Korrekturen werden zu deterministischen Regeln, nie Trainingsdaten.',
			transform: {
				type: 'llm:classify',
				config: {
					retrieval: 'buchungshistorie',
					output: 'kategorie',
					neverOutputs: ['konto', 'bu']
				}
			},
			llm: {
				purpose: 'Leistungsart → Kontenkategorie',
				constraints: ['gibt NIE Konto oder BU aus', 'Retrieval vor Modell', 'Begründung pflicht']
			},
			inputs: [{ name: 'positionen' }, { name: 'kontext' }],
			outputs: [{ name: 'klassifiziert' }]
		},
		{
			id: 'tax',
			kind: 'transform',
			name: 'Steuerlogik',
			description:
				'Deterministischer Entscheidungsbaum, nie KI: Land, USt-IdNr., Leistungsort, B2B/B2C → Regime → Konto + BU. Jede Regel mit §-Verweis, als testbarer Code.',
			transform: { type: 'rules:tax', config: { engine: 'decision-tree', paragraphRefs: true } },
			autonomie: {
				modus: 'auto',
				freigabe: {
					durch: 'buchhalter-stb',
					seit: '2026-03-01',
					nachweis: 'deterministischer Entscheidungsbaum, jede Regel mit Test und §-Verweis'
				},
				fehler: 'hitl'
			},
			inputs: [{ name: 'klassifiziert' }, { name: 'kontext' }],
			outputs: [{ name: 'verortet' }]
		},
		{
			id: 'derive',
			kind: 'transform',
			name: 'Buchungszeilen ableiten',
			description:
				'Position → 1..n Buchungszeilen (n:m): 70/30-Splits, Geschenke-Asymmetrie, Vorsteuerzeilen — jede Zeile mit Begründung.',
			transform: {
				type: 'map:positions-to-lines',
				config: { splits: ['bewirtung-70-30', 'geschenke-50eur'], begruendung: true }
			},
			inputs: [{ name: 'verortet' }],
			outputs: [{ name: 'buchungssatz' }, { name: 'offen' }]
		},
		{
			id: 'validate',
			kind: 'transform',
			name: 'Validieren',
			description:
				'Deterministisch: Soll=Haben, Netto×Satz=Steuer, VIES, Belegdatum im WJ, Plausibilität gegen Lieferantenhistorie. Unsicheres → Prüfliste statt raten.',
			transform: {
				type: 'rules:validate',
				config: {
					checks: ['soll-haben', 'netto-satz-steuer', 'vies', 'belegdatum-wj', 'historie']
				}
			},
			inputs: [{ name: 'buchungssatz' }],
			outputs: [{ name: 'geprueft' }, { name: 'unsicher' }]
		},
		{
			id: 'versteuerung',
			kind: 'route',
			name: 'Versteuerungsart',
			description:
				'Soll oder Ist — aus der Mandanten-Policy (§ 20 UStG, 800.000-€-Grenze). Bei Soll ist die USt längst mit der Rechnung entstanden; bei Ist entsteht sie erst jetzt, mit der Zahlung.',
			transform: {
				type: 'route:by-policy',
				config: {
					quelle: 'mandanten-policy',
					schwelle: '800000 EUR Vorjahresumsatz',
					paragraph: '§ 20 UStG'
				}
			},
			inputs: [{ name: 'zahlungen' }, { name: 'kontext' }],
			outputs: [{ name: 'soll' }, { name: 'ist' }]
		},
		{
			id: 'ust-umbuchen',
			kind: 'transform',
			name: 'USt fällig stellen',
			description:
				'Ist-Versteuerung: erst der Zahlungseingang macht die USt fällig — Umbuchung »USt nicht fällig« → »USt fällig«, anteilig bei Teilzahlung und Skonto (§ 13 Abs. 1 Nr. 1 b UStG). Deterministisch.',
			transform: {
				type: 'map:tax-on-payment',
				config: {
					von: 'ust-nicht-faellig',
					nach: 'ust-faellig',
					anteilig: ['teilzahlung', 'skonto']
				}
			},
			inputs: [{ name: 'zahlungen' }],
			outputs: [{ name: 'umbuchung' }, { name: 'ausgeglichen' }]
		},
		{
			id: 'hitl-gf',
			kind: 'hitl',
			name: 'Freigabe GF',
			description:
				'Vier Augen, erstes Paar: Gründer/Geschäftsführung. Sieht Begründung statt grünem Häkchen, Liste nach Risiko sortiert — Stichproben mit Zwang zur Vollprüfung gegen Automation Bias.',
			transform: {
				type: 'hitl:approve',
				config: {
					rolle: 'geschaeftsfuehrung',
					reihenfolge: 1,
					anzeige: 'begruendung',
					sortierung: 'risiko',
					stichproben: 'zwang-zur-vollpruefung'
				}
			},
			inputs: [{ name: 'zeilen' }],
			outputs: [{ name: 'freigegeben' }]
		},
		{
			id: 'hitl-buchhalter',
			kind: 'hitl',
			name: 'Freigabe Buchhalter',
			description:
				'Vier Augen, zweites Paar: Buchhalter/Steuerberater — die Kanzlei arbeitet direkt im Tool. Erst nach beiden Freigaben darf festgeschrieben werden.',
			transform: {
				type: 'hitl:approve',
				config: { rolle: 'buchhalter-stb', reihenfolge: 2, vieraugen: true }
			},
			inputs: [{ name: 'zeilen' }],
			outputs: [{ name: 'freigegeben' }]
		},
		{
			id: 'festschreiben',
			kind: 'transform',
			name: 'Festschreiben',
			description:
				'GoBD-Festschreibung, an die UStVA-Periode gekoppelt (Frist: Ablauf des Folgemonats). Unveränderbarkeit als Hash-Kette, extern verankert — Blockchain-Anchoring als Beweis, dass nachträglich nichts angefasst wurde.',
			transform: {
				type: 'seal:festschreibung',
				config: {
					kopplung: 'ustva-periode',
					frist: 'ablauf-folgemonat',
					hashkette: true,
					anchor: 'blockchain'
				}
			},
			inputs: [{ name: 'freigegeben', mode: 'any' }],
			outputs: [{ name: 'festgeschrieben' }]
		},
		{
			id: 'out-stapel',
			kind: 'output',
			name: 'Buchungsstapel',
			description:
				'Festgeschriebene Buchungen — zweifach freigegeben, gegen die Hash-Kette verankert. Von hier holt der DATEV-Export.',
			transform: { type: 'sink:booking-batch', config: { festgeschrieben: true } },
			inputs: [{ name: 'festgeschrieben' }],
			outputs: []
		},
		{
			id: 'out-hitl',
			kind: 'handoff',
			name: '→ HITL',
			description:
				'Was die Validierung nicht sicher passiert, geht an den HITL-Skill — dort wird nach Risiko sortiert und mit Begründung geprüft; Korrigiertes läuft erneut durch die Validierung.',
			transform: { type: 'handoff:skill', config: { ziel: 'hitl' } },
			handoff: { skill: 'hitl' },
			inputs: [{ name: 'unklar' }],
			outputs: []
		},
		{
			id: 'out-opos',
			kind: 'output',
			name: 'Offene Posten',
			description:
				'Der OPOS-Bestand: neue Forderungen/Verbindlichkeiten aus dem Buchungssatz, ausgeglichene aus dem Zahlungsstrom. Die Erfassung liest ihn beim nächsten Lauf.',
			transform: { type: 'sink:open-items', config: { faelligkeiten: true } },
			inputs: [{ name: 'posten', mode: 'any' }],
			outputs: []
		}
	],
	edges: [
		{
			id: 'v1',
			from: 'in-positionen',
			fromPort: 'positionen',
			to: 'classify',
			toPort: 'positionen'
		},
		{ id: 'v2', from: 'in-stammdaten', fromPort: 'kontext', to: 'classify', toPort: 'kontext' },
		{ id: 'v3', from: 'classify', fromPort: 'klassifiziert', to: 'tax', toPort: 'klassifiziert' },
		{ id: 'v4', from: 'in-stammdaten', fromPort: 'kontext', to: 'tax', toPort: 'kontext' },
		{ id: 'v5', from: 'tax', fromPort: 'verortet', to: 'derive', toPort: 'verortet' },
		{ id: 'v6', from: 'derive', fromPort: 'buchungssatz', to: 'validate', toPort: 'buchungssatz' },
		{ id: 'v7', from: 'derive', fromPort: 'offen', to: 'out-opos', toPort: 'posten' },
		{ id: 'v8', from: 'validate', fromPort: 'geprueft', to: 'hitl-gf', toPort: 'zeilen' },
		{ id: 'v9', from: 'validate', fromPort: 'unsicher', to: 'out-hitl', toPort: 'unklar' },
		{
			id: 'v10',
			from: 'hitl-gf',
			fromPort: 'freigegeben',
			to: 'hitl-buchhalter',
			toPort: 'zeilen'
		},
		{
			id: 'v11',
			from: 'hitl-buchhalter',
			fromPort: 'freigegeben',
			to: 'festschreiben',
			toPort: 'freigegeben'
		},
		{
			id: 'v12',
			from: 'festschreiben',
			fromPort: 'festgeschrieben',
			to: 'out-stapel',
			toPort: 'festgeschrieben'
		},
		{
			id: 'v13',
			from: 'in-abgeglichen',
			fromPort: 'zahlungen',
			to: 'versteuerung',
			toPort: 'zahlungen'
		},
		{
			id: 'v14',
			from: 'in-stammdaten',
			fromPort: 'kontext',
			to: 'versteuerung',
			toPort: 'kontext'
		},
		{ id: 'v15', from: 'versteuerung', fromPort: 'soll', to: 'out-opos', toPort: 'posten' },
		{ id: 'v16', from: 'versteuerung', fromPort: 'ist', to: 'ust-umbuchen', toPort: 'zahlungen' },
		{
			id: 'v17',
			from: 'ust-umbuchen',
			fromPort: 'umbuchung',
			to: 'festschreiben',
			toPort: 'freigegeben'
		},
		{ id: 'v18', from: 'ust-umbuchen', fromPort: 'ausgeglichen', to: 'out-opos', toPort: 'posten' }
	]
}

/**
 * The Buchhaltung skill's entry: what the Inbox hands over becomes a
 * sealed batch. Two boxes and a wire — abgleichen (generic) feeds buchen
 * (tax), so this level stays readable in a glance.
 */
const eingangsrechnungBuchen: Recipe = {
	id: 'eingangsrechnung-buchen',
	name: 'Eingangsrechnung buchen',
	description:
		'Der Einstieg des Buchhaltungs-Skills: Positionen und Transaktionen kommen aus der Inbox, hier werden Zahlungen abgeglichen und daraus der festgeschriebene Buchungsstapel.',
	nodes: [
		{
			id: 'in-positionen',
			kind: 'input',
			name: 'Positionen',
			description:
				'Aus dem Inbox-Skill: bereits extrahierte Rechnungspositionen mit Konfidenz — die Verarbeitungseinheit.',
			transform: { type: 'source:positions', config: { herkunft: 'skill:inbox' } },
			inputs: [],
			outputs: [{ name: 'positionen' }]
		},
		{
			id: 'in-transaktionen',
			kind: 'input',
			name: 'Transaktionen',
			description: 'Aus dem Inbox-Skill: gelesene Kontoauszüge und CSV-Exporte.',
			transform: { type: 'source:transactions', config: { herkunft: 'skill:inbox' } },
			inputs: [],
			outputs: [{ name: 'transaktionen' }]
		},
		{
			id: 'in-stammdaten',
			kind: 'input',
			name: 'Kontenplan & Policy',
			description:
				'Mandanten-Kontenplan, Wahlrechte-Policy, Historie — reicht in den Buchungsteil.',
			transform: {
				type: 'source:master-data',
				config: { kontenplan: 'mandant', policy: 'versioniert', historie: true }
			},
			inputs: [],
			outputs: [{ name: 'kontext' }]
		},
		{
			id: 'abgleichen',
			kind: 'subflow',
			name: 'Zahlungsabgleich',
			description:
				'Der allgemeine Teil, ohne Steuerrecht: Transaktionen gegen offene Posten matchen, Unklares in die Klärung.',
			transform: { type: 'subflow', config: {} },
			subflow: {
				recipe: 'zahlungsabgleich',
				portMap: {
					inputs: { transaktionen: 'in-transaktionen' },
					outputs: { abgeglichen: 'out-abgeglichen' }
				}
			},
			inputs: [{ name: 'transaktionen' }],
			outputs: [{ name: 'abgeglichen' }]
		},
		{
			id: 'buchen',
			kind: 'subflow',
			name: 'Buchungsvorgang',
			description:
				'Der steuerliche Teil: Kategorie, Steuerlogik, Buchungszeilen, Soll/Ist, Vier-Augen-Freigabe, Festschreibung.',
			transform: { type: 'subflow', config: {} },
			subflow: {
				recipe: 'buchungsvorgang',
				portMap: {
					inputs: {
						positionen: 'in-positionen',
						zahlungen: 'in-abgeglichen',
						kontext: 'in-stammdaten'
					},
					outputs: { stapel: 'out-stapel' }
				}
			},
			inputs: [{ name: 'positionen' }, { name: 'zahlungen' }, { name: 'kontext' }],
			outputs: [{ name: 'stapel' }]
		},
		{
			id: 'out-stapel',
			kind: 'output',
			name: 'Buchungsstapel',
			description:
				'Festgeschriebene, verankerte Buchungen — der Bestand, aus dem der DATEV-Export am Periodenende zieht.',
			transform: { type: 'sink:booking-batch', config: { festgeschrieben: true } },
			inputs: [{ name: 'stapel' }],
			outputs: []
		}
	],
	edges: [
		{
			id: 'e1',
			from: 'in-transaktionen',
			fromPort: 'transaktionen',
			to: 'abgleichen',
			toPort: 'transaktionen'
		},
		{ id: 'e2', from: 'in-positionen', fromPort: 'positionen', to: 'buchen', toPort: 'positionen' },
		{ id: 'e3', from: 'abgleichen', fromPort: 'abgeglichen', to: 'buchen', toPort: 'zahlungen' },
		{ id: 'e4', from: 'in-stammdaten', fromPort: 'kontext', to: 'buchen', toPort: 'kontext' },
		{ id: 'e5', from: 'buchen', fromPort: 'stapel', to: 'out-stapel', toPort: 'stapel' }
	]
}
/**
 * DATEV export — its own system, deliberately at the edge. It reads the
 * sealed batch as state and produces one EXTF file per Stapel; nothing
 * upstream depends on it, and it depends on nothing but the ledger.
 *
 * The interesting step is »Vorsteuer falten«: our explicit Vorsteuer lines
 * do not exist in EXTF. There, tax is a BU key on a gross amount, and the
 * receiving system re-derives the split on import — so the export has to
 * fold the accordion shut that DATEV will open again.
 */
const datevExport: Recipe = {
	id: 'datev-export',
	name: 'DATEV-Export (EXTF)',
	description:
		'Eigenständiges Randsystem: festgeschriebene Buchungen → Stapel je Periode und Belegkreis → Vorsteuerzeilen in BU-Schlüssel falten → EXTF-CSV schreiben und prüfen.',
	nodes: [
		{
			id: 'in-buchungen',
			kind: 'input',
			name: 'Festgeschriebene Buchungen',
			description:
				'Der Bestand aus dem Buchungsvorgang — nur Festgeschriebenes wird exportiert, nie Entwürfe.',
			transform: { type: 'source:booking-batch', config: { nurFestgeschrieben: true } },
			inputs: [],
			outputs: [{ name: 'buchungen' }]
		},
		{
			id: 'in-mandant',
			kind: 'input',
			name: 'Mandant & Berater',
			description:
				'Was in den Header muss: Beraternummer, Mandantennummer, WJ-Beginn, Sachkontenlänge, Kontenrahmen.',
			transform: {
				type: 'source:client-meta',
				config: { felder: ['beraternr', 'mandantennr', 'wj-beginn', 'sachkontenlaenge', 'skr'] }
			},
			inputs: [],
			outputs: [{ name: 'stammdaten' }]
		},
		{
			id: 'stapeln',
			kind: 'transform',
			name: 'Stapel bilden',
			description:
				'Ein Stapel je Periode × Belegkreis (so arbeitet die Kanzlei), nie über die Wirtschaftsjahr-Grenze, max. 99.999 Zeilen.',
			transform: {
				type: 'group:batches',
				config: {
					schluessel: ['periode', 'belegkreis'],
					grenze: 'wirtschaftsjahr',
					maxZeilen: 99999
				}
			},
			inputs: [{ name: 'buchungen' }],
			outputs: [{ name: 'stapel' }]
		},
		{
			id: 'falten',
			kind: 'transform',
			name: 'Vorsteuer falten',
			description:
				'Unsere expliziten Vorsteuerzeilen existieren im EXTF nicht: Brutto auf das Aufwandskonto, Steuersatz als BU-Schlüssel, Haben-Zeile wird Gegenkonto. Deterministisch und umkehrbar.',
			transform: {
				type: 'map:fold-tax-lines',
				config: {
					vorsteuerZeilen: 'in-bu-schluessel',
					habenZeile: 'gegenkonto',
					bu: { '19': 9, '7': 8 }
				}
			},
			inputs: [{ name: 'stapel' }],
			outputs: [{ name: 'gefaltet' }]
		},
		{
			id: 'schreiben',
			kind: 'transform',
			name: 'EXTF schreiben',
			description:
				'Formatversion 700, Kategorie 21, 125 Felder je Zeile, Windows-1252, Semikolon — Belegdatum als TTMM, weil das Jahr im Header steht.',
			transform: {
				type: 'write:extf',
				config: {
					version: 700,
					kategorie: 21,
					felder: 125,
					encoding: 'windows-1252',
					belegdatum: 'TTMM'
				}
			},
			inputs: [{ name: 'gefaltet' }, { name: 'stammdaten' }],
			outputs: [{ name: 'datei' }]
		},
		{
			id: 'pruefen',
			kind: 'transform',
			name: 'Prüfen',
			description:
				'Vor der Übergabe: Summe je Beleg gegen Gegenkonto, BU-Schlüssel gegen Steuersatz, Belegdatum im Header-Zeitraum, Zeilenzahl im Limit.',
			transform: {
				type: 'rules:validate-extf',
				config: { checks: ['belegsumme', 'bu-vs-satz', 'datum-im-zeitraum', 'zeilenlimit'] }
			},
			inputs: [{ name: 'datei' }],
			outputs: [{ name: 'ok' }, { name: 'fehler' }]
		},
		{
			id: 'out-datei',
			kind: 'output',
			name: 'EXTF-Datei',
			description: 'Übergabefertig für die Kanzlei — der Austauschpfad, nicht unser Datenmodell.',
			transform: { type: 'sink:file', config: { name: 'EXTF_Buchungsstapel_<periode>.csv' } },
			inputs: [{ name: 'ok' }],
			outputs: []
		},
		{
			id: 'out-abweisung',
			kind: 'handoff',
			name: '→ HITL',
			description:
				'Was die Prüfung nicht passiert, geht an den HITL-Skill — eine abgelehnte Übermittlung merkt man sonst erst beim Steuerberater. Format-Fehler sind eine typische Klasse für die Selbstheilung.',
			transform: { type: 'handoff:skill', config: { ziel: 'hitl' } },
			handoff: { skill: 'hitl' },
			inputs: [{ name: 'fehler' }],
			outputs: []
		}
	],
	edges: [
		{ id: 'd1', from: 'in-buchungen', fromPort: 'buchungen', to: 'stapeln', toPort: 'buchungen' },
		{ id: 'd2', from: 'stapeln', fromPort: 'stapel', to: 'falten', toPort: 'stapel' },
		{ id: 'd3', from: 'falten', fromPort: 'gefaltet', to: 'schreiben', toPort: 'gefaltet' },
		{
			id: 'd4',
			from: 'in-mandant',
			fromPort: 'stammdaten',
			to: 'schreiben',
			toPort: 'stammdaten'
		},
		{ id: 'd5', from: 'schreiben', fromPort: 'datei', to: 'pruefen', toPort: 'datei' },
		{ id: 'd6', from: 'pruefen', fromPort: 'ok', to: 'out-datei', toPort: 'ok' },
		{ id: 'd7', from: 'pruefen', fromPort: 'fehler', to: 'out-abweisung', toPort: 'fehler' }
	]
}

/**
 * The Inbox skill's entry: EVERYTHING that needs work arrives here — mail,
 * postbox, upload, webhook, message. Normalize, split (one mail can hold
 * three Vorgänge), classify ONCE, then read the documents: the class
 * travels with the item and tells the OCR which schema and system prompt
 * to use. What comes out are structured positions and transactions, handed
 * to the Buchhaltung skill. What cannot be placed lands in the
 * Weiß-nicht-Box: direct HITL instead of guessing.
 */
const inboxTriage: Recipe = {
	id: 'inbox-triage',
	name: 'Inbox-Triage',
	description:
		'Der eine Eingang: annehmen → Vorgänge trennen → einmal klassifizieren → lesen. Belege werden extrahiert, Auszüge gelesen; das Ergebnis geht an den Buchhaltungs-Skill, Unklares an einen Menschen.',
	nodes: [
		{
			id: 'in-mail',
			kind: 'input',
			name: 'E-Mail',
			description: 'Postfach-Anbindung: Mails samt Anhängen, auch Weiterleitungen.',
			transform: { type: 'source:mail', config: { protokoll: 'imap', anhaenge: true } },
			inputs: [],
			outputs: [{ name: 'eingang' }]
		},
		{
			id: 'in-postbox',
			kind: 'input',
			name: 'Postbox',
			description: 'Gescannte Briefpost (Scan-Service oder eigener Scanner).',
			transform: { type: 'source:postbox', config: { format: ['pdf', 'image'] } },
			inputs: [],
			outputs: [{ name: 'eingang' }]
		},
		{
			id: 'in-upload',
			kind: 'input',
			name: 'Upload',
			description: 'Manuell hochgeladene Dateien — Drag & Drop, Datei-Dialog, Share-Sheet.',
			transform: { type: 'source:upload', config: { kanal: ['app', 'share-sheet'] } },
			inputs: [],
			outputs: [{ name: 'eingang' }]
		},
		{
			id: 'annehmen',
			kind: 'transform',
			name: 'Annehmen',
			description:
				'Alles wird derselbe Umschlag: Vorgang mit Quelle, Zeitstempel, Text, Anhängen, Metadaten. Deterministisch — hier wird nichts interpretiert.',
			transform: {
				type: 'ingest:normalize',
				config: { envelope: ['quelle', 'zeit', 'text', 'anhaenge', 'meta'], dedupe: 'hash' }
			},
			inputs: [{ name: 'eingang', mode: 'any' }],
			outputs: [{ name: 'vorgang' }]
		},
		{
			id: 'trennen',
			kind: 'transform',
			name: 'Vorgänge trennen',
			description:
				'Ein Eingang kann mehrere Vorgänge tragen: eine Mail mit drei Rechnungen wird zu drei Vorgängen, jeder behält den Verweis auf den Ursprung.',
			transform: { type: 'llm:split', config: { output: 'vorgaenge[]', herkunftsRef: true } },
			llm: {
				purpose: 'Mehrere eigenständige Vorgänge in einem Eingang erkennen und trennen',
				constraints: [
					'nur trennen, nichts verwerfen',
					'jeder Vorgang behält die Ursprungs-Referenz'
				]
			},
			inputs: [{ name: 'vorgang' }],
			outputs: [{ name: 'vorgaenge' }]
		},
		{
			id: 'klassifizieren',
			kind: 'transform',
			name: 'Klassifizieren',
			description:
				'Die eine Klassifikation für alles: Vorgang → Klasse + Dokumenttyp, mit Konfidenz. Der Typ reist mit dem Vorgang und steuert stromabwärts Schema und System-Prompt der OCR. Unter der Schwelle wird nicht geraten.',
			transform: {
				type: 'llm:classify-inbox',
				config: {
					klassen: ['beleg', 'transaktionen'],
					dokumenttypen: ['rechnung', 'kontoauszug', 'sonstiges'],
					schwelle: 0.8,
					unterSchwelle: 'unbekannt'
				}
			},
			llm: {
				purpose: 'Vorgang einer bekannten Klasse und einem Dokumenttyp zuordnen',
				constraints: [
					'Konfidenz pflicht',
					'unter Schwelle → unbekannt, nie raten',
					'Begründung pro Zuordnung'
				]
			},
			inputs: [{ name: 'vorgaenge' }],
			outputs: [{ name: 'klassifiziert' }, { name: 'dokumenttyp' }]
		},
		{
			id: 'triage',
			kind: 'route',
			name: 'Triage',
			description:
				'Die Standard-Weiche: genau ein Ausgang pro Vorgang, entlang der Klasse. Vorerst nur die gebauten Pfade — was hier keine Klasse findet, geht an einen Menschen statt in einen Platzhalter.',
			transform: { type: 'route:by-class', config: { quelle: 'klassifikation' } },
			inputs: [{ name: 'klassifiziert' }],
			outputs: [{ name: 'beleg' }, { name: 'transaktionen' }, { name: 'unbekannt' }]
		},
		{
			id: 'extract',
			kind: 'subflow',
			name: 'Belege extrahieren',
			description:
				'Weiche E-Rechnung | PDF-Text | Scan → Positionen mit Konfidenz; der Scan-Zweig nutzt den OCR-Flow mit Dokumenttyp »rechnung«.',
			transform: { type: 'subflow', config: {} },
			subflow: {
				recipe: 'belege-extrahieren',
				portMap: {
					inputs: { dokument: 'in-dokumente', typ: 'in-typ' },
					outputs: { positionen: 'out-positionen' }
				}
			},
			inputs: [{ name: 'dokument' }, { name: 'typ' }],
			outputs: [{ name: 'positionen' }]
		},
		{
			id: 'auszugsweiche',
			kind: 'route',
			name: 'Auszugsweiche',
			description:
				'CSV wird geparst, PDF/Scan geht durch dieselbe OCR wie jeder andere Beleg — nur mit Dokumenttyp »kontoauszug«.',
			transform: {
				type: 'route:by-format',
				config: { order: ['csv', 'scan'], detect: { csv: 'mime-csv', scan: 'fallback' } }
			},
			inputs: [{ name: 'auszug' }],
			outputs: [{ name: 'csv' }, { name: 'scan' }]
		},
		{
			id: 'parse-csv',
			kind: 'transform',
			name: 'CSV parsen',
			description:
				'Deterministisch: Spalten-Mapping je Bank, Beträge und Daten normalisiert. Kein Modell nötig.',
			transform: {
				type: 'parse:csv',
				config: { mapping: 'je-bank', normalisieren: ['betrag', 'datum'] }
			},
			autonomie: {
				modus: 'auto',
				freigabe: {
					durch: 'buchhalter-stb',
					seit: '2026-06-15',
					nachweis:
						'Spalten-Mapping je Bank getestet; neue Layouts sind eine freigegebene Fehlerklasse'
				},
				fehler: 'hitl'
			},
			inputs: [{ name: 'csv' }],
			outputs: [{ name: 'transaktionen' }]
		},
		{
			id: 'auszug-ocr',
			kind: 'subflow',
			name: 'Auszug lesen',
			description:
				'Derselbe OCR-Subflow wie beim Beleg — mit Typ »kontoauszug« liefert er direkt eine Transaktionsliste. Ein Flow, zwei Dokumenttypen.',
			transform: { type: 'subflow', config: {} },
			subflow: {
				recipe: 'scan-zu-dokument',
				portMap: { inputs: { bild: 'in-bild', typ: 'in-typ' }, outputs: { daten: 'out-daten' } }
			},
			inputs: [{ name: 'bild' }, { name: 'typ' }],
			outputs: [{ name: 'daten' }]
		},
		{
			id: 'an-buchhaltung',
			kind: 'handoff',
			name: '→ Buchhaltung',
			description:
				'Die Skill-Grenze: gelesene Positionen und Transaktionen gehen an den Buchhaltungs-Skill. Der Inbox-Skill weiß nicht, was dort passiert — er kennt nur den Vertrag.',
			transform: { type: 'handoff:skill', config: { ziel: 'buchhaltung', eintritt: 'entry-flow' } },
			handoff: { skill: 'buchhaltung' },
			inputs: [{ name: 'positionen' }, { name: 'transaktionen', mode: 'any' }],
			outputs: []
		},
		{
			id: 'an-hitl',
			kind: 'handoff',
			name: '→ HITL (Weiß-nicht-Box)',
			description:
				'Alles, was keine Klasse fand, geht an den HITL-Skill: direkte menschliche Sichtung. Jede Zuordnung von dort wird zur Regel für die nächste Triage.',
			transform: {
				type: 'handoff:skill',
				config: { ziel: 'hitl', lerneffekt: 'korrektur-wird-regel' }
			},
			handoff: { skill: 'hitl' },
			inputs: [{ name: 'unklar' }],
			outputs: []
		}
	],
	edges: [
		{ id: 't1', from: 'in-mail', fromPort: 'eingang', to: 'annehmen', toPort: 'eingang' },
		{ id: 't2', from: 'in-postbox', fromPort: 'eingang', to: 'annehmen', toPort: 'eingang' },
		{ id: 't3', from: 'in-upload', fromPort: 'eingang', to: 'annehmen', toPort: 'eingang' },
		{ id: 't6', from: 'annehmen', fromPort: 'vorgang', to: 'trennen', toPort: 'vorgang' },
		{ id: 't7', from: 'trennen', fromPort: 'vorgaenge', to: 'klassifizieren', toPort: 'vorgaenge' },
		{
			id: 't8',
			from: 'klassifizieren',
			fromPort: 'klassifiziert',
			to: 'triage',
			toPort: 'klassifiziert'
		},
		{ id: 't9', from: 'triage', fromPort: 'beleg', to: 'extract', toPort: 'dokument' },
		{ id: 't10', from: 'klassifizieren', fromPort: 'dokumenttyp', to: 'extract', toPort: 'typ' },
		{
			id: 't11',
			from: 'triage',
			fromPort: 'transaktionen',
			to: 'auszugsweiche',
			toPort: 'auszug'
		},
		{ id: 't12', from: 'auszugsweiche', fromPort: 'csv', to: 'parse-csv', toPort: 'csv' },
		{ id: 't13', from: 'auszugsweiche', fromPort: 'scan', to: 'auszug-ocr', toPort: 'bild' },
		{ id: 't14', from: 'klassifizieren', fromPort: 'dokumenttyp', to: 'auszug-ocr', toPort: 'typ' },
		{
			id: 't15',
			from: 'extract',
			fromPort: 'positionen',
			to: 'an-buchhaltung',
			toPort: 'positionen'
		},
		{
			id: 't16',
			from: 'parse-csv',
			fromPort: 'transaktionen',
			to: 'an-buchhaltung',
			toPort: 'transaktionen'
		},
		{
			id: 't17',
			from: 'auszug-ocr',
			fromPort: 'daten',
			to: 'an-buchhaltung',
			toPort: 'transaktionen'
		},
		{ id: 't18', from: 'triage', fromPort: 'unbekannt', to: 'an-hitl', toPort: 'unklar' }
	]
}
/**
 * The whitelist ledger: how an actor earns autonomy, and how it loses it.
 * Promotion is a signed human decision on evidence (runs, corrections, late
 * errors); demotion is automatic and needs nobody — a regression drops the
 * actor straight back to supervised.
 */
const hitlWhitelist: Recipe = {
	id: 'hitl-whitelist',
	name: 'Whitelist & Autonomie',
	description:
		'Jeder Actor startet unter Aufsicht. Aus der Bilanz seiner Läufe (Korrekturquote, Spätfehler) wird er stufenweise freigegeben — hitl → Stichprobe → auto — und bei einem Rückfall sofort und ohne Nachfrage zurückgestuft.',
	nodes: [
		{
			id: 'in-entscheidungen',
			kind: 'input',
			name: 'Entscheidungen',
			description: 'Was Menschen entschieden haben: freigegeben, korrigiert, abgelehnt — je Actor.',
			transform: { type: 'source:decisions', config: { jeActor: true } },
			inputs: [],
			outputs: [{ name: 'entscheidungen' }]
		},
		{
			id: 'in-spaetfehler',
			kind: 'input',
			name: 'Spätfehler',
			description:
				'Fehler, die erst bei UStVA oder Festschreibung auffielen — die ehrlichste Kennzahl, weil sie die Durchlaufquote widerlegt.',
			transform: { type: 'source:late-errors', config: { quelle: ['ustva', 'festschreibung'] } },
			inputs: [],
			outputs: [{ name: 'spaetfehler' }]
		},
		{
			id: 'bilanz',
			kind: 'transform',
			name: 'Bilanz je Actor',
			description:
				'Deterministisch: Läufe, Korrekturquote je Feld, Sekunden pro Beleg, Spätfehlerquote. Zahlen, keine Meinung.',
			transform: {
				type: 'stats:actor-ledger',
				config: {
					kennzahlen: ['laeufe', 'korrekturquote', 'sekunden-pro-beleg', 'spaetfehlerquote']
				}
			},
			autonomie: {
				modus: 'auto',
				freigabe: {
					durch: 'system',
					seit: '2026-08-01',
					nachweis: 'reine Aggregation ohne Ermessen'
				},
				fehler: 'retry'
			},
			inputs: [{ name: 'entscheidungen' }, { name: 'spaetfehler' }],
			outputs: [{ name: 'bilanz' }]
		},
		{
			id: 'weiche',
			kind: 'route',
			name: 'Reif für die nächste Stufe?',
			description:
				'Schwellen je Stufe: genug Läufe, Korrekturquote unter Grenze, keine Spätfehler im Fenster. Ein Rückfall schlägt alles.',
			transform: {
				type: 'route:by-threshold',
				config: {
					stufen: ['hitl', 'stichprobe', 'auto'],
					schwellen: { laeufe: 200, korrekturquote: 0.02, spaetfehler: 0 }
				}
			},
			inputs: [{ name: 'bilanz' }],
			outputs: [{ name: 'reif' }, { name: 'rueckfall' }, { name: 'unveraendert' }]
		},
		{
			id: 'freigeben',
			kind: 'hitl',
			name: 'Stufe freigeben',
			description:
				'Nur ein Mensch hebt eine Stufe — mit Blick auf die Bilanz, nicht auf ein grünes Häkchen. Die Entscheidung wird als Nachweis in die Capability geschrieben.',
			transform: {
				type: 'hitl:approve',
				config: { rolle: 'geschaeftsfuehrung', schreibt: 'autonomie.freigabe' }
			},
			inputs: [{ name: 'reif' }],
			outputs: [{ name: 'freigabe' }]
		},
		{
			id: 'zuruecksetzen',
			kind: 'transform',
			name: 'Zurückstufen',
			description:
				'Ein Rückfall stuft sofort auf hitl zurück — deterministisch, ohne Nachfrage. Vertrauen wieder aufbauen dauert, verlieren geht schnell.',
			transform: {
				type: 'caps:demote',
				config: { ziel: 'hitl', sofort: true, benachrichtigen: true }
			},
			autonomie: {
				modus: 'auto',
				freigabe: {
					durch: 'system',
					seit: '2026-08-01',
					nachweis: 'Sicherheitsrichtung — Zurückstufen darf nie an einer Freigabe hängen'
				},
				fehler: 'retry'
			},
			inputs: [{ name: 'rueckfall' }],
			outputs: [{ name: 'degradiert' }]
		},
		{
			id: 'out-caps',
			kind: 'output',
			name: 'Actor-Capabilities',
			description:
				'Die aktualisierte `autonomie` je Actor — die Registry, die jeder Flow beim Lauf liest.',
			transform: { type: 'sink:actor-caps', config: { feld: 'autonomie' } },
			inputs: [{ name: 'caps', mode: 'any' }],
			outputs: []
		},
		{
			id: 'out-unveraendert',
			kind: 'output',
			name: 'Unverändert',
			description: 'Noch nicht reif, aber auch kein Rückfall — die Bilanz läuft weiter.',
			transform: { type: 'sink:noop', config: {} },
			inputs: [{ name: 'bilanz' }],
			outputs: []
		}
	],
	edges: [
		{
			id: 'w1',
			from: 'in-entscheidungen',
			fromPort: 'entscheidungen',
			to: 'bilanz',
			toPort: 'entscheidungen'
		},
		{
			id: 'w2',
			from: 'in-spaetfehler',
			fromPort: 'spaetfehler',
			to: 'bilanz',
			toPort: 'spaetfehler'
		},
		{ id: 'w3', from: 'bilanz', fromPort: 'bilanz', to: 'weiche', toPort: 'bilanz' },
		{ id: 'w4', from: 'weiche', fromPort: 'reif', to: 'freigeben', toPort: 'reif' },
		{ id: 'w5', from: 'weiche', fromPort: 'rueckfall', to: 'zuruecksetzen', toPort: 'rueckfall' },
		{ id: 'w6', from: 'freigeben', fromPort: 'freigabe', to: 'out-caps', toPort: 'caps' },
		{ id: 'w7', from: 'zuruecksetzen', fromPort: 'degradiert', to: 'out-caps', toPort: 'caps' },
		{
			id: 'w8',
			from: 'weiche',
			fromPort: 'unveraendert',
			to: 'out-unveraendert',
			toPort: 'bilanz'
		}
	]
}

/**
 * The HITL skill's entry: one queue for everything that needs a person,
 * from any skill. Sorted by risk rather than by date, because the point is
 * where a mistake would hurt — and shown with the reason, never a green
 * checkmark, so the reviewer reads an argument instead of clicking through.
 */
const hitlPosteingang: Recipe = {
	id: 'hitl-posteingang',
	name: 'HITL-Posteingang',
	description:
		'Die eine Warteschlange für Freigaben, Fehler und Unklares aus allen Skills: nach Risiko sortiert, mit Begründung statt Häkchen. In v1 landet jeder Fehler als Meldung beim Menschen — automatische Reparatur kommt später. Jede Entscheidung zählt in die Whitelist-Bilanz.',
	nodes: [
		{
			id: 'in-freigabe',
			kind: 'input',
			name: 'Freigaben',
			description: 'Wartende Bestätigungen aus anderen Skills — der Flow steht, bis jemand zusagt.',
			transform: { type: 'source:approvals', config: { herkunft: 'alle-skills' } },
			inputs: [],
			outputs: [{ name: 'freigabe' }]
		},
		{
			id: 'in-fehler',
			kind: 'input',
			name: 'Fehler',
			description: 'Fehlgeschlagene Schritte aus allen Skills, mit ihrem Kontext.',
			transform: { type: 'source:failures', config: { herkunft: 'alle-skills' } },
			inputs: [],
			outputs: [{ name: 'fehler' }]
		},
		{
			id: 'in-unklar',
			kind: 'input',
			name: 'Unklares',
			description: 'Was unter der Konfidenzschwelle blieb — geparkt statt geraten.',
			transform: { type: 'source:uncertain', config: { herkunft: 'alle-skills' } },
			inputs: [],
			outputs: [{ name: 'unklar' }]
		},
		{
			id: 'priorisieren',
			kind: 'transform',
			name: 'Nach Risiko sortieren',
			description:
				'Unsicherheit × Betrag × Steuerwirkung × Neuheit des Gegenübers, gruppiert nach Lieferant. Deterministisch — die Reihenfolge ist kein Modellurteil.',
			transform: {
				type: 'rank:risk',
				config: {
					faktoren: ['unsicherheit', 'betrag', 'steuerwirkung', 'neuheit'],
					gruppierung: 'lieferant'
				}
			},
			autonomie: {
				modus: 'auto',
				freigabe: {
					durch: 'system',
					seit: '2026-08-01',
					nachweis: 'deterministische Sortierung ohne Ermessen'
				},
				fehler: 'retry'
			},
			inputs: [{ name: 'posten', mode: 'any' }],
			outputs: [{ name: 'sortiert' }]
		},
		{
			id: 'entscheiden',
			kind: 'hitl',
			name: 'Entscheiden',
			description:
				'Der Mensch: freigeben, korrigieren, ablehnen. Gezeigt wird die Begründung samt §-Verweis, nicht ein Häkchen — plus erzwungene Stichproben gegen Automation Bias.',
			transform: {
				type: 'hitl:decide',
				config: {
					aktionen: ['freigeben', 'korrigieren', 'ablehnen'],
					anzeige: 'begruendung',
					stichproben: 'zwang-zur-vollpruefung',
					tastatur: true
				}
			},
			inputs: [{ name: 'posten', mode: 'any' }],
			outputs: [{ name: 'entscheidung' }]
		},
		{
			id: 'bewerten',
			kind: 'subflow',
			name: 'Whitelist & Autonomie',
			description:
				'Jede Entscheidung zählt in die Bilanz des Actors — sie ist der Weg zur Freigabe und der schnellste Weg zurück.',
			transform: { type: 'subflow', config: {} },
			subflow: {
				recipe: 'hitl-whitelist',
				portMap: { inputs: { entscheidungen: 'in-entscheidungen' }, outputs: { caps: 'out-caps' } }
			},
			inputs: [{ name: 'entscheidungen' }],
			outputs: [{ name: 'caps' }]
		},
		{
			id: 'out-entscheidung',
			kind: 'output',
			name: 'Entscheidung',
			description:
				'Zurück an den wartenden Flow: freigegeben, korrigiert oder abgelehnt — mit Begründung im Audit-Log.',
			transform: { type: 'sink:decision', config: { auditLog: true } },
			inputs: [{ name: 'entscheidung' }],
			outputs: []
		},
		{
			id: 'out-caps',
			kind: 'output',
			name: 'Actor-Capabilities',
			description: 'Die aktualisierte Autonomie-Stufe je Actor — was beim nächsten Lauf gilt.',
			transform: { type: 'sink:actor-caps', config: { feld: 'autonomie' } },
			inputs: [{ name: 'caps' }],
			outputs: []
		}
	],
	edges: [
		{ id: 'h1', from: 'in-freigabe', fromPort: 'freigabe', to: 'priorisieren', toPort: 'posten' },
		{ id: 'h2', from: 'in-fehler', fromPort: 'fehler', to: 'priorisieren', toPort: 'posten' },
		{ id: 'h3', from: 'in-unklar', fromPort: 'unklar', to: 'priorisieren', toPort: 'posten' },
		{ id: 'h4', from: 'priorisieren', fromPort: 'sortiert', to: 'entscheiden', toPort: 'posten' },
		{
			id: 'h8',
			from: 'entscheiden',
			fromPort: 'entscheidung',
			to: 'out-entscheidung',
			toPort: 'entscheidung'
		},
		{
			id: 'h9',
			from: 'entscheiden',
			fromPort: 'entscheidung',
			to: 'bewerten',
			toPort: 'entscheidungen'
		},
		{ id: 'h10', from: 'bewerten', fromPort: 'caps', to: 'out-caps', toPort: 'caps' }
	]
}

import { intentsTriage } from './intents-config'

export const recipes: Recipe[] = [
	inboxTriage,
	belegeExtrahieren,
	scanZuDokument,
	eingangsrechnungBuchen,
	zahlungsabgleich,
	buchungsvorgang,
	datevExport,
	hitlPosteingang,
	hitlWhitelist,
	intentsTriage
]
