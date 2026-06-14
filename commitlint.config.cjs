/**
 * Conventional-commits gate. Versions are CalVer (date-driven, see scripts/next-version.ts),
 * so commit types no longer pick the version — but they still drive a clean, grouped
 * CHANGELOG.md, so we enforce the convention on every PR.
 */
module.exports = {
	extends: ['@commitlint/config-conventional']
}
