import type { Manifest } from './actor'
import type { CapabilityId, SchemaId } from './ids'
import { definitionFromManifest, type ActorDefinition, type ExecutionEnvironment } from './registry'
import { parseStudioPublicParametersSchema } from './studio/v2'

/** Serializable, release-installed contract data. No executable import path or address. */
export interface ActorInstallationDescriptor {
	packageId: string
	manifest: Manifest
	placements: ExecutionEnvironment[]
	schemas: Array<{
		schema: SchemaId
		typeKey: string
		typeVersion: number
		projectorDigest: string
	}>
	procedures: Array<{
		capabilityId: CapabilityId
		procedureKey: string
		procedureVersion: string
		implementationDigest: string
		evidenceRuleDigest: string
		requiredFeatures: string[]
	}>
}

export interface TrustedActorInstallation {
	descriptor: ActorInstallationDescriptor
	definition: ActorDefinition
	digest: string
}

export interface ActorInstallationInventoryEntry {
	packageId: string
	actorId: string
	capabilityId: CapabilityId
	method: string
	mode: NonNullable<Manifest['methods'][number]['mode']> | 'unspecified'
	placements: ExecutionEnvironment[]
	contractDigest: string
	disposition: 'proof-producing' | 'non-proof' | 'contract-incomplete'
	reasonCodes: string[]
}

/**
 * The host passes an allowlisted set of descriptors. Executable factories,
 * projectors, authorizers and Store credentials remain separate host ports.
 */
export class TrustedActorInstallations {
	readonly #byRef = new Map<string, TrustedActorInstallation>()

	async install(raw: ActorInstallationDescriptor): Promise<TrustedActorInstallation> {
		const descriptor = structuredClone(raw)
		const definition = definitionFromManifest(descriptor.manifest)
		validateDescriptor(descriptor, definition)
		const digest = await sha256(canonical(descriptor))
		const existing = this.#byRef.get(definition.ref)
		if (existing) {
			if (existing.digest !== digest || existing.descriptor.packageId !== descriptor.packageId)
				throw new Error(`ACTOR_INSTALLATION_IDENTITY_CONFLICT: ${definition.ref}`)
			return existing
		}
		const installation = deepFreeze({ descriptor, definition, digest })
		this.#byRef.set(definition.ref, installation)
		return installation
	}

	get(ref: string): TrustedActorInstallation | undefined {
		return this.#byRef.get(ref)
	}

	list(): TrustedActorInstallation[] {
		return [...this.#byRef.values()].sort((a, b) => a.definition.ref.localeCompare(b.definition.ref))
	}

	/** Complete method inventory without materializing any Actor or touching an offer. */
	inventory(): ActorInstallationInventoryEntry[] {
		return this.list().flatMap(({ descriptor, definition, digest }) =>
			definition.capabilities.map((capability) => {
				const method = descriptor.manifest.methods.find((item) => item.name === capability.method)!
				const reasons = methodInventoryIssues(descriptor, capability.id, method,
					capability.requires.length, capability.produces.length)
				return {
					packageId: descriptor.packageId,
					actorId: definition.ref,
					capabilityId: capability.id,
					method: method.name,
					mode: method.mode ?? 'unspecified',
					placements: [...descriptor.placements],
					contractDigest: digest,
					disposition: reasons.length ? 'contract-incomplete' : capability.produces.length
						? 'proof-producing' : 'non-proof',
					reasonCodes: reasons
				} as ActorInstallationInventoryEntry
			})
		).sort((a, b) => a.capabilityId.localeCompare(b.capabilityId))
	}

	async digest(): Promise<string> {
		return sha256(this.list().map((item) => `${item.definition.ref}\0${item.digest}`).join('\n'))
	}
}

function validateDescriptor(descriptor: ActorInstallationDescriptor, definition: ActorDefinition): void {
	if (!exactKeys(descriptor, ['packageId', 'manifest', 'placements', 'schemas', 'procedures']) ||
		!descriptor.packageId || descriptor.packageId.length > 256 ||
		!Array.isArray(descriptor.placements) || descriptor.placements.length === 0 ||
		!descriptor.placements.every((placement) => placement === 'local' || placement === 'server') ||
		new Set(descriptor.placements).size !== descriptor.placements.length ||
		!Array.isArray(descriptor.schemas) || !Array.isArray(descriptor.procedures))
		throw new Error('ACTOR_INSTALLATION_INVALID')
	if (new Set(definition.capabilities.map((capability) => capability.id)).size !==
		definition.capabilities.length)
		throw new Error('ACTOR_INSTALLATION_DUPLICATE_METHOD')
	const schemas = new Set<string>()
	for (const binding of descriptor.schemas) {
		if (!exactKeys(binding, ['schema', 'typeKey', 'typeVersion', 'projectorDigest']) ||
			typeof binding.schema !== 'string' || !binding.schema || binding.schema.length > 160 ||
			!typeKey(binding.typeKey) || !Number.isInteger(binding.typeVersion) ||
			binding.typeVersion < 1 || binding.typeVersion > 10_000 ||
			!hexDigest(binding.projectorDigest) || schemas.has(binding.schema))
			throw new Error('ACTOR_INSTALLATION_SCHEMA_INVALID')
		schemas.add(binding.schema)
	}
	const known = new Set(definition.capabilities.map((capability) => capability.id))
	const procedures = new Set<string>()
	for (const binding of descriptor.procedures) {
		if (!exactKeys(binding, ['capabilityId', 'procedureKey', 'procedureVersion',
			'implementationDigest', 'evidenceRuleDigest', 'requiredFeatures']) ||
			!known.has(binding.capabilityId) || procedures.has(binding.capabilityId) ||
			!binding.procedureKey || !binding.procedureVersion ||
			!hexDigest(binding.implementationDigest) || !hexDigest(binding.evidenceRuleDigest) ||
			!Array.isArray(binding.requiredFeatures) ||
			!binding.requiredFeatures.every((feature) => typeof feature === 'string' && feature.length > 0))
			throw new Error('ACTOR_INSTALLATION_PROCEDURE_INVALID')
		procedures.add(binding.capabilityId)
	}
}

function methodInventoryIssues(
	descriptor: ActorInstallationDescriptor,
	capabilityId: CapabilityId,
	method: Manifest['methods'][number],
	requirements: number,
	guarantees: number
): string[] {
	const issues: string[] = []
	try {
		parseStudioPublicParametersSchema(method.parameters)
	} catch {
		issues.push('PARAMETERS_SCHEMA_UNSUPPORTED')
	}
	if (!method.mode) issues.push('MODE_UNDECLARED')
	if (!method.idempotency) issues.push('RETRY_UNDECLARED')
	if (!descriptor.procedures.some((binding) => binding.capabilityId === capabilityId) &&
		method.mode !== 'view') issues.push('PROCEDURE_UNDECLARED')
	const publicSlots = [...(method.inputSlots ?? []), ...(method.outputSlots ?? [])]
	for (const slot of publicSlots) {
		if (!slot.schema || !slot.role) issues.push('PORT_CONTRACT_INCOMPLETE')
		else if (!slot.sensitive && !descriptor.schemas.some((binding) => binding.schema === slot.schema))
			issues.push('STORE_SCHEMA_UNBOUND')
	}
	if (requirements && !method.inputSlots?.length) issues.push('INPUT_PORTS_UNDECLARED')
	if (guarantees && !method.outputSlots?.length) issues.push('OUTPUT_PORTS_UNDECLARED')
	return [...new Set(issues)]
}

function exactKeys(value: unknown, keys: string[]): boolean {
	return !!value && typeof value === 'object' && !Array.isArray(value) &&
		Object.keys(value).sort().join('\0') === keys.sort().join('\0')
}

function hexDigest(value: string): boolean {
	return /^[0-9a-f]{64}$/.test(value)
}

function typeKey(value: string): boolean {
	return typeof value === 'string' && /^[a-z][a-z0-9.-]{0,127}$/.test(value)
}

async function sha256(value: string): Promise<string> {
	const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
	return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	if (value && typeof value === 'object')
		return `{${Object.entries(value).filter(([, item]) => item !== undefined)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
	return JSON.stringify(value)
}

function deepFreeze<Value>(value: Value): Value {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
	for (const child of Object.values(value)) deepFreeze(child)
	return Object.freeze(value)
}
