import { env } from '$env/dynamic/private'

export function resolveJaensenWebApiBaseUrl(): string {
	return (env.JAENSEN_WEB_API_URL?.trim() || 'http://127.0.0.1:7341').replace(/\/$/, '')
}

export async function proxyJson(path: string, init?: RequestInit): Promise<Response> {
	const response = await fetch(`${resolveJaensenWebApiBaseUrl()}${path}`, init)
	return new Response(response.body, {
		status: response.status,
		headers: {
			'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8'
		}
	})
}