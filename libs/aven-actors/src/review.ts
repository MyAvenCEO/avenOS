/** Private runner records, not artifacts or caller-asserted approval tokens. */
export interface ActorReviewProposal {
	id: string
	invocationId: string
	revision: number
	subjectSchema: string
	subjectDigest: string
	subject: Record<string, unknown>
	title: string
	expiresAt: string
}
export interface ActorReviewRecord extends ActorReviewProposal {
	runId: string
	generation: number
	createdAt: string
	superseded: boolean
	eventVersion: number
	decision: {
		id: string
		outcome: 'approve' | 'deny' | 'postpone'
		reviewerId: string
		sessionId: string
		decidedAt: string
	} | null
}
export interface ActorReviewDecisionCommand {
	id: string
	revision: number
	subjectDigest: string
	expectedEventVersion: number
	outcome: 'approve' | 'deny' | 'postpone'
}
