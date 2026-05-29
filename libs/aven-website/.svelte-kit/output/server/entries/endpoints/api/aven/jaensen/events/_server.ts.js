import { n as proxyJson } from "../../../../../../chunks/_shared.js";
import { error } from "@sveltejs/kit";
//#region src/routes/api/aven/jaensen/events/+server.ts
var GET = async ({ url }) => {
	const scope = url.searchParams.get("scope");
	if (!scope) throw error(400, "Missing scope");
	const after = url.searchParams.get("after");
	const query = new URLSearchParams({ scope });
	if (after) query.set("after", after);
	return proxyJson(`/api/events?${query.toString()}`);
};
//#endregion
export { GET };
