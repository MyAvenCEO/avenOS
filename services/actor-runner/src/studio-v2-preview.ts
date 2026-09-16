import { StudioSkillV2Error, type StudioSkillV2Issue } from '@avenos/actors'
import { studioPlanDigest } from './studio-artifacts.js'
import type { StudioV2SkillValidator, StudioV2ValidationAuthority } from './studio-v2-validation.js'

export interface StudioV2Preview {
	ok: boolean
	mode: 'authoring-contract'
	publishes: false
	definitionDigest?: string
	transitiveChildArtifactIds: string[]
	issues: StudioSkillV2Issue[]
}

/** Side-effect-free v2 preview. Runtime planning remains a separate admission stage. */
export class StudioV2Previewer {
	constructor(readonly validator: StudioV2SkillValidator) {}

	async preview(raw: unknown, authority: StudioV2ValidationAuthority): Promise<StudioV2Preview> {
		try {
			const result = await this.validator.validate(raw, authority)
			return {
				ok: result.issues.length === 0,
				mode: 'authoring-contract',
				publishes: false,
				definitionDigest: studioPlanDigest(result.definition),
				transitiveChildArtifactIds: [...result.children.keys()].sort(),
				issues: result.issues
			}
		} catch (error) {
			if (!(error instanceof StudioSkillV2Error)) throw error
			return {
				ok: false,
				mode: 'authoring-contract',
				publishes: false,
				transitiveChildArtifactIds: [],
				issues: error.issues
			}
		}
	}
}
