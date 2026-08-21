<script lang="ts">
import { page } from '$app/state'
import { designerPages, pageFor } from '$lib/app-runtime/designer-scenarios.js'

const selectedPage = $derived(pageFor(page.url.pathname))
const selectedScenario = $derived(
	selectedPage?.scenarios.find((item) => item.id === page.url.searchParams.get('scenario')) ??
		selectedPage?.scenarios[0]
)

function withSession(href: string): string {
	const target = new URL(href, page.url.origin)
	const session = page.url.searchParams.get('session')
	if (session) target.searchParams.set('session', session)
	return `${target.pathname}${target.search}`
}

function setSession(value: string) {
	const target = new URL(page.url)
	if (value) target.searchParams.set('session', value)
	else target.searchParams.delete('session')
	window.location.assign(`${target.pathname}${target.search}`)
}

function navigate(href: string) {
	window.location.assign(href)
}
</script>

<div class="designer-menu">
	<strong>Designer preview</strong>
	<label>
		<span>Page</span>
		<select
			value={selectedPage ? withSession(selectedPage.scenarios[0]!.href) : ''}
			onchange={(event) => navigate((event.currentTarget as HTMLSelectElement).value)}
		>
			{#each designerPages as item}
				<option value={withSession(item.scenarios[0]!.href)}>{item.label}</option>
			{/each}
		</select>
	</label>
	<label>
		<span>State</span>
		<select
			value={selectedScenario ? withSession(selectedScenario.href) : ''}
			onchange={(event) => navigate((event.currentTarget as HTMLSelectElement).value)}
		>
			{#each selectedPage?.scenarios ?? [] as item}
				<option value={withSession(item.href)}>{item.label}</option>
			{/each}
		</select>
	</label>
	<label class="session-select">
		<span>Session</span>
		<select
			value={page.url.searchParams.get('session') ?? ''}
			onchange={(event) => setSession((event.currentTarget as HTMLSelectElement).value)}
		>
			<option value="">Page default</option>
			<option value="anonymous">Anonymous</option>
			<option value="authenticated">Authenticated</option>
		</select>
	</label>
	<span class="mock-badge">Mock data</span>
</div>

<style>
.designer-menu {
	position: sticky;
	top: 0;
	z-index: 1000;
	display: flex;
	align-items: center;
	gap: 1rem;
	min-height: 3.5rem;
	padding: 0.5rem max(1rem, calc((100vw - 72rem) / 2));
	color: #fff;
	background: #171717;
	box-shadow: 0 2px 8px rgb(0 0 0 / 18%);
}
.designer-menu label {
	display: flex;
	flex: 1 1 15rem;
	align-items: center;
	gap: 0.5rem;
	font-weight: 400;
}
.designer-menu select {
	width: 100%;
	min-height: 2.25rem;
	padding: 0.35rem 2rem 0.35rem 0.65rem;
	font: inherit;
	color: #171717;
	background: #fff;
	border: 0;
	border-radius: 0.25rem;
}
.mock-badge {
	padding: 0.25rem 0.55rem;
	font-size: 0.8rem;
	white-space: nowrap;
	color: #171717;
	background: #b8f7d4;
	border-radius: 999px;
}
@media (max-width: 900px) {
	.designer-menu {
		align-items: stretch;
		flex-wrap: wrap;
		gap: 0.35rem 0.75rem;
		padding-block: 0.65rem;
	}
	.designer-menu label {
		order: 2;
		flex-basis: calc(50% - 0.5rem);
	}
	.designer-menu select {
		flex: 1;
	}
	.mock-badge {
		margin-left: auto;
	}
}
@media (max-width: 560px) {
	.designer-menu label {
		flex-basis: 100%;
	}
}
</style>
