import { ActorId } from "typed-actors";
import { hashSchema, type SchemaRef } from "./domain.ts";
import {
  listBundledSchemaBindings,
  type BundledSchemaBinding,
} from "./actors/registry/catalog.ts";
import type { ActorId as ActorIdType, ActorSystem } from "typed-actors";
import type { SchemaActorState } from "./subsystem.ts";

export class DefaultSchemaBootstrapConflictError extends Error {
  readonly schemaRef: SchemaRef;
  readonly existingSchemaHash: string;
  readonly attemptedSchemaHash: string;

  constructor(args: { schemaRef: SchemaRef; existingSchemaHash: string; attemptedSchemaHash: string }) {
    super(
      `Default schema bootstrap conflict for '${args.schemaRef.schemaId}@${args.schemaRef.version}': existing hash ${args.existingSchemaHash} does not match attempted hash ${args.attemptedSchemaHash}.`,
    );
    this.name = "DefaultSchemaBootstrapConflictError";
    this.schemaRef = args.schemaRef;
    this.existingSchemaHash = args.existingSchemaHash;
    this.attemptedSchemaHash = args.attemptedSchemaHash;
  }
}

export class DefaultSchemaBootstrapDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DefaultSchemaBootstrapDefinitionError";
  }
}

function schemaActorId(schemaId: string): ActorId {
  return ActorId.root("aven").child("system").child("schemas").child(schemaId);
}

function registryRef() {
  return { id: ActorId.root("aven").child("system").child("schemas"), kind: "schemaRegistry" as never };
}

function validateBinding(binding: BundledSchemaBinding) {
  if (binding.version === "latest") {
    throw new DefaultSchemaBootstrapDefinitionError(`Default schema binding '${binding.schemaId}' must not use version 'latest'.`);
  }
  if (binding.definition.id !== binding.schemaId) {
    throw new DefaultSchemaBootstrapDefinitionError(
      `Default schema binding mismatch: schemaId '${binding.schemaId}' does not match definition.id '${binding.definition.id}'.`,
    );
  }
}

export async function bootstrapBundledSchemas(system: Pick<ActorSystem<any>, "send" | "runUntilIdle" | "inspector">): Promise<void> {
  const bindings = listBundledSchemaBindings();
  for (const binding of bindings) {
    validateBinding(binding);
    await system.send(registryRef(), {
      type: "registerSchemaVersion",
      schemaId: binding.schemaId,
      version: binding.version,
      schema: binding.definition.schema,
    } as never);
  }

  await system.runUntilIdle();

  for (const binding of bindings) {
    const actor = await system.inspector.getActor(schemaActorId(binding.schemaId));
    const state = actor?.actor.state as SchemaActorState | undefined;
    const registered = state?.versions[binding.version];
    const attemptedSchemaHash = hashSchema(binding.definition.schema);
    if (!registered) {
      throw new DefaultSchemaBootstrapDefinitionError(
        `Default schema '${binding.schemaId}@${binding.version}' was not registered during bootstrap.`,
      );
    }
    if (registered.schemaHash !== attemptedSchemaHash) {
      throw new DefaultSchemaBootstrapConflictError({
        schemaRef: { schemaId: binding.schemaId, version: binding.version },
        existingSchemaHash: registered.schemaHash,
        attemptedSchemaHash,
      });
    }
  }
}

export async function bootstrapDefaultExtractionSchemas(system: Pick<ActorSystem<any>, "send" | "runUntilIdle" | "inspector">): Promise<void> {
  await bootstrapBundledSchemas(system);
}