import { n as proxyJson } from "../../../../../../../chunks/_shared.js";
//#region src/routes/api/aven/jaensen/intents/[intentId]/+server.ts
var GET = async ({ params }) => proxyJson(`/api/intents/${encodeURIComponent(params.intentId)}`);
//#endregion
export { GET };
