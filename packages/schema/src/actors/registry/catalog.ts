import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { JsonValue } from "typed-actors";
import { cloneJsonValue } from "shared";
import { hashSchema, type SchemaRef } from "../../domain.ts";

export interface BundledSchemaDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly merge_spec?: unknown;
  readonly llm_model?: string | null;
  readonly system_prompt?: string;
  readonly schema: JsonValue;
}

export interface BundledSchemaBinding {
  readonly schemaId: string;
  readonly version: string;
  readonly definition: BundledSchemaDefinition;
}

export interface BundledSchemaCatalogEntry {
  readonly schemaId: string;
  readonly version: string;
  readonly schemaHash: string;
  readonly metadata: {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly merge_spec?: unknown;
    readonly llm_model?: string | null;
    readonly system_prompt?: string;
  };
}

function clone<T>(value: T): T {
  return cloneJsonValue(value);
}

function readDefinitionFile(filename: string): BundledSchemaDefinition {
  const fileUrl = new URL(`../../default-schemas/${filename}`, import.meta.url);
  if (existsSync(fileUrl)) {
    return JSON.parse(readFileSync(fileUrl, "utf8")) as BundledSchemaDefinition;
  }
  const cwdCandidate = join(process.cwd(), "packages", "schema", "src", "default-schemas", filename);
  if (existsSync(cwdCandidate)) {
    return JSON.parse(readFileSync(cwdCandidate, "utf8")) as BundledSchemaDefinition;
  }
  return JSON.parse(readFileSync(fileUrl, "utf8")) as BundledSchemaDefinition;
}

const manifest = [
  { schemaId: "invoice", version: "1.0.0", filename: "invoice-core.definition.json" },
  { schemaId: "invoice", version: "1.1.0", filename: "invoice.definition.json" },
  { schemaId: "note", version: "1.0.0", filename: "note.definition.json" },
  { schemaId: "approval-decision", version: "1.0.0", filename: "approval-decision.definition.json" },
  { schemaId: "intent_next_action", version: "1.0.0", filename: "intent-next-action.definition.json" },
  { schemaId: "intent_route_decision", version: "1.0.0", filename: "intent-route-decision.definition.json" },
  { schemaId: "aven:shell-execution-context", version: "v1", filename: "shell-execution-context.definition.json" },
  { schemaId: "bank_statement", version: "1.0.0", filename: "bank-statement.definition.json" },
  { schemaId: "calendar_event", version: "1.0.0", filename: "calendar-event.definition.json" },
  { schemaId: "shipping_delivery", version: "1.0.0", filename: "shipping-delivery.definition.json" },
  { schemaId: "travel_ticket", version: "1.0.0", filename: "travel-ticket.definition.json" },
] as const;

const bundledSchemaBindings = manifest.map((entry) => ({
  schemaId: entry.schemaId,
  version: entry.version,
  definition: readDefinitionFile(entry.filename),
})) satisfies readonly BundledSchemaBinding[];

const bundledSchemaCatalogEntries = bundledSchemaBindings.map((binding) => ({
  schemaId: binding.schemaId,
  version: binding.version,
  schemaHash: hashSchema(binding.definition.schema),
  metadata: clone({
    id: binding.definition.id,
    name: binding.definition.name,
    description: binding.definition.description,
    merge_spec: binding.definition.merge_spec,
    llm_model: binding.definition.llm_model,
    system_prompt: binding.definition.system_prompt,
  }),
})) satisfies readonly BundledSchemaCatalogEntry[];

const catalogByKey = new Map<string, BundledSchemaCatalogEntry>(
  bundledSchemaCatalogEntries.map((entry) => [`${entry.schemaId}@${entry.version}`, entry]),
);

const bindingByKey = new Map<string, BundledSchemaBinding>(
  bundledSchemaBindings.map((binding) => [`${binding.schemaId}@${binding.version}`, binding]),
);

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10));
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10));
  const maxLength = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = Number.isFinite(leftParts[index] ?? NaN) ? (leftParts[index] ?? 0) : 0;
    const rightValue = Number.isFinite(rightParts[index] ?? NaN) ? (rightParts[index] ?? 0) : 0;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }
  return left.localeCompare(right);
}

export function listBundledSchemaBindings(): readonly BundledSchemaBinding[] {
  return bundledSchemaBindings.map((binding) => ({
    schemaId: binding.schemaId,
    version: binding.version,
    definition: clone(binding.definition),
  }));
}

export function listBundledSchemaCatalogEntries(): readonly BundledSchemaCatalogEntry[] {
  return bundledSchemaCatalogEntries.map((entry) => clone(entry));
}

export function getBundledSchemaBinding(schemaRef: SchemaRef): BundledSchemaBinding | undefined {
  const binding = bindingByKey.get(`${schemaRef.schemaId}@${schemaRef.version}`);
  return binding
    ? {
        schemaId: binding.schemaId,
        version: binding.version,
        definition: clone(binding.definition),
      }
    : undefined;
}

export function getBundledSchemaCatalogEntry(schemaRef: SchemaRef): BundledSchemaCatalogEntry | undefined {
  const entry = catalogByKey.get(`${schemaRef.schemaId}@${schemaRef.version}`);
  return entry ? clone(entry) : undefined;
}

export function getCurrentDefaultExtractionSchemaRef(schemaId: string): SchemaRef | undefined {
  const matches = bundledSchemaCatalogEntries
    .filter((entry) => entry.schemaId === schemaId)
    .sort((left, right) => compareVersions(left.version, right.version));
  const latest = matches.at(-1);
  return latest ? { schemaId: latest.schemaId, version: latest.version } : undefined;
}

export function listCurrentDefaultExtractionSchemas(): readonly {
  readonly schemaId: string;
  readonly version: string;
  readonly name: string;
  readonly description: string;
}[] {
  const latestBySchemaId = new Map<string, BundledSchemaCatalogEntry>();
  for (const entry of bundledSchemaCatalogEntries) {
    const current = latestBySchemaId.get(entry.schemaId);
    if (!current || compareVersions(current.version, entry.version) < 0) {
      latestBySchemaId.set(entry.schemaId, entry);
    }
  }
  return [...latestBySchemaId.values()]
    .sort((left, right) => left.schemaId.localeCompare(right.schemaId))
    .map((entry) => ({
      schemaId: entry.schemaId,
      version: entry.version,
      name: entry.metadata.name,
      description: entry.metadata.description,
    }));
}