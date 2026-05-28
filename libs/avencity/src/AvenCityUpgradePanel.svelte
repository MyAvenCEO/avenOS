<script lang="ts">
	import AvenCityUpgradeIcon from './AvenCityUpgradeIcon.svelte'
	import {
		AVENCITY_UPGRADES,
		formatDomeDiameter,
		formatHeartCostShort,
		formatHeartCostFull,
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
		<p class="avencity-panel__path-label avencity-panel__body-label-left">Levels</p>
		<p class="avencity-panel__path-label avencity-panel__path-label--right avencity-panel__body-label-right">
			Level {upgrade.level}
		</p>

		<section class="avencity-panel__select" aria-label="Select level">
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
							title="{item.title} · {formatDomeDiameter(item.domeDiameterM)} · ♥ {formatHeartCostShort(item.heartCost)}{locked ? ' · Locked' : ''}"
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
			<div class="avencity-panel__detail-inner">
				<div class="avencity-panel__hero">
					<div class="avencity-panel__hero-icon">
						<AvenCityUpgradeIcon variant={upgrade.icon} size={44} />
					</div>

					<div class="avencity-panel__hero-stack">
						<div
							class="avencity-panel__hero-price"
							class:avencity-panel__hero-price--locked={isUpgradeLocked(upgrade)}
						>
							<p class="avencity-panel__hero-hearts">
								<span class="avencity-panel__hero-heart" aria-hidden="true">♥</span>
								<span class="avencity-panel__hero-hearts-value"
									>{formatHeartCostFull(upgrade.heartCost)}</span
								>
							</p>
						</div>

						<div class="avencity-panel__meta" aria-label="Upgrade metadata">
							<span class="avencity-panel__badge">
								{upgrade.capacity} {upgrade.capacity === 1 ? 'person' : 'people'}
							</span>
							<span class="avencity-panel__badge">
								{formatDomeDiameter(upgrade.domeDiameterM)}
							</span>
						</div>
					</div>
				</div>

				<div class="avencity-panel__copy">
					<h2 class="avencity-panel__title">{upgrade.title}</h2>
					<p class="avencity-panel__desc">{upgrade.description}</p>
				</div>
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
		--avencity-panel-grid: 9.4rem;
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
		grid-template-rows: auto var(--avencity-panel-grid);
		gap: 0 0.75rem;
		row-gap: 0.4rem;
		align-items: stretch;
	}

	.avencity-panel__body-label-left {
		grid-column: 1;
		grid-row: 1;
		margin: 0;
	}

	.avencity-panel__body-label-right {
		grid-column: 3;
		grid-row: 1;
		margin: 0;
	}

	.avencity-panel__select {
		grid-column: 1;
		grid-row: 2;
		display: flex;
		flex-direction: column;
		flex-shrink: 0;
		width: 9.4rem;
		min-height: 0;
	}

	.avencity-panel__divider {
		grid-column: 2;
		grid-row: 1 / -1;
		width: 1px;
		background: var(--color-border, #d8dde4);
	}

	.avencity-panel__path-label {
		font-size: 10px;
		font-weight: 700;
		line-height: 1.2;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		opacity: 0.45;
	}

	.avencity-panel__path-label--right {
		text-align: right;
	}

	.avencity-panel__grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		grid-template-rows: repeat(3, minmax(0, 1fr));
		gap: 0.3rem;
		width: 100%;
		height: 100%;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.avencity-panel__grid > li {
		display: flex;
		min-width: 0;
		min-height: 0;
	}

	.avencity-panel__grid-item {
		display: flex;
		flex: 1;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.1rem;
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		padding: 0.15rem 0.1rem;
		border: 1px solid transparent;
		border-radius: 0.55rem;
		background: transparent;
		color: inherit;
		cursor: pointer;
		pointer-events: auto;
		text-align: center;
		transition:
			background-color 160ms ease,
			border-color 160ms ease,
			opacity 160ms ease;
	}

	.avencity-panel__grid-item--locked {
		opacity: 0.52;
		border-color: color-mix(in srgb, var(--color-border, #d8dde4) 72%, transparent);
	}

	.avencity-panel__grid-item:hover {
		background-color: var(--color-surface-card-hover, #f6f3e8);
		border-color: var(--color-border, #d8dde4);
	}

	.avencity-panel__grid-item--selected {
		background-color: var(--color-surface-card-selected, #efeada);
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
		max-width: 100%;
		font-size: 0.54rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
		opacity: 0.72;
		white-space: nowrap;
	}

	.avencity-panel__detail {
		grid-column: 3;
		grid-row: 2;
		display: flex;
		flex-direction: column;
		box-sizing: border-box;
		min-width: 0;
		min-height: 0;
		height: 100%;
		overflow: hidden;
	}

	.avencity-panel__detail-inner {
		display: flex;
		flex-direction: column;
		gap: 0.38rem;
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}

	.avencity-panel__hero {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: stretch;
		gap: 0.45rem;
		flex-shrink: 0;
		width: 100%;
	}

	.avencity-panel__hero-icon {
		display: grid;
		box-sizing: border-box;
		align-self: stretch;
		aspect-ratio: 1;
		width: auto;
		min-width: 3.55rem;
		max-width: 4rem;
		place-items: center;
		border: 1px solid var(--color-border, #d8dde4);
		border-radius: 0.75rem;
		background: var(--color-surface-soft, #f9f5e6);
		color: var(--color-brand-navy, #1e293b);
	}

	.avencity-panel__hero-stack {
		display: flex;
		flex-direction: column;
		gap: 0.24rem;
		min-width: 0;
	}

	.avencity-panel__hero-price {
		display: flex;
		width: 100%;
		min-width: 0;
	}

	.avencity-panel__meta {
		display: flex;
		flex-wrap: nowrap;
		align-items: center;
		justify-content: flex-start;
		gap: 0.24rem;
		width: 100%;
		min-width: 0;
		overflow: hidden;
	}

	.avencity-panel__copy {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.1rem;
		min-height: 0;
		overflow: hidden;
	}

	.avencity-panel__hero-hearts {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.36rem;
		box-sizing: border-box;
		width: 100%;
		min-width: 0;
		margin: 0;
		padding: 0.44rem 0.55rem;
		border: 1.5px solid color-mix(in srgb, var(--color-border, #d8dde4) 88%, var(--color-brand-navy, #1e293b));
		border-radius: 0.62rem;
		background: color-mix(in srgb, var(--color-surface-soft, #f9f5e6) 88%, white);
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, white 70%, transparent),
			0 1px 2px color-mix(in srgb, var(--color-brand-navy, #1e293b) 6%, transparent);
		font-size: 1.24rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		line-height: 1;
		letter-spacing: -0.03em;
	}

	.avencity-panel__hero-hearts-value {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.avencity-panel__hero-heart {
		flex-shrink: 0;
		color: currentColor;
		font-size: 1.02rem;
		line-height: 1;
		opacity: 0.75;
	}

	.avencity-panel__hero-price--locked .avencity-panel__hero-hearts {
		border-style: dashed;
		opacity: 0.82;
	}

	.avencity-panel__title {
		margin: 0;
		font-size: 0.92rem;
		font-weight: 700;
		line-height: 1.2;
		letter-spacing: -0.01em;
		display: -webkit-box;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 1;
		line-clamp: 1;
	}

	.avencity-panel__desc {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.45;
		opacity: 0.72;
		display: -webkit-box;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		min-height: calc(3 * 1.45 * 0.72rem);
	}

	.avencity-panel__badge {
		display: inline-flex;
		flex-shrink: 1;
		align-items: center;
		gap: 0.2rem;
		min-width: 0;
		padding: 0.16rem 0.38rem;
		border: 1px solid var(--color-border, #d8dde4);
		border-radius: 9999px;
		background: var(--color-surface-soft, #f9f5e6);
		font-size: 8px;
		font-weight: 700;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.avencity-panel__heart {
		color: currentColor;
		font-size: 9px;
		line-height: 1;
		opacity: 0.75;
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
