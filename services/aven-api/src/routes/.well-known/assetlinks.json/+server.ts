import { json } from '@sveltejs/kit'
import { loadServerConfig } from '$lib/server/config.js'

export const _ANDROID_APP_PACKAGE_ID = 'ceo.aven.os'

const assetLinksHeaders = {
	'cache-control': 'public, max-age=3600',
	'x-content-type-options': 'nosniff'
}

export function _androidAssetLinks(fingerprints: string[]) {
	return [
		{
			relation: [
				'delegate_permission/common.handle_all_urls',
				'delegate_permission/common.get_login_creds'
			],
			target: {
				namespace: 'android_app',
				package_name: _ANDROID_APP_PACKAGE_ID,
				sha256_cert_fingerprints: fingerprints
			}
		}
	]
}

export const GET = () => {
	const fingerprints = loadServerConfig().ANDROID_APP_CERT_SHA256_FINGERPRINTS
	if (fingerprints.length === 0) {
		return json(
			{ error: 'ANDROID_APP_CERT_SHA256_FINGERPRINTS is not configured.' },
			{ status: 503, headers: assetLinksHeaders }
		)
	}
	return json(_androidAssetLinks(fingerprints), { headers: assetLinksHeaders })
}
