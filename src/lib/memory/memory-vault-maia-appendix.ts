/**
 * Appended to the Memory UI vault index snapshot only (not the full Maia system blob).
 * Links the dynamic knowledge table to the Maia runtime Markdown row in the sidebar.
 */
export function memoryVaultSnapshotMaiaAppendix(): string {
	return [
		'',
		'---',
		'',
		'### Agents · Maia runtime (`.data/agents/maia`)',
		'',
		'These files shape **Talk** system context in order: **SOUL.md** → **vault owner** (`Humans/OWNER_*.md`, injected) → **RULES.md** → vault snapshot. Open **SOUL** / **RULES** from **agents / maia** in the sidebar; edit the owner note under **knowledge** → **Humans**.',
		'',
		'| File | Role |',
		'|------|------|',
		'| `SOUL.md` | Maia identity |',
		'| `RULES.md` | Tool + vault procedures |',
		'| `Humans/OWNER_*.md` | Vault owner identity + preferences (`##` sections) |'
	].join('\n')
}
