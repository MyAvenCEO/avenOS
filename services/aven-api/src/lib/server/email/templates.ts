export const systemEmailTemplates = ['name.purchase-link', 'name.purchased'] as const
export type SystemEmailTemplate = (typeof systemEmailTemplates)[number]

export interface TemplateDataMap {
	'name.purchase-link': { name: string; claimUrl: string; expiresAt: string }
	'name.purchased': { name: string; accessUrl: string }
}
export type TemplateData<T extends SystemEmailTemplate> = TemplateDataMap[T]
export interface RenderedEmail {
	subject: string
	text: string
	html: string
}

export function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#039;')
}

const link = (url: string, label: string) => `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`
const render = (subject: string, text: string[], html: string[]): RenderedEmail => ({
	subject,
	text: text.join('\n'),
	html: `<!doctype html><html><body>${html.map((line) => `<p>${line}</p>`).join('')}</body></html>`
})

export function renderEmail<T extends SystemEmailTemplate>(
	template: T,
	data: TemplateData<T>
): RenderedEmail {
	if (template === 'name.purchase-link') {
		const input = data as TemplateDataMap['name.purchase-link']
		return render(
			`Checkout link for ${input.name}`,
			[
				`Name: ${input.name}`,
				`Continue to checkout: ${input.claimUrl}`,
				`Link expires: ${input.expiresAt}`
			],
			[
				`Name: ${escapeHtml(input.name)}`,
				link(input.claimUrl, 'Continue to checkout'),
				`Link expires: ${escapeHtml(input.expiresAt)}`
			]
		)
	}
	const input = data as TemplateDataMap['name.purchased']
	const text = [`Name: ${input.name}`]
	const html = [`Name: ${escapeHtml(input.name)}`]
	if (input.accessUrl) {
		text.push(
			`Create passkey: ${input.accessUrl}`,
			`Login: ${input.accessUrl}`,
			'This link works until a passkey is created.'
		)
		html.push(
			link(input.accessUrl, 'Create passkey'),
			link(input.accessUrl, 'Login'),
			'This link works until a passkey is created.'
		)
	}
	return render(`Login for ${input.name}`, text, html)
}
