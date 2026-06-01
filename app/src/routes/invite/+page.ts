import type { PageLoad } from './$types'

/** `/invite?invite=TOKEN` — token present means redeem an invite; absent means bootstrap/return sign-in. */
export const load: PageLoad = ({ url }) => {
	return { inviteToken: url.searchParams.get('invite') ?? undefined }
}
