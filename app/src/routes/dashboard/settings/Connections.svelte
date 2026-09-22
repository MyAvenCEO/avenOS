<script lang="ts">
import { transportError } from '@avenos/chat-engine/transport-error'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { onMount } from 'svelte'
import {
	type BindingMetadata,
	type ConnectionContext,
	ConnectionManagement,
	type ConnectionMetadata,
	type CredentialMetadata
} from '$lib/connections/management'

let manager: ConnectionManagement | undefined
let disposed = false
let data = $state<ConnectionMetadata>({ credentials: [], bindings: [] })
let ready = $state(false),
	busy = $state(false),
	pending = $state(false)
let error = $state(''),
	status = $state('')
let form = $state<'credential' | 'binding' | null>(null)
let rotation = $state<CredentialMetadata | null>(null)
let label = $state(''),
	secret = $state(''),
	kind = $state<'password' | 'token'>('password')
let credentialRef = $state(''),
	protocol = $state<'imap' | 'http'>('imap')
let host = $state(''),
	login = $state(''),
	mailbox = $state('INBOX'),
	port = $state(993)
let purpose = $state('mail-read'),
	path = $state('/'),
	header = $state('authorization'),
	prefix = $state('Bearer ')
let revoke = $state<CredentialMetadata | BindingMetadata | null>(null)
const enabledCredentials = $derived(data.credentials.filter((c) => c.enabled))

function clearForm() {
	secret = ''
	form = null
	rotation = null
	revoke = null
}
async function refresh() {
	if (!manager || disposed) return
	const value = await manager.metadata()
	if (!disposed) {
		data = value
		ready = true
	}
}
async function load() {
	if (busy || disposed) return
	busy = true
	error = ''
	try {
		await refresh()
	} catch {
		if (!disposed) error = 'Verbindungen sind in diesem Workspace noch nicht verfügbar.'
	} finally {
		if (!disposed) busy = false
	}
}
onMount(() => {
	void (async () => {
		if (!isTauri()) {
			error = 'Verbindungen werden in der Desktop-App verwaltet.'
			return
		}
		try {
			const context = await invoke<ConnectionContext>('credential_context')
			if (disposed) return
			manager = new ConnectionManagement(context, (args) =>
				invoke('credential_request', { ...args })
			)
			await load()
		} catch {
			if (!disposed) error = 'Bitte zuerst einen Workspace auswählen.'
		}
	})()
	return () => {
		disposed = true
		secret = ''
		manager?.close()
	}
})
async function write(command: Record<string, unknown>) {
	if (!manager || busy || pending || disposed) return
	busy = true
	error = ''
	status = ''
	try {
		await manager.command(command)
		if (disposed) return
		clearForm()
		status = 'Gespeichert.'
		await refresh()
	} catch (cause) {
		if (!disposed) {
			pending = Boolean(manager.pendingCommand)
			const code = transportError(cause).code
			error = pending
				? 'Speichern nicht bestätigt. Bitte den Status prüfen.'
				: code === 'CREDENTIAL_INPUT_INVALID'
					? 'Bitte Server, Zugang und erlaubten Bereich prüfen.'
					: code === 'CREDENTIAL_VERSION_CONFLICT'
						? 'Der Zugang wurde inzwischen geändert. Bitte aktualisieren.'
						: 'Verbindung konnte nicht gespeichert werden. Bitte Angaben und Berechtigung prüfen.'
		}
	} finally {
		secret = ''
		if (!disposed) busy = false
	}
}
async function check() {
	if (!manager || busy || disposed) return
	busy = true
	error = ''
	try {
		await manager.checkReceipt()
		if (disposed) return
		pending = false
		clearForm()
		status = 'Gespeichert.'
		await refresh()
	} catch {
		if (!disposed) error = 'Noch kein Speicherbeleg gefunden. Bitte später erneut prüfen.'
	} finally {
		if (!disposed) busy = false
	}
}
function saveSecret(event: SubmitEvent) {
	event.preventDefault()
	const value = secret
	secret = ''
	void write(
		rotation
			? {
					action: 'rotate',
					credentialRef: rotation.credentialRef,
					expectedVersion: rotation.secretVersion,
					value
				}
			: {
					action: 'create',
					credentialRef: crypto.randomUUID(),
					expectedVersion: 0,
					label: label.trim(),
					kind,
					value
				}
	)
}
function saveBinding(event: SubmitEvent) {
	event.preventDefault()
	const name = label.trim(),
		hostname = host.trim().toLowerCase()
	const profile =
		protocol === 'imap'
			? {
					label: name,
					host: hostname,
					port,
					tls: 'implicit',
					authentication: 'password',
					login: login.trim(),
					accountRef: crypto.randomUUID(),
					mailboxes: [mailbox.trim()],
					operations: ['query', 'read-message'],
					purpose: purpose.trim(),
					maximumCommands: 64,
					maximumBytes: 32 * 1024 * 1024,
					maximumSeconds: 60
				}
			: {
					label: name,
					host: { kind: 'exact', value: hostname },
					placements: ['server'],
					schemes: ['https'],
					ports: [port],
					pathPrefix: path,
					methods: ['GET', 'HEAD'],
					purpose: purpose.trim(),
					attachment: { kind: 'header', name: header, prefix }
				}
	void write({
		action: 'binding-set',
		credentialRef,
		bindingRef: crypto.randomUUID(),
		expectedVersion: 0,
		protocol,
		profile
	})
}
function confirmRevoke() {
	if (!revoke) return
	void write(
		'bindingRef' in revoke
			? {
					action: 'binding-revoke',
					credentialRef: revoke.credentialRef,
					bindingRef: revoke.bindingRef,
					protocol: revoke.protocol,
					expectedVersion: revoke.revision
				}
			: {
					action: 'revoke',
					credentialRef: revoke.credentialRef,
					expectedVersion: revoke.secretVersion
				}
	)
}
function destination(binding: BindingMetadata) {
	const p = binding.profile
	return `${typeof p.host === 'string' ? p.host : p.host.value}${binding.protocol === 'imap' ? ` · ${(p.mailboxes ?? []).join(', ')}` : (p.pathPrefix ?? '/')}`
}
</script>

<section class="connections" aria-label="Verbindungen" aria-busy={busy}>
	<header>
		<div>
			<h2>Verbindungen</h2>
			<p>Zugänge speichern, erlaubte Ziele festlegen.</p>
		</div>
		<button disabled={busy} onclick={() => void load()}>Aktualisieren</button>
	</header>
	{#if error}
		<p role="alert">{error}</p>
	{/if}
	{#if status}
		<p role="status">{status}</p>
	{/if}
	{#if pending}
		<button disabled={busy} onclick={() => void check()}>Speicherstatus prüfen</button>
	{/if}
	{#if ready}
		<p class="hint">
			Noch kein automatischer Abruf: Eine Verbindung erlaubt keine Nutzung ohne Freigabe.
		</p>
		<div class="actions">
			<button
				disabled={busy || pending}
				onclick={() => { clearForm(); label = ''; form = 'credential' }}
			>
				+ Zugang
			</button>
			<button
				disabled={busy || pending || !enabledCredentials.length}
				onclick={() => { clearForm(); label = ''; credentialRef = enabledCredentials[0]?.credentialRef ?? ''; form = 'binding' }}
			>
				+ Erlaubtes Ziel
			</button>
		</div>
		{#if form === 'credential'}
			<form onsubmit={saveSecret}>
				<strong>{rotation ? `Zugang erneuern · ${rotation.label}` : 'Neuer Zugang'}</strong>
				{#if !rotation}
					<label
						>Name<input
							required
							maxlength="256"
							bind:value={label}
							placeholder="z. B. Projektpostfach"
						></label
					>
					<label
						>Art<select bind:value={kind}>
							<option value="password">Passwort</option>
							<option value="token">API-Token</option>
						</select></label
					>
				{/if}
				<label
					>{(rotation?.kind ?? kind) === 'password' ? 'Passwort' : 'API-Token'}
					<input
						type="password"
						required
						maxlength="32768"
						bind:value={secret}
						autocomplete="new-password"
						spellcheck="false"
					></label
				>
				<small
					>Wird verschlüsselt gespeichert und nicht im Chat angezeigt. Später nicht einsehbar.</small
				>
				<div class="actions">
					<button type="submit" disabled={busy || pending || !secret}>Speichern</button
					><button type="button" disabled={busy} onclick={clearForm}>Abbrechen</button>
				</div>
			</form>
		{:else if form === 'binding'}
			<form onsubmit={saveBinding}>
				<strong>Erlaubtes Ziel</strong>
				<label
					>Name<input
						required
						maxlength="256"
						bind:value={label}
						placeholder="z. B. Projekt-Mails"
					></label
				>
				<label
					>Zugang<select bind:value={credentialRef}>
						{#each enabledCredentials as c (c.credentialRef)}
							<option value={c.credentialRef}>{c.label}</option>
						{/each}
					</select></label
				>
				<label
					>Verbindung<select
						bind:value={protocol}
						onchange={() => { port = protocol === 'imap' ? 993 : 443; purpose = protocol === 'imap' ? 'mail-read' : 'api-read' }}
					>
						<option value="imap">IMAP · E-Mails lesen</option>
						<option value="http">HTTPS · API lesen</option>
					</select></label
				>
				<div class="pair">
					<label
						>Server<input
							required
							maxlength="253"
							bind:value={host}
							placeholder={protocol === 'imap' ? 'imap.example.org' : 'api.example.org'}
						></label
					><label>Port<input type="number" required min="1" max="65535" bind:value={port}></label>
				</div>
				{#if protocol === 'imap'}
					<label
						>Benutzername<input
							required
							maxlength="320"
							bind:value={login}
							autocomplete="username"
						></label
					>
					<label>Ordner<input required maxlength="1024" bind:value={mailbox}></label>
					<small>Nur dieser Ordner. Nachrichten werden weder verändert noch gelöscht.</small>
				{:else}
					<label
						>Erlaubter Pfad<input
							required
							maxlength="2048"
							bind:value={path}
							placeholder="/reports/"
						></label
					>
					<div class="pair">
						<label>Token-Header<input required maxlength="128" bind:value={header}></label
						><label>Präfix<input maxlength="256" bind:value={prefix}></label>
					</div>
					<small>Nur GET/HEAD über HTTPS. Weiterleitungen benötigen eine eigene Freigabe.</small>
				{/if}
				<label>Verwendungszweck<input required maxlength="128" bind:value={purpose}></label>
				<div class="actions">
					<button type="submit" disabled={busy || pending}>Ziel speichern</button
					><button type="button" disabled={busy} onclick={clearForm}>Abbrechen</button>
				</div>
			</form>
		{/if}
		{#if revoke}
			<div class="confirmation">
				<strong>Zugang sperren?</strong>
				<p>
					Neue Zugriffe werden verhindert. Bereits übertragene Anfragen lassen sich nicht
					zurückholen.
				</p>
				<div class="actions">
					<button disabled={busy || pending} onclick={confirmRevoke}>Sperren</button
					><button disabled={busy} onclick={() => revoke = null}>Abbrechen</button>
				</div>
			</div>
		{/if}
		<h3>Erlaubte Ziele</h3>
		{#if !data.bindings.length}
			<p class="hint">Noch keine Ziele eingerichtet.</p>
		{/if}
		{#each data.bindings as b (b.bindingRef)}
			<article>
				<div>
					<strong>{b.profile.label}</strong>
					<p>{destination(b)}</p>
					<small
						>{b.protocol === 'imap' ? 'E-Mails' : 'API'}
						·
						{b.enabled && data.credentials.some(c => c.credentialRef === b.credentialRef && c.enabled) ? 'Eingerichtet' : 'Gesperrt'}</small
					>
				</div>
				<button disabled={busy || pending || !b.enabled} onclick={() => revoke = b}>Sperren</button>
			</article>
		{/each}
		<h3>Zugänge</h3>
		{#if !data.credentials.length}
			<p class="hint">Noch keine Zugänge gespeichert.</p>
		{/if}
		{#each data.credentials as c (c.credentialRef)}
			<article>
				<div>
					<strong>{c.label}</strong>
					<p>
						{c.kind === 'password' ? 'Passwort' : 'API-Token'}
						· {c.enabled ? 'Gespeichert' : 'Gesperrt'}
					</p>
				</div>
				<div class="actions">
					<button
						disabled={busy || pending || !c.enabled}
						onclick={() => { clearForm(); rotation = c; form = 'credential' }}
					>
						Erneuern
					</button><button disabled={busy || pending || !c.enabled} onclick={() => revoke = c}>
						Sperren
					</button>
				</div>
			</article>
		{/each}
	{/if}
</section>

<style>
.connections {
	display: flex;
	flex-direction: column;
	gap: 1rem;
	max-width: 44rem;
}
header,
article {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 1rem;
}
h2,
h3,
strong {
	font-weight: 600;
}
h3 {
	margin-top: 0.5rem;
}
p,
small {
	font-size: 0.85rem;
}
p {
	margin: 0.2rem 0;
}
small,
.hint {
	opacity: 0.65;
}
form,
.confirmation,
article {
	border: 1px solid var(--color-border, #ddd);
	border-radius: 1rem;
	padding: 1rem;
}
form {
	display: flex;
	flex-direction: column;
	gap: 0.8rem;
}
label {
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
	font-size: 0.85rem;
}
input,
select {
	width: 100%;
	min-width: 0;
	border: 1px solid var(--color-border, #ddd);
	border-radius: 0.6rem;
	padding: 0.55rem;
	background: transparent;
}
.pair {
	display: grid;
	grid-template-columns: minmax(0, 3fr) minmax(5rem, 1fr);
	gap: 0.75rem;
}
.actions {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
}
button {
	border: 1px solid var(--color-border, #ddd);
	border-radius: 0.7rem;
	padding: 0.4rem 0.75rem;
	font-size: 0.85rem;
}
button:disabled {
	opacity: 0.45;
}
article p {
	overflow-wrap: anywhere;
}
@media (max-width: 500px) {
	article,
	header {
		align-items: start;
		flex-direction: column;
	}
}
</style>
