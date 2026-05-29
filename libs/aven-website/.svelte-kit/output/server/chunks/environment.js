//#region ../../node_modules/.bun/@sveltejs+kit@2.59.1+5c56de16fe0e6b09/node_modules/@sveltejs/kit/src/runtime/app/paths/internal/server.js
var base = "";
var assets = base;
var app_dir = "_app";
var initial = {
	base,
	assets
};
initial.base;
/**
* @param {{ base: string, assets: string }} paths
*/
function override(paths) {
	base = paths.base;
	assets = paths.assets;
}
function reset() {
	base = initial.base;
	assets = initial.assets;
}
/** @param {string} path */
function set_assets(path) {
	assets = initial.assets = path;
}
//#endregion
//#region \0virtual:__sveltekit/environment
var version = "1778791769609";
var prerendering = false;
function set_building() {}
function set_prerendering() {
	prerendering = true;
}
//#endregion
export { app_dir as a, override as c, version as i, reset as l, set_building as n, assets as o, set_prerendering as r, base as s, prerendering as t, set_assets as u };
