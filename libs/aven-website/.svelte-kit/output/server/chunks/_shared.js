import { n as private_env } from "./shared-server.js";
//#region src/routes/api/aven/jaensen/_shared.ts
function resolveJaensenWebApiBaseUrl() {
	return (private_env.JAENSEN_WEB_API_URL?.trim() || "http://127.0.0.1:7341").replace(/\/$/, "");
}
async function proxyJson(path, init) {
	const response = await fetch(`${resolveJaensenWebApiBaseUrl()}${path}`, init);
	return new Response(response.body, {
		status: response.status,
		headers: { "content-type": response.headers.get("content-type") ?? "application/json; charset=utf-8" }
	});
}
async function proxyEventStream(path, init) {
	const response = await fetch(`${resolveJaensenWebApiBaseUrl()}${path}`, init);
	return new Response(response.body, {
		status: response.status,
		headers: {
			"content-type": response.headers.get("content-type") ?? "text/event-stream; charset=utf-8",
			"cache-control": response.headers.get("cache-control") ?? "no-cache, no-transform",
			connection: response.headers.get("connection") ?? "keep-alive"
		}
	});
}
//#endregion
export { proxyJson as n, resolveJaensenWebApiBaseUrl as r, proxyEventStream as t };
