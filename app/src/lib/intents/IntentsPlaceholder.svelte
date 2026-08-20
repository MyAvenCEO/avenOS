<script lang="ts">
/**
 * The Intents workspace — MOCKED (0158), deliberately outside the
 * actor/flow architecture: no bus, no skills, hardcoded data only. Three
 * panes in the mail-app reading:
 *
 *   left   — the intent stream (one card per intent, by type)
 *   center — the ACTIVITY LOG: the intent's journey as a timeline —
 *            dots on a line, entry cards for the rich steps
 *   right  — the cluster: ARTIFACTS the intent combines, and the SKILLS
 *            it drives, each with where it currently stands
 *
 * An intent combines many artifacts and skill/flows to solve one task —
 * fed by the (invisible) inbox flow: ingest → archive → classify →
 * extract intents → trigger skill-flows.
 */

interface LogEntry {
	step: string
	when: string
	state: 'done' | 'running' | 'waiting'
	note?: string
	/** A rich entry renders as a card on the timeline (like a mail preview). */
	card?: { title: string; text: string }
	/** The waiting entry offers the HITL pair. */
	hitl?: boolean
}
interface MockArtifact {
	kind: 'doc' | 'todo' | 'calendar' | 'person' | 'entity' | 'statement'
	title: string
	note: string
}
interface SkillStatus {
	skill: string
	state: 'done' | 'running' | 'waiting'
	note: string
}
interface MockIntent {
	id: string
	type: string
	title: string
	source: string
	when: string
	deadline?: string
	status: 'captured' | 'running' | 'waiting' | 'collecting' | 'done'
	log: LogEntry[]
	artifacts: MockArtifact[]
	skills: SkillStatus[]
}

const TYPE_STYLE: Record<string, string> = {
	bezahlen: 'bg-[#2f5d50]/12 text-[#2f5d50]',
	frist: 'bg-[#c15b40]/12 text-[#9c4832]',
	steuer: 'bg-[#a06818]/12 text-[#a06818]',
	abgleich: 'bg-[#5b7a9d]/15 text-[#46617f]',
	auftrag: 'bg-[#8a6238]/15 text-[#8a6238]'
}

const STATUS_LABEL: Record<string, string> = {
	captured: 'erfasst',
	running: 'läuft',
	waiting: 'wartet auf dich',
	collecting: 'sammelt',
	done: 'erledigt'
}

const KIND_LABEL: Record<string, string> = {
	doc: 'PDF',
	todo: 'TODO',
	calendar: 'KAL',
	person: 'WER',
	entity: 'BRAIN',
	statement: 'KONTO'
}

const INTENTS: MockIntent[] = [
	{
		id: 'krankenkasse',
		type: 'frist',
		title: 'Krankenkasse: Nachweis bis 15.09.',
		source: 'Post-Scan · Brief',
		when: 'heute · 09:12',
		deadline: 'bis 15.09.',
		status: 'waiting',
		log: [
			{
				step: 'Brief eingegangen',
				when: '12.08. · 14:02',
				state: 'done',
				note: 'Post-Scan · als Artefakt archiviert'
			},
			{
				step: 'Klassifiziert',
				when: '12.08. · 14:02',
				state: 'done',
				card: {
					title: 'Krankenversicherung · Frist erkannt',
					text: 'Absender: Techniker Krankenkasse. Gefordert: Einkommensnachweis. Frist: 15.09. — Zuversicht 96 %.'
				}
			},
			{
				step: 'Intent extrahiert',
				when: '12.08. · 14:03',
				state: 'done',
				note: '„Nachweis einreichen bis zur Frist" — ein Todo, ein Termin, ein Entwurf'
			},
			{
				step: 'Todo angelegt',
				when: '12.08. · 14:03',
				state: 'done',
				note: '„Nachweis einreichen" · fällig 12.09. · @me'
			},
			{
				step: 'Kalender-Frist eingetragen',
				when: '12.08. · 14:03',
				state: 'done',
				note: '15.09. · ganztägig'
			},
			{
				step: 'Antwortentwurf wartet auf Freigabe',
				when: 'heute · 09:12',
				state: 'waiting',
				card: {
					title: 'Entwurf: Antwort an die TK',
					text: 'Sehr geehrte Damen und Herren, anbei der angeforderte Einkommensnachweis für den Zeitraum…'
				},
				hitl: true
			}
		],
		artifacts: [
			{ kind: 'doc', title: 'krankenkasse-brief.pdf', note: 'gescannt 12.08. · archiviert' },
			{ kind: 'todo', title: 'Nachweis einreichen', note: 'offen · fällig 12.09. · @me' },
			{ kind: 'calendar', title: 'Frist Krankenkasse', note: '15.09. · ganztägig' },
			{ kind: 'person', title: 'Techniker Krankenkasse', note: 'Firma · Versicherung' },
			{ kind: 'entity', title: '[[Versicherungen 2025]]', note: 'Brain · 4 Verknüpfungen' }
		],
		skills: [
			{ skill: 'inbox', state: 'done', note: 'klassifiziert · Intent extrahiert' },
			{ skill: 'todos', state: 'done', note: '1 Todo angelegt · offen' },
			{ skill: 'calendar', state: 'done', note: 'Frist 15.09. eingetragen' },
			{ skill: 'docs', state: 'waiting', note: 'Antwortentwurf wartet auf Freigabe' },
			{ skill: 'brain', state: 'running', note: 'verknüpft mit [[Versicherungen 2025]]' }
		]
	},
	{
		id: 'buerostuhl',
		type: 'bezahlen',
		title: 'Rechnung Bürostuhl bezahlen',
		source: 'Upload · Rechnung',
		when: 'heute · 08:44',
		deadline: 'bis 30.08.',
		status: 'running',
		log: [
			{
				step: 'Rechnung hochgeladen',
				when: 'heute · 08:44',
				state: 'done',
				note: 'rechnung-buerostuhl.pdf · archiviert'
			},
			{
				step: 'Klassifiziert',
				when: 'heute · 08:44',
				state: 'done',
				card: {
					title: 'Rechnung · 249,00 €',
					text: 'Möbelhaus Nord GmbH · Zahlungsziel 30.08. · IBAN erkannt · Skonto: keins.'
				}
			},
			{
				step: 'Todo angelegt',
				when: 'heute · 08:45',
				state: 'done',
				note: '„Bürostuhl bezahlen — 249 €" · fällig 30.08.'
			},
			{
				step: 'Wartet auf Zahlung',
				when: 'seit heute',
				state: 'running',
				note: 'der nächste Kontoauszug hakt das Todo automatisch ab'
			}
		],
		artifacts: [
			{ kind: 'doc', title: 'rechnung-buerostuhl.pdf', note: '249,00 € · archiviert' },
			{ kind: 'todo', title: 'Bürostuhl bezahlen', note: 'offen · fällig 30.08. · #rechnung' },
			{ kind: 'person', title: 'Möbelhaus Nord GmbH', note: 'Firma · Lieferant' }
		],
		skills: [
			{ skill: 'inbox', state: 'done', note: 'klassifiziert als Rechnung' },
			{ skill: 'todos', state: 'done', note: '1 Todo angelegt · offen' },
			{ skill: 'abgleich', state: 'running', note: 'wartet auf den nächsten Kontoauszug' }
		]
	},
	{
		id: 'steuer',
		type: 'steuer',
		title: 'Steuererklärung 2023 zusammenstellen',
		source: 'Dauerauftrag',
		when: 'seit 02.08.',
		deadline: 'bis 30.09.',
		status: 'collecting',
		log: [
			{
				step: 'Sammel-Intent gestartet',
				when: '02.08.',
				state: 'done',
				note: 'langlaufend: alles für die Erklärung 2023'
			},
			{
				step: 'Artefakte verknüpft',
				when: 'laufend',
				state: 'done',
				card: {
					title: '12 Artefakte im Brain',
					text: 'Rechnungen (7), Kontoauszüge (4), Lohnsteuerbescheinigung (1) — jedes neue Dokument wird automatisch zugeordnet.'
				}
			},
			{
				step: 'Todo hält die Frist',
				when: '02.08.',
				state: 'done',
				note: '„Unterlagen an Steuerberater" · fällig 20.09.'
			},
			{
				step: 'Sammelt weiter',
				when: 'laufend',
				state: 'running',
				note: 'fehlend laut Checkliste: Spendenquittungen, Handwerkerrechnungen'
			}
		],
		artifacts: [
			{ kind: 'entity', title: '[[Steuer 2023]]', note: 'Brain · 12 Artefakte' },
			{ kind: 'doc', title: 'lohnsteuerbescheinigung-2023.pdf', note: 'archiviert' },
			{ kind: 'statement', title: 'Kontoauszüge Q1–Q4 2023', note: '4 Dateien' },
			{ kind: 'todo', title: 'Unterlagen an Steuerberater', note: 'offen · fällig 20.09.' },
			{ kind: 'person', title: 'StB Kanzlei Meier', note: 'Firma · Steuerberatung' }
		],
		skills: [
			{ skill: 'brain', state: 'running', note: '12 Artefakte verknüpft · sammelt weiter' },
			{ skill: 'todos', state: 'done', note: 'Frist-Todo angelegt' },
			{ skill: 'docs', state: 'running', note: 'ordnet neue Dokumente automatisch zu' }
		]
	},
	{
		id: 'kontoauszug',
		type: 'abgleich',
		title: 'Kontoauszug Juli abgleichen',
		source: 'Upload · CSV',
		when: 'gestern · 18:40',
		status: 'done',
		log: [
			{
				step: 'Kontoauszug hochgeladen',
				when: 'gestern · 18:40',
				state: 'done',
				note: 'kontoauszug-07.csv · 38 Transaktionen'
			},
			{
				step: 'Abgeglichen',
				when: 'gestern · 18:41',
				state: 'done',
				card: {
					title: '6 Zahlungen zugeordnet, 1 nachgefragt',
					text: '31 bekannte Daueraufträge übersprungen. 6 offene Rechnungen automatisch abgehakt; „Miete August" wurde von dir bestätigt.'
				}
			},
			{
				step: 'Todos abgehakt',
				when: 'gestern · 18:41',
				state: 'done',
				note: '6 Rechnungs-Todos → erledigt'
			}
		],
		artifacts: [
			{ kind: 'statement', title: 'kontoauszug-07.csv', note: '38 Transaktionen' },
			{ kind: 'todo', title: 'Miete August überweisen', note: 'erledigt · abgeglichen' }
		],
		skills: [
			{ skill: 'abgleich', state: 'done', note: '38 Transaktionen · 7 zugeordnet' },
			{ skill: 'todos', state: 'done', note: '6 Todos abgehakt' }
		]
	},
	{
		id: 'fitnessstudio',
		type: 'auftrag',
		title: '„Kündige das Fitnessstudio"',
		source: 'Freitext · Chat',
		when: 'gestern · 21:15',
		status: 'captured',
		log: [
			{
				step: 'Auftrag erfasst',
				when: 'gestern · 21:15',
				state: 'done',
				note: 'freier Auftrag aus dem Chat'
			},
			{
				step: 'Intent extrahiert',
				when: 'gestern · 21:15',
				state: 'done',
				note: 'Kündigung: Vertrag finden, Frist prüfen, Schreiben aufsetzen'
			},
			{
				step: 'Vertrag wird gesucht',
				when: 'seit gestern',
				state: 'running',
				note: 'Archiv-Suche nach dem FitX-Vertrag läuft'
			}
		],
		artifacts: [{ kind: 'entity', title: '[[FitX Vertrag]]', note: 'Brain · gesucht…' }],
		skills: [
			{ skill: 'docs', state: 'running', note: 'durchsucht das Archiv' },
			{ skill: 'brain', state: 'waiting', note: 'wartet auf den Vertrag' }
		]
	}
]

let selectedId = $state(INTENTS[0].id)
const selected = $derived(INTENTS.find((i) => i.id === selectedId) ?? INTENTS[0])

/**
 * Artifact preview: clicking an artifact swaps the center from the activity
 * log to an example view of WHAT the artifact is — one mock preview per
 * kind. Selecting an intent (or the back button) returns to the log.
 */
let preview = $state<MockArtifact | null>(null)

const DOT: Record<string, string> = {
	done: 'bg-[#2f5d50] text-white',
	running: 'bg-[#a06818] text-white',
	waiting: 'bg-[#c15b40] text-white'
}
</script>

<div class="flex min-h-0 w-full flex-1 gap-3 overflow-hidden">
	<!-- LEFT: the intent stream — compact cards; the selected one inverts. -->
	<aside class="flex w-72 shrink-0 flex-col gap-2 overflow-y-auto pb-4">
		<h2 class="px-1 pt-1 font-semibold text-foreground/50 text-xs uppercase tracking-wide">
			Intents · {INTENTS.length}
		</h2>
		{#each INTENTS as intent (intent.id)}
			{@const sel = selectedId === intent.id}
			<button
				type="button"
				onclick={() => {
					selectedId = intent.id
					preview = null
				}}
				class="rounded-xl border px-3.5 py-2.5 text-left shadow-[0_1px_3px_rgba(30,41,59,0.05)] transition-all {sel
					? 'border-foreground/15 bg-surface-card-selected'
					: 'border-foreground/5 bg-[#fffdf7] hover:border-foreground/15'}"
			>
				<div class="flex items-center gap-2">
					<span
						class="rounded-full px-2 py-0.5 font-mono text-[0.5625rem] {TYPE_STYLE[intent.type]}"
					>
						{intent.type}
					</span>
					<span class="ml-auto font-mono text-[0.5625rem] {'text-foreground/35'}">
						{intent.when}
					</span>
				</div>
				<p class="pt-1 font-semibold text-[13px] leading-snug">{intent.title}</p>
				<div class="flex items-center gap-2 pt-1">
					<span class="text-[0.625rem] {'text-foreground/45'}">
						{intent.source}
					</span>
					{#if intent.deadline}
						<span
							class="rounded-full px-1.5 py-0.5 font-mono text-[0.5625rem] {'bg-[#c15b40]/10 text-[#9c4832]'}"
						>
							{intent.deadline}
						</span>
					{/if}
					<span
						class="ml-auto font-mono text-[0.5625rem] {intent.status === 'waiting'
							? 'text-[#9c4832]'
							: intent.status === 'done'
								? 'text-[#2f5d50]'
								: 'text-foreground/40'}"
					>
						{STATUS_LABEL[intent.status]}
					</span>
				</div>
			</button>
		{/each}
	</aside>

	<!-- CENTER: the activity log — the intent's journey as a timeline. -->
	<main
		class="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto rounded-2xl border border-foreground/5 bg-[#fffdf7] p-6 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
	>
		{#if preview}
			<!-- ARTIFACT PREVIEW: what the clicked artifact IS, by example. -->
			<header class="flex items-center gap-2">
				<span
					class="flex h-8 w-10 items-center justify-center rounded-lg bg-surface-soft font-mono text-[0.5625rem] text-foreground/50"
				>
					{KIND_LABEL[preview.kind]}
				</span>
				<div class="min-w-0">
					<h1 class="truncate font-semibold text-lg leading-tight">{preview.title}</h1>
					<p class="text-foreground/45 text-xs">{preview.note}</p>
				</div>
				<button
					type="button"
					onclick={() => {
						preview = null
					}}
					class="ml-auto shrink-0 rounded-full border border-foreground/10 px-3 py-1 text-foreground/60 text-xs transition-colors hover:bg-surface-card"
				>
					← Zurück zum Verlauf
				</button>
			</header>

			{#if preview.kind === 'doc'}
				<!-- a document page, sketched -->
				<div
					class="mx-auto w-full max-w-xl rounded-xl border border-border bg-white p-8 shadow-[0_2px_12px_rgba(30,41,59,0.06)]"
				>
					<div class="flex items-baseline justify-between pb-6">
						<span class="font-semibold text-sm">{preview.title.replace('.pdf', '')}</span>
						<span class="font-mono text-[0.625rem] text-foreground/40">Seite 1 / 2</span>
					</div>
					{#each [92, 100, 78, 96, 60] as w, i (i)}
						<div class="mb-2 h-2 rounded bg-foreground/8" style="width: {w}%"></div>
					{/each}
					<div class="mt-5 rounded-lg border border-[#a06818]/30 bg-[#a06818]/8 px-4 py-3">
						<p class="font-mono text-[0.625rem] text-[#a06818] uppercase tracking-wide">
							Extrahiert
						</p>
						<p class="pt-1 text-xs leading-relaxed">{preview.note}</p>
					</div>
					{#each [88, 95, 70] as w, i (i)}
						<div class="mt-2 h-2 rounded bg-foreground/8" style="width: {w}%"></div>
					{/each}
				</div>
			{:else if preview.kind === 'todo'}
				<div
					class="mx-auto w-full max-w-xl rounded-xl border border-border bg-white px-5 py-4 shadow-[0_2px_12px_rgba(30,41,59,0.06)]"
				>
					<div class="flex items-center gap-3">
						<span
							class="flex size-5 items-center justify-center rounded-md border-2 border-foreground/20"
						></span>
						<span class="flex-1 font-medium text-sm">{preview.title}</span>
						<span class="rounded-full bg-surface-soft px-2 py-0.5 font-mono text-[0.625rem]"
							>todos</span
						>
					</div>
					<p class="pt-2 pl-8 text-foreground/50 text-xs">{preview.note}</p>
				</div>
			{:else if preview.kind === 'calendar'}
				<div
					class="mx-auto flex w-full max-w-xl items-center gap-4 rounded-xl border border-border bg-white px-5 py-4 shadow-[0_2px_12px_rgba(30,41,59,0.06)]"
				>
					<div
						class="flex size-14 flex-col items-center justify-center rounded-xl bg-[#c15b40]/10 text-[#9c4832]"
					>
						<span class="font-semibold text-lg leading-none">15</span>
						<span class="pt-0.5 font-mono text-[0.5625rem] uppercase">Sep</span>
					</div>
					<div class="min-w-0">
						<p class="font-medium text-sm">{preview.title}</p>
						<p class="pt-0.5 text-foreground/50 text-xs">{preview.note}</p>
					</div>
				</div>
			{:else if preview.kind === 'person'}
				<div
					class="mx-auto w-full max-w-xl rounded-xl border border-border bg-white px-5 py-5 shadow-[0_2px_12px_rgba(30,41,59,0.06)]"
				>
					<div class="flex items-center gap-4">
						<span
							class="flex size-12 items-center justify-center rounded-full bg-[#7e6ead]/15 font-semibold text-[#655687] text-sm"
						>
							{preview.title.slice(0, 2).toUpperCase()}
						</span>
						<div class="min-w-0">
							<p class="font-semibold text-sm">{preview.title}</p>
							<p class="text-foreground/50 text-xs">{preview.note}</p>
						</div>
					</div>
					<div class="mt-4 grid grid-cols-2 gap-2 text-xs">
						<div class="rounded-lg bg-surface-soft px-3 py-2">
							<span class="text-foreground/40">Bezug</span><br>3 Intents · 2 Dokumente
						</div>
						<div class="rounded-lg bg-surface-soft px-3 py-2">
							<span class="text-foreground/40">Zuletzt</span><br>heute · Brief eingegangen
						</div>
					</div>
				</div>
			{:else if preview.kind === 'statement'}
				<div
					class="mx-auto w-full max-w-xl overflow-hidden rounded-xl border border-border bg-white shadow-[0_2px_12px_rgba(30,41,59,0.06)]"
				>
					<div class="border-border border-b px-5 py-3 font-medium text-sm">{preview.title}</div>
					{#each [{ d: '28.07.', t: 'Miete August', a: '−1.150,00 €', m: 'abgeglichen ✓' }, { d: '25.07.', t: 'Möbelhaus Nord GmbH', a: '−249,00 €', m: 'Rechnung zugeordnet ✓' }, { d: '24.07.', t: 'Gehalt', a: '+3.480,00 €', m: '' }] as row (row.d + row.t)}
						<div class="flex items-center gap-3 border-border/50 border-b px-5 py-2.5 text-xs">
							<span class="w-12 font-mono text-foreground/40">{row.d}</span>
							<span class="min-w-0 flex-1 truncate">{row.t}</span>
							<span class="font-mono {row.a.startsWith('+') ? 'text-[#2f5d50]' : ''}">{row.a}</span>
							<span class="w-32 text-right text-[0.625rem] text-foreground/40">{row.m}</span>
						</div>
					{/each}
				</div>
			{:else}
				<!-- brain entity: the wikilink card -->
				<div
					class="mx-auto w-full max-w-xl rounded-xl border border-border bg-white px-5 py-5 shadow-[0_2px_12px_rgba(30,41,59,0.06)]"
				>
					<p class="font-mono text-[#655687] text-sm">{preview.title}</p>
					<p class="pt-1 text-foreground/50 text-xs">{preview.note}</p>
					<div class="mt-4 flex flex-wrap gap-1.5">
						{#each ['[[Krankenkasse]]', '[[Einkommensnachweis]]', '[[Fristen 2025]]', '[[Steuer 2023]]'] as link (link)}
							<span
								class="rounded-full bg-[#7e6ead]/10 px-2.5 py-1 font-mono text-[#655687] text-[0.625rem]"
								>{link}</span
							>
						{/each}
					</div>
				</div>
			{/if}
		{:else}
			<header>
				<div class="flex items-center gap-2">
					<span
						class="rounded-full px-2 py-0.5 font-mono text-[0.625rem] {TYPE_STYLE[selected.type]}"
					>
						{selected.type}
					</span>
					{#if selected.deadline}
						<span
							class="rounded-full bg-[#c15b40]/10 px-2 py-0.5 font-mono text-[#9c4832] text-[0.625rem]"
						>
							{selected.deadline}
						</span>
					{/if}
					<span
						class="ml-auto rounded-full border border-border px-2.5 py-0.5 font-mono text-[0.625rem] text-foreground/50"
					>
						{STATUS_LABEL[selected.status]}
					</span>
				</div>
				<h1 class="pt-2 font-semibold text-xl leading-tight">{selected.title}</h1>
				<p class="pt-1 text-foreground/45 text-xs">{selected.source} · {selected.when}</p>
			</header>

			<!-- The timeline: dots on one line, cards for the rich entries. -->
			<ol class="flex flex-col">
				{#each selected.log as entry, i (entry.step + i)}
					<li class="relative flex gap-3 pb-5">
						<!-- the connector line, drawn segment by segment -->
						{#if i < selected.log.length - 1}
							<span class="absolute top-6 bottom-0 left-[11px] w-px bg-foreground/10"></span>
						{/if}
						<span
							class="z-10 mt-0.5 flex size-[23px] shrink-0 items-center justify-center rounded-full {DOT[
							entry.state
						]}"
						>
							{#if entry.state === 'done'}
								<svg
									viewBox="0 0 24 24"
									class="size-3"
									fill="none"
									stroke="currentColor"
									stroke-width="3"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<path d="m5 13 4 4L19 7" />
								</svg>
							{:else if entry.state === 'running'}
								<svg
									viewBox="0 0 24 24"
									class="size-3"
									fill="none"
									stroke="currentColor"
									stroke-width="2.5"
									stroke-linecap="round"
								>
									<path d="M21 12a9 9 0 1 1-6.2-8.56" />
								</svg>
							{:else}
								<svg
									viewBox="0 0 24 24"
									class="size-3"
									fill="none"
									stroke="currentColor"
									stroke-width="2.5"
									stroke-linecap="round"
								>
									<circle cx="12" cy="12" r="9" />
									<path d="M12 7v5l3 3" />
								</svg>
							{/if}
						</span>
						<div class="min-w-0 flex-1">
							<div class="flex items-baseline gap-2">
								<span class="font-medium text-sm">{entry.step}</span>
								<span class="ml-auto shrink-0 font-mono text-[0.625rem] text-foreground/35">
									{entry.when}
								</span>
							</div>
							{#if entry.note}
								<p class="pt-0.5 text-foreground/50 text-xs leading-relaxed">{entry.note}</p>
							{/if}
							{#if entry.card}
								<div class="mt-2 rounded-xl border border-border bg-surface-card px-4 py-3">
									<p class="font-medium text-xs">{entry.card.title}</p>
									<p class="pt-1 text-foreground/55 text-xs leading-relaxed">{entry.card.text}</p>
									{#if entry.hitl}
										<div class="flex gap-2 pt-3">
											<button
												type="button"
												class="rounded-full bg-primary px-4 py-1.5 font-medium text-primary-foreground text-xs"
											>
												Freigeben
											</button>
											<button
												type="button"
												class="rounded-full border border-foreground/10 px-4 py-1.5 font-medium text-foreground/60 text-xs"
											>
												Ablehnen
											</button>
										</div>
									{/if}
								</div>
							{/if}
						</div>
					</li>
				{/each}
			</ol>
		{/if}
	</main>

	<!-- RIGHT: the cluster — the artifacts this intent combines, and the
	     skills it drives with where each currently stands. -->
	<aside class="flex w-72 shrink-0 flex-col gap-2 overflow-y-auto pb-4">
		<h2 class="px-1 pt-1 font-semibold text-foreground/50 text-xs uppercase tracking-wide">
			Skills · {selected.skills.length}
		</h2>
		{#each selected.skills as s (s.skill)}
			<div
				class="rounded-2xl border border-foreground/5 bg-[#fffdf7] px-4 py-3 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
			>
				<div class="flex items-center gap-2">
					<span
						class="size-1.5 shrink-0 rounded-full {s.state === 'done'
							? 'bg-[#2f5d50]'
							: s.state === 'waiting'
								? 'bg-[#c15b40]'
								: 'bg-[#a06818]'}"
					></span>
					<span class="font-medium font-mono text-xs">{s.skill}</span>
					<span class="ml-auto font-mono text-[0.625rem] text-foreground/40">
						{s.state === 'done' ? 'fertig' : s.state === 'waiting' ? 'wartet' : 'läuft'}
					</span>
				</div>
				<p class="pt-1 text-[0.6875rem] text-foreground/50 leading-relaxed">{s.note}</p>
			</div>
		{/each}

		<h2 class="px-1 pt-3 font-semibold text-foreground/50 text-xs uppercase tracking-wide">
			Artefakte · {selected.artifacts.length}
		</h2>
		{#each selected.artifacts as artifact (artifact.title)}
			<button
				type="button"
				onclick={() => {
					preview = preview?.title === artifact.title ? null : artifact
				}}
				class="rounded-xl border px-4 py-3 text-left shadow-[0_1px_3px_rgba(30,41,59,0.05)] transition-all {preview?.title ===
				artifact.title
					? 'border-foreground/15 bg-surface-card-selected'
					: 'border-foreground/5 bg-[#fffdf7] hover:border-foreground/15'}"
			>
				<div class="flex items-center gap-2">
					<span
						class="flex h-8 w-10 items-center justify-center rounded-lg bg-surface-soft font-mono text-[0.5625rem] text-foreground/50"
					>
						{KIND_LABEL[artifact.kind]}
					</span>
					<div class="min-w-0">
						<p class="truncate font-medium text-xs">{artifact.title}</p>
						<p class="truncate text-[0.6875rem] text-foreground/45">{artifact.note}</p>
					</div>
				</div>
			</button>
		{/each}

		<p class="px-1 pt-2 text-[0.625rem] text-foreground/35 leading-relaxed">
			Ein Intent kombiniert Artefakte und Skill-Flows, um eine Aufgabe zu lösen. Alles hier ist ein
			Mock — die Pipeline (ingest → classify → intents → skill-flows) kommt später.
		</p>
	</aside>
</div>
