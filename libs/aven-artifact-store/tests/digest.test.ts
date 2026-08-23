import { expect, test } from 'bun:test'
import { type ArtifactJson, parseArtifactJson } from '../src/canonical'
import { artifactJsonDigest, DIGEST_DOMAINS } from '../src/digest'

interface Fixtures {
	artifact: { preimage: ArtifactJson; sha256: string }
	publication: { publisher: ArtifactJson; intent: ArtifactJson; sha256: string }
}

const fixtureUrl = new URL(
	'../../../services/artifact-store/conformance/fixtures/digests/v1.json',
	import.meta.url
)
const fixtures = (await Bun.file(fixtureUrl).json()) as Fixtures

test('matches the shared artifact digest vector', async () => {
	expect(await artifactJsonDigest(DIGEST_DOMAINS.artifact, fixtures.artifact.preimage)).toBe(
		fixtures.artifact.sha256
	)
})

test('matches the shared publication digest vector', async () => {
	const envelope = parseArtifactJson(
		JSON.stringify({
			publisher: fixtures.publication.publisher,
			intent: fixtures.publication.intent
		}),
		true
	)
	expect(await artifactJsonDigest(DIGEST_DOMAINS.publicationRequest, envelope)).toBe(
		fixtures.publication.sha256
	)
})

test('freezes both built-in type-definition digests', async () => {
	for (const [file, expected] of [
		['core.file.v1.json', '39effe32d62cdf0ace3ec8f9ac44e00807a6a480892d2f11de90a5b0597d5434'],
		['core.bundle.v1.json', '6c47e92a394cc3c7db983556379c9b3cf0c3a7e8f5f94d28fe1cf3abcec3f7c3']
	] as const) {
		const value = parseArtifactJson(
			await Bun.file(
				new URL(
					`../../../services/artifact-store/conformance/fixtures/protocol/${file}`,
					import.meta.url
				)
			).text(),
			true
		)
		expect(await artifactJsonDigest(DIGEST_DOMAINS.typeDefinition, value)).toBe(expected)
	}
})
