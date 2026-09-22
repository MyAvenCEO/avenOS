import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
	databaseNameForEnvironment,
	signTenantGrant,
	signWorkGrant,
	verifyTenantGrant
} from '@avenos/aven-customer-contracts'
import {
	admissionDigest,
	type InputAdmission,
	inputAdmissionSchema
} from '@avenos/intents/admission'
import { generateKeyPair } from 'jose'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { replacementHistory } from '../src/replacement-history'
import { IntentStore } from '../src/store'
import { IntentTurnOutbox } from '../src/turn-outbox'
import { admitWorkAuthority } from '../src/work-authority'

const url = process.env.INTENT_RETRIEVAL_TEST_DATABASE_URL
const name = `admission_${randomUUID().replaceAll('-', '')}`
const owner = randomUUID(),
	other = randomUUID()
let admin: pg.Pool, pool: pg.Pool, store: IntentStore
const keys = await generateKeyPair('EdDSA'),
	environmentId = randomUUID(),
	issuer = 'https://input-proof.example.test'
async function authority(subjectId: string, input: InputAdmission, generation = 1) {
	const binding = {
		iss: issuer,
		sub: subjectId,
		sid: 'synthetic-admission-session',
		role: 'user' as const,
		membershipRole: 'owner' as const,
		environmentId,
		databaseName: databaseNameForEnvironment(environmentId),
		routingGeneration: generation
	}
	const componentRef = 'ceo.aven:component:data:intents@1',
		actions = ['intents:read', 'intents:write']
	const tenant = await verifyTenantGrant(
		await signTenantGrant(
			{ ...binding, aud: componentRef, componentRef, actions },
			keys.privateKey
		),
		keys.publicKey,
		{ issuer, audience: componentRef, action: 'intents:write' }
	)
	const token = await signWorkGrant(
		{
			...binding,
			jti: randomUUID(),
			kind: 'chat-turn',
			inputId: input.inputId,
			inputRevision: input.revision,
			materialDigest: await admissionDigest(input),
			permissions: [
				{ componentRef, actions },
				{ componentRef: 'os.aven:component:actors:run-repository@1', actions: ['actor-runs:write'] }
			]
		},
		keys.privateKey
	)
	return admitWorkAuthority(token, keys.publicKey, issuer, tenant, input)
}
async function admit(subject: string, request: InputAdmission, generation = 1) {
	return store.admit(subject, request, generation, await authority(subject, request, generation))
}
function input(): InputAdmission {
	return {
		inputId: randomUUID(),
		revision: 1,
		text: 'Plan a community pottery workshop.',
		originalText: 'Plan a community pottery workshop.',
		corrections: [],
		target: { kind: 'new', title: 'Pottery workshop' },
		locale: 'en-GB',
		timezone: 'Europe/London',
		capturedAt: '2026-03-04T09:30:00Z',
		decisionId: randomUUID(),
		confirmed: true,
		references: []
	}
}
describe('admission contract', () => {
	test('rejects unknown authority and canonicalizes property order only', async () => {
		const a = input()
		expect(inputAdmissionSchema.safeParse({ ...a, bearerToken: 'not-authority' }).success).toBe(
			false
		)
		const b = Object.fromEntries(Object.entries(a).reverse()) as InputAdmission
		expect(await admissionDigest(a)).toBe(await admissionDigest(b))
		expect(await admissionDigest(a)).not.toBe(
			await admissionDigest({ ...a, text: `${a.text} More words.` })
		)
		await expect(
			admissionDigest({ ...a, bearerToken: 'not-authority' } as InputAdmission)
		).rejects.toThrow()
		expect(inputAdmissionSchema.safeParse({ ...a, timezone: 'Soon/AfterLunch' }).success).toBe(
			false
		)
		expect(inputAdmissionSchema.safeParse({ ...a, locale: 'English please' }).success).toBe(false)
	})
})
describe.skipIf(!url)('atomic admission in real PostgreSQL', () => {
	beforeAll(async () => {
		admin = new pg.Pool({ connectionString: url })
		await admin.query(`CREATE DATABASE ${name}`)
		const target = new URL(url!)
		target.pathname = `/${name}`
		pool = new pg.Pool({
			connectionString: target.toString(),
			options: '-c search_path=aven_intents,public',
			max: 8
		})
		await pool.query('CREATE SCHEMA aven_intents')
		await pool.query('CREATE SCHEMA aven_platform')
		await pool.query(`CREATE TABLE aven_platform.environment_identity(singleton boolean PRIMARY KEY,
      environment_id uuid NOT NULL, routing_generation bigint NOT NULL, execution_enabled boolean NOT NULL)`)
		await pool.query('INSERT INTO aven_platform.environment_identity VALUES(true,$1,1,true)', [
			environmentId
		])
		for (const migration of [
			'0001_intents',
			'0002_input_admission',
			'0003_turn_supervision',
			'0004_input_replacements'
		])
			await pool.query(
				await readFile(
					new URL(
						`../../platform-provisioner/components/intents/${migration}.sql`,
						import.meta.url
					),
					'utf8'
				)
			)
		store = new IntentStore(pool)
	}, 30000)
	afterAll(async () => {
		await pool?.end()
		if (admin) {
			await admin.query(`DROP DATABASE IF EXISTS ${name}`)
			await admin.end()
		}
	})
	test('two clients plus lost acknowledgement produce one Intent, contribution and turn', async () => {
		const request = input()
		const receipts = await Promise.all(Array.from({ length: 12 }, () => admit(owner, request)))
		for (const receipt of receipts) expect(receipt).toEqual(receipts[0])
		expect(await store.admission(owner, request.inputId, 1)).toEqual(receipts[0])
		const detail = await store.detail(owner, receipts[0].intentId)
		expect(detail.contributions.map((c) => c.kind)).toEqual(['intent-created', 'message'])
		expect(detail.contributions[1].text).toBe(request.text)
		expect(
			(await pool.query('SELECT * FROM turn_outbox WHERE turn_id=$1', [receipts[0].turnId])).rows
		).toHaveLength(1)
		await expect(admit(owner, { ...request, text: 'Changed words' })).rejects.toThrow(
			'different material'
		)
		await expect(
			admit(owner, { ...request, target: { kind: 'new', title: 'Another topic' } })
		).rejects.toThrow('different material')
		await expect(admit(owner, { ...request, revision: 2 })).rejects.toThrow('different material')
		await expect(store.admission(owner, request.inputId, 2)).rejects.toThrow('already sent')
		await expect(store.admission(other, request.inputId, 1)).rejects.toThrow('not found')
	})
	test('new admissions are ordered under the existing Intent lock', async () => {
		const first = await admit(owner, input())
		const requests = Array.from({ length: 8 }, () => ({
			...input(),
			target: { kind: 'existing' as const, id: first.intentId }
		}))
		const receipts = await Promise.all(requests.map((r) => admit(owner, r)))
		expect(receipts.map((r) => r.sequence).sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7, 8, 9, 10])
		expect(new Set(receipts.map((r) => r.turnId)).size).toBe(8)
	})
	test('a queued edit is immutable, idempotent and keeps its FIFO slot before later input', async () => {
		const original = input(),
			first = await admit(owner, original)
		const later = await admit(owner, {
			...input(),
			text: 'Later unrelated detail.',
			target: { kind: 'existing', id: first.intentId }
		})
		const edit: InputAdmission = {
			...input(),
			text: 'Use recycled clay instead.',
			target: { kind: 'existing', id: first.intentId },
			replaces: { turnId: first.turnId, expectedControlRevision: 1 }
		}
		const saved = await Promise.all(Array.from({ length: 5 }, () => admit(owner, edit)))
		for (const replay of saved) expect(replay).toEqual(saved[0])
		const replacement = saved[0],
			queue = new IntentTurnOutbox(pool)
		expect(replacement.sequence).toBeGreaterThan(later.sequence)
		expect((await queue.claim(scope, first.turnId)).state).toBe('cancelled')
		expect((await queue.claim(scope, later.turnId)).state).toBe('waiting')
		const claim = await queue.claim(scope, replacement.turnId)
		if (claim.state !== 'claimed') throw Error('Expected edited work first')
		const run = randomUUID()
		await queue.dispatched(scope, replacement.turnId, claim.dispatch.token, run)
		const history = await queue.history(scope, replacement.turnId, run)
		expect(history.contributions.find((c) => c.id === first.contributionId)?.text).toBe(
			original.text
		)
		expect(history.contributions.find((c) => c.id === first.contributionId)?.work_state).toBe(
			'cancelled'
		)
		expect(history.contributions.some((c) => c.id === later.contributionId)).toBe(false)
		const detail = await store.detail(owner, first.intentId)
		expect(
			detail.contributions.filter((c) => c.contributorKind === 'human').map((c) => c.text)
		).toEqual([original.text, 'Later unrelated detail.', edit.text])
		const state = (await store.turns(owner, first.intentId, 1)).turns.find(
			(t) => t.turnId === first.turnId
		)
		expect(state?.reason).toBe('INPUT_REPLACED')
		await expect(admit(owner, { ...edit, text: 'Changed retry' })).rejects.toThrow(
			'different material'
		)
	})
	test('competing queued edits cannot both replace the same predecessor', async () => {
		const first = await admit(owner, input())
		const edit: InputAdmission = {
			...input(),
			target: { kind: 'existing', id: first.intentId },
			replaces: { turnId: first.turnId, expectedControlRevision: 1 }
		}
		const attempts = await Promise.allSettled([
			admit(owner, edit),
			admit(owner, { ...edit, inputId: randomUUID(), text: 'Competing edit.' })
		])
		expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1)
		expect(attempts.filter((a) => a.status === 'rejected')).toHaveLength(1)
		expect(
			(
				await pool.query(
					'SELECT count(*)::int AS count FROM turn_outbox WHERE replaces_turn_id=$1',
					[first.turnId]
				)
			).rows[0].count
		).toBe(1)
	})
	test('successive edits keep one FIFO slot and their final answer precedes later follow-ups', async () => {
		const queue = new IntentTurnOutbox(pool),
			first = await admit(owner, input())
		const later = await admit(owner, {
			...input(),
			target: { kind: 'existing', id: first.intentId }
		})
		let latest = first
		for (const text of ['Use blue glaze.', 'Use green glaze.', 'Leave the clay unglazed.']) {
			latest = await admit(owner, {
				...input(),
				text,
				target: { kind: 'existing', id: first.intentId },
				replaces: { turnId: latest.turnId, expectedControlRevision: 1 }
			})
			expect((await queue.claim(scope, later.turnId)).state).toBe('waiting')
		}
		const rows = (
			await pool.query(
				'SELECT queue_position,queue_revision,state FROM turn_outbox WHERE intent_id=$1 ORDER BY queue_position,queue_revision',
				[first.intentId]
			)
		).rows
		expect(rows.slice(0, 4).map((row) => Number(row.queue_position))).toEqual(
			Array(4).fill(first.sequence)
		)
		expect(rows.slice(0, 4).map((row) => row.queue_revision)).toEqual([1, 2, 3, 4])
		expect(rows.slice(0, 4).map((row) => row.state)).toEqual([
			'cancelled',
			'cancelled',
			'cancelled',
			'pending'
		])
		const claim = await queue.claim(scope, latest.turnId),
			run = randomUUID()
		if (claim.state !== 'claimed') throw Error('Expected final edit first')
		await queue.dispatched(scope, latest.turnId, claim.dispatch.token, run)
		const output = await queue.finish(scope, latest.turnId, run, {
			state: 'completed',
			text: 'The unglazed version is ready.',
			payload: {}
		})
		const nextClaim = await queue.claim(scope, later.turnId),
			nextRun = randomUUID()
		if (nextClaim.state !== 'claimed')
			throw Error('Expected later follow-up after the edit completed')
		await queue.dispatched(scope, later.turnId, nextClaim.dispatch.token, nextRun)
		const history = await queue.history(scope, later.turnId, nextRun)
		expect(
			history.contributions.some(
				(c) => c.id === latest.contributionId && c.work_state === 'completed'
			)
		).toBe(true)
		expect(history.contributions.some((c) => c.id === output)).toBe(true)
		expect(history.contributions.filter((c) => c.work_state === 'cancelled')).toHaveLength(3)
	})
	test('the work certificate binds the predecessor and expected control revision as well as edited text', async () => {
		const first = await admit(owner, input())
		const edit: InputAdmission = {
			...input(),
			target: { kind: 'existing', id: first.intentId },
			replaces: { turnId: first.turnId, expectedControlRevision: 1 }
		}
		const grant = await authority(owner, edit)
		for (const replaces of [
			undefined,
			{ turnId: randomUUID(), expectedControlRevision: 1 },
			{ turnId: first.turnId, expectedControlRevision: 2 }
		])
			await expect(store.admit(owner, { ...edit, replaces }, 1, grant)).rejects.toThrow(
				'authority does not match'
			)
		await expect(store.admission(owner, edit.inputId, 1)).rejects.toThrow('not found')
		expect((await store.turns(owner, first.intentId, 1)).turns[0].state).toBe('queued')
	})
	test('dispatch binding and editing serialize without losing either message or running both versions', async () => {
		const queue = new IntentTurnOutbox(pool)
		for (let attempt = 0; attempt < 6; attempt++) {
			const first = await admit(owner, input()),
				claim = await queue.claim(scope, first.turnId),
				run = randomUUID()
			if (claim.state !== 'claimed') throw Error('Expected reservation')
			const edit: InputAdmission = {
				...input(),
				target: { kind: 'existing', id: first.intentId },
				replaces: { turnId: first.turnId, expectedControlRevision: 1 }
			}
			// Sign first: the race is between the two DB commands, not key work.
			const grant = await authority(owner, edit)
			const [binding, replacement] = await Promise.allSettled([
				queue.dispatched(scope, first.turnId, claim.dispatch.token, run),
				store.admit(owner, edit, 1, grant)
			])
			expect(replacement.status).toBe('fulfilled')
			if (replacement.status !== 'fulfilled') throw Error('Edit must be admitted in either order')
			expect((await queue.claim(scope, replacement.value.turnId)).state).toBe(
				binding.status === 'fulfilled' ? 'waiting' : 'claimed'
			)
			await expect(
				queue.authorizeExecution(scope, first.turnId, run, claim.dispatch.workGrant)
			).rejects.toThrow('no longer authorizes')
		}
	})
	test('an edit invalidates a reserved dispatch before that run can bind or execute', async () => {
		const first = await admit(owner, input()),
			queue = new IntentTurnOutbox(pool)
		const claim = await queue.claim(scope, first.turnId)
		if (claim.state !== 'claimed') throw Error('Expected dispatch reservation')
		const replacement = await admit(owner, {
			...input(),
			target: { kind: 'existing', id: first.intentId },
			replaces: { turnId: first.turnId, expectedControlRevision: 1 }
		})
		await expect(
			queue.dispatched(scope, first.turnId, claim.dispatch.token, randomUUID())
		).rejects.toThrow('Dispatch ownership ended')
		expect((await queue.claim(scope, replacement.turnId)).state).toBe('claimed')
	})
	test('editing started work revokes it and holds its replacement until effects settle', async () => {
		const first = await admit(owner, input()),
			queue = new IntentTurnOutbox(pool)
		const claim = await queue.claim(scope, first.turnId)
		if (claim.state !== 'claimed') throw Error('Expected dispatch')
		const run = randomUUID()
		await queue.dispatched(scope, first.turnId, claim.dispatch.token, run)
		const replacement: InputAdmission = {
			...input(),
			target: { kind: 'existing', id: first.intentId },
			replaces: { turnId: first.turnId, expectedControlRevision: 1 }
		}
		const saved = await admit(owner, replacement)
		expect(await admit(owner, replacement)).toEqual(saved)
		expect((await queue.claim(scope, saved.turnId)).state).toBe('waiting')
		const old = (
			await pool.query(
				'SELECT state,stop_requested_at,error_code FROM turn_outbox WHERE turn_id=$1',
				[first.turnId]
			)
		).rows[0]
		expect(old.state).toBe('blocked')
		expect(old.stop_requested_at).not.toBeNull()
		expect(old.error_code).toBe('INPUT_REPLACED')
		await expect(
			queue.authorizeExecution(scope, first.turnId, run, claim.dispatch.workGrant)
		).rejects.toThrow('no longer authorizes')
		await expect(
			queue.finish(scope, first.turnId, run, {
				state: 'completed',
				text: 'Stale answer',
				payload: {}
			})
		).rejects.toThrow()
	})
	test('an edit after completion stays behind newer running work and retains the original outcome', async () => {
		const queue = new IntentTurnOutbox(pool),
			first = await admit(owner, input())
		const claim = await queue.claim(scope, first.turnId),
			run = randomUUID()
		if (claim.state !== 'claimed') throw Error('Expected dispatch')
		await queue.dispatched(scope, first.turnId, claim.dispatch.token, run)
		const output = await queue.finish(scope, first.turnId, run, {
			state: 'completed',
			text: 'Original result',
			payload: {}
		})
		const next = await admit(owner, {
			...input(),
			target: { kind: 'existing', id: first.intentId }
		})
		const nextClaim = await queue.claim(scope, next.turnId),
			nextRun = randomUUID()
		if (nextClaim.state !== 'claimed') throw Error('Expected newer work')
		await queue.dispatched(scope, next.turnId, nextClaim.dispatch.token, nextRun)
		const edited = await admit(owner, {
			...input(),
			target: { kind: 'existing', id: first.intentId },
			replaces: { turnId: first.turnId, expectedControlRevision: 1 }
		})
		expect((await queue.claim(scope, edited.turnId)).state).toBe('waiting')
		expect(
			(await store.detail(owner, first.intentId)).contributions.find((c) => c.id === output)?.text
		).toBe('Original result')
		await expect(
			queue.authorizeExecution(scope, next.turnId, nextRun, nextClaim.dispatch.workGrant)
		).resolves.toBeUndefined()
		await queue.finish(scope, next.turnId, nextRun, {
			state: 'completed',
			text: 'Newer result',
			payload: {}
		})
		const editedClaim = await queue.claim(scope, edited.turnId),
			editedRun = randomUUID()
		if (editedClaim.state !== 'claimed') throw Error('Expected edit after newer work')
		await queue.dispatched(scope, edited.turnId, editedClaim.dispatch.token, editedRun)
		const context = await queue.executionContext(scope, edited.turnId, editedRun)
		expect(context.replacedRuns).toEqual([
			{
				turnId: first.turnId,
				runId: run,
				subjectId: owner,
				inputId: claim.dispatch.input.inputId,
				inputRevision: 1,
				materialDigest: await admissionDigest(claim.dispatch.input)
			}
		])
		expect(context.replacedRuns.some((reference) => reference.runId === nextRun)).toBe(false)
	})
	test('replacement ancestry rejects altered provenance and caps chains before admitting unusable edits', async () => {
		const first = await admit(owner, input())
		let previous = first
		for (let i = 0; i < 16; i++)
			previous = await admit(owner, {
				...input(),
				target: { kind: 'existing', id: first.intentId },
				replaces: { turnId: previous.turnId, expectedControlRevision: 1 }
			})
		await expect(
			admit(owner, {
				...input(),
				target: { kind: 'existing', id: first.intentId },
				replaces: { turnId: previous.turnId, expectedControlRevision: 1 }
			})
		).rejects.toThrow('inspection bound')
		const another = await admit(owner, input())
		await pool.query(
			"UPDATE input_admissions SET material_digest=repeat('a',64) WHERE turn_id=$1",
			[another.turnId]
		)
		await expect(
			admit(owner, {
				...input(),
				target: { kind: 'existing', id: another.intentId },
				replaces: { turnId: another.turnId, expectedControlRevision: 1 }
			})
		).rejects.toThrow('does not match')
	})
	test('replacement cannot target another owner, Intent or workspace generation', async () => {
		const first = await admit(owner, input()),
			unrelated = await admit(owner, input())
		const edit: InputAdmission = {
			...input(),
			target: { kind: 'existing', id: unrelated.intentId },
			replaces: { turnId: first.turnId, expectedControlRevision: 1 }
		}
		await expect(admit(owner, edit)).rejects.toThrow('not available in this Intent')
		await expect(
			admit(other, { ...edit, target: { kind: 'existing', id: first.intentId } })
		).rejects.toThrow('destination is no longer available')
		await expect(
			admit(owner, { ...edit, target: { kind: 'existing', id: first.intentId } }, 2)
		).rejects.toThrow('workspace changed')
		expect(
			inputAdmissionSchema.safeParse({ ...edit, target: { kind: 'new', title: 'Elsewhere' } })
				.success
		).toBe(false)
	})
	test('replacement ancestry rejects cross-Intent links and cycles even with matching stored digests', async () => {
		for (const foreign of [false, true]) {
			const original = input(),
				first = await admit(owner, original),
				otherIntent = await admit(owner, input())
			// Corrupt only this disposable database. A matching digest alone must not
			// turn an out-of-scope relation or a cycle into permission to read receipts.
			const predecessor = foreign ? otherIntent.turnId : first.turnId
			const corrupt: InputAdmission = {
				...original,
				target: { kind: 'existing', id: first.intentId },
				replaces: { turnId: predecessor, expectedControlRevision: 1 }
			}
			await pool.query('UPDATE turn_outbox SET input=$2,replaces_turn_id=$3 WHERE turn_id=$1', [
				first.turnId,
				corrupt,
				predecessor
			])
			await pool.query('UPDATE input_admissions SET material_digest=$2 WHERE turn_id=$1', [
				first.turnId,
				await admissionDigest(corrupt)
			])
			const edit: InputAdmission = {
				...input(),
				target: { kind: 'existing', id: first.intentId },
				replaces: { turnId: first.turnId, expectedControlRevision: 1 }
			}
			const db = await pool.connect()
			try {
				await db.query('BEGIN')
				await db.query('SELECT id FROM intents WHERE id=$1 FOR UPDATE', [first.intentId])
				await expect(
					replacementHistory(
						db,
						{
							subjectId: owner,
							intentId: first.intentId,
							generation: 1
						},
						first.turnId,
						false
					)
				).rejects.toThrow(foreign ? 'not available in this Intent' : 'inspection bound')
			} finally {
				await db.query('ROLLBACK')
				db.release()
			}
			// Admission can reject a cycle sooner because its root already has a successor.
			await expect(admit(owner, edit)).rejects.toThrow()
			await expect(store.admission(owner, edit.inputId, 1)).rejects.toThrow('not found')
		}
	})
	test('racing revisions of one captured input cannot create two turns', async () => {
		const request = input()
		const results = await Promise.allSettled([
			admit(owner, request),
			admit(owner, { ...request, revision: 2, text: 'Revised words' })
		])
		expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
		expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
		expect(
			(await pool.query('SELECT 1 FROM input_admissions WHERE input_id=$1', [request.inputId]))
				.rowCount
		).toBe(1)
	})
	test('unavailable or unowned targets cannot receive a contribution', async () => {
		const first = await admit(owner, input())
		const request = { ...input(), target: { kind: 'existing' as const, id: first.intentId } }
		await expect(admit(other, request)).rejects.toThrow('no longer available')
		const detail = await store.detail(owner, first.intentId)
		await store.archiveOrRestore(
			owner,
			first.intentId,
			{ id: first.intentId, expectedVersion: detail.version },
			false
		)
		await expect(admit(owner, request)).rejects.toThrow('no longer available')
		expect(
			(await pool.query('SELECT * FROM input_admissions WHERE input_id=$1', [request.inputId])).rows
		).toHaveLength(0)
		expect(await store.admission(owner, first.inputId, 1)).toEqual(first)
		expect(
			(await pool.query('SELECT state FROM turn_outbox WHERE turn_id=$1', [first.turnId])).rows[0]
				.state
		).toBe('cancelled')
		const archived = await store.detail(owner, first.intentId)
		await store.archiveOrRestore(
			owner,
			first.intentId,
			{ id: first.intentId, expectedVersion: archived.version },
			true
		)
		expect(
			(await pool.query('SELECT state FROM turn_outbox WHERE turn_id=$1', [first.turnId])).rows[0]
				.state
		).toBe('cancelled')
	})
	test('failure before outbox commit rolls back the new Intent and human contribution', async () => {
		// An actual database failure at the last write boundary, not a fake repository.
		await pool.query(`CREATE FUNCTION aven_intents.reject_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic interrupted admission'; END $$`)
		await pool.query(
			'CREATE TRIGGER reject_outbox BEFORE INSERT ON turn_outbox FOR EACH ROW EXECUTE FUNCTION aven_intents.reject_outbox()'
		)
		const request = input()
		const before = Number((await pool.query('SELECT count(*) FROM intents')).rows[0].count)
		try {
			await expect(admit(owner, request)).rejects.toThrow('synthetic interrupted admission')
		} finally {
			await pool.query('DROP TRIGGER reject_outbox ON turn_outbox')
			await pool.query('DROP FUNCTION aven_intents.reject_outbox()')
		}
		expect(Number((await pool.query('SELECT count(*) FROM intents')).rows[0].count)).toBe(before)
		await expect(store.admission(owner, request.inputId, 1)).rejects.toThrow('not found')
		expect((await admit(owner, request)).inputId).toBe(request.inputId)
	})
	test('an acknowledged input remains recoverable after its Intent is tombstoned', async () => {
		const request = input(),
			receipt = await admit(owner, request)
		const intent = await store.detail(owner, receipt.intentId)
		await store.tombstone(owner, receipt.intentId, {
			id: receipt.intentId,
			expectedVersion: intent.version
		})
		expect(
			(await pool.query('SELECT state FROM turn_outbox WHERE turn_id=$1', [receipt.turnId])).rows[0]
				.state
		).toBe('cancelled')
		expect(await store.admission(owner, request.inputId, request.revision)).toEqual(receipt)
		expect(await admit(owner, request)).toEqual(receipt)
	})
	test('paused work retains receipts but refuses new admission', async () => {
		const request = input(),
			receipt = await admit(owner, request)
		await pool.query('UPDATE aven_platform.environment_identity SET execution_enabled=false')
		try {
			expect(await admit(owner, request)).toEqual(receipt)
			await expect(admit(owner, input())).rejects.toThrow('work is paused')
		} finally {
			await pool.query('UPDATE aven_platform.environment_identity SET execution_enabled=true')
		}
		await expect(admit(owner, input(), 2)).rejects.toThrow('workspace changed')
	})
	const scope = { subjectId: owner, environmentId, generation: 1 }
	test('stopping queued work is idempotent, scoped and releases only its own FIFO position', async () => {
		const queue = new IntentTurnOutbox(pool),
			first = await admit(owner, input())
		const next = await admit(owner, {
			...input(),
			target: { kind: 'existing', id: first.intentId }
		})
		const command = { commandId: randomUUID(), expectedControlRevision: 1 }
		await expect(store.stopTurn(other, first.intentId, first.turnId, 1, command)).rejects.toThrow(
			'not found'
		)
		const foreignIntent = await admit(owner, input())
		await expect(
			store.stopTurn(owner, foreignIntent.intentId, first.turnId, 1, command)
		).rejects.toThrow('not found')
		await expect(store.stopTurn(owner, first.intentId, first.turnId, 2, command)).rejects.toThrow(
			'workspace changed'
		)
		const receipts = await Promise.all(
			Array.from({ length: 8 }, () =>
				store.stopTurn(owner, first.intentId, first.turnId, 1, command)
			)
		)
		for (const receipt of receipts) expect(receipt).toEqual(receipts[0])
		expect(receipts[0].disposition).toBe('cancelled')
		expect(receipts[0].controlRevision).toBe(2)
		expect(
			(await store.detail(owner, first.intentId)).contributions.filter(
				(c) => c.kind === 'turn-stop-requested'
			)
		).toHaveLength(1)
		const state = (await store.turns(owner, first.intentId, 1)).turns.find(
			(t) => t.turnId === first.turnId
		)!
		expect(state.state).toBe('cancelled')
		expect(state.finishedAt).not.toBeNull()
		expect(state.stopRequestedAt).not.toBeNull()
		expect((await queue.claim(scope, next.turnId)).state).toBe('claimed')
		expect((await queue.claim(scope, foreignIntent.turnId)).state).toBe('claimed')
		await expect(
			store.stopTurn(owner, first.intentId, first.turnId, 1, {
				...command,
				expectedControlRevision: 2
			})
		).rejects.toThrow('different material')
		await expect(
			store.stopTurn(owner, first.intentId, first.turnId, 1, {
				...command,
				commandId: randomUUID()
			})
		).rejects.toThrow('controls changed')
		expect(await store.admission(owner, first.inputId, 1)).toEqual(first)
	})
	test('stop withdraws an active dispatch and holds a bound effect until reconciliation', async () => {
		const queue = new IntentTurnOutbox(pool),
			first = await admit(owner, input())
		const claim = await queue.claim(scope, first.turnId),
			runId = randomUUID()
		if (claim.state !== 'claimed') throw Error('Expected dispatch')
		await queue.dispatched(scope, first.turnId, claim.dispatch.token, runId)
		const next = await admit(owner, {
			...input(),
			target: { kind: 'existing', id: first.intentId }
		})
		await pool.query(`UPDATE turn_outbox SET error_code='EXECUTION_UNCERTAIN' WHERE turn_id=$1`, [
			first.turnId
		])
		const receipt = await store.stopTurn(owner, first.intentId, first.turnId, 1, {
			commandId: randomUUID(),
			expectedControlRevision: 1
		})
		expect(receipt.disposition).toBe('stopping')
		const state = (await store.turns(owner, first.intentId, 1)).turns.find(
			(t) => t.turnId === first.turnId
		)!
		expect(state.state).toBe('stopping')
		expect(state.reason).toBe('EXECUTION_UNCERTAIN')
		expect(state.finishedAt).toBeNull()
		expect((await queue.claim(scope, next.turnId)).state).toBe('waiting')
		await expect(
			queue.authorizeExecution(scope, first.turnId, runId, claim.dispatch.workGrant)
		).rejects.toThrow('no longer authorizes')
		await expect(
			queue.finish(scope, first.turnId, runId, {
				state: 'completed',
				text: 'Late answer',
				payload: {}
			})
		).rejects.toThrow('no longer executing')
		const unbound = await admit(owner, input()),
			pending = await queue.claim(scope, unbound.turnId)
		if (pending.state !== 'claimed') throw Error('Expected pending dispatch')
		await store.stopTurn(owner, unbound.intentId, unbound.turnId, 1, {
			commandId: randomUUID(),
			expectedControlRevision: 1
		})
		await expect(
			queue.dispatched(scope, unbound.turnId, pending.dispatch.token, randomUUID())
		).rejects.toThrow('ownership ended')
	})
	test('stop stays available while execution is paused and never rewrites a completed answer', async () => {
		const queue = new IntentTurnOutbox(pool),
			first = await admit(owner, input())
		const claim = await queue.claim(scope, first.turnId),
			runId = randomUUID()
		if (claim.state !== 'claimed') throw Error('Expected dispatch')
		await queue.dispatched(scope, first.turnId, claim.dispatch.token, runId)
		const outputId = await queue.finish(scope, first.turnId, runId, {
			state: 'completed',
			text: 'Saved before stop.',
			payload: {}
		})
		const next = await admit(owner, input())
		await pool.query('UPDATE aven_platform.environment_identity SET execution_enabled=false')
		try {
			const receipt = await store.stopTurn(owner, first.intentId, first.turnId, 1, {
				commandId: randomUUID(),
				expectedControlRevision: 1
			})
			expect(receipt.disposition).toBe('finished')
			expect(receipt.controlRevision).toBe(1)
			expect((await store.turns(owner, first.intentId, 1)).turns[0].outputContributionId).toBe(
				outputId
			)
			expect(
				(
					await store.stopTurn(owner, next.intentId, next.turnId, 1, {
						commandId: randomUUID(),
						expectedControlRevision: 1
					})
				).disposition
			).toBe('cancelled')
		} finally {
			await pool.query('UPDATE aven_platform.environment_identity SET execution_enabled=true')
		}
	})
	test('queue projections are bounded, owned, honest about expiry and free of private work material', async () => {
		const queue = new IntentTurnOutbox(pool),
			first = await admit(owner, input())
		const second = await admit(owner, {
			...input(),
			target: { kind: 'existing', id: first.intentId }
		})
		const page = await store.turns(owner, first.intentId, 1, { limit: 1 })
		expect(page.turns.map((t) => t.turnId)).toEqual([second.turnId])
		expect(page.turns[0].state).toBe('queued')
		expect(page.turns[0].responseId).toMatch(/^[0-9a-f-]{36}$/)
		expect(page.turns[0].outputContributionId).toBeNull()
		expect(page.hasMore).toBe(true)
		const next = await store.turns(owner, first.intentId, 1, { cursor: page.nextCursor!, limit: 1 })
		expect(next.turns.map((t) => t.turnId)).toEqual([first.turnId])
		expect(next.hasMore).toBe(false)
		await expect(store.turns(other, first.intentId, 1)).rejects.toThrow('not found')
		const foreign = await admit(other, input())
		await expect(
			store.turns(other, foreign.intentId, 1, { cursor: page.nextCursor! })
		).rejects.toThrow('Cursor')
		await expect(
			store.turns(owner, first.intentId, 2, { cursor: page.nextCursor! })
		).rejects.toThrow('Cursor')
		const claimed = await queue.claim(scope, first.turnId),
			runId = randomUUID()
		if (claimed.state !== 'claimed') throw Error('Expected dispatch claim')
		await queue.dispatched(scope, first.turnId, claimed.dispatch.token, runId)
		const accepted = (await store.turns(owner, first.intentId, 1)).turns[1]
		expect(accepted.state).toBe('accepted')
		expect(accepted.acceptedAt).not.toBeNull()
		expect(accepted.outputContributionId).toBeNull()
		expect(accepted.responseId).toBe(next.turns[0].responseId)
		const body = JSON.stringify(accepted)
		for (const secret of [
			claimed.dispatch.workGrant,
			claimed.dispatch.input.text,
			claimed.dispatch.token,
			runId
		])
			expect(body).not.toContain(secret)
		expect((await store.turns(owner, first.intentId, 2)).turns[1].reason).toBe('WORKSPACE_CHANGED')
		const output = await queue.finish(scope, first.turnId, runId, {
			state: 'completed',
			text: 'Which topic would you like to discuss?',
			payload: {}
		})
		expect(output).toBe(accepted.responseId)
		await pool.query(
			`UPDATE turn_outbox SET authority_expires_at=clock_timestamp()-interval '1 second' WHERE intent_id=$1`,
			[first.intentId]
		)
		const expired = (await store.turns(owner, first.intentId, 1)).turns
		expect(expired[0].state).toBe('blocked')
		expect(expired[0].reason).toBe('WORK_AUTHORITY_EXPIRED')
		expect(expired[1].state).toBe('completed')
		expect(expired[1].reason).toBeNull()
		expect(expired[1].outputContributionId).toBe(output)
		expect(expired[1].finishedAt).not.toBeNull()
		expect(
			(await pool.query('SELECT state FROM turn_outbox WHERE turn_id=$1', [second.turnId])).rows[0]
				.state
		).toBe('pending')
		await pool.query(
			`UPDATE turn_outbox SET state='blocked',error_code='EXECUTION_UNCERTAIN' WHERE turn_id=$1`,
			[second.turnId]
		)
		expect((await store.turns(owner, first.intentId, 1)).turns[0].reason).toBe(
			'EXECUTION_UNCERTAIN'
		)
		await pool.query(
			`UPDATE turn_outbox SET error_code='internal diagnostic must not reach the projection' WHERE turn_id=$1`,
			[second.turnId]
		)
		expect((await store.turns(owner, first.intentId, 1)).turns[0].reason).toBe('WORK_INTERRUPTED')
		const detail = await store.detail(owner, first.intentId)
		await store.archiveOrRestore(
			owner,
			first.intentId,
			{ id: first.intentId, expectedVersion: detail.version },
			false
		)
		expect((await store.turns(owner, first.intentId, 1)).turns[0]).toMatchObject({
			state: 'cancelled',
			reason: 'INTENT_UNAVAILABLE'
		})
		await store.tombstone(owner, first.intentId, {
			id: first.intentId,
			expectedVersion: (await store.detail(owner, first.intentId)).version
		})
		await expect(store.turns(owner, first.intentId, 1)).rejects.toThrow('not found')
	})
	test('turn dispatch is FIFO per Intent, independent across Intents, and fenced between dispatchers', async () => {
		const queue = new IntentTurnOutbox(pool),
			first = await admit(owner, input())
		const second = await admit(owner, {
			...input(),
			target: { kind: 'existing', id: first.intentId }
		})
		const separate = await admit(owner, input())
		expect(await queue.claim(scope, second.turnId)).toEqual({ state: 'waiting' })
		const raced = await Promise.all(
			Array.from({ length: 8 }, () => queue.claim(scope, first.turnId))
		)
		expect(raced.filter((claim) => claim.state === 'claimed')).toHaveLength(1)
		expect((await queue.claim(scope, separate.turnId)).state).toBe('claimed')
		const claim = raced.find((claim) => claim.state === 'claimed')!
		if (claim.state !== 'claimed') throw Error('No claimed turn')
		const runId = randomUUID()
		await expect(queue.dispatched(scope, first.turnId, randomUUID(), runId)).rejects.toThrow(
			'ownership ended'
		)
		await queue.dispatched(scope, first.turnId, claim.dispatch.token, runId)
		await queue.dispatched(scope, first.turnId, claim.dispatch.token, runId)
		expect((await queue.claim(scope, first.turnId)).state).toBe('dispatched')
		expect((await queue.claim(scope, second.turnId)).state).toBe('waiting')
		const result = {
			state: 'completed' as const,
			text: 'Which workshop topic should we start with?',
			payload: {}
		}
		const outputs = await Promise.all(
			Array.from({ length: 8 }, () => queue.finish(scope, first.turnId, runId, result))
		)
		expect(new Set(outputs).size).toBe(1)
		expect(outputs[0]).toBe(claim.dispatch.outputId)
		expect(
			(await pool.query('SELECT 1 FROM contributions WHERE id=$1', [outputs[0]])).rowCount
		).toBe(1)
		await expect(
			queue.finish(scope, first.turnId, runId, { ...result, text: 'A different answer' })
		).rejects.toThrow('different result')
		expect((await queue.claim(scope, second.turnId)).state).toBe('claimed')
	})
	test('expired dispatch can be reclaimed but its old acknowledgement cannot steal ownership', async () => {
		const queue = new IntentTurnOutbox(pool),
			receipt = await admit(owner, input())
		const first = await queue.claim(scope, receipt.turnId)
		if (first.state !== 'claimed') throw Error('No claimed turn')
		await pool.query(
			`UPDATE turn_outbox SET dispatch_until=clock_timestamp()-interval '1 second' WHERE turn_id=$1`,
			[receipt.turnId]
		)
		const second = await queue.claim(scope, receipt.turnId)
		if (second.state !== 'claimed') throw Error('No reclaimed turn')
		expect(second.dispatch.token).not.toBe(first.dispatch.token)
		expect(second.dispatch.contextSequence).toBe(first.dispatch.contextSequence)
		expect(second.dispatch.outputId).toBe(first.dispatch.outputId)
		const runId = randomUUID()
		await expect(
			queue.dispatched(scope, receipt.turnId, first.dispatch.token, runId)
		).rejects.toThrow('ownership ended')
		await queue.dispatched(scope, receipt.turnId, second.dispatch.token, runId)
	})
	test('a queued turn sees prior answers but not future queued user requests', async () => {
		const queue = new IntentTurnOutbox(pool),
			first = await admit(owner, input())
		const second = await admit(owner, {
			...input(),
			target: { kind: 'existing', id: first.intentId },
			text: 'Use the smaller room.'
		})
		const third = await admit(owner, {
			...input(),
			target: { kind: 'existing', id: first.intentId },
			text: 'Another topic for later.'
		})
		const one = await queue.claim(scope, first.turnId),
			run1 = randomUUID()
		if (one.state !== 'claimed') throw Error('No claimed turn')
		await queue.dispatched(scope, first.turnId, one.dispatch.token, run1)
		const history1 = await queue.history(scope, first.turnId, run1)
		expect(
			history1.contributions.some((c) =>
				[first.contributionId, second.contributionId, third.contributionId].includes(c.id)
			)
		).toBe(false)
		const answerId = await queue.finish(scope, first.turnId, run1, {
			state: 'completed',
			text: 'Which room?',
			payload: {}
		})
		const two = await queue.claim(scope, second.turnId),
			run2 = randomUUID()
		if (two.state !== 'claimed') throw Error('No second claimed turn')
		await queue.dispatched(scope, second.turnId, two.dispatch.token, run2)
		const history2 = await queue.history(scope, second.turnId, run2)
		expect(history2.contributions.map((c) => c.id)).toContain(first.contributionId)
		expect(history2.contributions.map((c) => c.id)).toContain(answerId)
		expect(
			history2.contributions.some((c) =>
				[second.contributionId, third.contributionId].includes(c.id)
			)
		).toBe(false)
		await store.append(owner, first.intentId, {
			id: randomUUID(),
			contributorKind: 'human',
			kind: 'message',
			text: 'Later manual note',
			payload: {}
		})
		expect(await queue.history(scope, second.turnId, run2)).toEqual(history2)
	})
	test('archive withdraws bound work without releasing an uncertain effect on restoration', async () => {
		const queue = new IntentTurnOutbox(pool),
			receipt = await admit(owner, input()),
			run = randomUUID()
		const claim = await queue.claim(scope, receipt.turnId)
		if (claim.state !== 'claimed') throw Error('No claimed turn')
		await queue.dispatched(scope, receipt.turnId, claim.dispatch.token, run)
		const intent = await store.detail(owner, receipt.intentId)
		await store.archiveOrRestore(
			owner,
			intent.id,
			{ id: intent.id, expectedVersion: intent.version },
			false
		)
		await expect(
			queue.finish(scope, receipt.turnId, run, {
				state: 'completed',
				text: 'Late response',
				payload: {}
			})
		).rejects.toThrow('no longer executing')
		expect(
			(await pool.query('SELECT 1 FROM contributions WHERE id=$1', [claim.dispatch.outputId]))
				.rowCount
		).toBe(0)
		expect((await store.turns(owner, receipt.intentId, 1)).turns[0]).toMatchObject({
			state: 'blocked',
			reason: 'INTENT_UNAVAILABLE'
		})
		const archived = await store.detail(owner, receipt.intentId)
		await store.archiveOrRestore(
			owner,
			archived.id,
			{ id: archived.id, expectedVersion: archived.version },
			true
		)
		const following = await admit(owner, {
			...input(),
			target: { kind: 'existing', id: receipt.intentId }
		})
		expect((await queue.claim(scope, following.turnId)).state).toBe('waiting')
		await expect(
			queue.authorizeExecution(scope, receipt.turnId, run, claim.dispatch.workGrant)
		).rejects.toThrow('no longer authorizes')
		await expect(
			queue.dispatched(scope, receipt.turnId, claim.dispatch.token, run)
		).rejects.toThrow('ownership ended')
		expect((await queue.claim(scope, (await admit(owner, input())).turnId)).state).toBe('claimed')
		await pool.query(`UPDATE turn_outbox SET error_code='EXECUTION_UNCERTAIN' WHERE turn_id=$1`, [
			receipt.turnId
		])
		const restored = await store.detail(owner, receipt.intentId)
		await store.archiveOrRestore(
			owner,
			restored.id,
			{ id: restored.id, expectedVersion: restored.version },
			false
		)
		expect(
			(await store.turns(owner, receipt.intentId, 1)).turns.find((t) => t.turnId === receipt.turnId)
				?.reason
		).toBe('EXECUTION_UNCERTAIN')
	})
	test('expired work blocks only its own queue, while unknown owners and generations cannot claim', async () => {
		const queue = new IntentTurnOutbox(pool),
			first = await admit(owner, input())
		const second = await admit(owner, {
			...input(),
			target: { kind: 'existing', id: first.intentId }
		})
		const separate = await admit(owner, input())
		await pool.query(
			`UPDATE turn_outbox SET authority_expires_at=clock_timestamp()-interval '1 second' WHERE turn_id=$1`,
			[first.turnId]
		)
		expect((await queue.claim(scope, first.turnId)).state).toBe('blocked')
		expect((await queue.claim(scope, second.turnId)).state).toBe('waiting')
		await expect(queue.claim({ ...scope, subjectId: other }, separate.turnId)).rejects.toThrow(
			'not found'
		)
		await expect(queue.claim({ ...scope, generation: 2 }, separate.turnId)).rejects.toThrow(
			'different workspace generation'
		)
		expect((await queue.claim(scope, separate.turnId)).state).toBe('claimed')
	})
	test('failed final publication cannot release the next turn without its durable answer', async () => {
		const queue = new IntentTurnOutbox(pool),
			first = await admit(owner, input()),
			run = randomUUID()
		const second = await admit(owner, {
			...input(),
			target: { kind: 'existing', id: first.intentId }
		})
		const claim = await queue.claim(scope, first.turnId)
		if (claim.state !== 'claimed') throw Error('No claimed turn')
		await queue.dispatched(scope, first.turnId, claim.dispatch.token, run)
		await pool.query(`CREATE FUNCTION aven_intents.reject_finish() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.finished_at IS NOT NULL THEN RAISE EXCEPTION 'synthetic publication failure'; END IF; RETURN NEW; END $$`)
		await pool.query(
			'CREATE TRIGGER reject_finish BEFORE UPDATE ON turn_outbox FOR EACH ROW EXECUTE FUNCTION aven_intents.reject_finish()'
		)
		const result = {
			state: 'failed' as const,
			text: 'The answer could not be completed. Saved results remain available.',
			payload: {}
		}
		try {
			await expect(queue.finish(scope, first.turnId, run, result)).rejects.toThrow(
				'synthetic publication failure'
			)
		} finally {
			await pool.query('DROP TRIGGER reject_finish ON turn_outbox')
			await pool.query('DROP FUNCTION aven_intents.reject_finish()')
		}
		expect(
			(await pool.query('SELECT 1 FROM contributions WHERE id=$1', [claim.dispatch.outputId]))
				.rowCount
		).toBe(0)
		expect((await queue.claim(scope, second.turnId)).state).toBe('waiting')
		await queue.finish(scope, first.turnId, run, result)
		expect((await queue.claim(scope, second.turnId)).state).toBe('claimed')
	})
})
