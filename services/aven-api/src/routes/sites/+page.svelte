<script lang="ts">
import { appRuntime } from 'virtual:aven-app-runtime'
import type {
	SiteBinding,
	SiteBindingDraft,
	SiteDnsVerification,
	SiteRuntimeStatus
} from '@avenos/aven-hosting'
import { onMount, tick } from 'svelte'
import { goto } from '$app/navigation'

const emptyDraft = (name = ''): SiteBindingDraft => ({
	name,
	hostname: '',
	repository: '',
	sourceBranch: 'next',
	deploymentBranch: 'deploy/next'
})

const statusLabels: Record<SiteRuntimeStatus, string> = {
	awaiting_dns: 'DNS ausstehend',
	syncing: 'Wird veröffentlicht',
	active: 'Aktiv',
	dns_invalid: 'DNS prüfen',
	failed: 'Fehlgeschlagen'
}

let names = $state<string[]>([])
let sites = $state<SiteBinding[]>([])
let draft = $state<SiteBindingDraft>(emptyDraft())
let editingId = $state<string | null>(null)
let verification = $state<SiteDnsVerification | null>(null)
let loading = $state(true)
let sitesLoaded = $state(false)
let refreshing = $state(false)
let saving = $state(false)
let removingId = $state<string | null>(null)
let confirmingRemoveId = $state<string | null>(null)
let error = $state('')
let copied = $state('')
let hostnameInput = $state<HTMLInputElement>()

const shortRevision = (revision: string | null) => revision?.slice(0, 10) ?? '–'
const timestamp = new Intl.DateTimeFormat('de-DE', {
	dateStyle: 'medium',
	timeStyle: 'short'
})
const lastPublished = (site: SiteBinding) =>
	site.lastSyncedAt ? `Veröffentlicht ${timestamp.format(new Date(site.lastSyncedAt))}` : null
const commitUrl = (site: SiteBinding, revision: string | null) =>
	revision ? `https://github.com/${site.repository}/commit/${revision}` : null

async function loadSites() {
	sites = await appRuntime.sites.list()
	sitesLoaded = true
}

async function refreshSites() {
	if (refreshing || loading) return
	refreshing = true
	error = ''
	try {
		await loadSites()
	} catch (cause) {
		error = cause instanceof Error ? cause.message : 'Websites konnten nicht aktualisiert werden.'
	} finally {
		refreshing = false
	}
}

onMount(async () => {
	try {
		const access = await appRuntime.dashboard.load(new URL(window.location.href))
		if (access.needsPasskey) {
			void goto('/passkey/create')
			return
		}
		;[names, sites] = await Promise.all([appRuntime.names.mine(), appRuntime.sites.list()])
		sitesLoaded = true
		draft = emptyDraft(names[0] ?? '')
	} catch (cause) {
		error = cause instanceof Error ? cause.message : 'Websites konnten nicht geladen werden.'
	} finally {
		loading = false
	}
})

function edit(site: SiteBinding) {
	editingId = site.id
	confirmingRemoveId = null
	verification = null
	error = ''
	draft = {
		name: site.name,
		hostname: site.hostname,
		repository: site.repository,
		sourceBranch: site.sourceBranch,
		deploymentBranch: site.deploymentBranch
	}
	void tick().then(() => {
		hostnameInput?.focus({ preventScroll: true })
		window.scrollTo({ top: 0, behavior: 'smooth' })
	})
}

function reset() {
	editingId = null
	confirmingRemoveId = null
	verification = null
	error = ''
	draft = emptyDraft(names[0] ?? '')
}

async function save(event: SubmitEvent) {
	event.preventDefault()
	saving = true
	error = ''
	verification = null
	try {
		const result = editingId
			? await appRuntime.sites.update(editingId, draft)
			: await appRuntime.sites.create(draft)
		verification = result.dns
		editingId = null
		draft = emptyDraft(names[0] ?? '')
		await loadSites()
	} catch (cause) {
		error = cause instanceof Error ? cause.message : 'Website konnte nicht gespeichert werden.'
	} finally {
		saving = false
	}
}

async function remove(site: SiteBinding) {
	removingId = site.id
	error = ''
	try {
		await appRuntime.sites.remove(site.id)
		if (editingId === site.id) reset()
		await loadSites()
	} catch (cause) {
		error = cause instanceof Error ? cause.message : 'Website konnte nicht entfernt werden.'
	} finally {
		removingId = null
		confirmingRemoveId = null
	}
}

async function copy(value: string, key: string) {
	try {
		await navigator.clipboard.writeText(value)
		copied = key
		setTimeout(() => {
			if (copied === key) copied = ''
		}, 1500)
	} catch {
		error = 'Der Eintrag konnte nicht in die Zwischenablage kopiert werden.'
	}
}
</script>

<svelte:head><title>Websites · avenCEO</title></svelte:head>

<section class="hosting-shell">
	<header class="hosting-intro">
		<div>
			<p class="eyebrow">Static Hosting</p>
			<h1>Deine Websites</h1>
		</div>
		<p>
			Verbinde öffentliche GitHub-Repositories mit eigenen Domains. Ein Aven-Name kann mehrere
			Websites tragen — jede Website braucht eine eigene Domain oder Subdomain.
		</p>
	</header>

	{#if error}
		<div class="alert" role="alert">{error}</div>
	{/if}

	{#if verification}
		{@const dns = verification}
		<section class="dns-card" aria-live="polite" aria-labelledby="dns-heading">
			<div>
				<p class="eyebrow">Jetzt im DNS eintragen</p>
				<h2 id="dns-heading">{dns.hostname}</h2>
				<p class="fine">Der TXT-Wert wird nur jetzt vollständig angezeigt.</p>
			</div>
			<div class="dns-record">
				<span>TXT</span>
				<code title={dns.txtName}>{dns.txtName}</code>
				<code title={dns.txtValue}>{dns.txtValue}</code>
				<button
					type="button"
					class="ghost compact"
					onclick={() => copy(`${dns.txtName}\tTXT\t${dns.txtValue}`, 'txt')}
				>
					{copied === 'txt' ? 'Kopiert' : 'Eintrag kopieren'}
				</button>
			</div>
			{#if dns.ipv4}
				<div class="dns-record">
					<span>A</span>
					<code title={dns.hostname}>{dns.hostname}</code>
					<code title={dns.ipv4}>{dns.ipv4}</code>
					<button
						type="button"
						class="ghost compact"
						onclick={() => copy(`${dns.hostname}\tA\t${dns.ipv4}`, 'ipv4')}
					>
						{copied === 'ipv4' ? 'Kopiert' : 'Eintrag kopieren'}
					</button>
				</div>
			{/if}
			{#each dns.ipv6 as address (address)}
				<div class="dns-record">
					<span>AAAA</span>
					<code title={dns.hostname}>{dns.hostname}</code>
					<code title={address}>{address}</code>
					<button
						type="button"
						class="ghost compact"
						onclick={() => copy(`${dns.hostname}\tAAAA\t${address}`, `ipv6-${address}`)}
					>
						{copied === `ipv6-${address}` ? 'Kopiert' : 'Eintrag kopieren'}
					</button>
				</div>
			{/each}
			<p class="fine">
				Nach der DNS-Änderung prüft Aven die Domain automatisch und veröffentlicht die Website.
			</p>
		</section>
	{/if}

	<div class="hosting-grid">
		<section class="hosting-card editor" aria-labelledby="site-editor-heading">
			<div>
				<p class="eyebrow">{editingId ? 'Verbindung bearbeiten' : 'Website hinzufügen'}</p>
				<h2 id="site-editor-heading">{editingId ? draft.hostname : 'Neue Verbindung'}</h2>
			</div>

			{#if loading}
				<p class="fine">Wird geladen …</p>
			{:else if !names.length}
				<div class="alert">Für Static Hosting brauchst du zuerst einen gekauften Aven-Namen.</div>
			{:else}
				<form onsubmit={save} aria-busy={saving}>
					<label>
						Aven-Name
						<select bind:value={draft.name}>
							{#each names as name (name)}
								<option value={name}>{name}</option>
							{/each}
						</select>
					</label>
					<label>
						Domain oder Subdomain
						<input
							bind:this={hostnameInput}
							bind:value={draft.hostname}
							placeholder="www.deine-domain.de"
							required
							autocomplete="off"
							autocapitalize="none"
							inputmode="url"
							spellcheck="false"
						>
					</label>
					<label>
						Öffentliches GitHub-Repository
						<input
							bind:value={draft.repository}
							placeholder="organisation/repository"
							required
							autocomplete="off"
							autocapitalize="none"
							spellcheck="false"
						>
					</label>
					<div class="branch-fields">
						<label>
							Quell-Branch
							<input
								bind:value={draft.sourceBranch}
								placeholder="next"
								required
								autocomplete="off"
								autocapitalize="none"
								spellcheck="false"
							>
						</label>
						<label>
							Deployment-Branch
							<input
								bind:value={draft.deploymentBranch}
								placeholder="deploy/next"
								required
								autocomplete="off"
								autocapitalize="none"
								aria-describedby="deployment-contract"
								spellcheck="false"
							>
						</label>
					</div>
					<p class="fine" id="deployment-contract">
						Der Deployment-Branch muss <code>dist/index.html</code> und eine passende
						<code>dist/.source-revision</code>
						enthalten.
					</p>
					<div class="actions">
						{#if editingId}
							<button type="button" class="ghost" onclick={reset}>Abbrechen</button>
						{/if}
						<button disabled={saving}>
							{saving ? 'Wird gespeichert …' : editingId ? 'Änderung speichern' : 'Website verbinden'}
						</button>
					</div>
				</form>
			{/if}
		</section>

		<section
			class="site-list"
			aria-busy={loading || refreshing}
			aria-labelledby="site-list-heading"
		>
			<div class="site-list-heading">
				<div>
					<p class="eyebrow">Verbindungen</p>
					<h2 id="site-list-heading">
						{sites.length} {sites.length === 1 ? 'Website' : 'Websites'}
					</h2>
				</div>
				<button
					type="button"
					class="ghost compact"
					onclick={refreshSites}
					disabled={loading || refreshing}
				>
					{refreshing ? 'Wird aktualisiert …' : 'Aktualisieren'}
				</button>
			</div>

			{#if loading}
				<div class="empty-site loading-site" aria-live="polite">Websites werden geladen …</div>
			{:else if sitesLoaded && !sites.length}
				<div class="empty-site">
					<strong>Noch keine Website verbunden</strong>
					<p>Fülle das Formular aus. Anschließend erhältst du die passenden DNS-Einträge.</p>
				</div>
			{/if}
			{#each sites as site (site.id)}
				<article class="site-card">
					<header>
						<div>
							<a
								href={`https://${site.hostname}`}
								target="_blank"
								rel="noopener noreferrer"
								aria-label={`${site.hostname} in einem neuen Tab öffnen`}
								>{site.hostname}</a
							>
							<p>
								{site.name}
								·
								<a
									href={`https://github.com/${site.repository}`}
									target="_blank"
									rel="noopener noreferrer"
									aria-label={`${site.repository} auf GitHub öffnen`}
									>{site.repository}</a
								>
							</p>
						</div>
						<span
							class:active={site.status === 'active'}
							class:error-state={site.status === 'failed' || site.status === 'dns_invalid'}
							class="site-status"
						>
							{statusLabels[site.status]}
						</span>
					</header>
					<dl>
						<div>
							<dt>Quelle</dt>
							<dd>
								{site.sourceBranch}
								·
								{#if commitUrl(site, site.activeSourceRevision)}
									<a
										href={commitUrl(site, site.activeSourceRevision) ?? undefined}
										target="_blank"
										rel="noopener noreferrer"
										>{shortRevision(site.activeSourceRevision)}</a
									>
								{:else}
									{shortRevision(site.activeSourceRevision)}
								{/if}
							</dd>
						</div>
						<div>
							<dt>Deployment</dt>
							<dd>
								{site.deploymentBranch}
								·
								{#if commitUrl(site, site.activeArtifactRevision)}
									<a
										href={commitUrl(site, site.activeArtifactRevision) ?? undefined}
										target="_blank"
										rel="noopener noreferrer"
										>{shortRevision(site.activeArtifactRevision)}</a
									>
								{:else}
									{shortRevision(site.activeArtifactRevision)}
								{/if}
							</dd>
						</div>
					</dl>
					{#if lastPublished(site)}
						<p class="site-timestamp">{lastPublished(site)}</p>
					{/if}
					{#if site.lastError}
						<div class="site-error" role="status">{site.lastError}</div>
					{/if}
					<footer>
						{#if confirmingRemoveId === site.id}
							<p class="remove-confirmation" role="alert">Diese Verbindung entfernen?</p>
							<div class="site-actions">
								<button
									type="button"
									class="ghost compact"
									disabled={removingId === site.id}
									onclick={() => (confirmingRemoveId = null)}
								>
									Abbrechen
								</button>
								<button
									type="button"
									class="ghost compact danger"
									disabled={removingId === site.id}
									onclick={() => remove(site)}
								>
									{removingId === site.id ? 'Wird entfernt …' : 'Jetzt entfernen'}
								</button>
							</div>
						{:else}
							<button type="button" class="ghost compact" onclick={() => edit(site)}>
								Bearbeiten
							</button>
							<button
								type="button"
								class="ghost compact danger"
								onclick={() => (confirmingRemoveId = site.id)}
							>
								Entfernen
							</button>
						{/if}
					</footer>
				</article>
			{/each}
		</section>
	</div>
</section>
