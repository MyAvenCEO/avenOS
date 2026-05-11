import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * AvenOS monorepo root: this file is at `projects/aven-ceo/src/lib/jaensen/paths.ts`.
 * Override with `AVENOS_REPO_ROOT` if the checkout layout differs.
 */
export const AVENOS_REPO_ROOT = process.env.AVENOS_REPO_ROOT?.trim()
	? path.resolve(process.env.AVENOS_REPO_ROOT.trim())
	: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..')

/**
 * Local data directory at repo root (gitignored). Default `<repo>/.data`.
 * Flue/Jaensen writes under this via `createFsStorage`: `<AVENOS_DATA_ROOT>/.flue/{state,memory,archive}`.
 * Override with `AVENOS_DATA_ROOT` if needed.
 */
export const AVENOS_DATA_ROOT = process.env.AVENOS_DATA_ROOT?.trim()
	? path.resolve(process.env.AVENOS_DATA_ROOT.trim())
	: path.join(AVENOS_REPO_ROOT, '.data')

/**
 * Root passed to Flue `createFsStorage` — same as {@link AVENOS_DATA_ROOT} (no extra `jaensen` segment).
 */
export const JAENSEN_DATA_DIR = AVENOS_DATA_ROOT

/** Ephemeral skill sandboxes (`LocalSandboxFactory` working directory). `<repo>/.data/sandboxes`. */
export const AVENOS_SANDBOXES_DIR = path.join(AVENOS_DATA_ROOT, 'sandboxes')

/** `@avenos/jaensen-bot` checkout (skill registry, Flue package). */
export const JAENSEN_PACKAGE_DIR = path.join(AVENOS_REPO_ROOT, 'projects', 'jaensen-bot')

export const JAENSEN_DOCUMENT_DIR = path.join(JAENSEN_DATA_DIR, '.flue', 'archive')
