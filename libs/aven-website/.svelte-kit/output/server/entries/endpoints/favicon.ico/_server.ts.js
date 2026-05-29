import { redirect } from "@sveltejs/kit";
//#region src/routes/favicon.ico/+server.ts
/** Browsers request `/favicon.ico` by convention; we only ship `/favicon.svg`. */
var GET = () => redirect(302, "/favicon.svg");
//#endregion
export { GET };
