import { r as resolveJaensenWebApiBaseUrl } from "../../../../../../../chunks/_shared.js";
import { error } from "@sveltejs/kit";
//#region src/routes/api/aven/jaensen/events/stream/+server.ts
var GET = async ({ request, url, fetch }) => {
	const scope = url.searchParams.get("scope");
	if (!scope) throw error(400, "Missing scope");
	const target = new URL("/api/events/stream", resolveJaensenWebApiBaseUrl());
	target.searchParams.set("scope", scope);
	const after = url.searchParams.get("after");
	if (after) target.searchParams.set("after", after);
	const response = await fetch(target, { headers: {
		accept: "text/event-stream",
		"last-event-id": request.headers.get("last-event-id") ?? ""
	} });
	return new Response(response.body, {
		status: response.status,
		headers: {
			"content-type": response.headers.get("content-type") ?? "text/event-stream; charset=utf-8",
			"cache-control": response.headers.get("cache-control") ?? "no-cache, no-transform",
			connection: response.headers.get("connection") ?? "keep-alive"
		}
	});
};
//#endregion
export { GET };
