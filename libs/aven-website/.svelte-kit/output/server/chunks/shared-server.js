//#region ../../node_modules/.bun/@sveltejs+kit@2.59.1+5c56de16fe0e6b09/node_modules/@sveltejs/kit/src/runtime/shared-server.js
/**
* `$env/dynamic/private`
* @type {Record<string, string>}
*/
var private_env = {};
/**
* `$env/dynamic/public`
* @type {Record<string, string>}
*/
var public_env = {};
/** @param {any} error */
var fix_stack_trace = (error) => error?.stack;
/** @type {(environment: Record<string, string>) => void} */
function set_private_env(environment) {
	private_env = environment;
}
/** @type {(environment: Record<string, string>) => void} */
function set_public_env(environment) {
	public_env = environment;
}
//#endregion
export { set_public_env as a, set_private_env as i, private_env as n, public_env as r, fix_stack_trace as t };
