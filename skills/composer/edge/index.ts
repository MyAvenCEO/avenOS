// next.aven.ceo edge — the "apex door". A tiny scale-to-zero Fly app whose ONLY
// job is to 301/302-redirect to the Tigris-direct content host. It never proxies
// content bytes, so it incurs only weightless redirect egress; every real byte is
// served directly from Tigris's global edge (free egress).
//
//   /                 -> 302 /<locale>/   (locale from Accept-Language; varies, so 302)
//   /en /de /en/* /de/*-> 301 CONTENT + same path        (verbatim host-swap mirror)
//   /<anything-else>  -> 301 CONTENT/en/<path>           (locale-less safety fallback)

const CONTENT = (process.env.CONTENT_HOST ?? 'https://www.next.aven.ceo').replace(/\/$/, '')
const LOCALES = (process.env.LOCALES ?? 'en,de').split(',')
const DEFAULT_LOCALE = process.env.DEFAULT_LOCALE ?? 'en'

function pickLocale(req: Request): string {
	const al = (req.headers.get('accept-language') ?? '').toLowerCase()
	for (const part of al.split(',')) {
		const code = part.trim().slice(0, 2)
		if (LOCALES.includes(code)) return code
	}
	return DEFAULT_LOCALE
}

function redirect(location: string, status: 301 | 302): Response {
	return new Response(null, {
		status,
		headers: { location, 'cache-control': status === 301 ? 'public, max-age=3600' : 'no-store' }
	})
}

const localePrefixed = (p: string) => LOCALES.some((l) => p === `/${l}` || p.startsWith(`/${l}/`))

const server = Bun.serve({
	port: Number(process.env.PORT) || 8080,
	fetch(req) {
		const url = new URL(req.url)
		const path = url.pathname
		const qs = url.search

		// bare apex -> locale home (language-negotiated => 302, it varies)
		if (path === '/') return redirect(`${CONTENT}/${pickLocale(req)}/`, 302)

		// health check for Fly
		if (path === '/healthz')
			return new Response('ok', { headers: { 'content-type': 'text/plain' } })

		// locale already in the path -> verbatim host-swap mirror (permanent => 301)
		if (localePrefixed(path)) return redirect(`${CONTENT}${path}${qs}`, 301)

		// locale-less path -> prepend default locale (safety fallback)
		return redirect(`${CONTENT}/${DEFAULT_LOCALE}${path}${qs}`, 301)
	}
})

console.log(`next-edge (door) listening on :${server.port} -> ${CONTENT}`)
