<script lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { onMount } from 'svelte'
import { intents } from '../intents/intents.svelte'
import { shell } from '../intents/talk.svelte'
import { customerWork } from './customer-work.svelte'
import {
	documentExecutionPreference,
	loadPersistentIntents,
	processAdmittedUpload,
	type UploadedArtifactReceipt
} from './ingest.svelte'
import { inboxEpoch, loadUploadInbox, uploadInbox } from './upload-inbox.svelte'

let selected = $state<string[]>([])
let destination = $state('new')
let title = $state('')
let admittedIntent = $state('')
let notice = $state('')
const blocked = $derived(uploadInbox.busy || customerWork.uploads)
const canAdmit = $derived(
	!blocked && selected.length > 0 && (destination !== 'new' || title.trim().length > 0)
)
onMount(() => {
	void loadUploadInbox()
})
$effect(() => {
	const remaining = selected.filter((id) =>
		uploadInbox.items.some((item) => item.artifactId === id)
	)
	if (remaining.length !== selected.length) selected = remaining
})

async function admit() {
	if (!canAdmit) return
	const epoch = inboxEpoch(),
		environment = documentExecutionPreference.environment
	const chosen = uploadInbox.items.filter((item) => selected.includes(item.artifactId))
	const intentId = destination === 'new' ? crypto.randomUUID() : destination
	uploadInbox.busy = true
	customerWork.uploads = true
	uploadInbox.error = ''
	notice = ''
	let completed = 0
	const errors: string[] = []
	try {
		const scope = await invoke<string>('imap_account_scope')
		if (epoch !== inboxEpoch()) return
		if (destination === 'new') {
			await invoke('intent_create', {
				expectedImapScope: scope,
				intent: {
					id: intentId,
					title: title.trim(),
					intentType: 'file',
					sourceLabel: 'Posteingang',
					deadline: null,
					routingSummary: 'Documents explicitly assigned from the upload inbox.'
				}
			})
		}
		for (const [index, item] of chosen.entries()) {
			if (epoch !== inboxEpoch()) break
			uploadInbox.progress = `${index + 1} / ${chosen.length}`
			try {
				const receipt = await invoke<UploadedArtifactReceipt>('artifact_inbox_promote', {
					artifactId: item.artifactId,
					intentId,
					executionEnvironment: environment,
					expectedImapScope: scope
				})
				if (epoch !== inboxEpoch()) break
				completed++
				selected = selected.filter((id) => id !== item.artifactId)
				await processAdmittedUpload(receipt, environment, scope)
			} catch (error) {
				errors.push(`${item.payload.originalName}: ${String(error)}`)
			}
		}
		if (epoch === inboxEpoch()) {
			admittedIntent = completed ? intentId : ''
			notice = completed
				? `${completed} Datei${completed === 1 ? '' : 'en'} zugeordnet. Die Verarbeitung erscheint im Intent.`
				: ''
			await loadPersistentIntents()
			// Loading the Intent projection must not move the user away from remaining uploads.
			if (epoch === inboxEpoch()) shell.inboxOpen = true
		}
	} catch (error) {
		errors.push(String(error))
	} finally {
		if (epoch === inboxEpoch()) {
			uploadInbox.busy = false
			customerWork.uploads = false
			uploadInbox.progress = ''
			await loadUploadInbox()
			if (epoch === inboxEpoch()) uploadInbox.error = errors.join('\n')
		}
	}
}
</script>

<main
	aria-label="Upload inbox"
	class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-foreground/10 bg-surface-raised"
>
	<header class="flex items-start justify-between gap-4 border-b border-foreground/8 p-6">
		<div>
			<p class="text-xs uppercase tracking-widest text-foreground/55">Noch nicht zugeordnet</p>
			<h1 class="mt-1 text-2xl font-semibold">Posteingang</h1>
			<p class="mt-2 max-w-xl text-sm text-foreground/65">
				Dateien sammeln, gemeinsam zuordnen. Inhalte werden erst danach gelesen und verarbeitet.
			</p>
		</div>
		<button
			type="button"
			class="rounded-lg border border-foreground/15 px-3 py-2 text-sm disabled:opacity-40"
			disabled={blocked||uploadInbox.loading}
			onclick={()=>loadUploadInbox()}
		>
			Aktualisieren
		</button>
	</header>
	<div class="min-h-0 flex-1 overflow-y-auto p-6">
		{#if uploadInbox.error}
			<p
				role="alert"
				class="mb-4 whitespace-pre-wrap rounded-xl border border-foreground/15 bg-foreground/5 p-3 text-sm"
			>
				{uploadInbox.error}
			</p>
		{/if}
		{#if notice}
			<div role="status" class="mb-4 rounded-xl border border-primary/20 p-4 text-sm">
				<p>{notice}</p>
				{#if admittedIntent}
					<button
						type="button"
						disabled={blocked}
						class="mt-2 underline underline-offset-4 disabled:opacity-40"
						data-inbox-open-intent
						onclick={()=>intents.select(admittedIntent)}
					>
						Intent öffnen →
					</button>
				{/if}
			</div>
		{/if}
		{#if uploadInbox.items.length}
			<div class="mb-3 flex items-center justify-between gap-3 text-sm text-foreground/65">
				<span
					>{uploadInbox.items.length}{uploadInbox.nextAfter?' +':''}
					Dateien · {selected.length} ausgewählt</span
				>
				<button
					type="button"
					disabled={blocked}
					class="underline underline-offset-4 disabled:opacity-40"
					onclick={()=>selected=selected.length?[]:uploadInbox.items.slice(0,50).map(item=>item.artifactId)}
				>
					{selected.length?'Auswahl aufheben':'Bis zu 50 auswählen'}
				</button>
			</div>
			<ul class="divide-y divide-foreground/8">
				{#each uploadInbox.items as item (item.artifactId)}
					<li>
						<label
							class="flex cursor-pointer items-center gap-4 rounded-lg px-2 py-4 hover:bg-foreground/3"
						>
							<input
								type="checkbox"
								value={item.artifactId}
								bind:group={selected}
								disabled={blocked||(!selected.includes(item.artifactId)&&selected.length>=50)}
								class="size-4 shrink-0"
								style="accent-color: var(--color-primary)"
								aria-label={item.payload.originalName}
							>
							<span class="min-w-0 flex-1"
								><span class="block break-words text-sm font-medium"
									>{item.payload.originalName}</span
								><span class="mt-1 block text-xs text-foreground/55"
									>{item.payload.declaredMediaType}
									· {Math.ceil(item.blob.length/1024)} KB ·
									{new Date(item.payload.observedAt).toLocaleString()}</span
								></span
							>
							<span
								class="shrink-0 rounded-full bg-foreground/5 px-2 py-1 text-xs text-foreground/60"
								>Ungeprüft</span
							>
						</label>
					</li>
				{/each}
			</ul>
			{#if uploadInbox.nextAfter}
				<button
					type="button"
					class="mt-4 rounded-lg border border-foreground/15 px-4 py-2 text-sm"
					disabled={blocked||uploadInbox.loading}
					onclick={()=>loadUploadInbox(true)}
				>
					Weitere Dateien laden
				</button>
			{/if}
		{:else}
			<div
				class="mx-auto my-12 max-w-sm rounded-2xl border border-dashed border-foreground/20 p-8 text-center"
			>
				<p class="text-lg font-medium">Platz für neue Dokumente</p>
				<p class="mt-3 text-sm text-foreground/65">
					Dateien hier ablegen. Kennst du den passenden Intent schon? Ziehe sie direkt auf dessen
					Karte links oder in seinen Verlauf.
				</p>
			</div>
		{/if}
	</div>
	{#if selected.length}
		<form
			class="grid grid-cols-1 items-end gap-3 border-t border-foreground/10 bg-surface-raised p-5 lg:grid-cols-3"
			onsubmit={event=>{event.preventDefault();void admit()}}
		>
			<label class="min-w-0 flex-1 text-xs text-foreground/65"
				>Zuordnen zu
				<select
					bind:value={destination}
					disabled={blocked}
					class="mt-1 block w-full rounded-lg border border-foreground/15 bg-surface-raised p-2 text-sm text-foreground"
				>
					<option value="new">Neuer Intent…</option>
					{#each intents.items as intent (intent.id)}
						<option value={intent.id}>{intent.title}</option>
					{/each}
				</select>
			</label>
			{#if destination==='new'}
				<label class="min-w-0 flex-1 text-xs text-foreground/65"
					>Worum geht es?<input
						bind:value={title}
						maxlength="160"
						required
						disabled={blocked}
						placeholder="Zum Beispiel: Belege September"
						class="mt-1 block w-full rounded-lg border border-foreground/15 bg-surface-raised p-2 text-sm text-foreground"
					></label
				>
			{/if}
			<button
				type="submit"
				disabled={!canAdmit}
				class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
			>
				{uploadInbox.busy?uploadInbox.progress:'Zuordnen & verarbeiten'}
			</button>
			<p class="w-full text-xs text-foreground/55 lg:col-span-3">
				Damit gibst du die ausgewählten Dateien für die normale Verarbeitung und passende Skills
				frei.
			</p>
		</form>
	{/if}
	{#if uploadInbox.busy && !selected.length}
		<p role="status" class="border-t border-foreground/10 p-4 text-sm">
			Wird hochgeladen… {uploadInbox.progress}
		</p>
	{/if}
</main>
