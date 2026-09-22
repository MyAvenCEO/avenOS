import { z } from 'zod'

/** Public destination metadata only. Never includes credential IDs, ciphertext,
 * authentication placement, login names or secret material. */
export const connectionCatalogSchema = z
	.object({
		observedAt: z.iso.datetime({ offset: true }),
		bindings: z
			.array(
				z
					.object({
						bindingRef: z.uuid(),
						label: z.string().min(1).max(256),
						protocol: z.enum(['http', 'imap']),
						purpose: z.string().min(1).max(128),
						enabled: z.boolean(),
						host: z.string().min(1).max(253),
						hostMatch: z.enum(['exact', 'suffix']),
						ports: z.array(z.number().int().min(1).max(65535)).min(1).max(64),
						mailboxes: z.array(z.string().min(1).max(1024)).max(64),
						methods: z.array(z.enum(['GET', 'HEAD'])).max(2),
						pathPrefix: z.string().min(1).max(2048).nullable()
					})
					.strict()
			)
			.max(256)
	})
	.strict()

export function publicConnectionCatalog(raw: unknown, observedAt = new Date().toISOString()) {
	const metadata = z
		.object({
			credentials: z.array(z.object({ credentialRef: z.uuid(), enabled: z.boolean() })).max(1024),
			bindings: z
				.array(
					z.object({
						bindingRef: z.uuid(),
						credentialRef: z.uuid(),
						enabled: z.boolean(),
						protocol: z.enum(['http', 'imap']),
						profile: z.record(z.string(), z.unknown())
					})
				)
				.max(256)
		})
		.parse(raw)
	const active = new Set(metadata.credentials.filter((c) => c.enabled).map((c) => c.credentialRef))
	return connectionCatalogSchema.parse({
		observedAt,
		bindings: metadata.bindings.map((b) => {
			const p = b.profile,
				imap = b.protocol === 'imap'
			const host = imap
				? { value: p.host, kind: 'exact' }
				: z.object({ value: z.string(), kind: z.enum(['exact', 'suffix']) }).parse(p.host)
			return {
				bindingRef: b.bindingRef,
				label: p.label,
				protocol: b.protocol,
				purpose: p.purpose,
				enabled: b.enabled && active.has(b.credentialRef),
				host: host.value,
				hostMatch: host.kind,
				ports: imap ? [p.port] : p.ports,
				mailboxes: imap ? p.mailboxes : [],
				methods: imap ? [] : p.methods,
				pathPrefix: imap ? null : p.pathPrefix
			}
		})
	})
}
