/**
 * Appended to the Memory UI vault index snapshot only (not sent to Maia chat).
 * Links the dynamic knowledge table to the Maia runtime Markdown row in the sidebar.
 */
export function memoryVaultSnapshotMaiaAppendix(): string {
	return [
		'',
		'---',
		'',
		'### Agents · Maia runtime (`.data/agents/maia`)',
		'',
		'These files are loaded into **Talk** before the vault table above. Open them from the left sidebar under **agents/maia**.',
		'',
		'| File | Role |',
		'|------|------|',
		'| `SOUL.md` | Identity |',
		'| `RULES.md` | Procedures (tools, snapshot discipline) |',
		'| `README.md` | Folder reference |'
	].join('\n')
}
