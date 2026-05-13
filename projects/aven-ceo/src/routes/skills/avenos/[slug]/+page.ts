import { error } from '@sveltejs/kit'
import { avenosSkillSlugs, loadSkill } from '$lib/skills/loader'

export const prerender = true

export const entries = () => avenosSkillSlugs.map((slug) => ({ slug }))

export const load = ({ params }: { params: { slug: string } }) => {
	const skill = loadSkill(params.slug, 'de')
	if (!skill || skill.publisher.id !== 'avenos') throw error(404, 'Skill nicht gefunden')
	return { skill }
}
