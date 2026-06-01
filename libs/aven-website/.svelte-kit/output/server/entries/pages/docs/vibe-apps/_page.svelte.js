import { n as onDestroy } from "../../../../chunks/index-server.js";
import { H as attr, W as escape_html, a as ensure_array_like, l as stringify, n as attr_class, o as head } from "../../../../chunks/dev.js";
import { t as MarketingSiteHeader } from "../../../../chunks/MarketingSiteHeader.js";
import "@modelcontextprotocol/ext-apps/app-bridge";
var demo_default$3 = {
	statement_kind: "periodic_account_statement",
	statement_id: "KA-2026-04-9812",
	statement_issue_date: "2026-05-02",
	currency: "EUR",
	period_start: "2026-04-01",
	period_end: "2026-04-30",
	payment_due_date: null,
	opening_balance: 4280.55,
	closing_balance: 5124.18,
	account_holder: {
		"name": "Dr. Elena Vogt",
		"contact_name": null,
		"street": "Eichenweg 7",
		"postal_code": "10439",
		"city": "Berlin",
		"country": "Germany",
		"email": null,
		"phone": null,
		"tax_id": null
	},
	institution: {
		"name": "Stadtsparkasse Berlin",
		"contact_name": null,
		"street": "ABC-Platz 16",
		"postal_code": "10172",
		"city": "Berlin",
		"country": "Germany",
		"email": "service@stadtsparkasse.example",
		"phone": "+49 30 9876543",
		"tax_id": null
	},
	account_overview: {
		"branch_name": "Filiale Mitte",
		"iban": "DE89 3704 0044 0532 0130 00",
		"bic": "COBADEFFXXX",
		"account_number": null,
		"domestic_bank_code": "10050000",
		"product_name": "Girokonto Business",
		"card_last_four": "9912"
	},
	transactions: [
		{
			"value_date": "2026-04-01",
			"booking_date": "2026-04-02",
			"title": "Incoming transfer",
			"description": "REF 77821 · Acme Consulting AG\nRechnung R-2026-1842",
			"amount": 4403,
			"balance_after": 8683.55,
			"counterparty_name": "Acme Consulting AG"
		},
		{
			"value_date": "2026-04-03",
			"booking_date": "2026-04-03",
			"title": null,
			"description": "Monthly software subscription\nADYEN NV · Amsterdam",
			"amount": -89,
			"balance_after": 8594.55,
			"original_amount": -96.79,
			"original_currency": "USD",
			"exchange_rate": "1,1573",
			"fx_surcharge_eur": -1.69,
			"foreign_exchange_fee_percent": 1.75
		},
		{
			"value_date": "2026-04-15",
			"booking_date": "2026-04-15",
			"description": "Office rent April",
			"amount": -2850,
			"balance_after": 5744.55
		},
		{
			"value_date": "2026-04-28",
			"booking_date": "2026-04-28",
			"description": "Card purchase SUPERMARKT MITTE BERLIN",
			"amount": -52.37,
			"balance_after": 5692.18
		},
		{
			"value_date": "2026-04-30",
			"booking_date": "2026-04-30",
			"description": "Account maintenance fee",
			"amount": -12,
			"balance_after": 5124.18
		}
	],
	notes: "Zinsen für den Zeitraum 01.04.–30.04.: nicht angefallen.\nSollzinssatz p.a. bei Überziehung: 8,9 % (Stand Auszug)."
};
var demo_default$2 = {
	contract_id: "AVN-V-2026-0413",
	title: "Rahmenvertrag über digitale Dienstleistungen",
	contract_type: "Dienstleistungsvertrag",
	jurisdiction: "Bundesrepublik Deutschland",
	effective_date: "2026-05-01",
	language: "de",
	preamble: "Die Parteien beabsichtigen, im Rahmen ihrer jeweiligen Geschäftstätigkeit eine vertrauensvolle und nachhaltige Zusammenarbeit zu gestalten. Dieser Vertrag regelt die wesentlichen Bedingungen; Einzelvereinbarungen und Anlagen können ergänzend vereinbart werden.",
	parties: [
		{
			"role": "Auftragnehmerin",
			"name": "Aven Labs GmbH",
			"legal_form": "Gesellschaft mit beschränkter Haftung",
			"registration": "HRB 123456 B, Amtsgericht Berlin Charlottenburg",
			"address": "Eichenweg 7\n10439 Berlin",
			"representative": "Dr. Elena Vogt (Geschäftsführerin)",
			"email": "legal@avenlabs.example"
		},
		{
			"role": "Auftraggeber",
			"name": "Nordlicht Retail AG",
			"legal_form": "Aktiengesellschaft",
			"registration": "HRB 987654, Amtsgericht Hamburg",
			"address": "Hafenstraße 4\n20354 Hamburg",
			"representative": "Dr. Jonas Klein (Vorstand)",
			"email": "vertrag@nordlicht.example"
		},
		{
			"role": "Garantin (Bürgin)",
			"name": "Stadtsparkasse Berlin",
			"legal_form": "Anstalt des öffentlichen Rechts",
			"registration": "—",
			"address": "ABC-Platz 16\n10172 Berlin",
			"representative": "—",
			"email": "firmenkunden@stadtsparkasse.example"
		}
	],
	definitions: [{
		"term": "„Plattform“",
		"definition": "die von der Auftragnehmerin bereitgestellte Software-, Hosting- und Schnittstellenlandschaft einschließlich Dokumentation."
	}, {
		"term": "„SLA“",
		"definition": "die in Anlage 1 beschriebene Vereinbarung zu Verfügbarkeit und Reaktionszeiten (sofern vereinbart)."
	}],
	clauses: [
		{
			"number": "§ 1",
			"title": "Gegenstand und Leistungsumfang",
			"body": "Die Auftragnehmerin stellt dem Auftraggeber die Plattform zur Nutzung im vereinbarten Umfang zur Verfügung, inklusive Wartung, Updates nach angemessener Planung sowie Support gemäß dem gewählten Service-Level.\n\nLeistungsänderungen bedürfen der schriftlichen oder textformvertraglichen Zustimmung beider Parteien, sofern sie den wirtschaftlichen Kern der Vereinbarung berühren."
		},
		{
			"number": "§ 2",
			"title": "Laufzeit und Kündigung",
			"body": "Der Vertrag beginnt mit dem Wirksamwerden und läuft auf unbestimmte Zeit, sofern nichts anderes vereinbart ist.\n\nDie ordentliche Kündigung ist mit einer Frist von drei (3) Monaten zum Monatsende zulässig. Die außerordentliche Kündigung aus wichtigem Grund bleibt unberührt.",
			"subclauses": [{
				"label": "(1)",
				"body": "Nach Vertragsende stellt die Auftragnehmerin auf Verlangen einen Export maschinenlesbarer Daten nach angemessenem Aufwand bereit."
			}, {
				"label": "(2)",
				"body": "Gesetzliche Aufbewahrungsfristen und Treuhandpflichten gehen vor."
			}]
		},
		{
			"number": "§ 3",
			"title": "Vergütung und Rechnungsstellung",
			"body": "Die Vergütung erfolgt nach der jeweils gültigen Preisliste bzw. Angebotsbestätigung, zzgl. gesetzlicher Umsatzsteuer. Rechnungen sind innerhalb von vierzehn (14) Tagen nach Rechnungsdatum zahlbar, sofern nicht abweichend vereinbart."
		},
		{
			"number": "§ 4",
			"title": "Geheimhaltung und Datenschutz",
			"body": "Die Parteien verpflichten sich, alle im Rahmen der Zusammenarbeit zugänglich gewordenen vertraulichen Informationen streng vertraulich zu behandeln und nur zur Vertragserfüllung zu verwenden.\n\nDie Parteien werden personenbezogene Daten ausschließlich im Einklang mit der DSGVO und den jeweils geschlossenen Auftragsverarbeitungsvereinbarungen verarbeiten."
		},
		{
			"number": "§ 5",
			"title": "Haftung",
			"body": "Die Haftung der Auftragnehmerin für Schäden aus leichter Fahrlässigkeit ist — soweit gesetzlich zulässig — auf Vorsatz und grobe Fahrlässigkeit sowie auf die Verletzung wesentlicher Vertragspflichten beschränkt; in letzterem Fall ist die Haftung auf den typischerweise vorhersehbaren Schaden begrenzt.\n\nDie vorstehenden Haftungsbeschränkungen gelten nicht bei Verletzung von Leben, Körper oder Gesundheit oder bei zwingender gesetzlicher Haftung."
		},
		{
			"number": "§ 6",
			"title": "Schriftform, salvatorische Klausel, Gerichtsstand",
			"body": "Änderungen und Ergänzungen dieses Vertrags bedürfen zu ihrer Wirksamkeit der Textform, soweit gesetzlich nichts anderes erforderlich ist.\n\nSollten einzelne Bestimmungen unwirksam sein, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt.\n\nSofern die Parteien Kaufleute sind, ist ausschließlicher Gerichtsstand der Sitz der Auftragnehmerin; zwingende gesetzliche Gerichtsstände bleiben unberührt."
		}
	],
	signature_note: "Dieses Dokument ist eine technische Vorschau zu Demonstrationszwecken und ersetzt keine Rechtsberatung.",
	signatures: [
		{
			"party_index": 0,
			"signer_name": "Dr. Elena Vogt",
			"signer_role": "Geschäftsführerin",
			"place": "Berlin",
			"date": "2026-04-28"
		},
		{
			"party_index": 1,
			"signer_name": "Dr. Jonas Klein",
			"signer_role": "Vorstand",
			"place": "Hamburg",
			"date": "2026-04-28"
		},
		{
			"party_index": 2,
			"signer_name": "— (Kenntnisnahme)",
			"signer_role": "Institutsbevollmächtigte",
			"place": "Berlin",
			"date": "2026-04-28"
		}
	]
};
var demo_default$1 = {
	vendor: {
		"name": "TechSupply GmbH",
		"contact_name": "Maria Weber",
		"street": "Industriepark 12",
		"postal_code": "80331",
		"city": "München",
		"country": "Germany",
		"email": "billing@techsupply.example",
		"phone": "+49 89 12345678",
		"identifiers": [{
			"category": "vat_id",
			"value": "DE123456789",
			"label_printed": "USt-IdNr."
		}]
	},
	buyer: {
		"name": "Acme Consulting AG",
		"contact_name": "Dr. Jonas Klein",
		"street": "Hafenstraße 4",
		"postal_code": "20354",
		"city": "Hamburg",
		"country": "Germany",
		"email": "finance@acme.example"
	},
	header: {
		"document_kind": "invoice",
		"currency": "EUR",
		"issue_date": "2026-04-15",
		"due_date": "2026-05-15",
		"invoice_number": "R-2026-1842",
		"order_number": "PO-77821",
		"customer_number": "KD-9910",
		"referenced_invoice_numbers": []
	},
	statements: [{
		"section_title": "Professional services Q2",
		"service_period": "01.04.2026 – 30.04.2026",
		"line_items": [
			{
				"position": 1,
				"title": "Platform subscription",
				"description": "Enterprise tier — April 2026",
				"quantity": 1,
				"quantity_unit": "Mon.",
				"unit_price": 890,
				"tax_rate_percent": 19,
				"amount": 890
			},
			{
				"position": 2,
				"title": "Implementation hours",
				"description": "On-site integration (16h)\nTravel flat",
				"quantity": 16,
				"quantity_unit": "Std.",
				"unit_price": 185,
				"tax_rate_percent": 19,
				"amount": 2960
			},
			{
				"position": 3,
				"title": "Volume discount",
				"description": "Contract tier adjustment",
				"line_kind": "discount",
				"quantity": null,
				"quantity_unit": null,
				"unit_price": null,
				"tax_rate_percent": 19,
				"amount": -150
			}
		]
	}],
	totals: {
		"subtotal": 3700,
		"tax_breakdown": [{
			"tax_rate_percent": 19,
			"tax_amount": 703,
			"net_subtotal": 3700,
			"tax_group_letter": "A"
		}],
		"tax_total": 703,
		"invoice_total": 4403
	},
	payments: [{
		"date": "2026-04-20",
		"amount": 2e3,
		"method": "SEPA-Überweisung",
		"reference": "INV R-2026-1842"
	}],
	total_outstanding: 2403,
	payment_instructions: "Bitte überweisen Sie den offenen Betrag unter Angabe der Rechnungsnummer auf IBAN DE12 3456 7890 1234 5678 90 (BIC ABCDDEFFXXX) bei der Musterbank AG."
};
var demo_default = {
	title: "Arbeitsaufträge",
	items: [
		{
			"id": "1",
			"text": "Vibe-App-Sandbox ausliefern",
			"done": true
		},
		{
			"id": "2",
			"text": "Jazz-gestützte Artefakte anbinden",
			"done": false
		},
		{
			"id": "3",
			"text": "CSP für Produktion schärfen",
			"done": false
		}
	]
};
//#endregion
//#region ../../libs/vibe-apps/src/registry.ts
/**
* Catalog of vibe apps. Each entry points to a single self-contained
* `index.html` (pure HTML/CSS/JS, no per-app build step) plus a
* co-located `demo.json` payload for the host's demo `tools/call`
* round-trip.
*/
function clone(x) {
	return JSON.parse(JSON.stringify(x));
}
var vibeAppList = [
	{
		id: "invoice",
		label: "Rechnung",
		description: "Rechnungsansicht (Legacy-Layout) mit schema-geprägter Demo.",
		getToolArguments: () => clone(demo_default$1),
		getToolResult: () => Promise.resolve({ content: [{
			type: "text",
			text: "Demo-Rechnungstool beendet."
		}] })
	},
	{
		id: "bank-statement",
		label: "Kontoauszug",
		description: "Kontoauszug-Ansicht, angeglichen an das OCR-Schema bank_statement.",
		getToolArguments: () => clone(demo_default$3),
		getToolResult: () => Promise.resolve({ content: [{
			type: "text",
			text: "Demo-Kontoauszug beendet."
		}] })
	},
	{
		id: "contract",
		label: "Vertrag",
		description: "Mehrparteien-Vertrag mit Präambel, Begriffen, Klauseln und Signaturen.",
		getToolArguments: () => clone(demo_default$2),
		getToolResult: () => Promise.resolve({ content: [{
			type: "text",
			text: "Demo-Vertragstool beendet."
		}] })
	},
	{
		id: "todos",
		label: "Aufgaben",
		description: "Kleine Aufgabenliste mit Host- und Sandbox-Sync.",
		getToolArguments: () => clone(demo_default),
		getToolResult: () => Promise.resolve({ content: [{
			type: "text",
			text: "Demo beendet."
		}] })
	}
];
//#endregion
//#region src/lib/vibe-apps/VibeSandboxFrame.svelte
function VibeSandboxFrame($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { appId } = $$props;
		let bridge = null;
		onDestroy(() => {
			if (bridge) {
				bridge.teardownResource({}).catch(() => {});
				bridge = null;
			}
		});
		$$renderer.push(`<div class="flex min-h-0 min-w-0 flex-1 flex-col">`);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-white/10"><iframe title="Vibe-App-Sandbox" class="block min-h-0 w-full flex-1 border-0 bg-transparent"></iframe></div></div>`);
	});
}
//#endregion
//#region src/routes/docs/vibe-apps/+page.svelte
function _page($$renderer) {
	let selectedId = "invoice";
	head("qc4jok", $$renderer, ($$renderer) => {
		$$renderer.title(($$renderer) => {
			$$renderer.push(`<title>Vibe-View Library — Aven Dokumentation</title>`);
		});
	});
	$$renderer.push(`<div class="flex min-h-dvh flex-col bg-background text-foreground font-sans antialiased">`);
	MarketingSiteHeader($$renderer, { active: "docs" });
	$$renderer.push(`<!----> <div class="flex min-h-0 min-w-0 flex-1"><aside class="flex w-64 shrink-0 flex-col border-r border-border p-4" aria-label="Vibe-View Library"><p class="tech-label px-1 pb-2">Vibe-View Library</p> <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"><!--[-->`);
	const each_array = ensure_array_like(vibeAppList);
	for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
		let app = each_array[$$index];
		$$renderer.push(`<button type="button"${attr_class(`min-w-0 rounded-xl border px-3 py-2.5 text-left transition-colors ${stringify(selectedId === app.id ? "border-[color:var(--color-tuscan-sun)] bg-white/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]" : "border-border bg-white/10 hover:bg-white/20")}`)}><span class="block truncate text-sm font-medium tracking-tight">${escape_html(app.label)}</span> <span class="mt-0.5 block min-w-0 truncate text-xs text-muted-foreground"${attr("title", app.description)}>${escape_html(app.description)}</span></button>`);
	}
	$$renderer.push(`<!--]--></div> <a href="/docs" class="mt-auto shrink-0 flex items-center gap-2 rounded-lg px-2 py-1.5 pt-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground opacity-50 transition-opacity hover:opacity-100"><svg class="size-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" stroke-linecap="round" stroke-linejoin="round"></path></svg> Dokumentation</a></aside> <section class="flex min-h-0 min-w-0 flex-1 flex-col bg-sandbox-host p-6"><div class="flex min-h-0 min-w-0 flex-1 flex-col"><!---->`);
	VibeSandboxFrame($$renderer, { appId: selectedId });
	$$renderer.push(`<!----></div></section></div></div>`);
}
//#endregion
export { _page as default };
