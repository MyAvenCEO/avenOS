<script lang="ts">
import { AvenUiEngine } from '@avenos/aven-ui'
import { onDestroy } from 'svelte'
import type { Face } from './faces'

/**
 * Mounts an actor's face through THE aven-ui engine — shadow root,
 * whitelist, brand tokens, identical to the live actor windows. A face
 * is an illustration here, not a control surface: no events leave it.
 */
const { face, facts }: { face: Face; facts: Record<string, unknown> } = $props()

let engine: AvenUiEngine | null = null
let host = $state<HTMLElement | null>(null)
let error = $state<string | null>(null)

$effect(() => {
	const element = host
	const bundle = { view: face.view, style: face.style, state: facts }
	if (!element) return
	let cancelled = false
	void (async () => {
		try {
			error = null
			engine ??= new AvenUiEngine({ container: element })
			if (cancelled) return
			await engine.mount(bundle)
		} catch (err) {
			error = err instanceof Error ? err.message : String(err)
		}
	})()
	return () => {
		cancelled = true
	}
})

onDestroy(() => {
	void engine?.unmount()
	engine = null
})
</script>

{#if error}
	<p class="px-1 text-red-600 text-sm" role="alert">{error}</p>
{/if}
<div bind:this={host} class="w-full"></div>
