export const systemEmailTemplates = ['name.purchase-link', 'name.purchased'] as const
export type SystemEmailTemplate = (typeof systemEmailTemplates)[number]

export interface TemplateDataMap {
	'name.purchase-link': { name: string; claimUrl: string; expiresAt: string }
	'name.purchased': { name: string; accessUrl: string }
}

export type TemplateData<T extends SystemEmailTemplate> = TemplateDataMap[T]

export const emailTemplateFields = {
	'name.purchase-link': ['name', 'claimUrl', 'expiresAt'],
	'name.purchased': ['name', 'accessUrl']
} as const satisfies Record<SystemEmailTemplate, readonly string[]>

export const emailTemplateTokens = {
	name: 'AVENEMAILTOKENNAME7D8F2A',
	claimUrl: 'AVENEMAILTOKENCLAIMURL4C1E9B',
	expiresAt: 'AVENEMAILTOKENEXPIRESAT6A3D5C',
	accessUrl: 'AVENEMAILTOKENACCESSURL8B2F4D'
} as const

export type EmailTemplateField = keyof typeof emailTemplateTokens
