import { H as attr, U as clsx, W as escape_html, a as ensure_array_like, d as html, i as derived, n as attr_class, o as head } from "../../../chunks/dev.js";
import { n as paletteFromCommaString, t as beamAvatarSvg } from "../../../chunks/beam-avatar.js";
import { t as AvenIdCheckCta } from "../../../chunks/AvenIdCheckCta.js";
import { t as MarketingSiteHeader } from "../../../chunks/MarketingSiteHeader.js";
import { a as loadSkills, r as loadPublishersWithSkills, s as skillDetailHref } from "../../../chunks/loader.js";
//#region src/lib/components/SkillMarketplaceCard.svelte
function SkillMarketplaceCard($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { skill, variant = "default" } = $$props;
		const cardClass = variant === "spotlight" ? "group flex min-w-0 flex-col rounded-2xl border-2 border-tuscan-sun/35 bg-linear-to-br from-white/90 via-white/72 to-white/58 p-6 ring-1 ring-tuscan-sun/15 shadow-[0_14px_40px_-24px_rgb(0_0_0/0.35)] transition-all hover:border-tuscan-sun/55 hover:shadow-[0_18px_44px_-22px_rgb(0_0_0/0.4)] sm:p-7" : "group flex min-w-0 flex-col rounded-2xl border border-border/40 bg-white/55 p-5 ring-1 ring-black/5 transition-all hover:border-border/70 hover:bg-white/70 hover:shadow-[0_8px_28px_-12px_rgb(0_0_0/0.22)] sm:p-6";
		const chainLabels = {
			"email-ingestor": "E‑Mail",
			"document-extractor": "Dokumente",
			"brain-memorizer": "Gedächtnis",
			"book-keeper": "Buchhaltung",
			"human-reviewer": "HITL",
			"blog-writer": "Content",
			"golden-offer": "Angebote"
		};
		$$renderer.push(`<a${attr("href", skillDetailHref(skill.slug, "de"))}${attr_class(clsx(cardClass))}${attr("aria-label", `${skill.slug} — ${skill.oneLineCopy}`)}><div class="flex items-start justify-between gap-3"><p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/40">${escape_html(skill.publisher.displayName)}</p> <span class="inline-flex items-center rounded-full border border-tuscan-sun/40 bg-tuscan-sun/20 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-tuscan-sun">Skill</span></div> <h3 class="mt-3 font-mono text-[15px] font-bold tracking-[0.06em] text-foreground sm:text-[16px]">${escape_html(skill.slug)}</h3> <p class="mt-2 text-[14px] font-medium leading-snug text-foreground/82 sm:text-[15px]">${escape_html(skill.oneLineCopy)}</p> <p class="mt-3 font-serif text-[13px] italic leading-snug text-foreground/58 sm:text-[14px]">"${escape_html(skill.founderScenario.timestamp)} — ${escape_html(skill.founderScenario.story.slice(0, 100))}…"</p> <div class="mt-4 flex flex-wrap gap-1.5"><!--[-->`);
		const each_array = ensure_array_like(skill.playsWith);
		for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
			let { slug } = each_array[$$index];
			$$renderer.push(`<span class="inline-flex items-center rounded-full border border-border/40 bg-background/70 px-2 py-0.5 font-mono text-[9px] font-semibold text-foreground/50">→ ${escape_html(chainLabels[slug] ?? slug)}</span>`);
		}
		$$renderer.push(`<!--]--></div> <div class="mt-5 flex items-center justify-between border-t border-border/30 pt-4"><div><p class="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-tuscan-sun">${escape_html(skill.hero.promiseHoursPerWeek)} gespart</p></div> <span class="font-mono text-[12px] font-semibold text-foreground/55 transition-colors group-hover:text-foreground/80">Skill ansehen →</span></div></a>`);
	});
}
//#endregion
//#region src/routes/skills/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		const skills = loadSkills("de");
		const publishersData = loadPublishersWithSkills("de");
		let filterAventin = true;
		let filterAvenmaia = true;
		function pubVisible(id) {
			return id === "aventin" ? filterAventin : filterAvenmaia;
		}
		const visibleSkills = derived(() => skills.filter((s) => pubVisible(s.publisher.id)));
		const spotlightSlugSet = derived(() => {
			const set = /* @__PURE__ */ new Set();
			for (const pub of publishersData) {
				if (!pubVisible(pub.id)) continue;
				for (const slug of pub.featuredSlugs) set.add(slug);
			}
			return set;
		});
		const catalogSkills = derived(() => visibleSkills().filter((s) => !spotlightSlugSet().has(s.slug)));
		const chainSteps = [
			{
				slug: "email-ingestor",
				label: "E‑Mail",
				description: "Liest & klassifiziert"
			},
			{
				slug: "document-extractor",
				label: "Dokumente",
				description: "OCR & Extraktion"
			},
			{
				slug: "brain-memorizer",
				label: "Gedächtnis",
				description: "Identität & Kontext"
			},
			{
				slug: "book-keeper",
				label: "Buchhaltung",
				description: "Matching & Buchung"
			}
		];
		head("1g4s34r", $$renderer, ($$renderer) => {
			$$renderer.title(($$renderer) => {
				$$renderer.push(`<title>Skills Marketplace — aven.ceo · Aven Skills</title>`);
			});
			$$renderer.push(`<meta name="description" content="Skills, die echte Probleme lösen — gebaut von AvenTin und AvenMaia, installierbar für deinen Aven."/>`);
		});
		$$renderer.push(`<div lang="de" class="min-h-screen bg-background text-foreground font-sans antialiased">`);
		MarketingSiteHeader($$renderer, {
			active: "skills",
			maxWidth: "6xl"
		});
		$$renderer.push(`<!----> <section class="border-b border-border/40 px-5 py-24 sm:px-8 sm:py-32 md:py-40"><div class="mx-auto max-w-3xl text-center"><p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/40">Skill Marketplace · Aven</p> <h1 class="mt-4 text-[1.55rem] font-semibold tracking-[-0.03em] text-pretty leading-snug text-foreground sm:text-3xl md:text-[2.35rem] md:leading-[1.15]">Aven Skills, die echte Probleme lösen. <span class="mt-2 block font-serif text-[clamp(1.25rem,3.85vw,2.05rem)] font-light leading-[1.08] tracking-tight text-foreground/88">Weil wir als Founder sie selbst haben.</span></h1> <p class="mx-auto mt-8 max-w-2xl text-[15px] leading-relaxed text-foreground/70 sm:text-base">Diese Skills haben wir für unsere eigenen Alltage gebaut — und dogfooden sie täglich. Heute
				sind sie installierbar für deinen Aven. Kein Aufpreis. Kein Lock‑in.
				  <strong class="font-medium text-foreground/85">Dein Aven. Deine Daten. Dein Stack.</strong></p></div></section> <section class="border-b border-border/40 px-5 py-12 sm:px-8 sm:py-14"><div class="mx-auto flex max-w-6xl flex-col gap-10 lg:flex-row lg:gap-12"><aside class="lg:w-56 lg:shrink-0"><p class="font-mono text-[9px] font-bold uppercase tracking-[0.26em] text-foreground/35">Filter</p> <p class="mt-2 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-foreground/55">Publisher</p> <div class="mt-4 space-y-3"><!--[-->`);
		const each_array = ensure_array_like(publishersData);
		for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
			let pub = each_array[$$index];
			$$renderer.push(`<label class="flex cursor-pointer items-start gap-3 rounded-xl border border-border/35 bg-white/55 p-3 ring-1 ring-black/4 transition-colors hover:border-border/55 hover:bg-white/70"><input type="checkbox" class="mt-1 size-3.5 shrink-0 accent-tuscan-sun"${attr("checked", pubVisible(pub.id), true)}/> <div class="min-w-0 flex-1"><div class="flex items-center gap-2"><div class="size-8 shrink-0 overflow-hidden rounded-full ring-1 ring-background [&amp;>svg]:block [&amp;>svg]:size-full" aria-hidden="true">${html(beamAvatarSvg(pub.beamAvatarLabel, paletteFromCommaString(pub.paletteCsv), 32, `filter-${pub.id}`))}</div> <div class="min-w-0"><p class="font-mono text-[12px] font-bold tracking-[0.08em] text-tuscan-sun">${escape_html(pub.displayName)}</p> <p class="text-[10px] leading-snug text-foreground/48">${escape_html(pub.subtitle)}</p></div></div> <p class="mt-2 font-mono text-[10px] font-semibold tabular-nums text-foreground/42">${escape_html(pub.skillCount)}
									Skills</p></div></label>`);
		}
		$$renderer.push(`<!--]--></div></aside> <div class="min-w-0 flex-1 space-y-14"><div class="space-y-12"><!--[-->`);
		const each_array_1 = ensure_array_like(publishersData);
		for (let $$index_2 = 0, $$length = each_array_1.length; $$index_2 < $$length; $$index_2++) {
			let pub = each_array_1[$$index_2];
			if (pubVisible(pub.id)) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<div><div class="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-border/30 pb-4"><div class="flex items-center gap-3"><div class="size-11 shrink-0 overflow-hidden rounded-full ring-2 ring-background [&amp;>svg]:block [&amp;>svg]:size-full" aria-hidden="true">${html(beamAvatarSvg(pub.beamAvatarLabel, paletteFromCommaString(pub.paletteCsv), 44, `featured-head-${pub.id}`))}</div> <div><p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/38">Empfohlen · ${escape_html(pub.displayName)}</p> <h2 class="mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">Featured Skills</h2> <p class="mt-1 text-[12px] text-foreground/52">${escape_html(pub.skillCount)}
												Skills insgesamt · ${escape_html(pub.featuredSlugs.length)} im Spotlight</p></div></div></div> <div class="grid gap-4 md:grid-cols-2"><!--[-->`);
				const each_array_2 = ensure_array_like(pub.featuredSlugs);
				for (let $$index_1 = 0, $$length = each_array_2.length; $$index_1 < $$length; $$index_1++) {
					let fs = each_array_2[$$index_1];
					const sk = pub.skills.find((s) => s.slug === fs);
					if (sk) {
						$$renderer.push("<!--[0-->");
						SkillMarketplaceCard($$renderer, {
							skill: sk,
							variant: "spotlight"
						});
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]-->`);
				}
				$$renderer.push(`<!--]--></div></div>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]-->`);
		}
		$$renderer.push(`<!--]--></div> <div><div class="mb-5 border-b border-border/30 pb-4"><p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/38">Katalog</p> <h2 class="mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">Weitere Skills</h2> <p class="mt-1 text-[13px] text-foreground/55">${escape_html(catalogSkills().length)}
							Skill${escape_html(catalogSkills().length === 1 ? "" : "s")} `);
		if (visibleSkills().length !== catalogSkills().length) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<span class="text-foreground/40">(${escape_html(visibleSkills().length)} mit Spotlight)</span>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></p></div> `);
		if (catalogSkills().length === 0) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<p class="rounded-xl border border-border/35 bg-white/45 px-4 py-6 text-center text-[14px] text-foreground/55">Keine weiteren Skills für die aktuelle Auswahl — aktiviere einen Publisher im Filter.</p>`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><!--[-->`);
			const each_array_3 = ensure_array_like(catalogSkills());
			for (let $$index_3 = 0, $$length = each_array_3.length; $$index_3 < $$length; $$index_3++) {
				let skill = each_array_3[$$index_3];
				SkillMarketplaceCard($$renderer, { skill });
			}
			$$renderer.push(`<!--]--></div>`);
		}
		$$renderer.push(`<!--]--></div></div></div></section> <section class="border-b border-border/40 bg-gradient-to-b from-transparent via-white/20 to-transparent px-5 py-14 sm:px-8 sm:py-20"><div class="mx-auto max-w-4xl"><div class="text-center"><p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/40">Das System</p> <h2 class="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Kein Skill steht allein — sie komponieren.</h2> <p class="mx-auto mt-4 max-w-xl text-[15px] leading-snug text-foreground/65">Von der ersten Mail bis zur fertigen Buchung: jeder Skill gibt seine Arbeit an den
					nächsten weiter. human-reviewer ist der HITL‑Layer — er hört immer mit.</p></div> <div class="mt-10 flex flex-col items-center gap-2 sm:flex-row sm:items-stretch sm:justify-center"><!--[-->`);
		const each_array_4 = ensure_array_like(chainSteps);
		for (let i = 0, $$length = each_array_4.length; i < $$length; i++) {
			let step = each_array_4[i];
			$$renderer.push(`<a${attr("href", skillDetailHref(step.slug, "de"))} class="group flex min-w-0 flex-col items-center rounded-xl border border-border/35 bg-white/55 px-4 py-4 text-center ring-1 ring-black/4 transition-colors hover:border-border/65 hover:bg-white/70 sm:w-36"><p class="font-mono text-[10px] font-bold tracking-[0.1em] text-foreground/70 group-hover:text-foreground/90">${escape_html(step.label)}</p> <p class="mt-1 text-[11px] leading-snug text-foreground/50">${escape_html(step.description)}</p></a> `);
			if (i < chainSteps.length - 1) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<div class="flex items-center justify-center text-foreground/30 sm:self-center" aria-hidden="true"><span class="text-lg sm:text-xl">→</span></div>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]-->`);
		}
		$$renderer.push(`<!--]--></div> <div class="mx-auto mt-6 max-w-sm rounded-xl border border-tuscan-sun/30 bg-tuscan-sun/10 px-4 py-3 text-center ring-1 ring-tuscan-sun/20"><p class="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-tuscan-sun">HITL Layer</p> <a${attr("href", skillDetailHref("human-reviewer", "de"))} class="mt-1 block font-mono text-[12px] font-bold tracking-[0.08em] text-foreground/75 hover:text-foreground/95">human-reviewer</a> <p class="mt-1 text-[11px] text-foreground/52">Jeder Skill delegiert hierher, wenn echtes Urteilsvermögen gefragt ist.</p></div></div></section> <section class="border-b border-border/40 px-5 py-12 sm:px-8 sm:py-14"><div class="mx-auto max-w-3xl text-center"><p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/40">Pricing</p> <h2 class="mt-3 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">Alle ${escape_html(skills.length)} Skills. In jedem CEO‑Plan enthalten.</h2> <p class="mx-auto mt-4 max-w-xl text-[15px] leading-snug text-foreground/65">Kein Skill‑Marktplatz‑Lock‑in. Kein Abo pro Skill. Kein Vendor, der deine Arbeitsintelligenz
				hält. Du baust auf einem Stack, der dir gehört.</p> <div class="mt-6"><a href="/pricing" class="inline-flex min-h-11 items-center justify-center rounded-full border border-border/60 bg-white/55 px-7 text-[13px] font-semibold text-foreground transition-colors hover:bg-white/85">Alle Pläne ansehen →</a></div></div></section> <section class="border-b border-border/40 px-5 py-14 sm:px-8 sm:py-20"><div class="mx-auto max-w-2xl">`);
		AvenIdCheckCta($$renderer, { variant: "banner" });
		$$renderer.push(`<!----></div></section> <footer class="border-t border-border/40 px-5 py-10 sm:px-8 text-center text-[11px] font-mono text-foreground/30">Aven Maia · AvenOS</footer></div>`);
	});
}
//#endregion
export { _page as default };
