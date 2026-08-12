<script lang="ts">
import { AvenUiEngine, type UiEvent } from '@avenos/aven-ui'
import { onDestroy } from 'svelte'
import type { Actor, VibeSpec } from './actor'
import type { VibeEvent } from './sandbox'

/**
 * THE view renderer (0130): one component that mounts any actor's vibe —
 * validated view/style JSON through the aven-ui engine into a shadow root.
 *
 * State never originates here. The subject actor owns its vibe state (the
 * sandbox reduces it); this component renders that state and forwards every
 * UI event back to `applyEvent`, the same door the voice tools use. Two
 * windows over one actor (list + board) are just two AvenUiViews with
 * different specs over the SAME state.
 */

interface VibeSubject extends Actor {
	vibeState: Record<string, unknown>
	applyEvent(event: VibeEvent): Promise<unknown>
}

function isVibeSubject(a: Actor): a is VibeSubject {
	return 'vibeState' in a && 'applyEvent' in a
}

/** A named vibe window passes its own spec; the default window falls back to manifest.vibe. */
const { actor, spec: specOverride }: { actor: Actor; spec?: VibeSpec } = $props()

const spec = $derived(specOverride ?? actor.manifest.vibe)
const subject = $derived(isVibeSubject(actor) ? actor : null)

let engine: AvenUiEngine | null = null
let mounted = $state(false)
let renderError = $state<string | null>(null)

function attachHost(element: HTMLElement) {
	void mount(element)
	return () => {
		void engine?.unmount()
		engine = null
		mounted = false
	}
}

async function mount(element: HTMLElement): Promise<void> {
	if (!spec || !subject) return
	renderError = null
	try {
		engine = new AvenUiEngine({
			container: element,
			onEvent: (event: UiEvent) => {
				subject.applyEvent(event as VibeEvent).catch((err) => {
					renderError = err instanceof Error ? err.message : String(err)
				})
			}
		})
		await engine.mount({ view: spec.view, style: spec.style, state: subject.vibeState })
		mounted = true
	} catch (err) {
		renderError = err instanceof Error ? err.message : String(err)
	}
}

// The actor's state is the single source; every reduction re-renders.
$effect(() => {
	const state = subject?.vibeState
	if (engine && mounted && state) void engine.replaceState(state)
})

onDestroy(() => {
	void engine?.unmount()
	engine = null
})
</script>

{#if renderError}
	<p class="shrink-0 px-1 text-sm text-red-600" role="alert">{renderError}</p>
{/if}
{#if spec && subject}
	<div {@attach attachHost} class="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto"></div>
{:else}
	<p class="text-muted-foreground px-1 text-sm">{actor.manifest.name} has no vibe to render.</p>
{/if}
