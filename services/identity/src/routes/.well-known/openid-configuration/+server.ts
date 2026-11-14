import { json } from '@sveltejs/kit'
import { loadIdentityConfig } from '$lib/server/config.js'
import { OIDC_PATHS, OIDC_SCOPES } from '$lib/server/oidc.js'

export const GET = () => {
	const issuer = loadIdentityConfig().PUBLIC_BASE_URL.replace(/\/$/, '')
	return json({
		issuer,
		authorization_endpoint: `${issuer}${OIDC_PATHS.authorize}`,
		token_endpoint: `${issuer}${OIDC_PATHS.token}`,
		userinfo_endpoint: `${issuer}${OIDC_PATHS.userinfo}`,
		jwks_uri: `${issuer}${OIDC_PATHS.jwks}`,
		// Session-cookie exchange for the five-minute `aven-services` JWT (unchanged).
		aven_service_token_endpoint: `${issuer}/api/auth/token`,
		scopes_supported: [...OIDC_SCOPES],
		response_types_supported: ['code'],
		response_modes_supported: ['query'],
		grant_types_supported: ['authorization_code'],
		code_challenge_methods_supported: ['S256'],
		token_endpoint_auth_methods_supported: ['none'],
		subject_types_supported: ['public'],
		id_token_signing_alg_values_supported: ['EdDSA'],
		claims_supported: [
			'iss',
			'aud',
			'sub',
			'exp',
			'iat',
			'auth_time',
			'nonce',
			'amr',
			'email',
			'email_verified',
			'name',
			'given_name',
			'family_name',
			'picture',
			'updated_at'
		],
		authorization_response_iss_parameter_supported: true,
		request_parameter_supported: false,
		request_uri_parameter_supported: false
	})
}
