// @avenos/skills/composer — the composer skill SDK. The deterministic static-site generator (the
// routing SSOT used by BOTH the local preview and the deploy), the GLM website editor, the
// authoring guide the GLM prompt injects, and the chat tool schemas. The composer vibe (app UI) and
// the betterauth chat loop are thin adapters over this. board 0056.

export { COMPOSER_AUTHORING_GUIDE } from './authoring'
export {
	type EditResult,
	editWebsiteDiff,
	parseEditBlocks,
	type TokenUsage,
	WEBSITE_MODEL
} from './edit'
export { SEED_SRC } from './seed'
export {
	buildSite,
	localesOf,
	type Resolution,
	resolveRoute,
	type SiteObject,
	type SiteOptions
} from './site-generator'
export { COMPOSER_TOOLS, EDIT_WEBSITE_TOOL, SHOW_WEBSITE_TOOL } from './tools'
