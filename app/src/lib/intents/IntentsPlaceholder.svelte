<script lang="ts">
import { Background, type Edge, type Node, SvelteFlow } from '@xyflow/svelte'
import '@xyflow/svelte/dist/style.css'
import { hitlQueue } from '$lib/actors/hitl.svelte'
import FitView from '$lib/mesh/FitView.svelte'
import FlowNode from '$lib/skills/FlowNode.svelte'
import { layoutWorkflow } from '$lib/skills/flow-layout'
import { skillById } from '$lib/skills/registry'

/**
 * The Intents workspace — instances MOCKED (0158), but the skill flows are
 * the REAL templates from the skills registry: template and instance are
 * one source. Three panes in the mail-app reading:
 *
 *   left   — the intent stream (compact cards, cream selection)
 *   center — the ACTIVITY LOG (every entry TYPED by the skill that wrote
 *            it), OR an artifact preview (full width), OR the skill's
 *            ACTUAL workflow rendered as the n8n canvas with the
 *            instance state overlaid on its nodes
 *   right  — SKILLS (click → the instance-on-template flow) above
 *            ARTIFACTS (click → preview)
 *
 * A PENDING HITL never lives in the log alone: it surfaces in the global
 * HITL bar above the voice pill (the one confirm interface); the log
 * keeps the entry as history. Submitted/answered gates stay log lines.
 */

interface LogEntry {
	step: string
	when: string
	state: 'done' | 'running' | 'waiting'
	/** WHICH skill wrote this entry — every log line is typed. */
	skill: string
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
	/** Which workflow of the TEMPLATE this instance runs. */
	workflow: string
	/** Node ids (of the template workflow) already completed. */
	done: string[]
	/** The node the instance currently sits on, if any. */
	current?: string
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
				skill: 'inbox',
				note: 'Post-Scan · als Artefakt archiviert'
			},
			{
				step: 'Klassifiziert',
				when: '12.08. · 14:02',
				state: 'done',
				skill: 'inbox',
				card: {
					title: 'Krankenversicherung · Frist erkannt',
					text: 'Absender: Techniker Krankenkasse. Gefordert: Einkommensnachweis. Frist: 15.09. — Zuversicht 96 %.'
				}
			},
			{
				step: 'Intent extrahiert',
				when: '12.08. · 14:03',
				state: 'done',
				skill: 'inbox',
				note: '„Nachweis einreichen bis zur Frist" — ein Todo, ein Termin, ein Entwurf'
			},
			{
				step: 'Todo angelegt',
				when: '12.08. · 14:03',
				state: 'done',
				skill: 'todos',
				note: '„Nachweis einreichen" · fällig 12.09. · @me'
			},
			{
				step: 'Kalender-Frist eingetragen',
				when: '12.08. · 14:03',
				state: 'done',
				skill: 'calendar',
				note: '15.09. · ganztägig'
			},
			{
				step: 'Antwortentwurf wartet auf Freigabe',
				when: 'heute · 09:12',
				state: 'waiting',
				skill: 'docs',
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
			{
				skill: 'inbox',
				state: 'done',
				note: 'klassifiziert · Intent extrahiert',
				workflow: 'intake',
				done: ['mail-trigger', 'upload-trigger', 'normalize', 'classify', 'route']
			},
			{
				skill: 'todos',
				state: 'done',
				note: '1 Todo angelegt · offen',
				workflow: 'capture',
				done: ['voice-trigger', 'create', 'list-view', 'board-view']
			},
			{
				skill: 'calendar',
				state: 'done',
				note: 'Frist 15.09. eingetragen',
				workflow: 'frist',
				done: ['date-trigger', 'schedule'],
				current: 'remind'
			},
			{
				skill: 'docs',
				state: 'waiting',
				note: 'Antwortentwurf wartet auf Freigabe',
				workflow: 'respond',
				done: ['request-trigger', 'draft'],
				current: 'approve'
			},
			{
				skill: 'brain',
				state: 'running',
				note: 'verknüpft mit [[Versicherungen 2025]]',
				workflow: 'verknuepfen',
				done: ['entity-trigger', 'resolve', 'link'],
				current: 'enrich'
			}
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
				skill: 'inbox',
				note: 'rechnung-buerostuhl.pdf · archiviert'
			},
			{
				step: 'Klassifiziert',
				when: 'heute · 08:44',
				state: 'done',
				skill: 'inbox',
				card: {
					title: 'Rechnung · 249,00 €',
					text: 'Möbelhaus Nord GmbH · Zahlungsziel 30.08. · IBAN erkannt · Skonto: keins.'
				}
			},
			{
				step: 'Todo angelegt',
				when: 'heute · 08:45',
				state: 'done',
				skill: 'todos',
				note: '„Bürostuhl bezahlen — 249 €" · fällig 30.08.'
			},
			{
				step: 'Wartet auf Zahlung',
				when: 'seit heute',
				state: 'running',
				skill: 'abgleich',
				note: 'der nächste Kontoauszug hakt das Todo automatisch ab'
			}
		],
		artifacts: [
			{ kind: 'doc', title: 'rechnung-buerostuhl.pdf', note: '249,00 € · archiviert' },
			{ kind: 'todo', title: 'Bürostuhl bezahlen', note: 'offen · fällig 30.08. · #rechnung' },
			{ kind: 'person', title: 'Möbelhaus Nord GmbH', note: 'Firma · Lieferant' }
		],
		skills: [
			{
				skill: 'inbox',
				state: 'done',
				note: 'klassifiziert als Rechnung',
				workflow: 'intake',
				done: ['mail-trigger', 'upload-trigger', 'normalize', 'classify', 'route']
			},
			{
				skill: 'todos',
				state: 'done',
				note: '1 Todo angelegt · offen',
				workflow: 'capture',
				done: ['voice-trigger', 'create', 'list-view', 'board-view']
			},
			{
				skill: 'abgleich',
				state: 'running',
				note: 'wartet auf den nächsten Kontoauszug',
				workflow: 'match',
				done: [],
				current: 'statement-trigger'
			}
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
				skill: 'brain',
				note: 'langlaufend: alles für die Erklärung 2023'
			},
			{
				step: 'Artefakte verknüpft',
				when: 'laufend',
				state: 'done',
				skill: 'brain',
				card: {
					title: '12 Artefakte im Brain',
					text: 'Rechnungen (7), Kontoauszüge (4), Lohnsteuerbescheinigung (1) — jedes neue Dokument wird automatisch zugeordnet.'
				}
			},
			{
				step: 'Todo hält die Frist',
				when: '02.08.',
				state: 'done',
				skill: 'todos',
				note: '„Unterlagen an Steuerberater" · fällig 20.09.'
			},
			{
				step: 'Sammelt weiter',
				when: 'laufend',
				state: 'running',
				skill: 'docs',
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
			{
				skill: 'brain',
				state: 'running',
				note: '12 Artefakte verknüpft · sammelt weiter',
				workflow: 'verknuepfen',
				done: ['entity-trigger', 'resolve', 'link'],
				current: 'enrich'
			},
			{
				skill: 'todos',
				state: 'done',
				note: 'Frist-Todo angelegt',
				workflow: 'capture',
				done: ['voice-trigger', 'create', 'list-view']
			},
			{
				skill: 'docs',
				state: 'running',
				note: 'ordnet neue Dokumente automatisch zu',
				workflow: 'respond',
				done: ['request-trigger'],
				current: 'draft'
			}
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
				skill: 'inbox',
				note: 'kontoauszug-07.csv · 38 Transaktionen'
			},
			{
				step: 'Abgeglichen',
				when: 'gestern · 18:41',
				state: 'done',
				skill: 'abgleich',
				card: {
					title: '6 Zahlungen zugeordnet, 1 nachgefragt',
					text: '31 bekannte Daueraufträge übersprungen. 6 offene Rechnungen automatisch abgehakt; „Miete August" wurde von dir bestätigt.'
				}
			},
			{
				step: 'Todos abgehakt',
				when: 'gestern · 18:41',
				state: 'done',
				skill: 'todos',
				note: '6 Rechnungs-Todos → erledigt'
			}
		],
		artifacts: [
			{ kind: 'statement', title: 'kontoauszug-07.csv', note: '38 Transaktionen' },
			{ kind: 'todo', title: 'Miete August überweisen', note: 'erledigt · abgeglichen' }
		],
		skills: [
			{
				skill: 'abgleich',
				state: 'done',
				note: '38 Transaktionen · 7 zugeordnet',
				workflow: 'match',
				done: ['statement-trigger', 'match', 'tick']
			},
			{
				skill: 'todos',
				state: 'done',
				note: '6 Todos abgehakt',
				workflow: 'capture',
				done: ['voice-trigger', 'create', 'list-view', 'board-view']
			}
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
				skill: 'inbox',
				note: 'freier Auftrag aus dem Chat'
			},
			{
				step: 'Intent extrahiert',
				when: 'gestern · 21:15',
				state: 'done',
				skill: 'inbox',
				note: 'Kündigung: Vertrag finden, Frist prüfen, Schreiben aufsetzen'
			},
			{
				step: 'Vertrag wird gesucht',
				when: 'seit gestern',
				state: 'running',
				skill: 'docs',
				note: 'Archiv-Suche nach dem FitX-Vertrag läuft'
			}
		],
		artifacts: [{ kind: 'entity', title: '[[FitX Vertrag]]', note: 'Brain · gesucht…' }],
		skills: [
			{
				skill: 'docs',
				state: 'running',
				note: 'durchsucht das Archiv',
				workflow: 'respond',
				done: ['request-trigger'],
				current: 'draft'
			},
			{
				skill: 'brain',
				state: 'waiting',
				note: 'wartet auf den Vertrag',
				workflow: 'verknuepfen',
				done: [],
				current: 'entity-trigger'
			}
		]
	}
]

let selectedId = $state(INTENTS[0].id)
const selected = $derived(INTENTS.find((i) => i.id === selectedId) ?? INTENTS[0])

/**
 * Talk to MAIA — the generic AI chat, above the intents: free-form asks
 * (from which intents get extracted, managed, triggered), and every
 * inline view query ("show me all todos") that has no intent template.
 * Mocked transcript; the input is the global voice/text pill.
 */
let talkMode = $state(false)

/** Done intents rest in the archive — a toggle, closed by default. */
let archiveOpen = $state(false)
const activeIntents = $derived(INTENTS.filter((i) => i.status !== 'done'))
const archivedIntents = $derived(INTENTS.filter((i) => i.status === 'done'))

/**
 * The center shows ONE of three things: the activity log (default), an
 * artifact preview, or a skill's flow stepper. Selecting an intent — or
 * the back button — returns to the log.
 */
let preview = $state<MockArtifact | null>(null)
let skillView = $state<SkillStatus | null>(null)

/**
 * The pending HITL of the mock surfaces where every held message lives:
 * the GLOBAL bar above the voice pill. Seeded once; Confirm/Reject there
 * simply clears it (the mock has nothing to execute).
 */
if (!hitlQueue.items.some((h) => h.id === 'mock-docs-tk')) {
	hitlQueue.items.push({
		id: 'mock-docs-tk',
		actor: 'docs',
		method: 'draft_approve',
		label: 'Antwortentwurf an die TK freigeben',
		detail: 'Intent „Krankenkasse: Nachweis bis 15.09." · Entwurf bereit'
	})
}

/**
 * The selected skill instance rendered ON its template workflow — the
 * same layout + node cards as the Skills viewer, the instance state
 * (done/current) overlaid per node.
 */
let sfNodes = $state.raw<Node[]>([])
let sfEdges = $state.raw<Edge[]>([])
$effect.pre(() => {
	const view = skillView
	if (!view) {
		sfNodes = []
		sfEdges = []
		return
	}
	const template = skillById(view.skill)
	const wf = template?.workflows.find((w) => w.id === view.workflow) ?? template?.workflows[0]
	if (!wf) {
		sfNodes = []
		sfEdges = []
		return
	}
	const laid = layoutWorkflow(wf)
	sfNodes = laid.nodes.map((n) => ({
		id: n.id,
		type: 'flow',
		position: n.position,
		draggable: false,
		data: {
			node: n.node,
			selected: false,
			instance: view.done.includes(n.id)
				? ('done' as const)
				: n.id === view.current
					? view.state === 'waiting'
						? ('waiting' as const)
						: ('running' as const)
					: undefined
		}
	}))
	sfEdges = laid.edges.map((e, i) => ({
		id: `${e.from}-${e.predicate}-${e.to}-${i}`,
		source: e.from,
		target: e.to,
		label: e.predicate,
		type: 'smoothstep',
		style: 'stroke: rgba(47,93,80,0.5); stroke-width: 1.5;',
		labelStyle: 'font-size: 10px; fill: rgba(30,41,59,0.7);',
		labelBgStyle: 'fill: #f8f6ef;',
		labelBgPadding: [4, 2] as [number, number],
		labelBgBorderRadius: 4
	}))
})
const sfNodeTypes = { flow: FlowNode }
let sfW = $state(0)
let sfH = $state(0)

const DOT: Record<string, string> = {
	done: 'bg-[#2f5d50] text-white',
	running: 'bg-[#a06818] text-white',
	waiting: 'bg-[#c15b40] text-white'
}
</script>

{#snippet backButton()}
	<button
		type="button"
		onclick={() => {
			preview = null
			skillView = null
		}}
		class="ml-auto shrink-0 rounded-full border border-foreground/10 px-3 py-1 text-foreground/60 text-xs transition-colors hover:bg-surface-card"
	>
		← Zurück zum Verlauf
	</button>
{/snippet}

<div class="flex min-h-0 w-full flex-1 gap-3 overflow-hidden">
	<!-- LEFT: the intent stream — compact cards, cream selection. -->
	<aside class="flex w-72 shrink-0 flex-col gap-2 overflow-y-auto pb-4">
		<!-- The generic AI chat — above the intents: free-form + view queries. -->
		<button
			type="button"
			onclick={() => {
				talkMode = true
				preview = null
				skillView = null
			}}
			class="flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left shadow-[0_1px_3px_rgba(30,41,59,0.05)] transition-all {talkMode
				? 'border-foreground/15 bg-surface-card-selected'
				: 'border-foreground/5 bg-[#fffdf7] hover:border-foreground/15'}"
		>
			<span class="block size-7 shrink-0 overflow-hidden rounded-full border border-border">
				<img src="/aven-logo.svg" alt="" class="size-full object-cover">
			</span>
			<span class="min-w-0">
				<span class="block font-semibold text-[13px] leading-snug">Talk to MAIA</span>
				<span class="block text-[0.625rem] text-foreground/45">
					freie Fragen · Views · neue Intents
				</span>
			</span>
		</button>

		<h2 class="px-1 pt-2 font-semibold text-foreground/50 text-xs uppercase tracking-wide">
			Intents · {activeIntents.length}
		</h2>
		{#each activeIntents as intent (intent.id)}
			{@const sel = selectedId === intent.id}
			<button
				type="button"
				onclick={() => {
					selectedId = intent.id
					preview = null
					skillView = null
					talkMode = false
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
					<span class="ml-auto font-mono text-[0.5625rem] text-foreground/35">{intent.when}</span>
				</div>
				<p class="pt-1 font-semibold text-[13px] leading-snug">{intent.title}</p>
				<div class="flex items-center gap-2 pt-1">
					<span class="text-[0.625rem] text-foreground/45">{intent.source}</span>
					{#if intent.deadline}
						<span
							class="rounded-full bg-[#c15b40]/10 px-1.5 py-0.5 font-mono text-[#9c4832] text-[0.5625rem]"
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

		<!-- The archive: done intents rest here, folded away by default. -->
		<button
			type="button"
			onclick={() => {
				archiveOpen = !archiveOpen
			}}
			class="flex items-center gap-1.5 px-1 pt-3 text-left font-semibold text-foreground/50 text-xs uppercase tracking-wide transition-colors hover:text-foreground/80"
		>
			<svg
				viewBox="0 0 24 24"
				class="size-3 transition-transform {archiveOpen ? 'rotate-90' : ''}"
				fill="none"
				stroke="currentColor"
				stroke-width="2.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<path d="m9 6 6 6-6 6" />
			</svg>
			Archiv · {archivedIntents.length}
		</button>
		{#if archiveOpen}
			{#each archivedIntents as intent (intent.id)}
				{@const sel = selectedId === intent.id}
				<button
					type="button"
					onclick={() => {
						selectedId = intent.id
						preview = null
						skillView = null
						talkMode = false
					}}
					class="rounded-xl border px-3.5 py-2.5 text-left opacity-70 shadow-[0_1px_3px_rgba(30,41,59,0.05)] transition-all hover:opacity-100 {sel
						? 'border-foreground/15 bg-surface-card-selected opacity-100'
						: 'border-foreground/5 bg-[#fffdf7] hover:border-foreground/15'}"
				>
					<div class="flex items-center gap-2">
						<span
							class="rounded-full px-2 py-0.5 font-mono text-[0.5625rem] {TYPE_STYLE[intent.type]}"
						>
							{intent.type}
						</span>
						<span class="ml-auto font-mono text-[0.5625rem] text-foreground/35">{intent.when}</span>
					</div>
					<p class="pt-1 font-semibold text-[13px] leading-snug">{intent.title}</p>
					<div class="flex items-center gap-2 pt-1">
						<span class="text-[0.625rem] text-foreground/45">{intent.source}</span>
						<span class="ml-auto font-mono text-[#2f5d50] text-[0.5625rem]">erledigt</span>
					</div>
				</button>
			{/each}
		{/if}
	</aside>

	<!-- CENTER: activity log / artifact preview / skill stepper. -->
	<main
		class="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto rounded-2xl border border-foreground/5 bg-[#fffdf7] p-6 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
	>
		{#if talkMode}
			<!-- TALK TO MAIA: the traditional AI-chat view — free-form asks,
			     inline view queries, and intents extracted on the fly. Input is
			     the global voice/text pill below. Mocked transcript. -->
			<header class="flex items-center gap-2.5">
				<span class="block size-9 shrink-0 overflow-hidden rounded-full border border-border">
					<img src="/aven-logo.svg" alt="" class="size-full object-cover">
				</span>
				<div class="min-w-0">
					<h1 class="font-semibold text-lg leading-tight">MAIA</h1>
					<p class="text-foreground/45 text-xs">
						freie Fragen · Inline-Views · Intents extrahieren — sprich oder tippe unten
					</p>
				</div>
			</header>
			<div class="border-border border-b"></div>

			<div class="flex flex-col gap-4 pt-2">
				<!-- a view query: the answer IS an inline view -->
				<div class="flex justify-end">
					<div
						class="max-w-[75%] rounded-2xl bg-primary px-4 py-2.5 text-primary-foreground text-sm"
					>
						Zeig mir alle offenen Todos
					</div>
				</div>
				<div class="flex flex-col gap-2">
					<div
						class="max-w-[85%] rounded-2xl border border-border bg-surface-card px-4 py-2.5 text-sm"
					>
						Drei offene Todos — zwei davon mit Frist:
					</div>
					<!-- the inline view: a mini todo list, rendered right in the chat -->
					<div class="max-w-[85%] rounded-xl border border-border bg-[#fffdf7] px-4 py-3">
						{#each [{ t: 'Nachweis einreichen', m: 'fällig 12.09. · @me' }, { t: 'Bürostuhl bezahlen', m: 'fällig 30.08. · #rechnung' }, { t: 'Unterlagen an Steuerberater', m: 'fällig 20.09.' }] as row (row.t)}
							<div class="flex items-center gap-2.5 border-border/50 border-b py-1.5 last:border-0">
								<span class="size-3.5 rounded border-2 border-foreground/20"></span>
								<span class="min-w-0 flex-1 truncate text-xs">{row.t}</span>
								<span class="shrink-0 text-[0.625rem] text-foreground/40">{row.m}</span>
							</div>
						{/each}
					</div>
				</div>

				<!-- a free-form ask: MAIA extracts an intent from it -->
				<div class="flex justify-end">
					<div
						class="max-w-[75%] rounded-2xl bg-primary px-4 py-2.5 text-primary-foreground text-sm"
					>
						Kündige bitte mein Fitnessstudio
					</div>
				</div>
				<div class="flex flex-col gap-2">
					<div
						class="max-w-[85%] rounded-2xl border border-border bg-surface-card px-4 py-2.5 text-sm"
					>
						Verstanden — daraus habe ich einen Intent gemacht. Ich suche den Vertrag im Archiv und
						prüfe die Kündigungsfrist.
					</div>
					<!-- the extracted intent, as a chip that jumps to it -->
					<button
						type="button"
						onclick={() => {
							selectedId = 'fitnessstudio'
							talkMode = false
						}}
						class="flex w-fit items-center gap-2 rounded-xl border border-[#8a6238]/30 bg-[#8a6238]/8 px-3.5 py-2 text-left transition-colors hover:bg-[#8a6238]/15"
					>
						<span
							class="rounded-full bg-[#8a6238]/15 px-2 py-0.5 font-mono text-[#8a6238] text-[0.5625rem]"
						>
							auftrag
						</span>
						<span class="font-medium text-xs">„Kündige das Fitnessstudio"</span>
						<span class="font-mono text-[0.625rem] text-foreground/40">→ Intent öffnen</span>
					</button>
				</div>

				<p class="pt-2 text-center text-[0.625rem] text-foreground/35">
					Alles Freiform ohne Intent-/Skill-Template landet hier — Antworten, Inline-Views, neue
					Intents. Eingabe global über die Voice-/Text-Pill.
				</p>
			</div>
		{:else if skillView}
			<!-- SKILL FLOW STEPPER: where this skill stands for this intent. -->
			{@const skillLog = selected.log.filter((e) => e.skill === skillView?.skill)}
			<header class="flex items-center gap-3">
				<span
					class="size-2 shrink-0 rounded-full {skillView.state === 'done'
						? 'bg-[#2f5d50]'
						: skillView.state === 'waiting'
							? 'bg-[#c15b40]'
							: 'bg-[#a06818]'}"
				></span>
				<div class="min-w-0">
					<h1 class="font-mono font-semibold text-lg leading-tight">{skillView.skill}</h1>
					<p class="text-foreground/45 text-xs">{skillView.note}</p>
				</div>
				{@render backButton()}
			</header>
			<div class="border-border border-b"></div>

			<!-- the ACTUAL template workflow (same cards as the Skills viewer),
			     the instance state overlaid: ✓ done, amber running, red waiting -->
			<div
				bind:clientWidth={sfW}
				bind:clientHeight={sfH}
				class="h-[340px] w-full shrink-0 overflow-hidden rounded-xl border border-border bg-surface-soft/60"
			>
				{#key skillView.skill}
					<SvelteFlow
						nodes={sfNodes}
						edges={sfEdges}
						nodeTypes={sfNodeTypes}
						fitView
						minZoom={0.15}
						proOptions={{ hideAttribution: true }}
					>
						<Background bgColor="transparent" patternColor="rgba(30,41,59,0.08)" />
						<FitView w={sfW} h={sfH} />
					</SvelteFlow>
				{/key}
			</div>

			<!-- what this skill logged into the intent's stream -->
			{#if skillLog.length > 0}
				<h2 class="pt-4 font-semibold text-foreground/50 text-xs uppercase tracking-wide">
					Log dieses Skills
				</h2>
				<ul class="flex flex-col gap-2">
					{#each skillLog as entry (entry.step)}
						<li class="flex items-baseline gap-3 text-sm">
							<span class="font-mono text-[0.625rem] text-foreground/35">{entry.when}</span>
							<span class="min-w-0 flex-1">{entry.step}</span>
							<span
								class="font-mono text-[0.625rem] {entry.state === 'done'
									? 'text-[#2f5d50]'
									: entry.state === 'waiting'
										? 'text-[#9c4832]'
										: 'text-[#a06818]'}"
							>
								{entry.state === 'done' ? '✓' : entry.state === 'waiting' ? '⏸' : '⟳'}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		{:else if preview}
			<!-- ARTIFACT PREVIEW: full width — header, a divider, the view. -->
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
				{@render backButton()}
			</header>
			<div class="border-border border-b"></div>

			{#if preview.kind === 'doc'}
				<div class="w-full pt-2">
					<div class="flex items-baseline justify-between pb-6">
						<span class="font-semibold text-sm">{preview.title.replace('.pdf', '')}</span>
						<span class="font-mono text-[0.625rem] text-foreground/40">Seite 1 / 2</span>
					</div>
					{#each [92, 100, 78, 96, 60] as w, i (i)}
						<div class="mb-2 h-2 rounded bg-foreground/8" style="width: {w}%"></div>
					{/each}
					<div class="mt-5 rounded-lg border border-[#a06818]/30 bg-[#a06818]/8 px-4 py-3">
						<p class="font-mono text-[#a06818] text-[0.625rem] uppercase tracking-wide">
							Extrahiert
						</p>
						<p class="pt-1 text-xs leading-relaxed">{preview.note}</p>
					</div>
					{#each [88, 95, 70] as w, i (i)}
						<div class="mt-2 h-2 rounded bg-foreground/8" style="width: {w}%"></div>
					{/each}
				</div>
			{:else if preview.kind === 'todo'}
				<div class="w-full pt-2">
					<div class="flex items-center gap-3">
						<span
							class="flex size-5 items-center justify-center rounded-md border-2 border-foreground/20"
						></span>
						<span class="flex-1 font-medium text-sm">{preview.title}</span>
						<span class="rounded-full bg-surface-soft px-2 py-0.5 font-mono text-[0.625rem]">
							todos
						</span>
					</div>
					<p class="pt-2 pl-8 text-foreground/50 text-xs">{preview.note}</p>
				</div>
			{:else if preview.kind === 'calendar'}
				<div class="flex w-full items-center gap-4 pt-2">
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
				<div class="w-full pt-2">
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
				<div class="w-full pt-2">
					{#each [{ d: '28.07.', t: 'Miete August', a: '−1.150,00 €', m: 'abgeglichen ✓' }, { d: '25.07.', t: 'Möbelhaus Nord GmbH', a: '−249,00 €', m: 'Rechnung zugeordnet ✓' }, { d: '24.07.', t: 'Gehalt', a: '+3.480,00 €', m: '' }] as row (row.d + row.t)}
						<div class="flex items-center gap-3 border-border/60 border-b py-2.5 text-sm">
							<span class="w-14 font-mono text-foreground/40 text-xs">{row.d}</span>
							<span class="min-w-0 flex-1 truncate">{row.t}</span>
							<span class="font-mono {row.a.startsWith('+') ? 'text-[#2f5d50]' : ''}">{row.a}</span>
							<span class="w-40 text-right text-[0.6875rem] text-foreground/40">{row.m}</span>
						</div>
					{/each}
				</div>
			{:else}
				<!-- brain entity: an Obsidian-style markdown note with wikilinks -->
				<div class="w-full max-w-2xl pt-2 font-mono text-[13px] leading-relaxed">
					<p class="text-foreground/35">---</p>
					<p class="text-foreground/55">
						tags: <span class="text-[#a06818]">#versicherung #frist</span>
					</p>
					<p class="text-foreground/55">erstellt: 2025-08-12 · quelle: inbox</p>
					<p class="pb-3 text-foreground/35">---</p>
					<h1 class="pb-2 font-sans font-semibold text-xl">
						{preview.title.replaceAll('[', '').replaceAll(']', '')}
					</h1>
					<p class="pb-3 text-foreground/75">
						Sammelt alles rund um Versicherungen in 2025. Der Brief der
						<span
							class="cursor-pointer text-[#655687] underline decoration-[#655687]/30 underline-offset-2"
							>[[Techniker Krankenkasse]]</span
						>
						verlangt einen
						<span
							class="cursor-pointer text-[#655687] underline decoration-[#655687]/30 underline-offset-2"
							>[[Einkommensnachweis]]</span
						>
						bis zur Frist am 15.09. — das Todo hängt an
						<span
							class="cursor-pointer text-[#655687] underline decoration-[#655687]/30 underline-offset-2"
							>[[Fristen 2025]]</span
						>.
					</p>
					<p class="pb-1 text-foreground/75">## Offen</p>
					<p class="pb-0.5 text-foreground/75">
						- [ ] Nachweis einreichen <span class="text-foreground/40">(fällig 12.09.)</span>
					</p>
					<p class="pb-3 text-foreground/75">
						- [x] <span class="line-through opacity-60">Brief archivieren</span>
					</p>
					<p class="pb-1 text-foreground/75">## Verknüpft</p>
					<div class="flex flex-wrap gap-1.5 pb-4">
						{#each ['[[Techniker Krankenkasse]]', '[[Einkommensnachweis]]', '[[Fristen 2025]]', '[[Steuer 2023]]'] as link (link)}
							<span
								class="cursor-pointer rounded-md bg-[#7e6ead]/10 px-2 py-0.5 text-[#655687] text-xs"
								>{link}</span
							>
						{/each}
					</div>
					<div class="border-border border-t pt-3">
						<p
							class="pb-1 font-sans font-semibold text-foreground/50 text-xs uppercase tracking-wide"
						>
							Backlinks · 3
						</p>
						<p class="text-foreground/55 text-xs">
							[[Krankenkasse: Nachweis bis 15.09.]] · [[Steuer 2023]] · [[Post-Eingang August]]
						</p>
					</div>
				</div>
			{/if}
		{:else}
			<!-- ACTIVITY LOG: the intent's journey, every entry typed by skill. -->
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

			<ol class="flex flex-col">
				{#each selected.log as entry, i (entry.step + i)}
					<li class="relative flex gap-3 pb-5">
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
								<!-- the entry is TYPED: which skill wrote it -->
								<button
									type="button"
									onclick={() => {
										skillView = selected.skills.find((s) => s.skill === entry.skill) ?? null
										preview = null
									}}
									class="rounded-md bg-surface-soft px-1.5 py-0.5 font-mono text-[0.5625rem] text-foreground/55 transition-colors hover:bg-surface-card-selected"
								>
									{entry.skill}
								</button>
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
										<p class="pt-2 font-mono text-[#9c4832] text-[0.625rem]">
											→ wartet in der globalen Freigabe-Leiste über der Voice-Pill
										</p>
									{/if}
								</div>
							{/if}
						</div>
					</li>
				{/each}
			</ol>
		{/if}
	</main>

	<!-- RIGHT: SKILLS (click → stepper) above ARTIFACTS (click → preview). -->
	<aside class="flex w-72 shrink-0 flex-col gap-2 overflow-y-auto pb-4">
		<h2 class="px-1 pt-1 font-semibold text-foreground/50 text-xs uppercase tracking-wide">
			Skills · {selected.skills.length}
		</h2>
		{#each selected.skills as s (s.skill)}
			<button
				type="button"
				onclick={() => {
					skillView = skillView?.skill === s.skill ? null : s
					preview = null
				}}
				class="rounded-xl border px-4 py-3 text-left shadow-[0_1px_3px_rgba(30,41,59,0.05)] transition-all {skillView?.skill ===
				s.skill
					? 'border-foreground/15 bg-surface-card-selected'
					: 'border-foreground/5 bg-[#fffdf7] hover:border-foreground/15'}"
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
			</button>
		{/each}

		<h2 class="px-1 pt-3 font-semibold text-foreground/50 text-xs uppercase tracking-wide">
			Artefakte · {selected.artifacts.length}
		</h2>
		{#each selected.artifacts as artifact (artifact.title)}
			<button
				type="button"
				onclick={() => {
					preview = preview?.title === artifact.title ? null : artifact
					skillView = null
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
