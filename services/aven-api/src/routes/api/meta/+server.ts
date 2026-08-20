import { json } from '@sveltejs/kit'
import { runtime } from '$lib/server/runtime.js'

export const GET = async () => {
	const { config } = await runtime()
	return json({
		priceEur: config.NAME_PRICE_EUR,
		downloadUrl: config.DOWNLOAD_URL,
		requirePasskeyPrf: config.REQUIRE_PASSKEY_PRF
	})
}
