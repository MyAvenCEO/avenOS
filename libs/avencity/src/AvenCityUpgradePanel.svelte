<script lang="ts">
	import AvenCityUpgradeIcon from './AvenCityUpgradeIcon.svelte'
	import {
		AVENCITY_UPGRADES,
		formatHeartCostShort,
		isUpgradeLocked,
		type AvenCityUpgrade
	} from './upgrades'

	let {
		upgrade,
		selectedId,
		onSelect
	}: {
		upgrade: AvenCityUpgrade
		selectedId: string
		onSelect: (id: string) => void
	} = $props()

	function stopWheelBubble(e: WheelEvent) {
		e.stopPropagation()
	}

	function stopPointerBubble(e: PointerEvent) {
		e.stopPropagation()
	}

	function selectItem(id: string, e: MouseEvent) {
		e.stopPropagation()
		if (id === selectedId) return
		onSelect(id)
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="avencity-panel"
	role="dialog"
	aria-label="{upgrade.title} upgrade details"
	onwheel={stopWheelBubble}
>
	<div class="avencity-panel__body">
		<section class="avencity-panel__select" aria-label="Select level">
			<p class="avencity-panel__path-label">Levels</p>
			<ul class="avencity-panel__grid" role="listbox" aria-label="Upgrade levels">
				{#each AVENCITY_UPGRADES as item (item.id)}
					{@const locked = isUpgradeLocked(item)}
					<li role="presentation">
						<button
							type="button"
							class="avencity-panel__grid-item"
							class:avencity-panel__grid-item--selected={item.id === selectedId}
							class:avencity-panel__grid-item--locked={locked}
							role="option"
							aria-selected={item.id === selectedId}
							title="{item.title} · ♥ {formatHeartCostShort(item.heartCost)}{locked ? ' · Locked' : ''}"
							onclick={(e) => selectItem(item.id, e)}
							onpointerdown={stopPointerBubble}
						>
							<span class="avencity-panel__grid-level">{item.level}</span>
							<span class="avencity-panel__grid-price">
								<span class="avencity-panel__heart" aria-hidden="true">♥</span>
								{formatHeartCostShort(item.heartCost)}
							</span>
						</button>
					</li>
				{/each}
			</ul>
		</section>

		<div class="avencity-panel__divider" aria-hidden="true"></div>

		<section class="avencity-panel__detail" aria-label="Upgrade details">
			<div class="avencity-panel__hero-icon">
				<AvenCityUpgradeIcon variant={upgrade.icon} size={38} />
			</div>
			<p class="avencity-panel__level">Level {upgrade.level}</p>
			<h2 class="avencity-panel__title">{upgrade.title}</h2>
			<p class="avencity-panel__desc">{upgrade.description}</p>

			<div class="avencity-panel__meta" aria-label="Upgrade metadata">
				<span class="avencity-panel__badge">
					{upgrade.capacity} {upgrade.capacity === 1 ? 'person' : 'people'}
				</span>
				<span
					class="avencity-panel__badge avencity-panel__badge--hearts"
					class:avencity-panel__badge--locked={isUpgradeLocked(upgrade)}
				>
					<span class="avencity-panel__heart" aria-hidden="true">♥</span>
					{upgrade.heartCost.toLocaleString()}
					{#if isUpgradeLocked(upgrade)}
						<span class="avencity-panel__badge-lock">Locked</span>
					{/if}
				</span>
			</div>
		</section>
	</div>

	<div class="avencity-panel__arrow" aria-hidden="true"></div>
</div>

<style>
	.avencity-panel {
		position: relative;
		z-index: 1;
		isolation: isolate;
		width: min(26rem, 94vw);
		background: var(--color-surface-card, #f6f1e2);
		border: 1px solid var(--color-border, #d8dde4);
		border-radius: var(--radius-lg, 1rem);
		box-shadow:
			0 10px 28px color-mix(in srgb, var(--color-brand-navy, #1e293b) 10%, transparent),
			inset 0 0 0 1px color-mix(in srgb, white 35%, transparent);
		color: var(--color-brand-navy, #1e293b);
		font-family: var(--font-sans, ui-sans-serif, system-ui, sans-serif);
		padding: 0.75rem;
		pointer-events: auto;
		text-align: left;
		user-select: none;
	}

	.avencity-panel__body {
		display: grid;
		grid-template-columns: 9.4rem 1px minmax(0, 1fr);
		gap: 0.75rem;
		align-items: stretch;
	}

	.avencity-panel__select {
		display: flex;
		flex-direction: column;
		min-width: 0;
		width: 9.4rem;
	}

	.avencity-panel__divider {
		width: 1px;
		background: var(--color-border, #d8dde4);
	}

	.avencity-panel__path-label {
		margin: 0 0 0.4rem;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		opacity: 0.45;
	}

	.avencity-panel__grid {
		display: grid;
		flex: 1;
		grid-template-columns: repeat(3, 1fr);
		grid-template-rows: repeat(3, 1fr);
		gap: 0.3rem;
		aspect-ratio: 1;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.avencity-panel__grid-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.1rem;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		aspect-ratio: 1;
		padding: 0.2rem;
		border: 1px solid transparent;
		border-radius: 0.55rem;
		background: transparent;
		color: inherit;
		cursor: pointer;
		pointer-events: auto;
		text-align: center;
		transition:
			background-color 160ms ease,
			border-color 160ms ease;
	}

	.avencity-panel__grid-item--locked {
		opacity: 0.52;
		border-style: dashed;
		border-color: var(--color-border, #d8dde4);
		cursor: pointer;
	}

	.avencity-panel__grid-item:hover {
		background: var(--color-surface-card-hover, #f6f3e8);
		border-color: var(--color-border, #d8dde4);
	}

	.avencity-panel__grid-item--selected {
		background: var(--color-surface-card-selected, #efeada);
		border-color: var(--color-border, #d8dde4);
	}

	.avencity-panel__grid-item--locked.avencity-panel__grid-item--selected {
		opacity: 0.65;
	}

	.avencity-panel__grid-level {
		font-size: 1.05rem;
		font-weight: 700;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.03em;
	}

	.avencity-panel__grid-price {
		display: inline-flex;
		align-items: center;
		gap: 0.1rem;
		font-size: 0.58rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
		opacity: 0.72;
	}

	.avencity-panel__detail {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		min-width: 0;
		padding-right: 0.15rem;
	}

	.avencity-panel__hero-icon {
		display: grid;
		place-items: center;
		width: 3.1rem;
		height: 3.1rem;
		border: 1px solid var(--color-border, #d8dde4);
		border-radius: 0.85rem;
		background: var(--color-surface-soft, #f9f5e6);
		color: var(--color-brand-navy, #1e293b);
	}

	.avencity-panel__level {
		margin: 0.55rem 0 0;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		opacity: 0.55;
	}

	.avencity-panel__title {
		margin: 0.12rem 0 0;
		font-size: 0.92rem;
		font-weight: 700;
		line-height: 1.2;
		letter-spacing: -0.01em;
	}

	.avencity-panel__desc {
		margin: 0.35rem 0 0;
		font-size: 0.72rem;
		line-height: 1.45;
		opacity: 0.72;
	}

	.avencity-panel__meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-top: 0.55rem;
	}

	.avencity-panel__badge {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.2rem 0.45rem;
		border: 1px solid var(--color-border, #d8dde4);
		border-radius: 9999px;
		background: var(--color-surface-soft, #f9f5e6);
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.avencity-panel__badge--hearts {
		gap: 0.2rem;
		font-variant-numeric: tabular-nums;
		text-transform: none;
		letter-spacing: 0.02em;
		font-size: 10px;
	}

	.avencity-panel__heart {
		color: currentColor;
		font-size: 9px;
		line-height: 1;
		opacity: 0.75;
	}

	.avencity-panel__badge--locked {
		opacity: 0.55;
		border-style: dashed;
		background: color-mix(in srgb, var(--color-surface-soft, #f9f5e6) 70%, var(--color-border, #d8dde4));
	}

	.avencity-panel__badge-lock {
		margin-left: 0.15rem;
		padding-left: 0.35rem;
		border-left: 1px solid var(--color-border, #d8dde4);
		font-size: 8px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		opacity: 0.85;
	}

	.avencity-panel__arrow {
		position: absolute;
		left: 50%;
		bottom: -5px;
		width: 11px;
		height: 11px;
		background: var(--color-surface-card, #f6f1e2);
		border-right: 1px solid var(--color-border, #d8dde4);
		border-bottom: 1px solid var(--color-border, #d8dde4);
		transform: translateX(-50%) rotate(45deg);
		box-shadow: 3px 3px 6px color-mix(in srgb, var(--color-brand-navy, #1e293b) 4%, transparent);
	}
</style>
