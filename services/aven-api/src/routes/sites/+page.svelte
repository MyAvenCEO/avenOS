<script lang="ts">
import { appRuntime } from 'virtual:aven-app-runtime'
import type {
	SiteBinding,
	SiteBindingDraft,
	SiteDnsVerification,
	SiteRuntimeStatus
} from '@avenos/aven-hosting'
import { onMount } from 'svelte'
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
let saving = $state(false)
let removingId = $state<string | null>(null)
let error = $state('')
let copied = $state('')

const shortRevision = (revision: string | null) => revision?.slice(0, 10) ?? '–'

async function loadSites() {
	sites = await appRuntime.sites.list()
}

onMount(async () => {
	try {
		const access = await appRuntime.dashboard.load(new URL(window.location.href))
		if (access.needsPasskey) {
			void goto('/passkey/create')
			return
		}
		;[names, sites] = await Promise.all([appRuntime.names.mine(), appRuntime.sites.list()])
		draft = emptyDraft(names[0] ?? '')
	} catch (cause) {
		error = cause instanceof Error ? cause.message : 'Websites konnten nicht geladen werden.'
	} finally {
		loading = false
	}
})

function edit(site: SiteBinding) {
	editingId = site.id
	verification = null
	error = ''
	draft = {
		name: site.name,
		hostname: site.hostname,
		repository: site.repository,
		sourceBranch: site.sourceBranch,
		deploymentBranch: site.deploymentBranch
	}
	window.scrollTo({ top: 0, behavior: 'smooth' })
}

function reset() {
	editingId = null
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
	if (!window.confirm(`${site.hostname} wirklich entfernen?`)) return
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
	}
}

async function copy(value: string, key: string) {
	await navigator.clipboard.writeText(value)
	copied = key
	setTimeout(() => {
		if (copied === key) copied = ''
	}, 1500)
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
		<div class="alert">{error}</div>
	{/if}

	{#if verification}
		{@const dns = verification}
		<section class="dns-card" aria-live="polite">
			<div>
				<p class="eyebrow">Jetzt im DNS eintragen</p>
				<h2>{dns.hostname}</h2>
				<p class="fine">Der TXT-Wert wird nur jetzt vollständig angezeigt.</p>
			</div>
			<div class="dns-record">
				<span>TXT</span>
				<code>{dns.txtName}</code>
				<code>{dns.txtValue}</code>
				<button class="ghost compact" onclick={() => copy(dns.txtValue, 'txt')}>
					{copied === 'txt' ? 'Kopiert' : 'Wert kopieren'}
				</button>
			</div>
			{#if dns.ipv4}
				<div class="dns-record">
					<span>A</span>
					<code>{dns.hostname}</code>
					<code>{dns.ipv4}</code>
					<button class="ghost compact" onclick={() => copy(dns.ipv4 ?? '', 'ipv4')}>
						{copied === 'ipv4' ? 'Kopiert' : 'IP kopieren'}
					</button>
				</div>
			{/if}
			{#each dns.ipv6 as address (address)}
				<div class="dns-record">
					<span>AAAA</span><code>{dns.hostname}</code><code>{address}</code>
				</div>
			{/each}
			<p class="fine">
				Nach der DNS-Änderung prüft Aven die Domain automatisch und veröffentlicht die Website.
			</p>
		</section>
	{/if}

	<div class="hosting-grid">
		<section class="hosting-card editor">
			<div>
				<p class="eyebrow">{editingId ? 'Verbindung bearbeiten' : 'Website hinzufügen'}</p>
				<h2>{editingId ? draft.hostname : 'Neue Verbindung'}</h2>
			</div>

			{#if loading}
				<p class="fine">Wird geladen …</p>
			{:else if !names.length}
				<div class="alert">Für Static Hosting brauchst du zuerst einen gekauften Aven-Namen.</div>
			{:else}
				<form onsubmit={save}>
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
							bind:value={draft.hostname}
							placeholder="www.deine-domain.de"
							required
							autocomplete="off"
						>
					</label>
					<label>
						Öffentliches GitHub-Repository
						<input
							bind:value={draft.repository}
							placeholder="organisation/repository"
							required
							autocomplete="off"
						>
					</label>
					<div class="branch-fields">
						<label>
							Quell-Branch
							<input bind:value={draft.sourceBranch} placeholder="next" required autocomplete="off">
						</label>
						<label>
							Deployment-Branch
							<input
								bind:value={draft.deploymentBranch}
								placeholder="deploy/next"
								required
								autocomplete="off"
							>
						</label>
					</div>
					<p class="fine">
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

		<section class="site-list" aria-busy={loading}>
			<div class="site-list-heading">
				<div>
					<p class="eyebrow">Verbindungen</p>
					<h2>{sites.length} {sites.length === 1 ? 'Website' : 'Websites'}</h2>
				</div>
				<button class="ghost compact" onclick={loadSites} disabled={loading}>Aktualisieren</button>
			</div>

			{#if !loading && !sites.length}
				<div class="empty-site">Noch keine Website verbunden.</div>
			{/if}
			{#each sites as site (site.id)}
				<article class="site-card">
					<header>
						<div>
							<a href={`https://${site.hostname}`} target="_blank" rel="noopener noreferrer"
								>{site.hostname}</a
							>
							<p>{site.name} · {site.repository}</p>
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
							<dd>{site.sourceBranch} · {shortRevision(site.activeSourceRevision)}</dd>
						</div>
						<div>
							<dt>Deployment</dt>
							<dd>{site.deploymentBranch} · {shortRevision(site.activeArtifactRevision)}</dd>
						</div>
					</dl>
					{#if site.lastError}
						<div class="site-error">{site.lastError}</div>
					{/if}
					<footer>
						<button class="ghost compact" onclick={() => edit(site)}>Bearbeiten</button>
						<button
							class="ghost compact danger"
							disabled={removingId === site.id}
							onclick={() => remove(site)}
						>
							{removingId === site.id ? 'Wird entfernt …' : 'Entfernen'}
						</button>
					</footer>
				</article>
			{/each}
		</section>
	</div>
</section>
