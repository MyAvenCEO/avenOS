import { i as loadSkill, n as aventinSkillSlugs } from "../../../../../chunks/loader.js";
import { error } from "@sveltejs/kit";
//#region src/routes/skills/aventin/[slug]/+page.ts
var prerender = true;
var entries = () => aventinSkillSlugs.map((slug) => ({ slug }));
var load = ({ params }) => {
	const skill = loadSkill(params.slug, "de");
	if (!skill || skill.publisher.id !== "aventin") throw error(404, "Skill nicht gefunden");
	return { skill };
};
//#endregion
export { entries, load, prerender };
