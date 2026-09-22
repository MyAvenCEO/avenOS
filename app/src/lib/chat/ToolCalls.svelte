<script lang="ts">
import { currentStep, type ModelActivity, modelPhaseLabels } from '@avenos/chat-engine/current-step'
import type { ModelRequestMetric } from '@avenos/chat-engine/model-metrics'
import {
	formatDuration,
	type ToolCall,
	toolDetail,
	toolPurpose
} from '@avenos/chat-engine/tool-call'
import { toolPreviews } from '@avenos/chat-engine/tool-preview'
import ToolResultCard from './ToolResultCard.svelte'

let {
	calls,
	startedAt,
	durationMs,
	modelRequests = [],
	modelRequestCount,
	active = false,
	modelActivity = null,
	recovering = false
}: {
	calls: ToolCall[]
	startedAt?: number
	durationMs?: number
	modelRequests?: ModelRequestMetric[]
	modelRequestCount?: number
	active?: boolean
	modelActivity?: ModelActivity | null
	recovering?: boolean
} = $props()
let now = $state(Date.now())
$effect(() => {
	if (!active) return
	now = Date.now()
	const timer = setInterval(() => {
		now = Date.now()
	}, 250)
	return () => clearInterval(timer)
})
const elapsed = (value: { durationMs?: number; startedAt?: number; status: string }) =>
	value.durationMs ??
	(value.status === 'running' && value.startedAt !== undefined
		? Math.max(0, now - value.startedAt)
		: undefined)
const totalDuration = $derived(
	durationMs ?? (active && startedAt !== undefined ? Math.max(0, now - startedAt) : undefined)
)
const step = $derived(currentStep(modelActivity, calls, recovering))
const marks = { running: '◌', completed: '✓', failed: '!', interrupted: '−', incomplete: '!' }
const states = {
	running: 'Läuft',
	completed: 'Beendet',
	failed: 'Fehlgeschlagen',
	interrupted: 'Unterbrochen',
	incomplete: 'Unvollständig'
}
const previews = $derived(new Map(toolPreviews(calls).map((item) => [item.id, item.preview])))
type Entry = { kind: 'tool'; value: ToolCall } | { kind: 'model'; value: ModelRequestMetric }
const timeline = $derived.by(() => {
	const entries: Entry[] = [
		...calls.map((value) => ({ kind: 'tool' as const, value })),
		...modelRequests.map((value) => ({ kind: 'model' as const, value }))
	]
	// A live phase can precede its metric reaching the view. Render it only once.
	if (active && modelActivity && !modelRequests.some((value) => value.id === modelActivity?.id))
		entries.push({ kind: 'model', value: { ...modelActivity, status: 'running' } })
	return entries.sort((a, b) => (a.value.startedAt ?? 0) - (b.value.startedAt ?? 0))
})
const failures = $derived(
	timeline.filter((item) => ['failed', 'incomplete'].includes(item.value.status)).length
)
const last = $derived(timeline.at(-1))
const title = $derived(
	active
		? step.label
		: last
			? last.kind === 'tool'
				? toolPurpose(last.value)
				: modelPhaseLabels[last.value.phase]
			: 'Aktivität'
)
</script>

{#if active || timeline.length || totalDuration !== undefined}
	<div class="tool-activity">
		<details class="tool-calls" aria-label="Agent tool calls">
			<summary>
				<span
					class="heading-label"
					aria-label={active ? 'Current agent step' : undefined}
					data-phase={active ? step.kind : undefined}
					title={active ? step.detail : undefined}
				>
					<span class:spinning={active} aria-hidden="true"
						>{active ? '◌' : failures ? '!' : '✓'}</span
					>
					<span class="step-label" role={active ? 'status' : undefined}>{title}</span>
				</span>
				<span
					class="timing"
					title="Gesamte Antwortzeit einschließlich Modell, Werkzeugen und Prüfung."
					>{active ? 'Bisher' : 'Gesamt'} {formatDuration(totalDuration)}</span
				>
			</summary>
			<ol>
				{#each timeline as entry (`${entry.kind}:${entry.value.id}`)}
					{@const value = entry.value}
					<li data-step-kind={entry.kind} data-status={value.status}>
						<details class="step-details">
							<summary>
								<span
									>{marks[value.status]}
									{entry.kind === 'tool' ? toolPurpose(entry.value) : modelPhaseLabels[entry.value.phase]}</span
								>
								<span
									class="step-time"
									title={states[value.status]}
									aria-label={value.status === 'running' ? 'Current step duration' : undefined}
									>{formatDuration(elapsed(value))}</span
								>
							</summary>
							{#if entry.kind === 'tool'}
								<p>
									{entry.value.name}
									· {states[value.status]}
									{entry.value.durationBasis ? ` · ${entry.value.durationBasis}` : ''}
								</p>
								<pre>{toolDetail(entry.value.arguments)}</pre>
								{#if entry.value.result}
									<pre>{toolDetail(entry.value.result)}</pre>
								{/if}
								{#if entry.value.error}
									<p class="error">{entry.value.error}</p>
								{/if}
							{:else}
								<p class="metrics" data-model-request-id={value.id}>
									<span title="Eingabetokens, keine Anzeige des freien Kontextfensters"
										>Eingabe: {entry.value.inputTokens?.toLocaleString('de-DE') ?? '–'}</span
									>
									<span title="Ausgabetokens"
										>Ausgabe: {entry.value.outputTokens?.toLocaleString('de-DE') ?? '–'}</span
									>
									{#if entry.value.firstTextMs !== undefined}
										<span title="Erster Modelltext; kann noch ein ungeprüfter Entwurf sein"
											>Erster Text: {formatDuration(entry.value.firstTextMs)}</span
										>
									{/if}
									{#if entry.value.replayed}
										<span title="Ursprüngliche Messung, kein neuer Modellaufruf"
											>Wiederhergestellt</span
										>
									{/if}
								</p>
							{/if}
						</details>
						{#if entry.kind === 'tool'}
							{@const preview = previews.get(value.id)}
							{#if preview}
								<ToolResultCard {preview} />
							{/if}
						{/if}
					</li>
				{/each}
				{#if active && step.kind === 'waiting'}
					<li class="waiting" role="status">◌ {step.label}</li>
				{/if}
			</ol>
			{#if modelRequestCount !== undefined && modelRequestCount > modelRequests.length}
				<small>{modelRequests.length} von {modelRequestCount} Modellaufrufen gespeichert</small>
			{/if}
		</details>
	</div>
{/if}

<style>
.tool-activity {
	min-width: 0;
	flex: 0 0 auto;
}
.tool-calls {
	min-width: 0;
	border: 1px solid var(--color-border);
	border-radius: 8px;
	padding: 5px 8px;
	font-size: 12px;
}
summary {
	cursor: pointer;
	display: flex;
	align-items: baseline;
	gap: 8px;
	overflow-wrap: anywhere;
}
summary::before {
	content: "›";
}
details[open] > summary::before {
	content: "⌄";
}
summary > span:first-of-type {
	flex: 1;
	min-width: 0;
}
.heading-label {
	display: flex;
	align-items: center;
	gap: 6px;
}
.step-label {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.timing,
.step-time {
	white-space: nowrap;
	opacity: 0.7;
	font-size: 11px;
}
ol {
	display: grid;
	gap: 8px;
	padding: 0;
	margin: 8px 0 0;
	list-style: none;
}
li {
	min-width: 0;
	border-top: 1px solid var(--color-border);
	padding-top: 8px;
	display: grid;
	gap: 6px;
}
p {
	margin: 6px 0;
	opacity: 0.7;
}
.metrics {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 12px;
	font-size: 11px;
}
pre {
	max-height: 160px;
	overflow: auto;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	font-size: 11px;
}
.error {
	color: var(--color-error-ink);
}
.waiting,
small {
	opacity: 0.7;
}
summary:focus-visible {
	outline: 2px solid var(--color-primary);
	outline-offset: 2px;
}
.spinning {
	animation: spin 2s linear infinite;
}
@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}
@media (prefers-reduced-motion: reduce) {
	.spinning {
		animation: none;
	}
}
</style>
