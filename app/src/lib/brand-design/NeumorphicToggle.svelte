<script lang="ts">
	/**
	 * Skeuomorphic paper-UI toggle — first piece of the new "Brand Design" system.
	 * Rendered into an isolated SHADOW DOM so its bespoke skeuomorphic CSS can't
	 * leak into (or be touched by) the app's brand/Tailwind styles.
	 *
	 * The switch itself is pure-CSS (a hidden checkbox over the track). On change
	 * it reports state via `onChange(light)` so the host page can switch the whole
	 * SURROUNDING surface dark↔light — a real dark-mode switch. The toggle is
	 * transparent (no own background); the page surface shows through, which is
	 * exactly what the skeuomorphic inset/extrude shadows sit on.
	 *
	 * checkbox unchecked -> dark surface · checked -> light "paper" surface.
	 *
	 * SCSS palette resolved: $dark #1d2532 · lighten($dark,5%) ≈ #263142 ·
	 *   $light #dedad3 · darken($light,4%) ≈ #d5d0c7 · transparentize($c,x)=rgba(c,1-x)
	 */
	let { light = $bindable(false) }: { light?: boolean } = $props()

	const css = `
:host { display: inline-block; font-size: 16px; }
* { box-sizing: border-box; }

.stage {
	display: flex;
	flex-flow: column nowrap;
	align-items: center;
	justify-content: center;
	position: relative;
}

/* HIDDEN CHECKBOX — overlays the track so clicking the switch toggles it */
input[type="checkbox"] {
	display: block;
	position: relative;
	z-index: 100;
	margin-top: -7rem;
	bottom: -7rem;
	width: 16rem;
	height: 7rem;
	border-radius: 3.5rem;
	cursor: pointer;
	opacity: 0;
	-webkit-tap-highlight-color: transparent;
}

/* TOGGLE SWITCH (skeuomorphism) */
.toggle-switch {
	display: block;
	position: relative;
	width: 16rem;
	height: 7rem;
	border-radius: 3.5rem;
	transition: box-shadow 300ms ease-out 0s;
	/* pressed-track groove — dark surface */
	box-shadow:
		inset 0 0 7rem 7rem rgba(0,0,0,0.3),
		inset 0 0.8rem 0.4rem rgba(0,0,0,0.3),
		inset 0 3rem 1rem rgba(0,0,0,0.25),
		0 -0.25em 0.25em rgba(0,0,0,0.2),
		0 0.25em 0.25em rgba(255,255,255,0.08);
}
.toggle-switch:before {
	content: "";
	display: block;
	position: absolute;
	z-index: 50;
	top: 0.25rem;
	left: 0.25rem;
	width: 6.5rem;
	height: 6.5rem;
	border-radius: 3.5rem;
	transition: left 300ms ease-out 0s, background-color 300ms ease-out 0s, box-shadow 300ms ease-out 0s;
	/* extruded knob — dark surface */
	background-color: #263142;
	box-shadow:
		inset 0 0.25rem 0.25rem rgba(255,255,255,0.08),
		inset 0 -0.25rem 0.25rem rgba(0,0,0,0.2),
		0 0.6rem 0.4rem rgba(0,0,0,0.5),
		0 1.25rem 1rem rgba(0,0,0,0.5);
}

/* CHECKED -> light "paper" surface */
input[type="checkbox"]:checked ~ .toggle-switch {
	box-shadow:
		inset 0 0 7rem 7rem rgba(0,0,0,0.1),
		inset 0 0.8rem 0.4rem rgba(0,0,0,0.2),
		inset 0 3rem 1rem rgba(0,0,0,0.1),
		0 -0.25em 0.25em rgba(0,0,0,0.15),
		0 0.25em 0.25em rgba(255,255,255,0.4);
}
input[type="checkbox"]:checked ~ .toggle-switch:before {
	left: 9.25rem;
	background-color: #d5d0c7;
	box-shadow:
		inset 0 0.25rem 0.25rem rgba(255,255,255,0.4),
		inset 0 -0.25rem 0.25rem rgba(0,0,0,0.15),
		0 0.6rem 0.4rem rgba(0,0,0,0.25),
		0 1.25rem 1rem rgba(0,0,0,0.25);
}
`

	const html = `
<div class="stage">
	<input type="checkbox" id="toggle" aria-label="Toggle light / dark surface" />
	<div class="toggle-switch" aria-hidden="true"></div>
</div>`

	let host = $state<HTMLDivElement | null>(null)

	$effect(() => {
		const el = host
		if (!el || el.shadowRoot) return
		const root = el.attachShadow({ mode: 'open' })
		root.innerHTML = `<style>${css}</style>${html}`
		const cb = root.querySelector<HTMLInputElement>('input[type="checkbox"]')
		if (cb) {
			cb.checked = light
			cb.addEventListener('change', () => {
				light = cb.checked
			})
		}
	})
</script>

<div bind:this={host} class="inline-block"></div>
