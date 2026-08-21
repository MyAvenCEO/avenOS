<script lang="ts">
import { goto } from '$app/navigation'
import { page } from '$app/state'
import { designerPages } from '$lib/designer.js'

const selectedHref = $derived(
	designerPages.find((item) => item.path === page.url.pathname)?.href ?? ''
)
</script>

<div class="designer-menu">
	<strong>Designer preview</strong>
	<label>
		<span>Page</span>
		<select
			value={selectedHref}
			onchange={(event) => void goto((event.currentTarget as HTMLSelectElement).value)}
		>
			{#each designerPages as item}
				<option value={item.href}>{item.label}</option>
			{/each}
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
	flex: 1;
	align-items: center;
	gap: 0.5rem;
	font-weight: 400;
}
.designer-menu select {
	width: min(100%, 22rem);
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
@media (max-width: 560px) {
	.designer-menu {
		align-items: stretch;
		flex-wrap: wrap;
		gap: 0.35rem 0.75rem;
		padding-block: 0.65rem;
	}
	.designer-menu label {
		order: 2;
		flex-basis: 100%;
	}
	.designer-menu select {
		flex: 1;
	}
	.mock-badge {
		margin-left: auto;
	}
}
</style>
