import { randomUUID } from 'node:crypto'

import { SKILLS_ACTOR_ID, createSkillActorId } from '@jaensen/persistence-sqlite'
import type { BootstrapSkillsInput } from './types'

export async function bootstrapSkills(input: BootstrapSkillsInput): Promise<void> {
	await input.persistence.replaceSkills(input.skills, input.now)

	for (const skill of input.skills) {
		const actorId = createSkillActorId(skill.id)
		await input.persistence.ensureActorExists({
			id: actorId,
			kind: 'skill-supervisor',
			state: {
				skillId: skill.id,
				workers: {},
				bootstrappedAt: input.now.toISOString()
			}
		})

		await input.persistence.enqueue({
			id: randomUUID(),
			fromActor: SKILLS_ACTOR_ID,
			toActor: actorId,
			type: 'skill.bootstrap',
			correlationId: randomUUID(),
			payload: { skillId: skill.id },
			createdAt: input.now
		})
	}
}