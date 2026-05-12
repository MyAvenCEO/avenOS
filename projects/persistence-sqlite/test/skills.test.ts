import { expect, test } from 'bun:test'

import { SqlitePersistence } from '../src/sqlite-persistence'

test('replaceSkills swaps the loaded skill registry contents', async () => {
	const persistence = new SqlitePersistence()
	await persistence.migrate()

	await persistence.replaceSkills(
		[
			{
				id: 'skill-1',
				path: 'skills/ingest-docs/SOUL.md',
				frontmatter: { name: 'ingest-docs' },
				body: '# ingest',
				bodyHash: 'hash-1'
			},
			{
				id: 'skill-2',
				path: 'skills/brain/SOUL.md',
				frontmatter: { name: 'brain' },
				body: '# brain',
				bodyHash: 'hash-2'
			}
		],
		new Date('2026-05-12T00:00:00.000Z')
	)

	let skills = await persistence.listSkills()
	expect(skills.map((skill) => skill.path)).toEqual([
		'skills/brain/SOUL.md',
		'skills/ingest-docs/SOUL.md'
	])
	expect(skills[0]?.frontmatter).toEqual({ name: 'brain' })

	await persistence.replaceSkills(
		[
			{
				id: 'skill-3',
				path: 'skills/human-inbox/SOUL.md',
				frontmatter: { name: 'human-inbox' },
				body: '# human',
				bodyHash: 'hash-3'
			}
		],
		new Date('2026-05-12T00:10:00.000Z')
	)

	skills = await persistence.listSkills()
	expect(skills).toHaveLength(1)
	expect(skills[0]).toEqual({
		id: 'skill-3',
		path: 'skills/human-inbox/SOUL.md',
		frontmatter: { name: 'human-inbox' },
		body: '# human',
		bodyHash: 'hash-3',
		loadedAt: '2026-05-12T00:10:00.000Z'
	})
})