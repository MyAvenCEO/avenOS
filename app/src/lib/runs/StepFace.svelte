<script lang="ts">
import { AvenUiEngine } from '@avenos/aven-ui'
import { onDestroy } from 'svelte'
import type { RecipeNodeConfig } from '../fibu/recipe-config'
import type { FlowRun } from './mock-runs'
import { faceFor, faceState } from './step-faces'

/**
 * Der Host für ein Schritt-Gesicht: mountet den ViewDef durch DIESELBE
 * aven-ui-Engine, die auch die Actor-Faces rendert — Shadow-Root,
 * Whitelist, Brand-Tokens, alles identisch.
 *
 * Der einzige Unterschied zu `AvenUiView`: hier hängt kein Actor dran,
 * also gibt es auch keine Ereignisse, die auf den Bus gingen. Ein
 * Schritt-Gesicht ist eine Anschauung, keine Bedienoberfläche — Klicks
 * darin täten nichts, also nimmt es gar keine erst entgegen.
 */

// `zustand` statt `state`: eine Variable dieses Namens im Scope macht die
// $state-Rune mehrdeutig — Svelte liest sie sonst als Store-Zugriff.
const {
	node,
	zustand,
	ergebnis,
	run
}: {
	node: RecipeNodeConfig
	zustand: 'done' | 'current' | 'pending'
	ergebnis?: string
	run: FlowRun
} = $props()

const face = $derived(faceFor(node))
const daten = $derived(faceState(node, run, zustand, ergebnis))

let engine: AvenUiEngine | null = null
let host = $state<HTMLElement | null>(null)
let fehler = $state<string | null>(null)

/**
 * Neu mounten, wenn sich der ViewDef ändert (anderer Schritt = anderes
 * Gesicht); nur den Zustand tauschen, wenn dieselbe Ansicht neue Daten
 * bekommt — dieselbe Arbeitsteilung wie in AvenUiView.
 */
$effect(() => {
	const element = host
	const bundle = { view: face.view, style: face.style, state: daten }
	if (!element) return
	let abgebrochen = false
	void (async () => {
		try {
			fehler = null
			engine ??= new AvenUiEngine({ container: element })
			if (abgebrochen) return
			await engine.mount(bundle)
		} catch (err) {
			fehler = err instanceof Error ? err.message : String(err)
		}
	})()
	return () => {
		abgebrochen = true
	}
})

onDestroy(() => {
	void engine?.unmount()
	engine = null
})
</script>

{#if fehler}
	<p class="px-1 text-red-600 text-sm" role="alert">{fehler}</p>
{/if}
<div bind:this={host} class="w-full"></div>
