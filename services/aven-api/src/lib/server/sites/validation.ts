import { z } from 'zod'
import { namePattern, normalizeName } from '$lib/validation.js'

const label = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/
const branch = /^(?![./-])(?!.*(?:\.\.|\/\/|@\{|\\))[A-Za-z0-9._/-]{1,200}(?<![./])$/
const branchComponent = /^(?!\.)(?!.*\.lock$)[A-Za-z0-9._-]+$/
const repository = /^[A-Za-z0-9_.-]{1,100}\/[-A-Za-z0-9_.]{1,100}$/

export function normalizeSiteHostname(input: string, allowOperatorSubdomains = false): string {
	const hostname = input.trim().toLowerCase().replace(/\.$/, '')
	if (hostname !== input.toLowerCase().replace(/\.$/, '') || hostname.length > 253)
		throw new Error('hostname must not contain surrounding whitespace')
	const labels = hostname.split('.')
	if (labels.length < 2 || labels.some((part) => !label.test(part)))
		throw new Error('hostname must be an ASCII fully-qualified domain name')
	if (hostname === 'aven.ceo') throw new Error('the aven.ceo apex is reserved')
	if (!allowOperatorSubdomains && hostname.endsWith('.aven.ceo'))
		throw new Error('aven.ceo and its subdomains are reserved')
	return hostname
}

export function normalizeRepository(input: string): string {
	if (!repository.test(input) || input.includes('..'))
		throw new Error('repository must be a public GitHub owner/repository name')
	return input.toLowerCase()
}

export function normalizeBranch(input: string, deployment = false): string {
	if (
		!branch.test(input) ||
		input === '@' ||
		input.split('/').some((component) => !branchComponent.test(component))
	)
		throw new Error('invalid Git branch name')
	if (deployment && !input.startsWith('deploy/'))
		throw new Error('deploymentBranch must start with deploy/')
	return input
}

export const siteBindingInputSchema = (options: { allowOperatorSubdomains?: boolean } = {}) =>
	z.object({
		name: z.string().transform((value, context) => {
			const name = normalizeName(value)
			if (!namePattern.test(name)) {
				context.addIssue({ code: 'custom', message: 'invalid Aven name' })
				return z.NEVER
			}
			return name
		}),
		hostname: z.string().transform((value, context) => {
			try {
				return normalizeSiteHostname(value, options.allowOperatorSubdomains)
			} catch (error) {
				context.addIssue({ code: 'custom', message: (error as Error).message })
				return z.NEVER
			}
		}),
		repository: z.string().transform((value, context) => {
			try {
				return normalizeRepository(value)
			} catch (error) {
				context.addIssue({ code: 'custom', message: (error as Error).message })
				return z.NEVER
			}
		}),
		sourceBranch: z.string().transform((value, context) => {
			try {
				return normalizeBranch(value)
			} catch (error) {
				context.addIssue({ code: 'custom', message: (error as Error).message })
				return z.NEVER
			}
		}),
		deploymentBranch: z.string().transform((value, context) => {
			try {
				return normalizeBranch(value, true)
			} catch (error) {
				context.addIssue({ code: 'custom', message: (error as Error).message })
				return z.NEVER
			}
		})
	})
