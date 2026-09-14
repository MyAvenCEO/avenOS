<script lang="ts">
import { invoke, isTauri } from '@tauri-apps/api/core'
import { onDestroy } from 'svelte'
import { emailDocumentProcessing } from '$lib/artifacts/document-import-queue.svelte'
import type { EmailRequest, EmailResult } from '$lib/artifacts/email-job'
import { emailJob, emailJobState as job } from '$lib/artifacts/email-job.svelte'
import { documentExecutionPreference } from '$lib/artifacts/ingest.svelte'
import { transportError } from '$lib/artifacts/transport-error'

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

const numbers = new Intl.NumberFormat()
let progressMax = $derived(job.total || job.selectedTotal)
let progressValue = $derived(
	job.phase === 'indexing'
		? job.indexed
		: job.total
			? job.scanned
			: job.imported.length + job.failed.length
)
let progressLabel = $derived(
	job.phase === 'indexing' ? 'Messages ordered' : job.total ? 'Messages read' : 'PDFs checked'
)
let jobTitle = $derived(
	job.paused
		? 'Import paused'
		: job.phase === 'stopped'
			? 'Import stopped'
			: job.running
				? job.phase === 'indexing'
					? 'Preparing your mailbox'
					: 'Import in progress'
				: job.failed.length || job.issues.length
					? 'Finished with issues'
					: 'Uploads complete'
)
let selectable = $derived(
	result?.attachments.filter((a) => !imported.includes(a.id)).map((a) => a.id) ?? []
)
let selectedCount = $derived(selected.filter((id) => selectable.includes(id)).length)

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
	<header class="intro">
		<div class="mail-mark" aria-hidden="true">
			<svg
				width="25"
				height="25"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
			>
				<rect x="3" y="5" width="18" height="14" rx="3" />
				<path d="m4 7 8 6 8-6" />
			</svg>
		</div>
		<div>
			<h2>Email attachments</h2>
			<p>Bring the PDFs in your mailbox into your workspace, one Intent at a time.</p>
		</div>
	</header>
	{#if !isTauri()}
		<p class="notice">Open the desktop app to connect an IMAP mailbox.</p>
	{/if}

	{#if job.status}
		<section
			class="job-card"
			aria-label="Email import progress"
			class:needs-attention={job.paused || job.failed.length > 0}
		>
			<div class="card-heading">
				<div>
					<span class="eyebrow">MAILBOX IMPORT</span>
					<h3>{jobTitle}</h3>
					<p class="hint">{job.label} · {job.placement === 'local' ? 'This device' : 'Server'}</p>
				</div>
				<span class="badge" class:active={job.running && !job.paused}
					>{job.running ? 'Working' : job.paused ? 'Paused' : job.phase === 'stopped' ? 'Stopped' : 'Finished'}</span
				>
			</div>
			{#if progressMax > 0}
				<div class="progress-caption">
					<span>{progressLabel}</span
					><span>{numbers.format(progressValue)} / {numbers.format(progressMax)}</span>
				</div>
				<progress value={progressValue} max={progressMax} aria-label={progressLabel}></progress>
			{/if}
			<p class="job-status" role="status">{job.status}</p>
			{#if emailDocumentProcessing.active || emailDocumentProcessing.pending}
				<p class="processing-status">
					Document processing continues separately · {emailDocumentProcessing.active} active ·
					{numbers.format(emailDocumentProcessing.pending)}
					queued
				</p>
			{/if}
			<div class="metrics">
				<div><strong>{numbers.format(job.imported.length)}</strong><span>PDFs uploaded</span></div>
				<div><strong>{numbers.format(job.failed.length)}</strong><span>Uploads to retry</span></div>
				<div><strong>{numbers.format(job.issues.length)}</strong><span>Mailbox issues</span></div>
			</div>
			<div class="actions">
				{#if job.running && !job.paused && job.phase !== 'stopped'}
					<button type="button" onclick={() => emailJob.pause()}>Pause import</button>
				{/if}
				{#if job.paused && !job.running}
					<button class="primary" type="button" onclick={() => emailJob.resume()}>
						Resume import
					</button>
				{/if}
				{#if job.running || job.paused}
					<button
						class="quiet"
						type="button"
						disabled={job.phase === 'stopped'}
						onclick={() => emailJob.cancel()}
					>
						Stop import
					</button>
				{/if}
				{#if job.failed.length && !busy}
					<button type="button" onclick={() => emailJob.retryFailed()}>Retry failed PDFs</button>
				{/if}
				{#if job.imported.length}
					<a class="workspace-link" href="/dashboard"
						>Open workspace <span aria-hidden="true">↗</span></a
					>
				{/if}
			</div>
			{#if job.error}
				<p class="failure" role="alert">{transportError(job.error).message}</p>
			{/if}
			{#if job.failed.length || job.issues.length}
				<details class="issues">
					<summary>
						Review {numbers.format(job.failed.length + job.issues.length)} import issues
					</summary>
					<ul>
						{#each job.failed.slice(-100) as failure}
							<li>
								<strong>{failure.attachment.name}</strong>
								<p>{transportError(failure.error).message}</p>
								<details class="technical">
									<summary>Technical details</summary>
									<code>{failure.error}</code>
								</details>
							</li>
						{/each}
						{#each job.issues.slice(-100) as issue}
							<li>{issue}</li>
						{/each}
					</ul>
					{#if job.failed.length + job.issues.length > 100}
						<p class="hint">Showing recent issues. Retry failed PDFs retries all failed uploads.</p>
					{/if}
				</details>
			{/if}
			{#if job.running || job.paused || emailDocumentProcessing.active || emailDocumentProcessing.pending}
				<p class="hint">
					You can leave Settings. Keep the desktop app open while uploads or document processing are
					pending.
				</p>
			{/if}
		</section>
	{/if}

	<form onsubmit={(event) => { event.preventDefault(); importMailbox() }}>
		<fieldset class="card" disabled={busy || !isTauri()}>
			<legend><span class="step">1</span> Mailbox connection</legend>
			<div class="fields host-fields">
				<label
					>IMAP hostname<input
						bind:value={host}
						placeholder="imap.example.com"
						required
						autocomplete="off"
					></label
				>
				<label>Port<input type="number" bind:value={port} min="1" max="65535" required></label>
			</div>
			<div class="fields">
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
			<div class="connection-footer">
				<button
					type="button"
					disabled={!host.trim() || !user.trim() || !password}
					onclick={() => scan('list')}
				>
					Connect and list folders
				</button><span class="hint">Verified TLS · Password never saved</span>
			</div>
		</fieldset>

		<fieldset class="card" disabled={busy || !isTauri()}>
			<legend><span class="step">2</span> Import preferences</legend>
			<div class="fields">
				<label
					>Folder
					{#if mailboxes.length}
						<select aria-label="Folder" bind:value={mailbox}>
							{#each mailboxes as name}
								<option value={name}>{name}</option>
							{/each}
						</select>
					{:else}
						<input aria-label="Folder" bind:value={mailbox} required>
					{/if}</label
				>
				<label
					>Process documents on<select bind:value={placement}>
						<option value="local">This device</option>
						<option value="server">Server</option>
					</select></label
				>
			</div>
			<div class="import-note">
				<strong>Oldest first, newest last</strong>
				<p>
					Each PDF becomes an Intent. Downloads and uploads continue while documents process
					separately. Your emails stay unread and are never moved or deleted.
				</p>
			</div>
			<details class="advanced">
				<summary>Date range and preview</summary>
				<p class="hint">
					Leave dates empty for the entire folder. The preview limit only applies to Find PDF
					attachments.
				</p>
				<div class="fields">
					<label>Received on or after<input type="date" bind:value={since}></label
					><label>Received before<input type="date" bind:value={before}></label>
				</div>
				<div class="preview-actions">
					<label
						>Preview message limit<input
							type="number"
							bind:value={maxMessages}
							min="1"
							max="100"
							required
						></label
					><button
						type="button"
						disabled={!host.trim() || !user.trim() || !password}
						onclick={() => scan('scan')}
					>
						Find PDF attachments
					</button>
				</div>
			</details>
			<div class="actions import-actions">
				<button class="primary" type="submit">
					Import whole folder · oldest first <span aria-hidden="true">→</span>
				</button><button class="quiet" type="button" onclick={() => scan('demo')}>
					Try sample emails
				</button>
			</div>
			<p class="hint">
				Runs in the background while the app is open. Mail arriving after you start is included in
				your next import.
			</p>
		</fieldset>
	</form>
	{#if status}
		<p role="status" class="notice">{status}</p>
	{/if}
	{#if error}
		<p role="alert" class="failure">{transportError(error).message}</p>
	{/if}
	{#if result}
		{#if result.issues.length}
			<details class="issues">
				<summary>Preview issues ({result.issues.length})</summary>
				<ul>
					{#each result.issues as issue}
						<li>{issue}</li>
					{/each}
				</ul>
			</details>
		{/if}
		{#if result.attachments.length}
			<section class="card preview-card" aria-label="PDF preview">
				<div class="card-heading">
					<div>
						<span class="eyebrow">PREVIEW</span>
						<h3>Choose PDFs to import</h3>
					</div>
					<span class="badge">{selectedCount} selected</span>
				</div>
				<div class="selection-actions">
					<button
						class="quiet"
						type="button"
						disabled={busy || !selectable.length}
						onclick={() => { selected = [...selectable] }}
					>
						Select all
					</button><button
						class="quiet"
						type="button"
						disabled={busy || !selectedCount}
						onclick={() => { selected = [] }}
					>
						Clear selection
					</button>
				</div>
				<ul class="attachments">
					{#each result.attachments as attachment (attachment.id)}
						<li>
							<label class="attachment"
								><input
									type="checkbox"
									bind:group={selected}
									value={attachment.id}
									disabled={busy || imported.includes(attachment.id)}
								><span class="file-icon" aria-hidden="true">PDF</span
								><span class="file-info"
									><strong>{attachment.name}</strong
									><small>{attachment.subject || '(No subject)'}</small
									><small>{attachment.sender || 'Unknown sender'}</small
									><small
										>{Math.ceil(attachment.bytes / 1024)}
										KB ·
										{imported.includes(attachment.id) ? 'Imported' : failed.includes(attachment.id) ? 'Import failed' : attachment.source.mailbox || 'Sample email'}</small
									></span
								></label
							>
						</li>
					{/each}
				</ul>
				<div class="actions">
					<button
						class="primary"
						type="button"
						disabled={busy || !selectedCount}
						onclick={importSelected}
					>
						Import selected PDFs
					</button><span class="hint"
						>Processing on {placement === 'local' ? 'this device' : 'the server'}</span
					>
				</div>
				<p class="hint">
					Email details stay with each Intent. Full source emails remain in this device’s private
					cache.
				</p>
			</section>
		{:else}
			<div class="empty-state">
				<strong>No PDFs found in this preview</strong>
				<p>Try more messages, a different folder, or a wider date range.</p>
			</div>
		{/if}
	{/if}
</section>

<style>
.email-panel {
	display: flex;
	flex-direction: column;
	gap: 1.25rem;
	max-width: 800px;
}
.intro {
	display: flex;
	align-items: center;
	gap: 1rem;
	padding-bottom: 0.4rem;
}
.mail-mark {
	display: grid;
	place-items: center;
	flex-shrink: 0;
	width: 3.3rem;
	height: 3.3rem;
	border: 1px solid var(--color-border);
	border-radius: 1rem;
	background: var(--color-surface-raised);
}
h2 {
	font-size: 1.4rem;
	font-weight: 600;
	letter-spacing: -0.02em;
	margin: 0 0 0.3rem;
}
h3 {
	font-size: 1.05rem;
	font-weight: 600;
	margin: 0.15rem 0;
}
p {
	margin: 0;
}
.intro p,
.hint,
small {
	color: var(--color-foreground-quiet);
	font-size: 0.8rem;
	line-height: 1.6;
}
form {
	display: flex;
	flex-direction: column;
	gap: 1.4rem;
}
.card,
.job-card {
	min-width: 0;
	padding: 1.3rem;
	border: 1px solid var(--color-border);
	border-radius: 1rem;
	background: var(--color-surface-raised);
}
fieldset {
	margin: 0;
	display: flex;
	flex-direction: column;
	gap: 1rem;
}
fieldset:disabled {
	opacity: 0.65;
}
legend {
	font-size: 0.9rem;
	font-weight: 600;
	padding: 0 0.45rem;
	margin-left: -0.45rem;
}
.step {
	display: inline-grid;
	place-items: center;
	width: 1.5rem;
	height: 1.5rem;
	border: 1px solid var(--color-border);
	border-radius: 50%;
	font-size: 0.7rem;
	margin-right: 0.3rem;
	background: var(--color-surface-page);
}
.fields {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
	gap: 1rem;
}
.host-fields {
	grid-template-columns: minmax(0, 3fr) minmax(5rem, 1fr);
}
label {
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
	min-width: 0;
	font-size: 0.8rem;
}
input,
select {
	width: 100%;
	min-width: 0;
	border: 1px solid var(--color-border);
	border-radius: 0.55rem;
	padding: 0.65rem 0.75rem;
	background: var(--color-surface-page);
	color: inherit;
}
input:focus-visible,
select:focus-visible,
button:focus-visible,
summary:focus-visible,
a:focus-visible {
	outline: 2px solid var(--color-primary);
	outline-offset: 3px;
}
button {
	border: 1px solid var(--color-border);
	border-radius: 0.55rem;
	padding: 0.6rem 0.85rem;
	font-size: 0.8rem;
	cursor: pointer;
	transition: background 0.15s;
}
button:hover:not(:disabled) {
	background: var(--color-surface-sunken);
}
button:disabled {
	opacity: 0.45;
	cursor: default;
}
button.primary {
	background: var(--color-primary);
	color: var(--color-primary-foreground);
	border-color: var(--color-primary);
}
button.primary:hover:not(:disabled) {
	filter: brightness(1.12);
}
button.quiet {
	border-color: transparent;
	background: transparent;
}
.actions,
.connection-footer,
.preview-actions {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 0.7rem;
}
.connection-footer {
	justify-content: space-between;
}
.import-actions {
	padding-top: 0.2rem;
}
.import-note {
	border-left: 2px solid var(--color-border-strong, var(--color-border));
	padding-left: 0.8rem;
	font-size: 0.8rem;
}
.import-note strong {
	font-weight: 600;
}
.import-note p {
	margin-top: 0.25rem;
	color: var(--color-foreground-quiet);
	line-height: 1.6;
}
summary {
	cursor: pointer;
	font-size: 0.8rem;
	font-weight: 500;
}
.advanced {
	border-top: 1px solid var(--color-border);
	padding-top: 0.8rem;
}
.advanced[open] > * + * {
	margin-top: 0.8rem;
}
.preview-actions {
	align-items: end;
}
.preview-actions label {
	max-width: 11rem;
}
.notice,
.empty-state {
	padding: 1rem;
	border-radius: 0.7rem;
	background: var(--color-surface-sunken);
	font-size: 0.85rem;
}
.failure {
	color: var(--color-error-ink, #a1392e);
	font-size: 0.85rem;
	overflow-wrap: anywhere;
}
.job-card {
	display: flex;
	flex-direction: column;
	gap: 1rem;
	border-color: color-mix(in srgb, var(--color-primary) 35%, var(--color-border));
}
.job-card.needs-attention {
	border-color: var(--color-error-ink, #a1392e);
}
.card-heading {
	display: flex;
	align-items: start;
	justify-content: space-between;
	gap: 1rem;
}
.card-heading > div {
	min-width: 0;
	overflow-wrap: anywhere;
}
.eyebrow {
	font-size: 0.6rem;
	letter-spacing: 0.13em;
	color: var(--color-foreground-quiet);
}
.badge {
	white-space: nowrap;
	border-radius: 2rem;
	padding: 0.25rem 0.6rem;
	font-size: 0.7rem;
	background: var(--color-surface-sunken);
	border: 1px solid var(--color-border);
}
.badge.active::before {
	content: "";
	display: inline-block;
	width: 0.4rem;
	height: 0.4rem;
	border-radius: 50%;
	margin-right: 0.4rem;
	background: currentColor;
}
.progress-caption {
	display: flex;
	justify-content: space-between;
	gap: 0.5rem;
	font-size: 0.75rem;
	margin-bottom: -0.65rem;
}
progress {
	width: 100%;
	height: 0.4rem;
	border: 0;
	border-radius: 1rem;
	overflow: hidden;
	accent-color: var(--color-primary);
}
progress::-webkit-progress-bar {
	background: var(--color-surface-sunken);
}
progress::-webkit-progress-value {
	background: var(--color-primary);
	border-radius: 1rem;
}
progress::-moz-progress-bar {
	background: var(--color-primary);
}
.processing-status {
	font-size: 0.75rem;
	color: var(--color-foreground-quiet);
}
.job-status {
	font-size: 0.8rem;
	line-height: 1.5;
	overflow-wrap: anywhere;
}
.metrics {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	padding: 1rem 0;
	border-block: 1px solid var(--color-border);
}
.metrics > div {
	display: flex;
	flex-direction: column;
	gap: 0.2rem;
}
.metrics strong {
	font-size: 1.35rem;
	font-weight: 500;
	font-variant-numeric: tabular-nums;
}
.metrics span {
	color: var(--color-foreground-quiet);
	font-size: 0.7rem;
}
.workspace-link {
	font-size: 0.8rem;
	margin-left: auto;
	text-decoration: none;
}
.workspace-link:hover {
	text-decoration: underline;
}
.issues {
	border-top: 1px solid var(--color-border);
	padding-top: 0.8rem;
	overflow-wrap: anywhere;
}
.issues ul {
	padding: 0;
	list-style: none;
	margin-top: 0.8rem;
}
.issues li {
	padding: 0.75rem 0;
	font-size: 0.8rem;
	border-bottom: 1px solid var(--color-border);
}
.issues li p {
	margin-top: 0.35rem;
	color: var(--color-error-ink, #a1392e);
}
.technical {
	margin-top: 0.5rem;
}
.technical summary {
	color: var(--color-foreground-quiet);
	font-size: 0.7rem;
}
.technical code {
	display: block;
	margin-top: 0.5rem;
	font-size: 0.7rem;
	white-space: pre-wrap;
}
.preview-card {
	display: flex;
	flex-direction: column;
	gap: 1rem;
}
.selection-actions {
	display: flex;
	gap: 0.3rem;
}
.selection-actions button {
	padding: 0.2rem 0.35rem;
	font-size: 0.75rem;
}
.attachments {
	list-style: none;
	padding: 0;
	max-height: 26rem;
	overflow-y: auto;
	scrollbar-gutter: stable;
}
.attachments li {
	border-top: 1px solid var(--color-border);
	padding: 0.9rem 0;
}
.attachment {
	flex-direction: row;
	gap: 0.75rem;
	align-items: start;
	cursor: pointer;
}
.attachment input {
	margin-top: 0.3rem;
	width: 1rem;
	height: 1rem;
	flex-shrink: 0;
	accent-color: var(--color-primary);
}
.file-icon {
	display: grid;
	place-items: center;
	flex-shrink: 0;
	width: 2.3rem;
	height: 2.8rem;
	border: 1px solid var(--color-border);
	border-radius: 0.4rem;
	background: var(--color-surface-page);
	font-size: 0.55rem;
	font-weight: 600;
}
.file-info {
	min-width: 0;
	overflow-wrap: anywhere;
}
.file-info strong {
	font-size: 0.8rem;
	font-weight: 600;
}
small {
	display: block;
	font-size: 0.7rem;
}
.empty-state p {
	margin-top: 0.4rem;
	color: var(--color-foreground-quiet);
}
@media (max-width: 650px) {
	.fields {
		grid-template-columns: minmax(0, 1fr);
	}
	.host-fields {
		grid-template-columns: minmax(0, 3fr) minmax(5rem, 1fr);
	}
	.card,
	.job-card {
		padding: 1rem;
	}
	.workspace-link {
		margin-left: 0;
	}
}
@media (prefers-reduced-motion: reduce) {
	button {
		transition: none;
	}
}
</style>
