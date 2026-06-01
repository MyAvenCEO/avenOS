import { redirect } from '@sveltejs/kit'
import type { LayoutLoad } from './$types'

/** Legacy `/self/*` → `/settings/*` (plugin IPC names stay `plugin:self|*`). */
export const load: LayoutLoad = ({ url }) => {
	const target = url.pathname.replace(/^\/self(?=\/|$)/, '/settings') + url.search
	throw redirect(307, target)
}
