import { i as loadSkill, t as avenmaiaSkillSlugs } from "../../../../../chunks/loader.js";
import { error } from "@sveltejs/kit";
//#region src/routes/skills/avenmaia/[slug]/+page.ts
var prerender = true;
var entries = () => avenmaiaSkillSlugs.map((slug) => ({ slug }));
var load = ({ params }) => {
	const skill = loadSkill(params.slug, "de");
	if (!skill || skill.publisher.id !== "avenmaia") throw error(404, "Skill nicht gefunden");
	return { skill };
};
//#endregion
export { entries, load, prerender };
