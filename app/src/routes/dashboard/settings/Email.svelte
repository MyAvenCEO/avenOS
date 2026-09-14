<script lang="ts">
import { invoke, isTauri } from '@tauri-apps/api/core'
import { onDestroy } from 'svelte'
import type { EmailRequest, EmailResult } from '$lib/artifacts/email-job'
import { emailJob, emailJobState as job } from '$lib/artifacts/email-job.svelte'
import { documentExecutionPreference } from '$lib/artifacts/ingest.svelte'

let host = $state('')
let port = $state(993)
let user = $state('')
let password = $state('')
let mailbox = $state('INBOX')
let since = $state('')
let before = $state('')
let maxMessages = $state(20)
let mailboxes = $state<string[]>([])
let result = $state<EmailResult | null>(null)
let selected = $state<string[]>([])
let imported = $derived(job.imported)
let failed = $derived(job.failed.map((entry) => entry.attachment.id))
let scanning = $state(false)
let busy = $derived(scanning || job.running || job.paused)
let status = $state('')
let error = $state('')
let alive = true
let placement = $state<'local' | 'server'>(documentExecutionPreference.environment)

onDestroy(() => {
	alive = false
	password = ''
})

async function scan(operation: 'list' | 'scan' | 'demo') {
	if (busy) return
	scanning = true
	error = ''
	status = operation === 'list' ? 'Connecting to your mailbox…' : 'Reading emails and finding PDFs…'
	if (operation !== 'list') {
		emailJob.clearCompleted()
		result = null
		selected = []
	}
	try {
		const response = await invoke<EmailResult>('imap_scan', {
			request: {
				operation,
				host: host.trim(),
				port,
				user: user.trim(),
				password,
				mailbox,
				since: since || null,
				before: before || null,
				maxMessages
			}
		})
		if (!alive) return
		if (operation === 'list') {
			mailboxes = response.mailboxes
			if (mailboxes.length && !mailboxes.includes(mailbox)) mailbox = mailboxes[0]
			status = `Connected. ${mailboxes.length} folders available.`
		} else {
			result = response
			selected = response.attachments.map((attachment) => attachment.id)
			status = `${response.attachments.length} PDF attachments found.`
		}
	} catch (cause) {
		error = cause instanceof Error ? cause.message : String(cause)
		status = ''
	} finally {
		// Retain only between listing folders and scanning; never persist credentials.
		if (operation !== 'list') password = ''
		scanning = false
	}
}

function connection(operation: EmailRequest['operation']): EmailRequest {
	return {
		operation,
		host: host.trim(),
		port,
		user: user.trim(),
		password,
		mailbox,
		since: since || null,
		before: before || null,
		maxMessages
	}
}

function importMailbox() {
	if (busy) return
	status = ''
	error = ''
	void emailJob.startMailbox(connection('start'), placement)
	password = ''
}

function importSelected() {
	if (!result || busy) return
	status = ''
	void emailJob.startSelected(
		result,
		selected.filter((id) => !imported.includes(id)),
		placement
	)
}
</script>

<section class="email-panel">
	<header>
		<h2>Email attachments</h2>
		<p>
			Bring PDFs from your mailbox into your workspace. Your emails stay unread and are never moved
			or deleted.
		</p>
	</header>
	{#if !isTauri()}
		<p class="notice">Open the desktop app to connect an IMAP mailbox.</p>
	{/if}
	<form onsubmit={(event) => { event.preventDefault(); importMailbox() }}>
		<fieldset disabled={busy || !isTauri()}>
			<div class="fields">
				<label
					>IMAP hostname<input
						bind:value={host}
						placeholder="imap.example.com"
						required
						autocomplete="off"
					></label
				>
				<label>Port<input type="number" bind:value={port} min="1" max="65535" required></label>
				<label
					>Mailbox login<input
						bind:value={user}
						placeholder="you@example.com"
						required
						autocomplete="username"
					></label
				>
				<label
					>Password or app password<input
						type="password"
						bind:value={password}
						required
						autocomplete="off"
					></label
				>
			</div>
			<p class="hint">
				Credentials stay in memory while the import runs. The connection uses verified TLS.
			</p>
			<button
				type="button"
				disabled={!host.trim() || !user.trim() || !password}
				onclick={() => scan('list')}
			>
				Connect and list folders
			</button>
			<div class="fields filters">
				<label
					>Folder
					{#if mailboxes.length}
						<select bind:value={mailbox}>
							{#each mailboxes as name}
								<option value={name}>{name}</option>
							{/each}
						</select>
					{:else}
						<input bind:value={mailbox} required>
					{/if}
				</label>
				<label
					>Preview message limit<input
						type="number"
						bind:value={maxMessages}
						min="1"
						max="100"
						required
					></label
				>
				<label>Received on or after<input type="date" bind:value={since}></label>
				<label>Received before<input type="date" bind:value={before}></label>
			</div>
			<div class="actions">
				<button class="primary" type="submit">Import whole folder · oldest first</button>
				<button
					type="button"
					disabled={!host.trim() || !user.trim() || !password}
					onclick={() => scan('scan')}
				>
					Find PDF attachments
				</button>
				<button type="button" onclick={() => scan('demo')}>Try sample emails</button>
			</div>
		</fieldset>
	</form>
	<div class="actions">
		<label
			>Process documents on<select bind:value={placement} disabled={busy}>
				<option value="local">This device</option>
				<option value="server">Server</option>
			</select></label
		>
	</div>
	<p class="hint">
		Whole-folder import includes all matching messages present when you start, oldest received
		first. Leave the dates empty for the entire folder. Every PDF gets its own Intent and ordinary
		document ingestion. You can leave Settings; keep the desktop app open until the import finishes.
	</p>
	{#if job.status}
		<div class="notice" role="status">
			<p>{job.status}</p>
			<p>
				{job.scanned}
				/ {job.total} messages read · {job.imported.length} PDFs uploaded ·
				{job.failed.length}
				uploads failed
			</p>
		</div>
		<div class="actions">
			{#if job.running && !job.paused}
				<button type="button" onclick={() => emailJob.pause()}>Pause import</button>
			{/if}
			{#if job.paused && !job.running}
				<button type="button" onclick={() => emailJob.resume()}>Resume import</button>
			{/if}
			{#if job.running || job.paused}
				<button type="button" onclick={() => emailJob.cancel()}>Stop import</button>
			{/if}
			{#if job.failed.length && !busy}
				<button type="button" onclick={() => emailJob.retryFailed()}>Retry failed PDFs</button>
			{/if}
			{#if job.imported.length}
				<a href="/dashboard">Open workspace</a>
			{/if}
		</div>
	{/if}
	{#if job.error}
		<p role="alert" class="failure">{job.error}</p>
	{/if}
	{#if job.failed.length || job.issues.length}
		<details class="failure" open>
			<summary>Import issues ({job.failed.length + job.issues.length})</summary>
			<ul>
				{#each job.failed.slice(-100) as failure}
					<li>{failure.attachment.name}: {failure.error}</li>
				{/each}
				{#each job.issues.slice(-100) as issue}
					<li>{issue}</li>
				{/each}
			</ul>
			{#if job.failed.length + job.issues.length > 100}
				<p>Showing the most recent issues. Retry failed PDFs retries all failed uploads.</p>
			{/if}
		</details>
	{/if}

	{#if status}
		<p role="status" class="notice">{status}</p>
	{/if}
	{#if error}
		<p role="alert" class="failure">{error}</p>
	{/if}
	{#if result}
		{#if result.issues.length}
			<ul class="failure">
				{#each result.issues as issue}
					<li>{issue}</li>
				{/each}
			</ul>
		{/if}
		{#if result.attachments.length}
			<div class="results-heading">
				<h3>Choose PDFs to import</h3>
				<span>{result.attachments.length} found</span>
			</div>
			<ul class="attachments">
				{#each result.attachments as attachment (attachment.id)}
					<li>
						<label class="attachment">
							<input
								type="checkbox"
								bind:group={selected}
								value={attachment.id}
								disabled={busy || imported.includes(attachment.id)}
							>
							<span
								><strong>{attachment.name}</strong
								><small>{attachment.sender || 'Unknown sender'}</small
								><small>{attachment.subject || '(No subject)'}</small
								><small
									>{Math.ceil(attachment.bytes / 1024)}
									KB ·
									{imported.includes(attachment.id) ? 'Imported' : failed.includes(attachment.id) ? 'Import failed' : attachment.source.mailbox || 'Sample email'}</small
								></span
							>
						</label>
					</li>
				{/each}
			</ul>
			<div class="actions">
				<button
					class="primary"
					type="button"
					disabled={busy || !selected.some((id) => !imported.includes(id))}
					onclick={importSelected}
				>
					Import selected PDFs
				</button>
			</div>
			<p class="hint">
				Selected PDFs are uploaded to your Aven workspace and processed using its document settings.
				Email details are kept with each Intent. Full source emails remain in this device’s private
				cache.
			</p>
		{/if}
	{/if}
</section>

<style>
.email-panel {
	display: flex;
	flex-direction: column;
	gap: 1rem;
}
h2 {
	font-size: 1.25rem;
	font-weight: 600;
	margin-bottom: 0.4rem;
}
h3,
strong {
	font-weight: 600;
}
header p,
.hint,
small {
	opacity: 0.65;
	font-size: 0.85rem;
}
fieldset {
	border: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 0.8rem;
}
fieldset:disabled {
	opacity: 0.6;
}
.fields {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 0.9rem;
}
.filters {
	margin-top: 0.5rem;
}
label {
	display: flex;
	flex-direction: column;
	gap: 0.35rem;
	font-size: 0.85rem;
}
input,
select {
	min-width: 0;
	border: 1px solid var(--color-border, #aaa);
	border-radius: 0.6rem;
	padding: 0.65rem;
	background: var(--color-surface-raised, transparent);
	color: inherit;
}
button {
	border: 1px solid var(--color-border, #aaa);
	border-radius: 0.65rem;
	padding: 0.65rem 1rem;
	font-size: 0.85rem;
}
button:disabled {
	opacity: 0.4;
	cursor: default;
}
.primary {
	background: var(--color-primary, #216352);
	color: white;
	border-color: transparent;
}
.actions {
	display: flex;
	gap: 0.75rem;
	align-items: end;
	flex-wrap: wrap;
}
.notice {
	padding: 0.8rem;
	border-radius: 0.6rem;
	background: var(--color-surface-raised, #8881);
	font-size: 0.9rem;
}
.failure {
	color: var(--color-error-ink, #a1392e);
	font-size: 0.85rem;
	overflow-wrap: anywhere;
}
.results-heading {
	display: flex;
	justify-content: space-between;
	gap: 1rem;
}
.results-heading span {
	opacity: 0.6;
	font-size: 0.85rem;
}
.attachments {
	list-style: none;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}
.attachments li {
	border: 1px solid var(--color-border, #aaa);
	border-radius: 0.7rem;
	padding: 0.8rem;
}
.attachment {
	flex-direction: row;
	gap: 0.8rem;
	align-items: start;
	cursor: pointer;
}
.attachment input {
	margin-top: 0.3rem;
}
.attachment span {
	min-width: 0;
	overflow-wrap: anywhere;
}
small {
	display: block;
	margin-top: 0.2rem;
}
@media (max-width: 600px) {
	.fields {
		grid-template-columns: 1fr;
	}
}
</style>
