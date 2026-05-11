import { redirect } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

/** Browsers request `/favicon.ico` by convention; we only ship `/favicon.svg`. */
export const GET: RequestHandler = () => redirect(302, '/favicon.svg')
