import { inboxSkill } from './inbox.skill'
import type { SkillDef } from './skill'
import { todosSkill } from './todos.skill'

/**
 * The declared skills — the platform's catalog, all data. Adding a skill
 * is adding a config here; the canvas, the cross-skill doors, and the
 * boundary interfaces all derive. (brain, contacts, calendar and docs
 * follow as cards 0154/0155 of the epic 0152.)
 */
export const skills: SkillDef[] = [todosSkill, inboxSkill]
