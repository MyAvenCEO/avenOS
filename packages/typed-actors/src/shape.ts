import type { JsonValue } from "./core/json.js";
import { isJsonValue } from "./core/json.js";
import { defineActor } from "./registry/define-registry.js";
import type { ActorDefinition, ActorPresentationHook } from "./registry/actor-definition.js";
import type { ActorRegistry, KindOf } from "./registry/actor-type.js";
import type { ActorContext } from "./runtime/activation/actor-context.js";
import type { StopReason, RestartReason } from "./runtime/lifecycle/lifecycle-types.js";
import type { ActorFailure, SupervisionDirective } from "./runtime/supervision/supervision-types.js";

/**
 * Shared options supported by all declarative field descriptors.
 *
 * These options are intentionally small in the first implementation slice. They already
 * carry the core semantics needed for boilerplate reduction:
 * - `optional` drives JSON Schema `required` handling
 * - `default` flows into generated input schemas and default debug payloads
 * - `description` is surfaced in generated schema metadata
 *
 * Future phases can extend this with richer markers such as `transient` or validation
 * refinements without changing the overall declaration model.
 */
export interface FieldOptions<T> {
  /** Marks the field as optional in generated object schemas. */
  readonly optional?: boolean;
  /** Marks the field as transient so normalizeState can strip it from persisted state snapshots. */
  readonly transient?: boolean;
  /** Supplies a default value for generated object schemas and debug payloads. */
  readonly default?: T;
  /** Optional human-readable field description carried into generated JSON Schema. */
  readonly description?: string;
}

type PreservedFieldFlags<T, O extends FieldOptions<T>> = Pick<O, Extract<keyof O, "optional" | "transient" | "description">> & FieldOptions<T>;

/**
 * Declarative field descriptor used to infer types and derive runtime JSON Schema.
 *
 * The descriptor is a plain typed object rather than an external DSL so actor contracts
 * remain ordinary TypeScript values that can be inspected, transformed, and composed.
 */
export type FieldDescriptor<T = JsonValue> =
  | ({ readonly kind: "string" } & FieldOptions<T>)
  | ({ readonly kind: "number" } & FieldOptions<T>)
  | ({ readonly kind: "integer" } & FieldOptions<T>)
  | ({ readonly kind: "boolean" } & FieldOptions<T>)
  | ({ readonly kind: "json" } & FieldOptions<T>)
  | ({ readonly kind: "ref" } & FieldOptions<T>)
  | ({ readonly kind: "literal"; readonly value: string | number | boolean | null } & FieldOptions<T>)
  | ({ readonly kind: "enum"; readonly values: readonly (string | number)[] } & FieldOptions<T>)
  | ({ readonly kind: "union"; readonly variants: readonly FieldDescriptor[] } & FieldOptions<T>)
  | ({ readonly kind: "array"; readonly item: FieldDescriptor } & FieldOptions<T>)
  | ({ readonly kind: "object"; readonly fields: Record<string, FieldDescriptor> } & FieldOptions<T>)
  | ({ readonly kind: "schema"; readonly schema: JsonValue } & FieldOptions<T>);

/** Resolves the TypeScript value type represented by a declarative field descriptor. */
export type InferFieldType<F extends FieldDescriptor> =
  F extends FieldDescriptor<infer T>
    ? T
    : never;

/** Scalar literal values accepted directly by `field.union(...)`. */
export type UnionLiteral = string | number | boolean | null;

type OptionalKeys<F extends Record<string, FieldDescriptor>> = {
  [K in keyof F]: F[K] extends { readonly optional?: true } ? K : never;
}[keyof F];

type RequiredKeys<F extends Record<string, FieldDescriptor>> = Exclude<keyof F, OptionalKeys<F>>;

/**
 * Resolves the TypeScript object type represented by a declarative field map.
 *
 * Required keys are inferred from descriptors without `optional: true`. Optional keys are
 * emitted as optional object properties.
 */
export type InferFields<F extends Record<string, FieldDescriptor<any>>> = {
  readonly [K in RequiredKeys<F>]: InferFieldType<F[K]>;
} & {
  readonly [K in OptionalKeys<F>]?: InferFieldType<F[K]>;
};

/**
 * Declarative message descriptor.
 *
 * A message descriptor is just a named field map. The message name becomes the runtime
 * discriminant (`type`) while the field map describes the remaining payload shape.
 */
export interface MessageDescriptor<F extends Record<string, FieldDescriptor<any>> = Record<string, FieldDescriptor<any>>> {
  readonly fields: F;
}

/** Resolves the init input shape from a declarative `state` block. */
export type InferInit<D extends ActorShapeDeclaration> = D["state"] extends Record<string, FieldDescriptor<any>>
  ? Partial<InferFields<D["state"]>>
  : never;

/**
 * Resolves the payload type for a declarative message descriptor.
 */
export type InferMessage<M extends MessageDescriptor, TType extends string> = {
  readonly type: TType;
} & InferFields<M["fields"]>;

/** Resolves a discriminated union of messages from a declarative `messages` block. */
export type InferMessages<M extends Record<string, MessageDescriptor>> = {
  readonly [K in keyof M]: K extends string ? InferMessage<M[K], K> : never;
}[keyof M];

/**
 * Declarative operation descriptor.
 *
 * Operations intentionally mirror the existing `ActionDescriptor` vocabulary so a
 * declaration can replace the current hand-written operation/debug descriptor pair.
 */
export interface OperationDescriptor<F extends Record<string, FieldDescriptor<any>> | undefined = Record<string, FieldDescriptor<any>> | undefined> {
  readonly title?: string;
  readonly description?: string;
  readonly mutates?: boolean;
  readonly dangerous?: boolean;
  readonly input?: F;
  readonly defaultValue?: JsonValue;
}

/**
 * Minimal actor shape used by the first implementation slice.
 *
 * This intentionally focuses on the parts we can derive safely right away:
 * message payload schemas, tree operation descriptors, and debug descriptors. Later phases
 * can extend the same shape with `state`, `init`, `tree`, and receive/runtime helpers.
 */
export interface ActorShapeDeclaration<
  TKind extends string = string,
  TState extends Record<string, FieldDescriptor<any>> = Record<string, FieldDescriptor<any>>,
  TMessages extends Record<string, MessageDescriptor> = Record<string, MessageDescriptor>,
  TOperations extends Record<string, OperationDescriptor | undefined> = Record<string, OperationDescriptor | undefined>,
> {
  readonly kind: TKind;
  readonly state?: TState;
  readonly init?: {
    /** Additional init-time defaults layered on top of field-level defaults. */
    readonly defaults?: Partial<InferFields<TState>>;
  };
  readonly messages?: TMessages;
  readonly operations?: TOperations;
  readonly present?: (state: Readonly<InferFields<TState>>) => {
    readonly title?: string;
    readonly subtitle?: string;
    readonly icon?: string;
    readonly tags?: readonly string[];
    readonly sortKey?: string;
  };
  readonly tree?: {
    /** Optional shape-owned describe-self projection used by tree tooling. */
    readonly describeSelf?: (input: {
      readonly state: Readonly<InferFields<TState>>;
      readonly operations: readonly DerivedActionDescriptor[];
    }) => DerivedRealTreeNodeSpec;
    /** Optional declarative child tree descriptors for common collection and alias patterns. */
    readonly children?: readonly TreeChildDescriptor<InferFields<TState>>[];
  };
}

/**
 * Defines an actor shape declaration with full TypeScript literal preservation.
 *
 * This function is intentionally a typed identity helper. Its job is to capture a single
 * declarative object as the source of truth while preserving literal keys and values for
 * later derivation.
 *
 * @example
 * ```ts
 * const shape = defineActorShape({
 *   kind: "metadata",
 *   messages: {
 *     getMetadataRecord: msg({ recordId: field.string() }),
 *   },
 *   operations: {
 *     getMetadataRecord: op({ title: "Get metadata record" }),
 *   },
 * });
 * ```
 */
export function defineActorShape<const D extends ActorShapeDeclaration>(declaration: D): D {
  validateActorShapeDeclaration(declaration);
  return declaration;
}

/**
 * Namespace of declarative field helpers.
 *
 * Each helper returns a typed runtime descriptor that can later be converted into JSON
 * Schema and, in future phases, reused for message validation and state inference.
 */
export const field = {
  /** Declares a string field. */
  string<const O extends FieldOptions<string> = {}>(options: O = {} as O): ({ readonly kind: "string" } & PreservedFieldFlags<string, O>) {
    return { kind: "string", ...options };
  },
  /** Declares a number field. */
  number<const O extends FieldOptions<number> = {}>(options: O = {} as O): ({ readonly kind: "number" } & PreservedFieldFlags<number, O>) {
    return { kind: "number", ...options };
  },
  /** Declares an integer field. */
  integer<const O extends FieldOptions<number> = {}>(options: O = {} as O): ({ readonly kind: "integer" } & PreservedFieldFlags<number, O>) {
    return { kind: "integer", ...options };
  },
  /** Declares a boolean field. */
  boolean<const O extends FieldOptions<boolean> = {}>(options: O = {} as O): ({ readonly kind: "boolean" } & PreservedFieldFlags<boolean, O>) {
    return { kind: "boolean", ...options };
  },
  /** Declares an unconstrained JSON value field. */
  json<T extends JsonValue = JsonValue, const O extends FieldOptions<T> = {}>(options: O = {} as O): ({ readonly kind: "json" } & PreservedFieldFlags<T, O>) {
    return { kind: "json", ...options };
  },
  /**
   * Declares a typed reference field.
   *
   * This is the escape hatch for complex TypeScript types that should participate in
   * declaration-driven inference even when they are not described inline as field maps.
   * It is especially useful for state slots such as typed record maps.
   */
  ref<T, const O extends FieldOptions<T> = {}>(options: O = {} as O): ({ readonly kind: "ref" } & PreservedFieldFlags<T, O>) {
    return { kind: "ref", ...options };
  },
  /** Declares an array field whose item schema is described by another field descriptor. */
  array<TItem extends FieldDescriptor<any>, const O extends FieldOptions<readonly InferFieldType<TItem>[]> = {}>(item: TItem, options: O = {} as O): ({ readonly kind: "array"; readonly item: TItem } & PreservedFieldFlags<readonly InferFieldType<TItem>[], O>) {
    return { kind: "array", item, ...options };
  },
  /** Declares an object field from a nested field map. */
  object<const F extends Record<string, FieldDescriptor<any>>, const O extends FieldOptions<InferFields<F>> = {}>(fields: F, options: O = {} as O): ({ readonly kind: "object"; readonly fields: F } & PreservedFieldFlags<InferFields<F>, O>) {
    return { kind: "object", fields, ...options };
  },
  /** Declares a field constrained to one exact literal value. */
  literal<const T extends string | number | boolean | null, const O extends FieldOptions<T> = {}>(value: T, options: O = {} as O): ({ readonly kind: "literal"; readonly value: T } & PreservedFieldFlags<T, O>) {
    return { kind: "literal", value, ...options };
  },
  /** Declares a field constrained to one of the provided scalar values. */
  enum<const TValues extends readonly [string | number, ...(string | number)[]]>(...values: TValues): FieldDescriptor<TValues[number]> {
    return { kind: "enum", values };
  },
  /**
   * Declares a field that can match any one of the provided descriptors or scalar literals.
   *
   * Scalar arguments are normalized to `field.literal(...)` internally so the call site can stay
   * compact for common string-status unions like `field.union("created", "running")`.
   */
  union<const TVariants extends readonly [FieldDescriptor<any> | UnionLiteral, ...(FieldDescriptor<any> | UnionLiteral)[]]>(...variants: TVariants): FieldDescriptor<
    InferFieldType<Extract<TVariants[number], FieldDescriptor<any>>> | Extract<TVariants[number], UnionLiteral>
  > {
    const normalizedVariants = variants.map((variant): FieldDescriptor => toUnionVariant(variant));
    return {
      kind: "union",
      variants: normalizedVariants,
    };
  },
  /**
   * Declares a raw JSON Schema escape hatch.
   *
   * This keeps the first migration slice practical for complex existing payloads while the
   * typed descriptor vocabulary is still being built out.
   */
  schema<T extends JsonValue = JsonValue, const O extends FieldOptions<T> = {}>(schema: JsonValue, options: O = {} as O): ({ readonly kind: "schema"; readonly schema: JsonValue } & PreservedFieldFlags<T, O>) {
    return { kind: "schema", schema, ...options };
  },
};

/**
 * Declares a message payload shape.
 *
 * The surrounding message name is provided by the parent `messages` object key. This keeps
 * message declarations compact while still allowing the framework to derive a discriminated
 * runtime payload schema later.
 */
export function msg<const F extends Record<string, FieldDescriptor<any>>>(fields: F): MessageDescriptor<F> {
  return { fields };
}

/**
 * Declares an operation exposed through actor-tree inspection/debug tooling.
 *
 * The operation id is derived from the surrounding object key, which removes another layer
 * of duplication compared to hand-written `ActionDescriptor` objects.
 */
export function op<const F extends Record<string, FieldDescriptor<any>> | undefined = undefined>(descriptor: OperationDescriptor<F>): OperationDescriptor<F> {
  return descriptor;
}

/** Declares a virtual collection node with derived list/inspect behavior. */
export function collection<TState>(path: string, descriptor: Omit<CollectionChildDescriptor<TState>, "kind" | "path">): CollectionChildDescriptor<TState> {
  return { kind: "collection", path, ...descriptor };
}

/** Declares a real-actor alias node for common single-child tree projections. */
export function actorAlias<TState>(path: string, descriptor: Omit<ActorAliasChildDescriptor<TState>, "kind" | "path">): ActorAliasChildDescriptor<TState> {
  return { kind: "actorAlias", path, ...descriptor };
}

/**
 * Runtime shape of a derived tree operation descriptor.
 *
 * This mirrors the structure consumed today by `typed-actors-introspection` without adding a
 * package dependency from `typed-actors` back to the introspection package.
 */
export interface DerivedActionDescriptor {
  readonly operationId: string;
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema?: JsonValue;
  readonly outputSchema?: JsonValue;
  readonly mutates?: boolean;
  readonly dangerous?: boolean;
}

/**
 * Runtime shape of a derived real-node tree projection overlay.
 *
 * This mirrors the `RealTreeNodeSpec` surface from `typed-actors-introspection`
 * without introducing a package dependency cycle.
 */
export interface DerivedRealTreeNodeSpec {
  readonly title?: string;
  readonly subtitle?: string;
  readonly icon?: string;
  readonly tags?: readonly string[];
  readonly sortKey?: string;
  readonly hasChildren?: boolean;
  readonly childCount?: number;
  readonly operations?: readonly DerivedActionDescriptor[];
  readonly summary?: JsonValue;
}

/**
 * Runtime shape of a derived virtual-node tree projection overlay.
 *
 * This mirrors the `ChildNodeSpec` surface from `typed-actors-introspection`
 * without introducing a package dependency cycle.
 */
export interface DerivedChildNodeSpec {
  readonly path: string;
  readonly nodeType: "virtualNamespace" | "virtualCollection" | "virtualItem" | "realActorAlias";
  readonly title: string;
  readonly subtitle?: string;
  readonly icon?: string;
  readonly tags?: readonly string[];
  readonly sortKey?: string;
  readonly status?: string;
  readonly actorId?: string;
  readonly actorKind?: string;
  readonly hasChildren?: boolean;
  readonly childCount?: number;
  readonly operations?: readonly DerivedActionDescriptor[];
  readonly summary?: JsonValue;
}

export interface TreeProjectionInput<TState> {
  readonly state: Readonly<TState>;
  readonly selfId: string;
  readonly operations: readonly DerivedActionDescriptor[];
}

export interface TreeChildProjectionInput<TState> extends TreeProjectionInput<TState> {
  readonly path: string;
}

export interface CollectionChildDescriptor<TState> {
  readonly kind: "collection";
  readonly path: string;
  readonly title: string | ((input: TreeProjectionInput<TState>) => string);
  readonly subtitle?: string | ((input: TreeProjectionInput<TState>) => string | undefined);
  readonly icon?: string | ((input: TreeProjectionInput<TState>) => string | undefined);
  readonly tags?: readonly string[] | ((input: TreeProjectionInput<TState>) => readonly string[] | undefined);
  readonly sortKey?: string | ((input: TreeProjectionInput<TState>) => string | undefined);
  readonly hasChildren?: boolean | ((input: TreeProjectionInput<TState>) => boolean);
  readonly childCount?: number | ((input: TreeProjectionInput<TState>) => number | undefined);
  readonly operations?: readonly DerivedActionDescriptor[] | ((input: TreeProjectionInput<TState>) => readonly DerivedActionDescriptor[] | undefined);
  readonly summary?: JsonValue | ((input: TreeProjectionInput<TState>) => JsonValue | undefined);
  readonly listItems?: (input: TreeProjectionInput<TState>) => readonly DerivedChildNodeSpec[];
}

export interface ActorAliasChildDescriptor<TState> {
  readonly kind: "actorAlias";
  readonly path: string;
  readonly title: string | ((input: TreeProjectionInput<TState>) => string);
  readonly subtitle?: string | ((input: TreeProjectionInput<TState>) => string | undefined);
  readonly icon?: string | ((input: TreeProjectionInput<TState>) => string | undefined);
  readonly tags?: readonly string[] | ((input: TreeProjectionInput<TState>) => readonly string[] | undefined);
  readonly sortKey?: string | ((input: TreeProjectionInput<TState>) => string | undefined);
  readonly status?: string | ((input: TreeProjectionInput<TState>) => string | undefined);
  readonly actorId: string | ((input: TreeProjectionInput<TState>) => string | undefined);
  readonly actorKind: string | ((input: TreeProjectionInput<TState>) => string | undefined);
  readonly hasChildren?: boolean | ((input: TreeProjectionInput<TState>) => boolean);
  readonly childCount?: number | ((input: TreeProjectionInput<TState>) => number | undefined);
  readonly operations?: readonly DerivedActionDescriptor[] | ((input: TreeProjectionInput<TState>) => readonly DerivedActionDescriptor[] | undefined);
  readonly summary?: JsonValue | ((input: TreeProjectionInput<TState>) => JsonValue | undefined);
}

export type TreeChildDescriptor<TState> = CollectionChildDescriptor<TState> | ActorAliasChildDescriptor<TState>;

export interface DerivedTreeProjection<TState> {
  listChildren(input: TreeChildProjectionInput<TState>): readonly DerivedChildNodeSpec[];
  inspectNode(input: TreeChildProjectionInput<TState>): DerivedChildNodeSpec | undefined;
}

/**
 * Runtime shape of a derived debug message descriptor.
 *
 * This mirrors the runtime debug descriptor structure already consumed in `aven-spine.ts`.
 */
export interface DerivedDebugMessageDescriptor {
  readonly id: string;
  readonly actorKind: string;
  readonly title: string;
  readonly description?: string;
  readonly messageType: string;
  readonly schema: JsonValue;
  readonly defaultValue: JsonValue;
  readonly dangerous?: boolean;
}

/**
 * Derived operation/debug artifacts produced from an actor shape declaration.
 */
export interface DerivedOperationArtifacts {
  /** Tree operation descriptors derived from the declaration's `operations` block. */
  readonly operations: readonly DerivedActionDescriptor[];
  /** Debug message descriptors derived from `messages` + `operations`. */
  readonly debugDescriptors: readonly DerivedDebugMessageDescriptor[];
}

/** Runtime validator derived from a declarative `messages` block. */
export type MessageValidator<M extends Record<string, MessageDescriptor>> = (value: unknown) => value is InferMessages<M>;

/** Resolves the actor state shape from a declarative `state` block. */
export type InferState<D extends ActorShapeDeclaration> = D["state"] extends Record<string, FieldDescriptor<any>>
  ? InferFields<D["state"]>
  : never;

/** State shape extended with the framework-managed operation result slot. */
export type StateWithLastResult<TState> = TState & {
  readonly lastResult?: JsonValue;
};

/** Runtime helpers derived from an actor's declarative state definition. */
export interface DerivedStateHelpers<TState> {
  /** Initializes state from declaration defaults and returns the standard active init result. */
  initState(input?: Partial<TState>): { readonly state: TState; readonly behavior: "active" };
  /** Strips framework-managed and transient fields from a state snapshot before persistence/storage. */
  normalizeState<T extends StateWithLastResult<TState>>(state: T): T;
  /** Attaches a framework-managed operation result without hand-writing the spread pattern. */
  withLastResult<T extends StateWithLastResult<TState>>(state: T, lastResult: JsonValue): T;
  /** Removes the framework-managed operation result slot from state when present. */
  clearLastResult<T extends StateWithLastResult<TState>>(state: T): T;
  /** Builds the standard success operation-result envelope used by higher-level actors. */
  okResult(data: Record<string, JsonValue | undefined>): JsonValue;
  /** Builds the standard error operation-result envelope used by higher-level actors. */
  errorResult(category: string, message: string, details?: JsonValue): JsonValue;
}

/**
 * Composed runtime assembled from a declarative actor shape.
 *
 * What it derives:
 * - `isMessage` from the shape's `messages` block
 * - `initState`, `withLastResult`, and `clearLastResult` from the shape's `state`
 * - `operations` and `debugDescriptors` from the shape's `operations` block
 *
 * How it works:
 * - it composes the already-proven lower-level builder functions into one stable object
 * - subsystem code can consume this object as a single runtime surface instead of importing
 *   each helper separately
 *
 * Why it exists:
 * - it is the first step toward a higher-level `buildActorDefinition(...)` layer
 * - it proves that runtime assembly can be centralized without yet changing actor business logic
 */
export interface DerivedActorRuntime<
  TMessages extends Record<string, MessageDescriptor>,
  TState,
> extends DerivedStateHelpers<TState> {
  /** Runtime message validator derived from the declaration's `messages` block. */
  readonly isMessage: MessageValidator<TMessages>;
  /** Returns actionable validation diagnostics for invalid messages. */
  readonly explainInvalidMessage: (value: unknown) => readonly string[];
  /** Throws an actionable error when a message does not match the declaration. */
  readonly assertMessage: (value: unknown) => asserts value is InferMessages<TMessages>;
  /** Debug message descriptors derived from the declaration's message/operation metadata. */
  readonly debugDescriptors: readonly DerivedDebugMessageDescriptor[];
  /** Optional shape-owned presentation helper derived from `shape.present`. */
  present?(state: Readonly<TState>): {
    readonly title?: string;
    readonly subtitle?: string;
    readonly icon?: string;
    readonly tags?: readonly string[];
    readonly sortKey?: string;
  };
}

/** Actor context surface augmented with declaration-derived runtime helpers. */
export type ActorContextWithRuntime<
  R extends ActorRegistry,
  K extends KindOf<R>,
  TMessages extends Record<string, MessageDescriptor>,
  TState,
> = ActorContext<R, K> & {
  readonly rt: DerivedActorRuntime<TMessages, TState>;
};

type BuildActorDefinitionReceive<R extends ActorRegistry, K extends KindOf<R>, TMessages extends Record<string, MessageDescriptor>, TState> = {
  readonly [B in Extract<keyof ActorDefinition<R, K>["receive"], string>]: (
    ctx: ActorContextWithRuntime<R, K, TMessages, TState>,
    message: Parameters<ActorDefinition<R, K>["receive"][B]>[1],
  ) => ReturnType<ActorDefinition<R, K>["receive"][B]>;
};

type BuildLifecycleHook<R extends ActorRegistry, K extends KindOf<R>, TMessages extends Record<string, MessageDescriptor>, TState> = (
  ctx: ActorContextWithRuntime<R, K, TMessages, TState>,
) => void | Promise<void>;

type BuildStopHook<R extends ActorRegistry, K extends KindOf<R>, TMessages extends Record<string, MessageDescriptor>, TState> = (
  ctx: ActorContextWithRuntime<R, K, TMessages, TState>,
  reason: StopReason,
) => void | Promise<void>;

type BuildRestartHook<R extends ActorRegistry, K extends KindOf<R>, TMessages extends Record<string, MessageDescriptor>, TState> = (
  ctx: ActorContextWithRuntime<R, K, TMessages, TState>,
  reason: RestartReason,
) => void | Promise<void>;

type BuildSupervisionHook<R extends ActorRegistry, K extends KindOf<R>, TMessages extends Record<string, MessageDescriptor>, TState> = (
  ctx: ActorContextWithRuntime<R, K, TMessages, TState>,
  failure: ActorFailure,
) => SupervisionDirective | Promise<SupervisionDirective>;

/**
 * Minimal options for assembling a typed actor definition from a declarative actor shape.
 *
 * This first version intentionally stays narrow:
 * - it wires `kind`, `isMessage`, and `init` from the derived runtime
 * - it accepts manual `receive` handlers unchanged
 * - it optionally accepts a manual `present` hook, or falls back to shape-level `present`
 *
 * It does not yet perform context augmentation, tree derivation, or runtime hook injection.
 */
export interface BuildActorDefinitionOptions<
  R extends ActorRegistry,
  K extends KindOf<R>,
  TMessages extends Record<string, MessageDescriptor> = Record<string, MessageDescriptor>,
  TState = StateOfShapeFallback,
> {
  /** Concrete registry actor kind constant used by the runtime registry. */
  readonly kind: K;
  /** Optional custom init hook when declarative init derivation is not yet sufficient. */
  readonly init?: ActorDefinition<R, K>["init"];
  /** Optional custom message guard when declarative inbox coverage is not yet complete. */
  readonly isMessage?: ActorDefinition<R, K>["isMessage"];
  /** Hand-written receive handlers that still contain the actor's domain logic. */
  readonly receive: BuildActorDefinitionReceive<R, K, TMessages, TState>;
  /** Optional presentation hook passed through unchanged. */
  readonly present?: ActorPresentationHook<R, K>;
  /** Optional lifecycle start hook passed through unchanged. */
  readonly onStart?: BuildLifecycleHook<R, K, TMessages, TState>;
  /** Optional lifecycle stop hook passed through unchanged. */
  readonly onStop?: BuildStopHook<R, K, TMessages, TState>;
  /** Optional lifecycle restart hook passed through unchanged. */
  readonly onRestart?: BuildRestartHook<R, K, TMessages, TState>;
  /** Optional supervision hook passed through unchanged. */
  readonly supervise?: BuildSupervisionHook<R, K, TMessages, TState>;
}

type StateOfShapeFallback = Record<string, unknown>;

type StatefulActorShape = ActorShapeDeclaration<string, Record<string, FieldDescriptor<any>>, Record<string, MessageDescriptor>, Record<string, OperationDescriptor | undefined>> & {
  readonly state: Record<string, FieldDescriptor<any>>;
};

type TreeProjectionReadyActorShape<TState extends Record<string, FieldDescriptor<any>>> = {
  readonly kind: string;
  readonly state: TState;
  readonly tree?: {
    readonly children?: readonly TreeChildDescriptor<InferFields<TState>>[];
  };
};

type RuntimeReadyActorShape = StatefulActorShape & {
  readonly messages: Record<string, MessageDescriptor>;
};

/**
 * Builds operation and debug-message artifacts from a declarative actor shape.
 *
 * What it derives:
 * - `operations`: replacement for hand-written `ActionDescriptor[]`
 * - `debugDescriptors`: replacement for hand-written `DebugMessageDescriptor[]`
 *
 * How it works:
 * - each operation id comes from the `operations` object key
 * - each input schema is derived from the matching operation `input` field map when present
 * - otherwise, the matching message descriptor schema is used
 * - default debug payloads come from the operation's `defaultValue` or descriptor defaults
 *
 * Why it exists:
 * - it removes the current 1:1 duplication between message contracts, tree operations, and
 *   debug panel descriptors.
 */
export function buildOperationArtifacts<const D extends ActorShapeDeclaration>(shape: D): DerivedOperationArtifacts {
  const messages = shape.messages ?? {};
  const operationsById = shape.operations ?? {};

  const operations = Object.entries(operationsById).flatMap(([operationId, operation]) => {
    if (operation === undefined) {
      return [];
    }
    const inputSchema = operation.input
      ? objectFieldsToSchema(operation.input)
      : (messages[operationId]?.fields ? objectFieldsToSchema(messages[operationId]!.fields) : undefined);
    return [{
      operationId,
      title: operation.title,
      description: operation.description,
      inputSchema,
      mutates: operation.mutates,
      dangerous: operation.dangerous,
    } satisfies DerivedActionDescriptor];
  });

  const debugDescriptors = operations.map((operation) => {
    const original = operationsById[operation.operationId];
    return {
      id: `${shape.kind}.${operation.operationId}`,
      actorKind: shape.kind,
      title: operation.title ?? operation.operationId,
      description: operation.description,
      messageType: operation.operationId,
      schema: operation.inputSchema ?? emptyObjectSchema(),
      defaultValue: original?.defaultValue ?? defaultObjectValue(original?.input ?? messages[operation.operationId]?.fields ?? {}),
      dangerous: operation.dangerous,
    } satisfies DerivedDebugMessageDescriptor;
  });

  return { operations, debugDescriptors };
}

/**
 * Builds an `isMessage` validator from declarative message descriptors.
 *
 * What it derives:
 * - a runtime validator for the actor's externally accepted message surface
 *
 * How it works:
 * - validates `message.type`
 * - checks that only declared fields are present
 * - validates each declared field against the corresponding descriptor
 *
 * Why it exists:
 * - it replaces hand-written `switch(message.type)` validation guards spread across actors.
 */
export function buildMessageValidator<const M extends Record<string, MessageDescriptor>>(messages: M): MessageValidator<M> {
  return ((value: unknown): value is InferMessages<M> => {
    if (!isRecord(value) || typeof value.type !== "string") {
      return false;
    }
    const descriptor = messages[value.type];
    if (!descriptor) {
      return false;
    }
    const allowedKeys = new Set(["type", ...Object.keys(descriptor.fields)]);
    if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
      return false;
    }
    for (const [key, fieldDescriptor] of Object.entries(descriptor.fields)) {
      const fieldValue = value[key];
      if (fieldValue === undefined) {
        if (fieldDescriptor.optional === true) {
          continue;
        }
        return false;
      }
      if (!matchesFieldDescriptor(fieldValue, fieldDescriptor)) {
        return false;
      }
    }
    return true;
  }) as MessageValidator<M>;
}

/** Builds actionable validation diagnostics for invalid messages. */
export function explainInvalidMessage<const D extends Pick<ActorShapeDeclaration, "kind" | "messages">>(shape: D, value: unknown): readonly string[] {
  const messages = shape.messages ?? {};
  if (!isRecord(value)) {
    return [`Invalid message for actor kind "${shape.kind}": expected object, got ${describeValue(value)}`];
  }
  if (typeof value.type !== "string") {
    return [`Invalid message for actor kind "${shape.kind}": field "type": expected string, got ${describeValue(value.type)}`];
  }
  const descriptor = messages[value.type];
  if (!descriptor) {
    return [`Invalid message for actor kind "${shape.kind}": message.type = "${value.type}" is not declared`];
  }
  const diagnostics: string[] = [];
  const allowedKeys = new Set(["type", ...Object.keys(descriptor.fields)]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      diagnostics.push(`field "${key}": unexpected field`);
    }
  }
  for (const [key, fieldDescriptor] of Object.entries(descriptor.fields)) {
    const fieldValue = value[key];
    if (fieldValue === undefined) {
      if (fieldDescriptor.optional === true) {
        continue;
      }
      diagnostics.push(`field "${key}": expected ${describeFieldDescriptor(fieldDescriptor)}, got undefined`);
      continue;
    }
    if (!matchesFieldDescriptor(fieldValue, fieldDescriptor)) {
      diagnostics.push(`field "${key}": expected ${describeFieldDescriptor(fieldDescriptor)}, got ${describeValue(fieldValue)}`);
    }
  }
  if (diagnostics.length === 0) {
    return [];
  }
  return [
    `Invalid message for actor kind "${shape.kind}":`,
    `  message.type = "${value.type}"`,
    ...diagnostics.map((line) => `  ${line}`),
  ];
}

/**
 * Builds init and operation-result state helpers from a declarative actor shape.
 *
 * What it derives:
 * - `initState`: standard `{ state, behavior: "active" }` initialization
 * - `withLastResult`: framework-managed operation-result attachment
 * - `clearLastResult`: framework-managed operation-result removal
 *
 * How it works:
 * - field-level defaults are collected from the `state` descriptors
 * - optional `init.defaults` override or extend those defaults
 * - init input is merged last so callers can override defaults explicitly
 *
 * Why it exists:
 * - it replaces repeated trivial init functions and repeated
 *   `{ ...state, lastResult: ... }` boilerplate.
 */
export function buildStateHelpers<const D extends StatefulActorShape>(shape: D): DerivedStateHelpers<InferState<D>> {
  const stateFields = shape.state ?? {};
  const fieldDefaults = collectFieldDefaults(stateFields);
  const initDefaults = shape.init?.defaults ?? {};
  const transientKeys = collectTransientKeys(stateFields);

  return {
    initState(input) {
      return withActorKindError(shape.kind, "initState", () => ({
        state: {
          ...fieldDefaults,
          ...initDefaults,
          ...(input ?? {}),
        } as InferState<D>,
        behavior: "active",
      }));
    },
    normalizeState(state) {
      return withActorKindError(shape.kind, "normalizeState", () => {
        const withoutOperationResult = state.lastResult === undefined
          ? { ...state }
          : (() => {
              const { lastResult: _lastResult, ...rest } = state;
              return rest;
            })();
        if (transientKeys.length === 0) {
          return withoutOperationResult as typeof state;
        }
        const normalized = { ...withoutOperationResult } as Record<string, unknown>;
        for (const key of transientKeys) {
          delete normalized[key];
        }
        return normalized as typeof state;
      });
    },
    withLastResult(state, lastResult) {
      return {
        ...state,
        lastResult,
      };
    },
    clearLastResult(state) {
      const { lastResult: _lastResult, ...rest } = state;
      return rest as typeof state;
    },
    okResult(data) {
      return {
        type: "ok",
        ...Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)),
      } as JsonValue;
    },
    errorResult(category, message, details) {
      return {
        type: "error",
        category,
        message,
        ...(details === undefined ? {} : { details }),
      } as JsonValue;
    },
  } as DerivedStateHelpers<InferState<D>>;
}

/**
 * Builds a composed actor runtime from a declarative actor shape.
 *
 * What it derives:
 * - a single runtime object containing message validation, init helpers, result helpers,
 *   tree operation descriptors, and debug descriptors
 *
 * How it works:
 * - delegates to `buildMessageValidator(...)`, `buildStateHelpers(...)`, and
 *   `buildOperationArtifacts(...)`
 * - returns the combined derived surface as one object for subsystem consumption
 *
 * Why it exists:
 * - it replaces ad hoc per-subsystem wiring of individual derived helpers
 * - it creates the integration seam needed before a future `buildActorDefinition(...)`
 */
export function buildActorRuntime<const D extends RuntimeReadyActorShape>(shape: D): DerivedActorRuntime<D["messages"], InferState<D>> {
  const isMessage = buildMessageValidator(shape.messages);
  const explain = (value: unknown) => explainInvalidMessage(shape, value);
  const stateHelpers = buildStateHelpers(shape);
  const operationArtifacts = buildOperationArtifacts(shape);
  const present = shape.present
    ? ((state: Readonly<InferState<D>>) => shape.present!(state))
    : undefined;

  return {
    isMessage,
    explainInvalidMessage: explain,
    assertMessage(value): asserts value is InferMessages<D["messages"]> {
      if (!isMessage(value)) {
        throw new Error(explain(value).join("\n"));
      }
    },
    debugDescriptors: operationArtifacts.debugDescriptors,
    ...(present === undefined ? {} : { present }),
    ...stateHelpers,
  };
}

/**
 * Builds declarative list/inspect helpers from an actor shape's `tree.children` block.
 *
 * This intentionally stays separate from `ctx.rt` injection so tree projection helpers do not
 * influence actor receive-handler variance.
 */
export function buildChildProjection<const TState extends Record<string, FieldDescriptor<any>>>(shape: TreeProjectionReadyActorShape<TState>): DerivedTreeProjection<InferFields<TState>> {
  const children = shape.tree?.children ?? [];

  const getRootNodes = (input: TreeProjectionInput<InferFields<TState>>): readonly DerivedChildNodeSpec[] => {
    return children.flatMap((descriptor) => {
      const node = describeDescriptor(descriptor, input);
      if (node === undefined) {
        return [];
      }
      return [node];
    });
  };

  const getNestedNodes = (input: TreeChildProjectionInput<InferFields<TState>>): readonly DerivedChildNodeSpec[] => {
    const descriptor = children.find((candidate) => candidate.kind === "collection" && normalizeVirtualPath(candidate.path) === input.path);
    if (!descriptor || descriptor.kind !== "collection") {
      return [];
    }
    return descriptor.listItems?.(input) ?? [];
  };

  return {
    listChildren(input) {
      return withActorKindError(shape.kind, "treeProjection.listChildren", () => {
        const path = normalizeVirtualPath(input.path);
        if (path === "/") {
          return getRootNodes(input);
        }
        return getNestedNodes({ ...input, path });
      });
    },
    inspectNode(input) {
      return withActorKindError(shape.kind, "treeProjection.inspectNode", () => {
        const path = normalizeVirtualPath(input.path);
        if (path === "/") {
          return undefined;
        }
        const rootNode = getRootNodes(input).find((node) => normalizeVirtualPath(node.path) === path);
        if (rootNode) {
          return rootNode;
        }
        for (const descriptor of children) {
          if (descriptor.kind !== "collection") {
            continue;
          }
          const collectionPath = normalizeVirtualPath(descriptor.path);
          if (!path.startsWith(`${collectionPath}/`)) {
            continue;
          }
          const item = (descriptor.listItems?.(input) ?? []).find((node) => normalizeVirtualPath(node.path) === path);
          if (item) {
            return item;
          }
        }
        return undefined;
      });
    },
  };
}

/**
 * Builds a minimal actor definition from a declarative shape plus manual receive handlers.
 *
 * What it derives:
 * - `isMessage` from the shape's declarative messages
 * - `init` from the shape's declarative state defaults
 *
 * What stays manual in this first step:
 * - `receive`
 *
 * What can now be shape-owned:
 * - `present`
 *
 * Why it exists:
 * - it is the next framework layer above `buildActorRuntime(...)`
 * - it removes the remaining repetitive `kind/isMessage/init` wiring from subsystems
 */
export function buildActorDefinition<
  R extends ActorRegistry,
  K extends KindOf<R>,
  const D extends StatefulActorShape,
>(
  shape: D,
  options: BuildActorDefinitionOptions<
    R,
    K,
    D extends RuntimeReadyActorShape ? D["messages"] : Record<string, MessageDescriptor>,
    InferState<D>
  >,
): ActorDefinition<R, K> {
  const runtime = shape.messages === undefined
    ? { ...buildStateHelpers(shape), debugDescriptors: [] as const }
    : buildActorRuntime(shape as RuntimeReadyActorShape);

  const withRuntime = (ctx: ActorContext<R, K>) => Object.assign(Object.create(Object.getPrototypeOf(ctx)), ctx, { rt: runtime });

  const receiveEntries = Object.entries(options.receive) as Array<[
    BehaviorKey<R, K>,
    BuildActorDefinitionReceive<R, K, D extends RuntimeReadyActorShape ? D["messages"] : Record<string, MessageDescriptor>, InferState<D>>[BehaviorKey<R, K>],
  ]>;

  const wrappedReceive = Object.fromEntries(
    receiveEntries.map(([behavior, receiver]) => [
      behavior,
      ((ctx: ActorContext<R, K>, message: unknown) => receiver(withRuntime(ctx) as never, message as never)) as ActorDefinition<R, K>["receive"][BehaviorKey<R, K>],
    ]),
  ) as ActorDefinition<R, K>["receive"];
  return defineActor<R, K>({
    kind: options.kind,
    ...(options.isMessage !== undefined
      ? { isMessage: options.isMessage }
      : (shape.messages === undefined ? {} : { isMessage: (runtime as DerivedActorRuntime<Record<string, MessageDescriptor>, InferState<D>>).isMessage as unknown as ActorDefinition<R, K>["isMessage"] })),
    init: options.init ?? ((input) => runtime.initState(input as Partial<InferState<D>>) as ActorDefinition<R, K>["init"] extends (...args: never[]) => infer TResult
      ? TResult
      : never),
    receive: wrappedReceive,
    ...(options.onStart === undefined ? {} : { onStart: ((ctx) => options.onStart!(withRuntime(ctx) as never)) as ActorDefinition<R, K>["onStart"] }),
    ...(options.onStop === undefined ? {} : { onStop: ((ctx, reason) => options.onStop!(withRuntime(ctx) as never, reason)) as ActorDefinition<R, K>["onStop"] }),
    ...(options.onRestart === undefined ? {} : { onRestart: ((ctx, reason) => options.onRestart!(withRuntime(ctx) as never, reason)) as ActorDefinition<R, K>["onRestart"] }),
    ...(options.supervise === undefined ? {} : { supervise: ((ctx, failure) => options.supervise!(withRuntime(ctx) as never, failure)) as ActorDefinition<R, K>["supervise"] }),
    ...((options.present ?? shape.present) === undefined
      ? {}
      : {
          present: (options.present
            ?? ((input) => shape.present!(input.state as unknown as InferState<D>))) as ActorPresentationHook<R, K>,
        }),
  });
}

type BehaviorKey<R extends ActorRegistry, K extends KindOf<R>> = Extract<keyof ActorDefinition<R, K>["receive"], string>;

function collectFieldDefaults<F extends Record<string, FieldDescriptor<any>>>(fields: F): Partial<InferFields<F>> {
  const result: Partial<InferFields<F>> = {};
  for (const [key, descriptor] of Object.entries(fields) as [keyof F, F[keyof F]][]) {
    const defaultValue = inferFieldDefaultValue(descriptor);
    if (defaultValue !== undefined) {
      (result as Record<string, unknown>)[key as string] = defaultValue;
    }
  }
  return result;
}

function collectTransientKeys(fields: Record<string, FieldDescriptor<any>>): readonly string[] {
  return Object.entries(fields)
    .filter(([, descriptor]) => descriptor.transient === true)
    .map(([key]) => key);
}

function inferFieldDefaultValue(descriptor: FieldDescriptor): unknown {
  if (descriptor.default !== undefined) {
    return descriptor.default;
  }
  if (descriptor.kind === "object") {
    const nested = collectFieldDefaults(descriptor.fields);
    return Object.keys(nested as Record<string, unknown>).length > 0 ? nested : undefined;
  }
  if (descriptor.kind === "literal") {
    return descriptor.value;
  }
  return undefined;
}

function toUnionVariant(variant: FieldDescriptor<any> | UnionLiteral): FieldDescriptor {
  if (variant === null || typeof variant === "string" || typeof variant === "number" || typeof variant === "boolean") {
    return field.literal(variant);
  }
  return variant;
}

function emptyObjectSchema(): JsonValue {
  return { type: "object", additionalProperties: false, default: {} };
}

function objectFieldsToSchema(fields: Record<string, FieldDescriptor>): JsonValue {
  const properties: Record<string, JsonValue> = {};
  const required: string[] = [];
  for (const [key, descriptor] of Object.entries(fields)) {
    properties[key] = fieldToSchema(descriptor);
    if (descriptor.optional !== true) {
      required.push(key);
    }
  }
  const schema: Record<string, JsonValue | string[] | boolean> = {
    type: "object",
    additionalProperties: false,
    properties,
  };
  if (required.length > 0) {
    schema.required = required;
  }
  const defaultValue = defaultObjectValue(fields);
  if (Object.keys(defaultValue).length > 0) {
    schema.default = defaultValue;
  }
  return schema as JsonValue;
}

function defaultObjectValue(fields: Record<string, FieldDescriptor>): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {};
  for (const [key, descriptor] of Object.entries(fields)) {
    const defaultValue = fieldDefaultValue(descriptor);
    if (defaultValue !== undefined) {
      result[key] = defaultValue;
    }
  }
  return result;
}

function fieldDefaultValue(descriptor: FieldDescriptor): JsonValue | undefined {
  if (descriptor.default !== undefined) {
    return descriptor.default as JsonValue;
  }
  if (descriptor.kind === "object") {
    const nested = defaultObjectValue(descriptor.fields);
    return Object.keys(nested).length > 0 ? nested : undefined;
  }
  if (descriptor.kind === "array") {
    return undefined;
  }
  if (descriptor.kind === "literal") {
    return descriptor.value as JsonValue;
  }
  if (descriptor.kind === "schema") {
    const schema = descriptor.schema as { readonly default?: JsonValue };
    return schema.default;
  }
  return undefined;
}

function fieldToSchema(descriptor: FieldDescriptor): JsonValue {
  switch (descriptor.kind) {
    case "string":
      return withFieldMetadata({ type: "string" }, descriptor);
    case "number":
      return withFieldMetadata({ type: "number" }, descriptor);
    case "integer":
      return withFieldMetadata({ type: "integer" }, descriptor);
    case "boolean":
      return withFieldMetadata({ type: "boolean" }, descriptor);
    case "json":
      return withFieldMetadata({}, descriptor);
    case "ref":
      return withFieldMetadata({}, descriptor);
    case "literal":
      return withFieldMetadata({ const: descriptor.value }, descriptor);
    case "enum":
      return withFieldMetadata({ enum: [...descriptor.values] }, descriptor);
    case "union":
      return withFieldMetadata({ oneOf: descriptor.variants.map((variant) => fieldToSchema(variant)) }, descriptor);
    case "array":
      return withFieldMetadata({ type: "array", items: fieldToSchema(descriptor.item) }, descriptor);
    case "object":
      return withFieldMetadata(objectFieldsToSchema(descriptor.fields), descriptor);
    case "schema":
      return withFieldMetadata(descriptor.schema, descriptor);
  }
}

function withFieldMetadata(base: JsonValue, descriptor: FieldDescriptor): JsonValue {
  if (typeof base !== "object" || base === null || Array.isArray(base)) {
    return base;
  }
  const result: Record<string, JsonValue> = { ...(base as Record<string, JsonValue>) };
  if (descriptor.description !== undefined) {
    result.description = descriptor.description;
  }
  if (descriptor.default !== undefined) {
    result.default = descriptor.default as JsonValue;
  }
  return result;
}

function matchesFieldDescriptor(value: unknown, descriptor: FieldDescriptor): boolean {
  switch (descriptor.kind) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "json":
      return isJsonValue(value);
    case "ref":
      return true;
    case "literal":
      return value === descriptor.value;
    case "enum":
      return descriptor.values.includes(value as string | number);
    case "union":
      return descriptor.variants.some((variant) => matchesFieldDescriptor(value, variant));
    case "array":
      return Array.isArray(value) && value.every((entry) => matchesFieldDescriptor(entry, descriptor.item));
    case "object": {
      if (!isRecord(value)) {
        return false;
      }
      const allowedKeys = new Set(Object.keys(descriptor.fields));
      if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
        return false;
      }
      for (const [key, nestedDescriptor] of Object.entries(descriptor.fields)) {
        const nestedValue = value[key];
        if (nestedValue === undefined) {
          if (nestedDescriptor.optional === true) {
            continue;
          }
          return false;
        }
        if (!matchesFieldDescriptor(nestedValue, nestedDescriptor)) {
          return false;
        }
      }
      return true;
    }
    case "schema":
      return matchesJsonSchema(value, descriptor.schema);
  }
}

function matchesJsonSchema(value: unknown, schema: JsonValue): boolean {
  if (!isRecord(schema)) {
    return true;
  }

  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.some((branch) => matchesJsonSchema(value, branch));
  }
  if (Object.hasOwn(schema, "const")) {
    return value === schema.const;
  }
  if (Array.isArray(schema.enum)) {
    return schema.enum.includes(value as never);
  }
  if (schema.type === "string") {
    return typeof value === "string";
  }
  if (schema.type === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (schema.type === "integer") {
    return typeof value === "number" && Number.isInteger(value);
  }
  if (schema.type === "boolean") {
    return typeof value === "boolean";
  }
  if (schema.type === "array") {
    return Array.isArray(value)
      && (schema.items === undefined || value.every((entry) => matchesJsonSchema(entry, schema.items as JsonValue)));
  }
  if (schema.type === "object") {
    if (!isRecord(value)) {
      return false;
    }
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required.filter((entry): entry is string => typeof entry === "string") : [];
    for (const key of required) {
      if (!(key in value)) {
        return false;
      }
    }
    if (schema.additionalProperties === false) {
      const allowedKeys = new Set(Object.keys(properties));
      if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
        return false;
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (!(key in value)) {
        continue;
      }
      if (!matchesJsonSchema(value[key], propertySchema as JsonValue)) {
        return false;
      }
    }
    return true;
  }
  return isJsonValue(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeVirtualPath(path: string): string {
  if (path === "/") {
    return path;
  }
  const trimmed = path.startsWith("/") ? path.slice(1) : path;
  return `/${trimmed}`;
}

function describeDescriptor<TState>(descriptor: TreeChildDescriptor<TState>, input: TreeProjectionInput<TState>): DerivedChildNodeSpec | undefined {
  if (descriptor.kind === "collection") {
    const title = resolveRequiredTreeValue(descriptor.title, input);
    return {
      path: descriptor.path,
      nodeType: "virtualCollection",
      title,
      subtitle: resolveTreeValue(descriptor.subtitle, input),
      icon: resolveTreeValue(descriptor.icon, input),
      tags: resolveTreeValue(descriptor.tags, input),
      sortKey: resolveTreeValue(descriptor.sortKey, input),
      hasChildren: resolveTreeValue(descriptor.hasChildren, input) ?? Boolean(descriptor.listItems?.(input).length),
      childCount: resolveTreeValue(descriptor.childCount, input) ?? descriptor.listItems?.(input).length,
      operations: resolveTreeValue(descriptor.operations, input),
      summary: resolveTreeValue(descriptor.summary, input),
    };
  }

  const actorId = resolveTreeValue(descriptor.actorId, input);
  const actorKind = resolveTreeValue(descriptor.actorKind, input);
  const title = resolveRequiredTreeValue(descriptor.title, input);
  if (actorId === undefined || actorKind === undefined) {
    return undefined;
  }

  return {
    path: descriptor.path,
    nodeType: "realActorAlias",
    title,
    subtitle: resolveTreeValue(descriptor.subtitle, input),
    icon: resolveTreeValue(descriptor.icon, input),
    tags: resolveTreeValue(descriptor.tags, input),
    sortKey: resolveTreeValue(descriptor.sortKey, input),
    status: resolveTreeValue(descriptor.status, input),
    actorId,
    actorKind,
    hasChildren: resolveTreeValue(descriptor.hasChildren, input),
    childCount: resolveTreeValue(descriptor.childCount, input),
    operations: resolveTreeValue(descriptor.operations, input),
    summary: resolveTreeValue(descriptor.summary, input),
  };
}

function resolveTreeValue<TState, TValue>(
  value: TValue | ((input: TreeProjectionInput<TState>) => TValue) | undefined,
  input: TreeProjectionInput<TState>,
): TValue | undefined {
  if (typeof value === "function") {
    return (value as (input: TreeProjectionInput<TState>) => TValue)(input);
  }
  return value;
}

function resolveRequiredTreeValue<TState, TValue>(
  value: TValue | ((input: TreeProjectionInput<TState>) => TValue),
  input: TreeProjectionInput<TState>,
): TValue {
  return typeof value === "function"
    ? (value as (input: TreeProjectionInput<TState>) => TValue)(input)
    : value;
}

function validateActorShapeDeclaration(shape: ActorShapeDeclaration): void {
  if (shape.state !== undefined) {
    for (const [key, descriptor] of Object.entries(shape.state)) {
      validateDescriptorDefaults(shape.kind, `state.${key}`, descriptor);
    }
  }
  if (shape.init?.defaults !== undefined && shape.state !== undefined) {
    for (const [key, value] of Object.entries(shape.init.defaults as Record<string, unknown>)) {
      const descriptor = shape.state[key];
      if (!descriptor) {
        throw new Error(`defineActorShape("${shape.kind}"): init.defaults.${key} is not declared in state`);
      }
      if (!matchesFieldDescriptor(value, descriptor)) {
        throw new Error(`defineActorShape("${shape.kind}"): init.defaults.${key} = ${describeValue(value)} is not valid for ${describeFieldDescriptor(descriptor)}`);
      }
    }
  }
  if (shape.messages !== undefined) {
    for (const [messageType, message] of Object.entries(shape.messages)) {
      for (const [key, descriptor] of Object.entries(message.fields)) {
        validateDescriptorDefaults(shape.kind, `messages.${messageType}.${key}`, descriptor);
      }
    }
  }
  if (shape.operations !== undefined) {
    for (const [operationId, operation] of Object.entries(shape.operations)) {
      if (!operation?.input) {
        continue;
      }
      for (const [key, descriptor] of Object.entries(operation.input)) {
        validateDescriptorDefaults(shape.kind, `operations.${operationId}.input.${key}`, descriptor);
      }
    }
  }
}

function validateDescriptorDefaults(actorKind: string, path: string, descriptor: FieldDescriptor): void {
  if (descriptor.default !== undefined && !matchesFieldDescriptor(descriptor.default, descriptor)) {
    throw new Error(`defineActorShape("${actorKind}"): ${path}.default = ${describeValue(descriptor.default)} is not valid for ${describeFieldDescriptor(descriptor)}`);
  }
  if (descriptor.kind === "union") {
    for (const [index, variant] of descriptor.variants.entries()) {
      validateDescriptorDefaults(actorKind, `${path}.variants[${index}]`, variant);
    }
  }
  if (descriptor.kind === "object") {
    for (const [key, nested] of Object.entries(descriptor.fields)) {
      validateDescriptorDefaults(actorKind, `${path}.${key}`, nested);
    }
  }
  if (descriptor.kind === "array") {
    validateDescriptorDefaults(actorKind, `${path}[]`, descriptor.item);
  }
}

function describeFieldDescriptor(descriptor: FieldDescriptor): string {
  switch (descriptor.kind) {
    case "string":
    case "number":
    case "integer":
    case "boolean":
    case "json":
    case "ref":
      return descriptor.kind;
    case "literal":
      return `literal(${JSON.stringify(descriptor.value)})`;
    case "enum":
      return `enum(${descriptor.values.map((value) => JSON.stringify(value)).join(", ")})`;
    case "union":
      return `union(${descriptor.variants.map((variant) => describeFieldDescriptor(variant)).join(", ")})`;
    case "array":
      return `array(${describeFieldDescriptor(descriptor.item)})`;
    case "object":
      return "object";
    case "schema":
      return "schema";
  }
}

function describeValue(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return `string(${JSON.stringify(value)})`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return `${typeof value}(${String(value)})`;
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (typeof value === "object") {
    return "object";
  }
  return typeof value;
}

function withActorKindError<TResult>(actorKind: string, operationName: string, thunk: () => TResult): TResult {
  try {
    return thunk();
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Error in ${operationName} for actor kind "${actorKind}": ${error.message}`);
    }
    throw new Error(`Error in ${operationName} for actor kind "${actorKind}": ${String(error)}`);
  }
}