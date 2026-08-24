import { error } from '@sveltejs/kit'
import { allSlugs, loadSkill } from '$lib/skills/loader'

export const prerender = true

/** Skills are global — one URL per skill, no publisher segment. */
export const entries = () => allSlugs.map((slug) => ({ slug }))

export const load = ({ params }: { params: { slug: string } }) => {
	const skill = loadSkill(params.slug, 'en')
	if (!skill) throw error(404, 'Skill not found')
	return { skill }
}
