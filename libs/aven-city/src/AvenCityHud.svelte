<script lang="ts">
import AvenCityHeartIcon from './AvenCityHeartIcon.svelte'
import { formatHearts, type HeartsLedger } from './ledger.svelte'

let { ledger }: { ledger: HeartsLedger } = $props()

const tickSteps = [1, 10, 100, 1000]

function advance(n: number) {
	ledger.advanceTicks(n)
}
</script>

<!-- Top-right: live HEARTS balance -->
<div class="avencity-hud avencity-hud--balance">
	<div class="avencity-balance">
		<span class="avencity-balance__icon" aria-hidden="true">
			<AvenCityHeartIcon size={16} />
		</span>
		<span class="avencity-balance__value" aria-label="{formatHearts(ledger.balance)} {ledger.symbol}">
			{formatHearts(ledger.balance)}
		</span>
	</div>
	<span class="avencity-balance__symbol">{ledger.symbol}</span>
</div>

<!-- Bottom-right: manual tick / round advance -->
<div class="avencity-hud avencity-hud--ticks">
	<span class="avencity-ticks__round">Round {ledger.tick}</span>
	<div class="avencity-ticks__buttons" role="group" aria-label="Advance game rounds">
		{#each tickSteps as step (step)}
			<button
				type="button"
				class="avencity-ticks__button"
				title="Advance {step} {step === 1 ? 'tick' : 'ticks'} — mint {step} ♥"
				onclick={() => advance(step)}
			>
				+{step}
			</button>
		{/each}
	</div>
</div>

<style>
.avencity-hud {
	position: absolute;
	z-index: 50;
	pointer-events: none;
	font-family: var(--font-sans, ui-sans-serif, system-ui, sans-serif);
	color: var(--color-brand-navy, #1e293b);
	user-select: none;
}

/* Top-right balance ---------------------------------------------------- */
.avencity-hud--balance {
	top: 0.85rem;
	right: 0.85rem;
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 0.15rem;
}

.avencity-balance {
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
	pointer-events: auto;
	padding: 0.4rem 0.7rem;
	border: 1px solid var(--color-border, #d8dde4);
	border-radius: 9999px;
	background: var(--color-surface-card, #f6f1e2);
	box-shadow:
		0 6px 18px color-mix(in srgb, var(--color-brand-navy, #1e293b) 9%, transparent),
		inset 0 0 0 1px color-mix(in srgb, white 35%, transparent);
}

.avencity-balance__icon {
	display: inline-flex;
	color: #e0596b;
}

.avencity-balance__value {
	font-size: 1.05rem;
	font-weight: 800;
	font-variant-numeric: tabular-nums;
	letter-spacing: -0.02em;
	line-height: 1;
}

.avencity-balance__symbol {
	padding-right: 0.3rem;
	font-size: 9px;
	font-weight: 700;
	letter-spacing: 0.14em;
	text-transform: uppercase;
	opacity: 0.5;
}

/* Bottom-right tick controls ------------------------------------------ */
.avencity-hud--ticks {
	bottom: 0.85rem;
	right: 0.85rem;
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 0.3rem;
}

.avencity-ticks__round {
	font-size: 9px;
	font-weight: 700;
	letter-spacing: 0.14em;
	text-transform: uppercase;
	opacity: 0.5;
}

.avencity-ticks__buttons {
	display: inline-flex;
	gap: 0.3rem;
	pointer-events: auto;
	padding: 0.3rem;
	border: 1px solid var(--color-border, #d8dde4);
	border-radius: 9999px;
	background: var(--color-surface-card, #f6f1e2);
	box-shadow:
		0 6px 18px color-mix(in srgb, var(--color-brand-navy, #1e293b) 9%, transparent),
		inset 0 0 0 1px color-mix(in srgb, white 35%, transparent);
}

.avencity-ticks__button {
	min-width: 2.6rem;
	padding: 0.34rem 0.5rem;
	border: 1px solid transparent;
	border-radius: 9999px;
	background: transparent;
	color: inherit;
	cursor: pointer;
	font-family: inherit;
	font-size: 0.78rem;
	font-weight: 700;
	font-variant-numeric: tabular-nums;
	line-height: 1;
	transition:
		background-color 150ms ease,
		border-color 150ms ease,
		transform 80ms ease;
}

.avencity-ticks__button:hover {
	background-color: var(--color-surface-card-hover, #f6f3e8);
	border-color: var(--color-border, #d8dde4);
}

.avencity-ticks__button:active {
	transform: translateY(1px);
	background-color: var(--color-surface-card-selected, #efeada);
}
</style>
