import { StudioSkillV2Error } from '@avenos/actors'
import { StudioCaseError } from '@avenos/actors/studio/case'
import { ArtifactStoreProblem } from '@avenos/artifact-store'
import { StudioAdmissionRejected, StudioConflict } from './studio-service.js'
import { StudioV2PublicationRace } from './studio-v2-authoring.js'
import { StudioV2DraftConflict } from './studio-v2-drafts.js'

/** The editor and delegated host share safe domain errors, not raw database or
 * upstream messages. A readable error is not a promise that no effect occurred. */
export function studioFailure(error: unknown):
	| {
			status: number
			effect?: 'not-applied' | 'uncertain'
			problem: Record<string, unknown> & { message: string }
	  }
	| undefined {
	if (
		error instanceof ArtifactStoreProblem &&
		error.status === 503 &&
		error.code === 'STORE_RECONCILIATION_REQUIRED'
	)
		return {
			status: 503,
			effect: 'not-applied',
			problem: {
				code: 'STUDIO_STORE_RECONCILIATION_REQUIRED',
				message:
					'This workspace is still installing its current artifact catalog. No Studio change was committed. Retry after workspace setup is ready.',
				storeCode: error.code,
				retryable: true
			}
		}
	if (error instanceof ArtifactStoreProblem && error.status === 422)
		return {
			status: 422,
			problem: {
				code: 'STUDIO_PUBLICATION_INVALID',
				message:
					'The Artifact Store rejected this publication because it does not satisfy its registered contract. No publication was committed. Repeating the same draft or changing its ID will not fix the contract.',
				storeCode: error.code
			}
		}
	if (error instanceof ArtifactStoreProblem && error.status >= 400 && error.status < 500)
		return {
			status: error.status,
			problem: {
				code: 'STUDIO_ARTIFACT_UNAVAILABLE',
				message:
					'The referenced artifact could not be accessed in this workspace. Inspect the exact ID and current permissions before retrying.'
			}
		}
	if (error instanceof StudioV2PublicationRace)
		return {
			status: 409,
			problem: {
				code: 'STUDIO_PUBLICATION_CONFLICT',
				message:
					'The Skill was published, but its draft changed concurrently. Refresh before editing or publishing again.',
				committedArtifactId: error.committedArtifactId
			}
		}
	if (error instanceof StudioV2DraftConflict)
		return {
			status: 409,
			effect: error.effect,
			problem: { code: 'STUDIO_DRAFT_CONFLICT', message: error.message }
		}
	if (error instanceof StudioCaseError)
		return { status: 400, problem: { code: 'STUDIO_INVALID', message: error.message } }
	if (error instanceof StudioSkillV2Error)
		return {
			status: 400,
			problem: { code: 'STUDIO_INVALID', message: error.message, issues: error.issues }
		}
	if (error instanceof StudioAdmissionRejected)
		return { status: 409, problem: { code: 'STUDIO_ADMISSION_REJECTED', message: error.message } }
	if (error instanceof StudioConflict)
		return { status: 409, problem: { code: 'STUDIO_CONFLICT', message: error.message } }
}
