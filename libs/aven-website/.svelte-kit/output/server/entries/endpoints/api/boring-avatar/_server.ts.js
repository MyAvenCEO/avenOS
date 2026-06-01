import { n as paletteFromCommaString, t as beamAvatarSvg } from "../../../../chunks/beam-avatar.js";
//#region src/routes/api/boring-avatar/+server.ts
function maskId(seed, size) {
	let h = 0;
	for (let i = 0; i < seed.length; i++) h = h * 31 + seed.charCodeAt(i) >>> 0;
	return `baa-${size}-${h.toString(36)}`;
}
/** Same-origin SVG avatars — local beam algorithm, no upstream fetch (avoids 404 / network). */
var GET = async ({ url }) => {
	const name = (url.searchParams.get("name") ?? "avatar").slice(0, 120);
	const sizeRaw = Number.parseInt(url.searchParams.get("size") ?? "64", 10);
	const size = Number.isFinite(sizeRaw) ? Math.min(256, Math.max(16, sizeRaw)) : 64;
	const variant = url.searchParams.get("variant") ?? "beam";
	const colorsParam = url.searchParams.get("colors");
	const svg = beamAvatarSvg(name, colorsParam ? paletteFromCommaString(colorsParam) : variant === "marble" ? paletteFromCommaString("e8c9a8,d4a574,c9a962,305669,222e49") : [], size, maskId(`${name}:${variant}`, size));
	return new Response(svg, { headers: {
		"content-type": "image/svg+xml; charset=utf-8",
		"cache-control": "public, max-age=86400"
	} });
};
//#endregion
export { GET };
