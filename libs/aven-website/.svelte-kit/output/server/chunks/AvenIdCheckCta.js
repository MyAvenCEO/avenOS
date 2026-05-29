import { H as attr, U as clsx, i as derived, n as attr_class } from "./dev.js";
import "./navigation.js";
//#region src/lib/components/AvenIdCheckCta.svelte
function AvenIdCheckCta($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { variant = "inline" } = $$props;
		let name = "";
		const slug = derived(() => name.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "").slice(0, 24));
		const wrapperClass = variant === "banner" ? "rounded-2xl border border-border/45 bg-linear-to-br from-white/92 via-white/78 to-white/62 px-5 py-8 shadow-[0_22px_50px_-32px_rgb(0_0_0/0.55)] ring-1 ring-black/8 sm:px-10 sm:py-10" : "rounded-2xl border border-border/40 bg-white/55 px-5 py-7 ring-1 ring-black/5 sm:px-8 sm:py-8";
		$$renderer.push(`<form${attr_class(clsx(wrapperClass))} aria-label="AvenCEO‑Name zur Warteliste"><p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-tuscan-sun">Limited Time Offer · Nur 10× Early Bird</p> <h3 class="mt-2 text-xl font-semibold tracking-tight text-pretty text-foreground sm:text-2xl md:text-[1.65rem]">Sichere dir deinen AvenCEO‑Namen für 8 € statt 55 €</h3> <p class="mt-3 max-w-2xl text-[14px] leading-snug text-foreground/68 sm:text-[15px]">Wie eine Domain — aber für dein zweites Gehirn: <strong class="font-medium text-foreground/82">dein-name.aven.ceo</strong> und passende Mail unter <strong class="font-medium text-foreground/82">dein-name@aven.ceo</strong>.</p> <div class="mt-6 flex flex-col gap-2.5 sm:flex-row sm:items-stretch"><label class="flex min-h-12 flex-1 items-center gap-2 rounded-full border border-border/60 bg-white/85 px-4 ring-1 ring-black/4"><input${attr("value", name)} type="text" name="aven-name" autocomplete="off" spellcheck="false" placeholder="dein-name" class="min-w-0 flex-1 bg-transparent py-3 text-[15px] font-medium tracking-tight text-foreground outline-none placeholder:text-foreground/35"/> <span class="shrink-0 font-mono text-[13px] text-foreground/55">.aven.ceo</span></label> <button type="submit"${attr("disabled", !slug(), true)} class="inline-flex min-h-12 shrink-0 items-center justify-center rounded-full bg-foreground px-7 text-[13px] font-semibold text-background transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40 sm:px-8">Weiter zur Warteliste →</button></div> <p class="mt-3 text-[12px] leading-snug text-foreground/55">Beispiel: <strong class="font-semibold text-foreground/75">samuel.aven.ceo</strong> <span class="text-foreground/45">·</span> samuel@aven.ceo <span class="text-foreground/45">·</span> Forever‑Bonus: dauerhafter Zugang zu Maia City</p></form>`);
	});
}
//#endregion
export { AvenIdCheckCta as t };
