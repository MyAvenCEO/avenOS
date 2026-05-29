

export const index = 15;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/debug/actors/_page.svelte.js')).default;
export const imports = ["_app/immutable/nodes/15.B2UL0RoJ.js","_app/immutable/chunks/CZPcR42g.js","_app/immutable/chunks/CRWD5eUP.js","_app/immutable/chunks/ibwe1TAv.js"];
export const stylesheets = ["_app/immutable/assets/15.CcVQuzji.css"];
export const fonts = [];
