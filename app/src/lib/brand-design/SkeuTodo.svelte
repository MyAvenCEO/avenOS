<script lang="ts">
	/**
	 * Skeuomorphic todo item — second piece of the Brand Design system. An
	 * elevated "paper" card with a recessed skeuo checkbox that presses in when
	 * checked. Adapts to the surrounding light/dark surface via the `light` prop.
	 * Uses Svelte-scoped styles (no shadow DOM needed — these classes are local).
	 */
	let { light = false }: { light?: boolean } = $props()
	let done = $state(false)
</script>

<div class="todo" class:is-light={light}>
	<button
		type="button"
		class="check"
		class:checked={done}
		aria-pressed={done}
		aria-label="Toggle done"
		onclick={() => (done = !done)}
	>
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M5 13l4 4L19 7" />
		</svg>
	</button>
	<span class="text" class:done>Bananen kaufen</span>
</div>

<style>
	/* Card = the general button's inactive (raised) style: transparent surface,
	   black drop shadow + white highlight (mirrors the toggle). */
	.todo {
		display: flex;
		align-items: center;
		gap: 1.25rem;
		width: min(26rem, 100%);
		padding: 1.25rem 1.5rem;
		border-radius: 1.5rem;
		background: transparent;
		color: #dedad3;
		transition: color 300ms ease-out, box-shadow 300ms ease-out;
		box-shadow:
			0.55rem 0.55rem 1.5rem rgba(0, 0, 0, 0.5),
			-0.5rem -0.5rem 1.3rem rgba(255, 255, 255, 0.07),
			-0.12rem -0.12rem 0.2rem rgba(255, 255, 255, 0.07);
	}
	.todo.is-light {
		color: #2a2520;
		box-shadow:
			0.55rem 0.55rem 1.5rem rgba(0, 0, 0, 0.16),
			-0.5rem -0.5rem 1.3rem rgba(255, 255, 255, 0.9),
			-0.12rem -0.12rem 0.2rem rgba(255, 255, 255, 0.9);
	}

	/* Recessed skeuo checkbox (empty = pressed-in well) */
	.check {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.6rem;
		height: 2.6rem;
		border: none;
		border-radius: 50%;
		cursor: pointer;
		background: #1f2734;
		color: transparent;
		transition: background-color 250ms ease-out, color 250ms ease-out, box-shadow 250ms ease-out;
		box-shadow:
			inset 0 0.18rem 0.35rem rgba(0, 0, 0, 0.6),
			inset 0 -0.12rem 0.25rem rgba(255, 255, 255, 0.05),
			0 0.05rem 0.1rem rgba(255, 255, 255, 0.05);
	}
	.todo.is-light .check {
		background: #d4cfc5;
		box-shadow:
			inset 0 0.18rem 0.35rem rgba(0, 0, 0, 0.22),
			inset 0 -0.12rem 0.25rem rgba(255, 255, 255, 0.7),
			0 0.05rem 0.1rem rgba(255, 255, 255, 0.5);
	}
	.check svg {
		width: 1.3rem;
		height: 1.3rem;
		opacity: 0;
		transform: scale(0.6);
		transition: opacity 200ms ease-out, transform 200ms ease-out;
	}

	/* Checked = an inner glowing lamp: stays recessed, but the well lights up
	   with a soft radial accent glow (inner + outer halo). */
	.check.checked {
		background: radial-gradient(circle at 50% 42%, #66e6a0 0%, #2f9c63 52%, #1f6b44 100%);
		color: #eafff3;
		box-shadow:
			inset 0 0.16rem 0.4rem rgba(0, 0, 0, 0.5),
			inset 0 0 0.8rem rgba(150, 255, 200, 0.55),
			0 0 0.9rem 0.04rem rgba(60, 200, 130, 0.55);
	}
	.todo.is-light .check.checked {
		background: radial-gradient(circle at 50% 42%, #74ecab 0%, #38a86f 55%, #2c8457 100%);
		color: #f2fff8;
		box-shadow:
			inset 0 0.16rem 0.4rem rgba(0, 0, 0, 0.25),
			inset 0 0 0.8rem rgba(190, 255, 220, 0.6),
			0 0 0.9rem 0.04rem rgba(70, 195, 135, 0.5);
	}
	.check.checked svg {
		opacity: 1;
		transform: scale(1);
	}

	.text {
		font-size: 1.15rem;
		font-weight: 500;
		letter-spacing: -0.01em;
		transition: opacity 250ms ease-out;
	}
	.text.done {
		text-decoration: line-through;
		opacity: 0.45;
	}
</style>
