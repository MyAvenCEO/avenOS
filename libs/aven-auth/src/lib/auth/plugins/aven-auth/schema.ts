export const avenAuthSchema = {
	selfSiteConfig: {
		modelName: 'self_site_config',
		fields: {
			adminUserId: { type: 'string', required: false },
			bootstrappedAt: { type: 'date', required: false },
		},
	},
	selfInvite: {
		modelName: 'self_invite',
		fields: {
			tokenHash: { type: 'string', required: true, unique: true },
			expiresAt: { type: 'date', required: true },
			consumedAt: { type: 'date', required: false },
			boundDid: { type: 'string', required: false },
			createdBy: { type: 'string', required: true },
			createdAt: { type: 'date', required: true },
		},
	},
	selfChallenge: {
		modelName: 'self_challenge',
		fields: {
			nonce: { type: 'string', required: true, unique: true },
			did: { type: 'string', required: true },
			flow: { type: 'string', required: true },
			inviteId: { type: 'string', required: false },
			message: { type: 'string', required: true },
			expiresAt: { type: 'date', required: true },
			usedAt: { type: 'date', required: false },
		},
	},
} as const
