import { t as proxyEventStream } from "../../../../../../../../chunks/_shared.js";
//#region src/routes/api/aven/jaensen/debug/actors/events/+server.ts
var GET = async ({ request, url }) => {
	const target = new URL("/debug/actors/events", "http://proxy.invalid");
	const after = url.searchParams.get("after");
	if (after) target.searchParams.set("after", after);
	return proxyEventStream(`${target.pathname}${target.search}`, { headers: {
		accept: "text/event-stream",
		"last-event-id": request.headers.get("last-event-id") ?? ""
	} });
};
//#endregion
export { GET };
