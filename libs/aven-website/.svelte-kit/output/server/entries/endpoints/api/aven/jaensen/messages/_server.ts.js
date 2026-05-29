import { r as resolveJaensenWebApiBaseUrl } from "../../../../../../chunks/_shared.js";
import { json } from "@sveltejs/kit";
//#region src/lib/jaensen/message-attachments.ts
function normalizeMessageAttachments(input) {
	return [...Array.isArray(input.attachments) ? input.attachments : [], ...input.attachment === void 0 ? [] : [input.attachment]];
}
//#endregion
//#region src/routes/api/aven/jaensen/messages/+server.ts
var POST = async ({ request }) => {
	let raw;
	try {
		raw = await request.json();
	} catch {
		return json({ error: "Expected JSON body." }, { status: 400 });
	}
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return json({ error: "Body must be an object." }, { status: 400 });
	const body = raw;
	const text = typeof body.text === "string" ? body.text.trim() : "";
	if (!text) return json({ error: "text is required." }, { status: 400 });
	const response = await fetch(`${resolveJaensenWebApiBaseUrl()}/api/messages`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			text,
			intentIdHint: typeof body.intentIdHint === "string" ? body.intentIdHint : void 0,
			attachments: normalizeMessageAttachments({
				attachments: body.attachments,
				attachment: body.attachment
			})
		})
	});
	const payload = await response.text();
	return new Response(payload, {
		status: response.status,
		headers: { "content-type": response.headers.get("content-type") ?? "application/json; charset=utf-8" }
	});
};
//#endregion
export { POST };
