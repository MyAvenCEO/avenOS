<script lang="ts">
import { appRuntime } from 'virtual:aven-app-runtime'
import { onMount } from 'svelte'
import { goto } from '$app/navigation'
import { page } from '$app/state'
import type { QueueStanding } from '$lib/types.js'

let downloadUrl = $state('')
let error = $state('')
let standing = $state<QueueStanding | null>(null)

const dateOf = (iso: string) =>
	new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })

onMount(async () => {
	try {
		const result = await appRuntime.dashboard.load(page.url)
		if (result.needsPasskey) {
			void goto('/passkey/create')
			return
		}
		downloadUrl = result.downloadUrl
		standing = await appRuntime.dashboard.queue()
	} catch (cause) {
		error = cause instanceof Error ? cause.message : 'Load failed.'
	}
})
</script>

<svelte:head><title>Download · avenCEO</title></svelte:head>
<section class="panel auth">
	<img src="/aven-logo.svg" alt="" class="mark" width="56" height="56">
	<h1>Dein avenOS</h1>

	{#if error}
		<div class="alert">{error}</div>
	{/if}

	{#if standing}
		<div class="code">
			<p class="eyebrow">Für dich reserviert</p>
			<p class="digits">{standing.name}.aven.ceo</p>
		</div>
		<p class="fine">Gesichert am {dateOf(standing.reservedAt)}</p>

		<dl class="facts">
			<div>
				<dt>Dein Platz</dt>
				<dd>{standing.position}</dd>
			</div>
			<div>
				<dt>Vor dir</dt>
				<dd>{standing.ahead}</dd>
			</div>
			<div>
				<dt>Schon eingeladen</dt>
				<dd>{standing.invited}</dd>
			</div>
		</dl>

		<p>
			{standing.total}
			Gründer stehen auf der Liste, {standing.invited} sind bereits an Bord.
			{#if standing.lastInvitedAt}
				Die letzten Einladungen gingen am {dateOf(standing.lastInvitedAt)} raus.
			{/if}
		</p>
		<p class="fine">
			Eingeladen wird der Reihe nach. Wenn du dran bist, bekommst du deine Onboarding‑Einladung per
			Mail — du musst hier nichts weiter tun und nichts nachsehen. Ein Datum nennen wir bewusst
			nicht: wir laden ein, wenn wir jemanden wirklich gut betreuen können, nicht nach Kalender.
		</p>
	{/if}

	{#if downloadUrl}
		<p>Lade die App und melde dich darin mit deinem Passkey an.</p>
		<a href={downloadUrl}><button>avenOS herunterladen</button></a>
	{/if}
</section>
