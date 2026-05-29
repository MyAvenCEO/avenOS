import "../../../../../chunks/dev.js";
import { t as SkillLanding } from "../../../../../chunks/SkillLanding.js";
//#region src/routes/skills/aventin/[slug]/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data } = $$props;
		SkillLanding($$renderer, { skill: data.skill });
	});
}
//#endregion
export { _page as default };
