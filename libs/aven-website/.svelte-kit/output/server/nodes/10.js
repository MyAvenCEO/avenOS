

export const index = 10;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/docs/vibe-apps/_page.svelte.js')).default;
export const universal = {
  "ssr": false
};
export const universal_id = "src/routes/docs/vibe-apps/+page.ts";
export const imports = ["_app/immutable/nodes/10.B6lnbFPm.js","_app/immutable/chunks/CRWD5eUP.js","_app/immutable/chunks/CZPcR42g.js","_app/immutable/chunks/ibwe1TAv.js","_app/immutable/chunks/B-va2yGd.js"];
export const stylesheets = [];
export const fonts = [];
