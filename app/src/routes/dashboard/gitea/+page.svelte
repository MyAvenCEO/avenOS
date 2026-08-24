<script lang="ts">
import { onMount } from 'svelte'

/**
 * aven-git spike (board 0162) — the app as a PURE REMOTE CLIENT of the user's
 * self-hosted Gitea. Everything here is plain `/api/v1` REST over HTTP: list
 * repos, create a repo, and now open one — its details plus a file/folder
 * browser over the contents API, with a text preview for files. The dev
 * instance comes from `libs/aven-git/gitea-dev.sh up`, which prints the token
 * to paste here; the same page would drive the real per-user server by
 * changing the base URL.
 *
 * Spike-grade on purpose: token in localStorage, no SSO, no actor wiring.
 */

const STORE_URL = 'aven-git.url'
const STORE_TOKEN = 'aven-git.token'

interface Repo {
	name: string
	owner: string
}

/**
 * The repo as the API reports it. Gitea returns ~70 fields; these are the
 * ones that describe how the repository is SET UP — what the settings tab
 * reads out.
 */
interface RepoDetails {
	full_name: string
	description: string
	private: boolean
	internal?: boolean
	fork?: boolean
	mirror?: boolean
	mirror_interval?: string
	template?: boolean
	archived?: boolean
	empty: boolean
	default_branch: string
	size: number
	created_at?: string
	updated_at: string
	clone_url: string
	ssh_url?: string
	object_format_name?: string
	language?: string
	website?: string
	topics?: string[]
	projects_mode?: string
	branch_count?: number
	open_issues_count?: number
	open_pr_counter?: number
	release_counter?: number
	permissions?: { admin?: boolean; push?: boolean; pull?: boolean }
	// what the repo offers
	has_code?: boolean
	has_issues?: boolean
	has_pull_requests?: boolean
	has_wiki?: boolean
	has_projects?: boolean
	has_releases?: boolean
	has_packages?: boolean
	has_actions?: boolean
	// how pull requests may land
	allow_merge_commits?: boolean
	allow_rebase?: boolean
	allow_rebase_explicit?: boolean
	allow_squash_merge?: boolean
	allow_fast_forward_only_merge?: boolean
	allow_manual_merge?: boolean
	autodetect_manual_merge?: boolean
	allow_merge_update?: boolean
	allow_rebase_update?: boolean
	default_merge_style?: string
	default_update_style?: string
	default_delete_branch_after_merge?: boolean
	default_allow_maintainer_edit?: boolean
	ignore_whitespace_conflicts?: boolean
}

/** One branch-protection rule, as `/branch_protections` reports it. */
interface Protection {
	rule_name: string
	priority?: number
	enable_push?: boolean
	enable_push_whitelist?: boolean
	push_whitelist_usernames?: string[]
	push_whitelist_teams?: string[]
	push_whitelist_deploy_keys?: boolean
	enable_force_push?: boolean
	enable_force_push_allowlist?: boolean
	force_push_allowlist_usernames?: string[]
	required_approvals?: number
	enable_approvals_whitelist?: boolean
	approvals_whitelist_username?: string[]
	dismiss_stale_approvals?: boolean
	ignore_stale_approvals?: boolean
	block_on_rejected_reviews?: boolean
	block_on_official_review_requests?: boolean
	block_on_outdated_branch?: boolean
	block_admin_merge_override?: boolean
	enable_merge_whitelist?: boolean
	merge_whitelist_usernames?: string[]
	enable_status_check?: boolean
	status_check_contexts?: string[]
	require_signed_commits?: boolean
	protected_file_patterns?: string
	unprotected_file_patterns?: string
	enable_bypass_allowlist?: boolean
	bypass_allowlist_usernames?: string[]
}

interface TagProtection {
	name_pattern: string
	whitelist_usernames?: string[]
	whitelist_teams?: string[]
}

interface Collaborator {
	login: string
	permissions?: { admin?: boolean; push?: boolean; pull?: boolean }
}

interface Entry {
	name: string
	path: string
	type: 'file' | 'dir' | string
	size: number
}

let baseUrl = $state('http://localhost:3300')
let token = $state('')
let repos = $state<Repo[]>([])
let newName = $state('')
let busy = $state(false)
let failure = $state<string | null>(null)

/** The open repo, or null while on the list. */
let open = $state<Repo | null>(null)
let details = $state<RepoDetails | null>(null)
/** The repo's branches, and the one the tree is browsed at. */
let branches = $state<string[]>([])
let ref = $state('')
/** Which face of the open repo is showing. */
let tab = $state<'files' | 'settings'>('files')
/** How the repo is set up — read-only, loaded when the tab is first opened. */
let protections = $state<Protection[]>([])
let tagProtections = $state<TagProtection[]>([])
let collaborators = $state<Collaborator[]>([])
let settingsLoaded = $state(false)
/** Directory currently shown inside the open repo ('' = root). */
let path = $state('')
let entries = $state<Entry[]>([])
/** A file being previewed, if any; sha is what the update API mutates against. */
let file = $state<{ path: string; text: string | null; sha: string } | null>(null)
/** The open file's editable buffer — text files are always editable in place. */
let draft = $state('')

const connected = $derived(token.trim() !== '')
const crumbs = $derived(path === '' ? [] : path.split('/'))
/** Unsaved edits: what makes the save bar appear. */
const dirty = $derived(file?.text != null && draft !== file.text)
/** The editor grows with the file rather than scrolling in a small box. */
const rows = $derived(Math.min(40, Math.max(8, draft.split('\n').length + 1)))

onMount(() => {
	baseUrl = localStorage.getItem(STORE_URL) ?? baseUrl
	token = localStorage.getItem(STORE_TOKEN) ?? ''
	if (connected) void refresh()
})

function remember() {
	localStorage.setItem(STORE_URL, baseUrl.trim())
	localStorage.setItem(STORE_TOKEN, token.trim())
}

async function api(apiPath: string, init?: RequestInit): Promise<Response> {
	const res = await fetch(`${baseUrl.trim().replace(/\/$/, '')}/api/v1${apiPath}`, {
		...init,
		headers: {
			Authorization: `token ${token.trim()}`,
			'Content-Type': 'application/json',
			...init?.headers
		}
	})
	if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${apiPath} → HTTP ${res.status}`)
	return res
}

async function refresh() {
	busy = true
	failure = null
	try {
		remember()
		const list = (await (await api('/user/repos')).json()) as Array<{
			name: string
			owner: { login: string }
		}>
		repos = list
			.map((r) => ({ name: r.name, owner: r.owner.login }))
			.sort((a, b) => a.name.localeCompare(b.name))
	} catch (err) {
		failure = err instanceof Error ? err.message : String(err)
	} finally {
		busy = false
	}
}

async function create(event: SubmitEvent) {
	event.preventDefault()
	const name = newName.trim()
	if (name === '' || busy) return
	busy = true
	failure = null
	try {
		await api('/user/repos', {
			method: 'POST',
			body: JSON.stringify({ name, auto_init: true, private: true })
		})
		newName = ''
	} catch (err) {
		failure = err instanceof Error ? err.message : String(err)
	} finally {
		busy = false
	}
	await refresh()
}

/** Open a repo: its details, branches, and the root directory listing. */
async function openRepo(repo: Repo) {
	open = repo
	details = null
	file = null
	branches = []
	tab = 'files'
	protections = []
	tagProtections = []
	collaborators = []
	settingsLoaded = false
	busy = true
	failure = null
	try {
		details = (await (await api(`/repos/${repo.owner}/${repo.name}`)).json()) as RepoDetails
		ref = details.default_branch
		const list = (await (await api(`/repos/${repo.owner}/${repo.name}/branches`)).json()) as Array<{
			name: string
		}>
		branches = list.map((b) => b.name).sort()
		await browse('')
	} catch (err) {
		failure = err instanceof Error ? err.message : String(err)
	} finally {
		busy = false
	}
}

/**
 * Read how the repo is configured. Three independent calls: the rules that
 * govern branches and tags, and who may touch the repo. Each is tolerated
 * separately — a token without admin scope still gets the rest, so a partial
 * answer beats an empty panel.
 */
async function loadSettings() {
	if (!open || settingsLoaded) return
	settingsLoaded = true
	const repo = `/repos/${open.owner}/${open.name}`
	const [p, t, c] = await Promise.all([
		api(`${repo}/branch_protections`)
			.then((r) => r.json() as Promise<Protection[]>)
			.catch(() => []),
		api(`${repo}/tag_protections`)
			.then((r) => r.json() as Promise<TagProtection[]>)
			.catch(() => []),
		api(`${repo}/collaborators`)
			.then((r) => r.json() as Promise<Collaborator[]>)
			.catch(() => [])
	])
	protections = p ?? []
	tagProtections = t ?? []
	collaborators = c ?? []
}

/**
 * Switch the browsed branch WITHOUT losing place: an open file re-opens at
 * the new ref (its whole point is comparing versions); if the branch does not
 * have it, the view falls back to the file's folder. With no file open the
 * current directory is kept.
 */
async function switchBranch(name: string) {
	ref = name
	if (file) {
		const keep = file.path
		if (!(await previewPath(keep))) await browse(keep.split('/').slice(0, -1).join('/'))
		return
	}
	await browse(path)
}

/** Show one directory of the open repo; dirs first, then files, alphabetical. */
async function browse(dir: string) {
	if (!open) return
	file = null
	draft = ''
	failure = null
	try {
		const raw = (await (
			await api(`/repos/${open.owner}/${open.name}/contents/${dir}?ref=${encodeURIComponent(ref)}`)
		).json()) as Entry[]
		entries = raw.sort(
			(a, b) =>
				(a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1) || a.name.localeCompare(b.name)
		)
		path = dir
	} catch (err) {
		// An empty repo has no contents to list — that is a state, not an error.
		if (err instanceof Error && err.message.includes('HTTP 404')) {
			entries = []
			path = dir
		} else {
			failure = err instanceof Error ? err.message : String(err)
		}
	}
}

/** Open a file: the contents API hands the blob back base64-encoded. */
async function preview(entry: Entry) {
	if (entry.size > 512 * 1024) {
		file = { path: entry.path, text: null, sha: '' }
		return
	}
	await previewPath(entry.path)
}

/**
 * Load one path as the previewed file at the current ref. Returns false when
 * the branch simply does not have it (so callers can fall back), true for
 * every handled outcome including binary.
 */
async function previewPath(filePath: string): Promise<boolean> {
	if (!open) return true
	failure = null
	try {
		const blob = (await (
			await api(
				`/repos/${open.owner}/${open.name}/contents/${filePath}?ref=${encodeURIComponent(ref)}`
			)
		).json()) as { content: string; sha: string }
		const bytes = Uint8Array.from(atob(blob.content.replace(/\n/g, '')), (c) => c.charCodeAt(0))
		const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
		file = { path: filePath, text, sha: blob.sha }
		draft = text
	} catch (err) {
		// Undecodable = binary; missing = the caller's fallback; the rest fails.
		if (err instanceof TypeError) file = { path: filePath, text: null, sha: '' }
		else if (err instanceof Error && err.message.includes('HTTP 404')) return false
		else failure = err instanceof Error ? err.message : String(err)
	}
	return true
}

/**
 * Save the draft — never onto the branch being read: the update API's
 * `new_branch` makes Gitea commit onto a fresh branch in one call, so every
 * save is an isolated proposal (the germ of a PR flow), not a mutation of
 * what was browsed. Afterwards the view follows the new branch.
 */
async function saveEdit() {
	if (!open || !file || busy) return
	busy = true
	failure = null
	const target = `edit/${file.path.split('/').at(-1)}-${Date.now()}`
	try {
		const result = (await (
			await api(`/repos/${open.owner}/${open.name}/contents/${file.path}`, {
				method: 'PUT',
				body: JSON.stringify({
					content: btoa(String.fromCharCode(...new TextEncoder().encode(draft))),
					message: `edit ${file.path} via avenOS`,
					sha: file.sha,
					branch: ref,
					new_branch: target
				})
			})
		).json()) as { content: { sha: string } }
		branches = [...branches, target].sort()
		ref = target
		file = { path: file.path, text: draft, sha: result.content.sha }
	} catch (err) {
		failure = err instanceof Error ? err.message : String(err)
	} finally {
		busy = false
	}
}

function closeRepo() {
	open = null
	details = null
	branches = []
	ref = ''
	entries = []
	path = ''
	file = null
	draft = ''
	failure = null
}

/** The merge styles the repo actually allows, in the order Gitea lists them. */
const mergeStyles = $derived(
	details
		? ([
				['merge', details.allow_merge_commits],
				['rebase', details.allow_rebase],
				['rebase-merge', details.allow_rebase_explicit],
				['squash', details.allow_squash_merge],
				['fast-forward-only', details.allow_fast_forward_only_merge],
				['manual', details.allow_manual_merge]
			] as Array<[string, boolean | undefined]>)
		: []
)

/** What the repo offers at all — the feature switches. */
const features = $derived(
	details
		? ([
				['code', details.has_code],
				['issues', details.has_issues],
				['pull requests', details.has_pull_requests],
				['wiki', details.has_wiki],
				['projects', details.has_projects],
				['releases', details.has_releases],
				['packages', details.has_packages],
				['actions', details.has_actions]
			] as Array<[string, boolean | undefined]>)
		: []
)

/** Everything a protection rule asserts, as label/value pairs worth showing. */
function ruleFacts(rule: Protection): Array<[string, string]> {
	const named = (list?: string[]) => (list?.length ? list.join(', ') : '')
	const facts: Array<[string, string]> = [
		[
			'push',
			rule.enable_push ? (rule.enable_push_whitelist ? 'allowlist only' : 'allowed') : 'blocked'
		],
		[
			'force push',
			rule.enable_force_push
				? rule.enable_force_push_allowlist
					? 'allowlist only'
					: 'allowed'
				: 'blocked'
		]
	]
	if (rule.required_approvals) facts.push(['approvals required', String(rule.required_approvals)])
	if (rule.enable_status_check)
		facts.push(['status checks', named(rule.status_check_contexts) || 'required'])
	if (rule.require_signed_commits) facts.push(['signed commits', 'required'])
	if (rule.block_on_rejected_reviews) facts.push(['rejected reviews', 'block merge'])
	if (rule.block_on_official_review_requests) facts.push(['open review requests', 'block merge'])
	if (rule.block_on_outdated_branch) facts.push(['outdated branch', 'block merge'])
	if (rule.block_admin_merge_override) facts.push(['admin override', 'blocked'])
	if (rule.dismiss_stale_approvals) facts.push(['stale approvals', 'dismissed'])
	if (rule.ignore_stale_approvals) facts.push(['stale approvals', 'ignored'])
	if (rule.enable_merge_whitelist)
		facts.push(['merge allowlist', named(rule.merge_whitelist_usernames) || 'set'])
	if (rule.enable_push_whitelist)
		facts.push(['push allowlist', named(rule.push_whitelist_usernames) || 'set'])
	if (rule.enable_bypass_allowlist)
		facts.push(['bypass', named(rule.bypass_allowlist_usernames) || 'set'])
	if (rule.protected_file_patterns) facts.push(['protected files', rule.protected_file_patterns])
	if (rule.unprotected_file_patterns)
		facts.push(['unprotected files', rule.unprotected_file_patterns])
	return facts
}

function permissionOf(who: { permissions?: { admin?: boolean; push?: boolean } }): string {
	if (who.permissions?.admin) return 'admin'
	if (who.permissions?.push) return 'write'
	return 'read'
}

function fmtSize(kb: number): string {
	return kb < 1024 ? `${kb} KB` : `${(kb / 1024).toFixed(1)} MB`
}

function fmtBytes(b: number): string {
	if (b < 1024) return `${b} B`
	if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
	return `${(b / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<svelte:head>
	<title>Git · avenOS</title>
</svelte:head>

<main class="flex min-h-0 w-full flex-1 flex-col gap-3 p-4 sm:p-6">
	<header class="flex flex-col items-center gap-1.5">
		<p class="text-[0.625rem] uppercase tracking-[0.2em] opacity-35">Git</p>
	</header>

	<!-- Three columns: the repos always to the left, the open repo (or the
	     server card) in the middle, its branches to the right. -->
	<div class="flex min-h-0 flex-1 gap-4">
		<!-- The repos: the standing index — selecting one fills the main area. -->
		<aside class="flex w-56 shrink-0 flex-col gap-2">
			<div class="flex items-baseline justify-between px-1">
				<p class="text-[0.625rem] uppercase tracking-[0.16em] opacity-40">Repositories</p>
				<span class="text-[10px] opacity-40">{repos.length}</span>
			</div>

			<form onsubmit={create} class="flex gap-1.5">
				<input
					type="text"
					bind:value={newName}
					placeholder="new-repo-name"
					disabled={!connected}
					class="min-w-0 flex-1 rounded-xl border border-foreground/5 bg-surface-raised px-2.5 py-1.5 font-mono text-xs shadow-[0_1px_3px_rgba(30,41,59,0.05)] outline-none focus:border-primary disabled:opacity-40"
				>
				<button
					type="submit"
					disabled={!connected || busy || newName.trim() === ''}
					title="Create repository"
					aria-label="Create repository"
					class="shrink-0 rounded-xl bg-primary px-2.5 py-1.5 text-primary-foreground text-xs transition-opacity disabled:opacity-30"
				>
					+
				</button>
			</form>

			<ul class="min-h-0 flex-1 space-y-1 overflow-y-auto">
				{#each repos as repo (repo.owner + '/' + repo.name)}
					{@const selected = open?.name === repo.name && open?.owner === repo.owner}
					<li>
						<button
							type="button"
							onclick={() => void openRepo(repo)}
							class="flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left font-mono text-xs transition-colors {selected
								? 'border-primary bg-primary text-primary-foreground'
								: 'border-foreground/5 bg-surface-raised shadow-[0_1px_3px_rgba(30,41,59,0.05)] hover:bg-primary/5'}"
						>
							<span class="min-w-0 flex-1 truncate">{repo.name}</span>
						</button>
					</li>
				{:else}
					<li class="px-3 py-2 text-xs opacity-40">
						{connected ? 'No repositories yet.' : 'Connect to see repositories.'}
					</li>
				{/each}
			</ul>

			<!-- The server itself, at the foot: what everything here talks to, and
			     the way back to its card. -->
			<button
				type="button"
				onclick={closeRepo}
				title="Server"
				class="flex items-center gap-2 rounded-xl border px-3 py-2 text-left font-mono text-[10px] transition-colors {open
					? 'border-foreground/5 bg-surface-raised opacity-60 hover:opacity-100'
					: 'border-primary bg-surface-raised'}"
			>
				<span
					class="size-1.5 shrink-0 rounded-full {connected ? 'bg-success' : 'bg-foreground/20'}"
				></span>
				<span class="min-w-0 flex-1 truncate">{baseUrl.replace(/^https?:\/\//, '')}</span>
			</button>
		</aside>

		{#if open}
			<!-- ONE repo: its facts on top, its tree below. -->
			<section class="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
				<h2 class="min-w-0 truncate font-mono text-sm">{open.owner}/{open.name}</h2>

				{#if details}
					<div
						class="flex flex-col gap-2 rounded-xl border border-foreground/5 bg-surface-raised px-4 py-3 text-xs shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
					>
						{#if details.description}
							<p class="opacity-80">{details.description}</p>
						{/if}
						<div class="flex flex-wrap gap-x-4 gap-y-1 opacity-60">
							<span>{details.private ? 'private' : 'public'}</span>
							<span>branch <span class="font-mono">{details.default_branch}</span></span>
							<span>{fmtSize(details.size)}</span>
							<span>updated {new Date(details.updated_at).toLocaleString()}</span>
						</div>
						<p class="select-all font-mono text-[10px] opacity-50">{details.clone_url}</p>
					</div>
				{/if}

				<!-- The repo has two faces: its contents, and how it is configured. -->
				<div class="flex gap-1">
					<button
						type="button"
						onclick={() => {
							tab = 'files'
						}}
						class="rounded-lg px-3 py-1.5 text-xs transition-colors {tab === 'files'
							? 'bg-surface-raised font-medium shadow-[0_1px_3px_rgba(30,41,59,0.05)]'
							: 'opacity-50 hover:opacity-100'}"
					>
						Files
					</button>
					<button
						type="button"
						onclick={() => {
							tab = 'settings'
							void loadSettings()
						}}
						class="rounded-lg px-3 py-1.5 text-xs transition-colors {tab === 'settings'
							? 'bg-surface-raised font-medium shadow-[0_1px_3px_rgba(30,41,59,0.05)]'
							: 'opacity-50 hover:opacity-100'}"
					>
						Settings
					</button>
				</div>

				{#if tab === 'files'}
					<!-- Breadcrumb: the path INTO the tree; every segment walks back up. -->
					<nav class="flex flex-wrap items-center gap-1 font-mono text-xs">
						<button
							type="button"
							onclick={() => void browse('')}
							class="rounded px-1 py-0.5 transition-colors hover:bg-primary/5 {path === '' && !file
						? 'font-semibold'
						: 'opacity-60'}"
						>
							{open.name}
						</button>
						{#each crumbs as segment, i (i)}
							<span class="opacity-30">/</span>
							<button
								type="button"
								onclick={() => void browse(crumbs.slice(0, i + 1).join('/'))}
								class="rounded px-1 py-0.5 transition-colors hover:bg-primary/5 {i === crumbs.length - 1 && !file
							? 'font-semibold'
							: 'opacity-60'}"
							>
								{segment}
							</button>
						{/each}
						{#if file}
							<span class="opacity-30">/</span>
							<span class="rounded px-1 py-0.5 font-semibold">{file.path.split('/').at(-1)}</span>
						{/if}
					</nav>

					{#if file}
						<!-- The file: editable in place, no mode to enter. Binary or huge stays opaque. -->
						{#if file.text === null}
							<p
								class="rounded-xl border border-foreground/5 bg-surface-raised px-4 py-3 text-xs opacity-60 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
							>
								Binary or too large to open.
							</p>
						{:else}
							<textarea
								bind:value={draft}
								{rows}
								spellcheck="false"
								class="min-h-0 flex-1 resize-y rounded-xl border bg-surface-raised px-4 py-3 font-mono text-xs leading-relaxed shadow-[0_1px_3px_rgba(30,41,59,0.05)] outline-none focus:border-primary {dirty
								? 'border-primary'
								: 'border-foreground/5'}"
							></textarea>
							<!-- The save bar exists only while there is something to save; the
						     commit lands on a fresh edit/* branch (see saveEdit). -->
							{#if dirty}
								<div class="flex items-center justify-end gap-2">
									<span class="mr-auto text-[10px] opacity-40">
										unsaved · saves to a new edit/* branch
									</span>
									<button
										type="button"
										onclick={() => {
										draft = file?.text ?? ''
									}}
										disabled={busy}
										class="rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-primary/5 disabled:opacity-30"
									>
										Revert
									</button>
									<button
										type="button"
										onclick={() => void saveEdit()}
										disabled={busy}
										class="rounded-lg bg-primary px-3 py-1.5 text-primary-foreground text-xs transition-opacity disabled:opacity-30"
									>
										{busy ? 'Saving…' : 'Save'}
									</button>
								</div>
							{/if}
						{/if}
					{:else}
						<!-- The tree, one directory at a time: folders first, then files. -->
						<ul class="min-h-0 flex-1 space-y-1 overflow-y-auto">
							{#each entries as entry (entry.path)}
								<li>
									<button
										type="button"
										onclick={() => (entry.type === 'dir' ? void browse(entry.path) : void preview(entry))}
										class="flex w-full items-center gap-2.5 rounded-xl border border-foreground/5 bg-surface-raised px-3 py-2 text-left font-mono text-sm shadow-[0_1px_3px_rgba(30,41,59,0.05)] transition-colors hover:bg-primary/5"
									>
										{#if entry.type === 'dir'}
											<!-- lucide:folder -->
											<svg
												viewBox="0 0 24 24"
												class="size-4 shrink-0 opacity-60"
												fill="none"
												stroke="currentColor"
												stroke-width="1.5"
												stroke-linejoin="round"
											>
												<path
													d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
												/>
											</svg>
										{:else}
											<!-- lucide:file -->
											<svg
												viewBox="0 0 24 24"
												class="size-4 shrink-0 opacity-40"
												fill="none"
												stroke="currentColor"
												stroke-width="1.5"
												stroke-linejoin="round"
											>
												<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
												<path d="M14 2v4a2 2 0 0 0 2 2h4" />
											</svg>
										{/if}
										<span class="min-w-0 flex-1 truncate">{entry.name}</span>
										{#if entry.type !== 'dir'}
											<span class="shrink-0 text-[10px] opacity-40">{fmtBytes(entry.size)}</span>
										{/if}
									</button>
								</li>
							{:else}
								<li class="px-3 py-2 text-xs opacity-40">
									{details?.empty ? 'Empty repository — no commits yet.' : 'Empty directory.'}
								</li>
							{/each}
						</ul>
					{/if}
				{:else if details}
					<!-- How the repo is SET UP — read-only. Everything here comes
					     straight from the API; nothing on this tab writes. -->
					<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-2">
						{#snippet row(label: string, value: string)}
							<div class="flex gap-3 text-xs">
								<span class="w-40 shrink-0 opacity-40">{label}</span>
								<span class="min-w-0 flex-1 break-all font-mono">{value}</span>
							</div>
						{/snippet}
						{#snippet chip(label: string, on: boolean | undefined)}
							<span
								class="rounded-full border px-2.5 py-0.5 text-[11px] {on
									? 'border-primary/30 bg-primary/5'
									: 'border-border opacity-30 line-through'}"
							>
								{label}
							</span>
						{/snippet}

						<section class="flex flex-col gap-2">
							<h3 class="text-[0.625rem] uppercase tracking-[0.16em] opacity-40">Repository</h3>
							<div
								class="flex flex-col gap-1.5 rounded-xl border border-foreground/5 bg-surface-raised px-4 py-3 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
							>
								{@render row('visibility', details.private ? 'private' : details.internal ? 'internal' : 'public')}
								{@render row('default branch', details.default_branch)}
								{@render row('object format', details.object_format_name ?? 'sha1')}
								{@render row('size', fmtSize(details.size))}
								{@render row('branches', String(details.branch_count ?? branches.length))}
								{@render row('open issues / PRs', `${details.open_issues_count ?? 0} / ${details.open_pr_counter ?? 0}`)}
								{@render row('releases', String(details.release_counter ?? 0))}
								{@render row('created', details.created_at ? new Date(details.created_at).toLocaleString() : '—')}
								{@render row('updated', new Date(details.updated_at).toLocaleString())}
								{@render row('clone (http)', details.clone_url)}
								{@render row('clone (ssh)', details.ssh_url || 'ssh disabled')}
								{@render row('your access', permissionOf(details))}
								{#if details.website}
									{@render row('website', details.website)}
								{/if}
								{#if details.language}
									{@render row('language', details.language)}
								{/if}
								{#if details.topics?.length}
									{@render row('topics', details.topics.join(', '))}
								{/if}
								{#if details.mirror}
									{@render row('mirror', `every ${details.mirror_interval || '—'}`)}
								{/if}
								<div class="flex flex-wrap gap-1.5 pt-1">
									{@render chip('template', details.template)}
									{@render chip('fork', details.fork)}
									{@render chip('mirror', details.mirror)}
									{@render chip('archived', details.archived)}
									{@render chip('empty', details.empty)}
								</div>
							</div>
						</section>

						<section class="flex flex-col gap-2">
							<h3 class="text-[0.625rem] uppercase tracking-[0.16em] opacity-40">Features</h3>
							<div
								class="flex flex-wrap gap-1.5 rounded-xl border border-foreground/5 bg-surface-raised px-4 py-3 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
							>
								{#each features as [label, on] (label)}
									{@render chip(label, on)}
								{/each}
							</div>
						</section>

						<section class="flex flex-col gap-2">
							<h3 class="text-[0.625rem] uppercase tracking-[0.16em] opacity-40">Pull requests</h3>
							<div
								class="flex flex-col gap-2 rounded-xl border border-foreground/5 bg-surface-raised px-4 py-3 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
							>
								<div class="flex flex-wrap gap-1.5">
									{#each mergeStyles as [label, on] (label)}
										{@render chip(label, on)}
									{/each}
								</div>
								{@render row('default merge style', details.default_merge_style ?? '—')}
								{@render row('default update style', details.default_update_style ?? '—')}
								{@render row('update by', [details.allow_merge_update ? 'merge' : '', details.allow_rebase_update ? 'rebase' : ''].filter(Boolean).join(', ') || 'blocked')}
								{@render row('delete branch after merge', details.default_delete_branch_after_merge ? 'yes' : 'no')}
								{@render row('maintainer edit by default', details.default_allow_maintainer_edit ? 'yes' : 'no')}
								{@render row('ignore whitespace conflicts', details.ignore_whitespace_conflicts ? 'yes' : 'no')}
								{@render row('autodetect manual merge', details.autodetect_manual_merge ? 'yes' : 'no')}
							</div>
						</section>

						<section class="flex flex-col gap-2">
							<h3 class="text-[0.625rem] uppercase tracking-[0.16em] opacity-40">
								Branch protection
							</h3>
							{#each protections as rule (rule.rule_name)}
								<div
									class="flex flex-col gap-1.5 rounded-xl border border-foreground/5 bg-surface-raised px-4 py-3 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
								>
									<p class="font-mono text-xs">
										{rule.rule_name}
										{#if rule.priority}
											<span class="pl-2 text-[10px] opacity-40"> priority {rule.priority} </span>
										{/if}
									</p>
									{#each ruleFacts(rule) as [label, value], i (i)}
										{@render row(label, value)}
									{/each}
								</div>
							{:else}
								<p
									class="rounded-xl border border-foreground/5 bg-surface-raised px-4 py-3 text-xs opacity-50 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
								>
									No protection rules — every branch accepts pushes and force pushes.
								</p>
							{/each}
						</section>

						{#if tagProtections.length > 0}
							<section class="flex flex-col gap-2">
								<h3 class="text-[0.625rem] uppercase tracking-[0.16em] opacity-40">
									Tag protection
								</h3>
								<div
									class="flex flex-col gap-1.5 rounded-xl border border-foreground/5 bg-surface-raised px-4 py-3 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
								>
									{#each tagProtections as t (t.name_pattern)}
										{@render row(t.name_pattern, t.whitelist_usernames?.join(', ') || 'no one')}
									{/each}
								</div>
							</section>
						{/if}

						<section class="flex flex-col gap-2">
							<h3 class="text-[0.625rem] uppercase tracking-[0.16em] opacity-40">Access</h3>
							<div
								class="flex flex-col gap-1.5 rounded-xl border border-foreground/5 bg-surface-raised px-4 py-3 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
							>
								{@render row(`${open.owner} (owner)`, 'admin')}
								{#each collaborators as c (c.login)}
									{@render row(c.login, permissionOf(c))}
								{/each}
							</div>
						</section>
					</div>
				{/if}

				{#if failure}
					<p
						class="rounded-xl border border-error/30 bg-error-muted px-4 py-3 text-error-strong text-xs"
					>
						{failure}
					</p>
				{/if}
			</section>

			{#if branches.length > 0 && tab === 'files'}
				<!-- The branches, top-down: the browsed one filled, the default
				     marked; clicking re-roots the tree at that ref. -->
				<aside class="flex w-44 shrink-0 flex-col gap-1.5">
					<p
						class="flex items-center gap-1.5 px-1 text-[0.625rem] uppercase tracking-[0.16em] opacity-40"
					>
						<!-- lucide:git-branch -->
						<svg
							viewBox="0 0 24 24"
							class="size-3"
							fill="none"
							stroke="currentColor"
							stroke-width="1.75"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<line x1="6" x2="6" y1="3" y2="15" />
							<circle cx="18" cy="6" r="3" />
							<circle cx="6" cy="18" r="3" />
							<path d="M18 9a9 9 0 0 1-9 9" />
						</svg>
						Branches
					</p>
					<ul class="min-h-0 flex-1 space-y-1 overflow-y-auto">
						{#each branches as branch (branch)}
							<li>
								<button
									type="button"
									onclick={() => void switchBranch(branch)}
									class="w-full truncate rounded-xl border px-3 py-1.5 text-left font-mono text-xs transition-colors {ref === branch
										? 'border-primary bg-primary text-primary-foreground'
										: 'border-border opacity-60 hover:bg-primary/5 hover:opacity-100'}"
								>
									{branch}{branch === details?.default_branch ? ' ·' : ''}
								</button>
							</li>
						{/each}
					</ul>
				</aside>
			{/if}
		{:else}
			<!-- The server: where YOUR Gitea lives and the token that opens it. Local
		     dev today (gitea-dev.sh prints the token), the remote personal server
		     tomorrow — this page never knows the difference. Shown whenever no
		     repo is selected. -->
			<section class="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
				<h2 class="text-sm">Server</h2>
				<div
					class="flex flex-col gap-2 rounded-xl border border-foreground/5 bg-surface-raised px-4 py-3 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
				>
					<label class="flex items-center gap-3 text-sm">
						<span class="w-14 shrink-0 text-xs opacity-60">URL</span>
						<input
							type="url"
							bind:value={baseUrl}
							placeholder="http://localhost:3300"
							class="min-w-0 flex-1 rounded-lg border border-border bg-transparent px-2.5 py-1.5 font-mono text-xs outline-none focus:border-primary"
						>
					</label>
					<label class="flex items-center gap-3 text-sm">
						<span class="w-14 shrink-0 text-xs opacity-60">Token</span>
						<input
							type="password"
							bind:value={token}
							placeholder="from: libs/aven-git/gitea-dev.sh up"
							class="min-w-0 flex-1 rounded-lg border border-border bg-transparent px-2.5 py-1.5 font-mono text-xs outline-none focus:border-primary"
						>
					</label>
					<button
						type="button"
						onclick={() => void refresh()}
						disabled={!connected || busy}
						class="self-end rounded-lg bg-primary px-3 py-1.5 text-primary-foreground text-xs transition-opacity disabled:opacity-30"
					>
						{busy ? 'Connecting…' : 'Connect'}
					</button>
				</div>

				{#if failure}
					<p
						class="rounded-xl border border-error/30 bg-error-muted px-4 py-3 text-error-strong text-xs"
					>
						{failure}
					</p>
				{/if}

				<p class="px-1 text-xs opacity-40">
					{connected
					? 'Pick a repository on the left.'
					: 'Paste the token, connect, and the repositories appear on the left.'}
				</p>
			</section>
		{/if}
	</div>
</main>
