<script lang="ts">
/**
 * Mini clay-style icons for the 10 base resources — soft rounded shapes,
 * pastel fills, a little highlight, matching the world's clay look.
 * Static trusted SVG snippets, keyed by resource id.
 */
let { name, class: className = 'h-4 w-4' }: { name: string; class?: string } = $props()

const ICONS: Record<string, string> = {
	WATER: `<path d="M12 3.5c3 3.8 5.5 7 5.5 10a5.5 5.5 0 1 1-11 0c0-3 2.5-6.2 5.5-10z" fill="#6cc4dc"/>
				<ellipse cx="9.8" cy="13.4" rx="1.6" ry="2.4" fill="#a8e1ee" transform="rotate(-18 9.8 13.4)"/>`,
	CLAY: `<ellipse cx="12" cy="16.4" rx="7.4" ry="4.4" fill="#c9906b"/>
				<ellipse cx="12" cy="11.4" rx="5.2" ry="3.4" fill="#d8a67e"/>
				<ellipse cx="10.4" cy="10.2" rx="1.8" ry="1" fill="#e8c0a0"/>`,
	WOOD: `<rect x="3.4" y="9.4" width="15" height="5.6" rx="2.8" fill="#b08155"/>
				<ellipse cx="18.6" cy="12.2" rx="2.6" ry="2.9" fill="#d9b48a"/>
				<ellipse cx="18.6" cy="12.2" rx="1.2" ry="1.4" fill="#c49a6b"/>`,
	HERBS: `<path d="M12 20V9" stroke="#6fae62" stroke-width="1.8" stroke-linecap="round"/>
				<ellipse cx="8.6" cy="10.6" rx="3" ry="1.9" fill="#8cc97f" transform="rotate(-32 8.6 10.6)"/>
				<ellipse cx="15.4" cy="8.9" rx="3" ry="1.9" fill="#6fae62" transform="rotate(28 15.4 8.9)"/>
				<ellipse cx="12" cy="5.6" rx="1.9" ry="2.4" fill="#a4d694"/>`,
	STONE: `<path d="M5 16.5c-.6-3.8 2-7.5 5.8-7.9 3.4-.4 7 1.6 7.6 4.7.6 3-1.8 4.7-5.4 4.9-3.6.2-7.5.5-8-1.7z" fill="#a8a094"/>
				<ellipse cx="9.6" cy="11.6" rx="2.2" ry="1.3" fill="#c2bbafd9" transform="rotate(-16 9.6 11.6)"/>`,
	ORE: `<path d="M5.4 16.8c-.5-3.4 1.8-6.8 5.2-7.2 3.2-.3 6.5 1.5 7 4.3.5 2.8-1.6 4.3-4.9 4.5-3.3.2-6.9.4-7.3-1.6z" fill="#8d867a"/>
				<path d="M10 12.6l1.5-2.4 1.5 2.4-1.5 2.2z" fill="#e8b34e"/>
				<path d="M14.6 14.2l1-1.6 1 1.6-1 1.4z" fill="#f2cd74"/>`,
	GRAIN: `<path d="M12 20.5V7" stroke="#c9a23b" stroke-width="1.6" stroke-linecap="round"/>
				<ellipse cx="9.7" cy="8.4" rx="1.5" ry="2.6" fill="#e8c96a" transform="rotate(-26 9.7 8.4)"/>
				<ellipse cx="14.3" cy="8.4" rx="1.5" ry="2.6" fill="#e8c96a" transform="rotate(26 14.3 8.4)"/>
				<ellipse cx="10" cy="12.6" rx="1.5" ry="2.6" fill="#dcb84f" transform="rotate(-26 10 12.6)"/>
				<ellipse cx="14" cy="12.6" rx="1.5" ry="2.6" fill="#dcb84f" transform="rotate(26 14 12.6)"/>
				<ellipse cx="12" cy="5" rx="1.5" ry="2.4" fill="#f2dd8d"/>`,
	FIBER: `<path d="M7 19c0-6 1.4-11.5 5-14.5" stroke="#d8b078" stroke-width="1.9" stroke-linecap="round" fill="none"/>
				<path d="M12 19c0-6 .8-11 0-14.5" stroke="#c9a05f" stroke-width="1.9" stroke-linecap="round" fill="none"/>
				<path d="M17 19c0-6-1.4-11.5-5-14.5" stroke="#e6c493" stroke-width="1.9" stroke-linecap="round" fill="none"/>
				<rect x="8" y="14.6" width="8" height="2.8" rx="1.4" fill="#b08155"/>`,
	SAND: `<path d="M3.5 17c2.4-3.4 5.6-4.6 8.5-3 2-2.6 5.6-2.6 8.5.6 1 1.1.4 2.9-1.1 2.9H4.8c-1.4 0-2.1-1.3-1.3-2.5z" fill="#ecd9a0"/>
				<circle cx="8.4" cy="10.4" r="1" fill="#d9c27f"/>
				<circle cx="13.6" cy="8.8" r=".8" fill="#d9c27f"/>
				<circle cx="16.8" cy="11.4" r=".7" fill="#e3cd8c"/>`,
	SUN: `<circle cx="12" cy="12" r="4.4" fill="#f5c95c"/>
				<circle cx="10.8" cy="10.8" r="1.6" fill="#ffe08a"/>
				<g stroke="#f5c95c" stroke-width="1.7" stroke-linecap="round">
					<path d="M12 3.2v2.2M12 18.6v2.2M3.2 12h2.2M18.6 12h2.2M5.9 5.9l1.5 1.5M16.6 16.6l1.5 1.5M18.1 5.9l-1.5 1.5M7.4 16.6l-1.5 1.5"/>
				</g>`
}

const fallback = `<circle cx="12" cy="12" r="5" fill="#c9c2b4"/>`
</script>

<svg viewBox="0 0 24 24" class={className} aria-hidden="true">
	<!-- eslint-disable-next-line svelte/no-at-html-tags — static trusted snippets -->
	{@html ICONS[name] ?? fallback}
</svg>
