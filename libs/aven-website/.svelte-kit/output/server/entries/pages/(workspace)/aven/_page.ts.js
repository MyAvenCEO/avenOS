import { redirect } from "@sveltejs/kit";
//#region src/routes/(workspace)/aven/+page.ts
var load = () => redirect(307, "/talk");
//#endregion
export { load };
