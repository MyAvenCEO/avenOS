import { describe, expect, it } from "vitest";
import { ActorStatus } from "../src/core/constants.js";
import { buildActorDefinition, buildActorRuntime, buildMessageValidator, defineActorShape, explainInvalidMessage, field, msg, op } from "../src/shape.js";
import { actorType, defineRegistry } from "../src/registry/define-registry.js";

describe("shape derivation", () => {
  it("derives debug descriptors with schemas from required and optional fields", () => {
    const shape = defineActorShape({
      kind: "testActor",
      state: {},
      messages: {
        ping: msg({
          requiredName: field.string(),
          optionalCount: field.integer({ optional: true, default: 3 }),
          nested: field.object({
            enabled: field.boolean({ default: true }),
          }),
        }),
      },
      operations: {
        ping: op({
          title: "Ping",
          description: "Ping the actor.",
        }),
      },
    });

    const runtime = buildActorRuntime(shape);
    expect(runtime.debugDescriptors).toHaveLength(1);
    expect(runtime.debugDescriptors[0]).toMatchObject({
      id: "testActor.ping",
      title: "Ping",
      description: "Ping the actor.",
      messageType: "ping",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["requiredName", "nested"],
        properties: {
          requiredName: { type: "string" },
          optionalCount: { type: "integer", default: 3 },
          nested: {
            type: "object",
            additionalProperties: false,
            required: ["enabled"],
            properties: {
              enabled: { type: "boolean", default: true },
            },
            default: { enabled: true },
          },
        },
        default: {
          optionalCount: 3,
          nested: { enabled: true },
        },
      },
    });
  });

  it("derives debug descriptors from operation metadata and defaults", () => {
    const shape = defineActorShape({
      kind: "testActor",
      state: {},
      messages: {
        createThing: msg({
          id: field.string({ default: "thing-1" }),
          payload: field.json({ default: { ok: true } }),
        }),
      },
      operations: {
        createThing: op({
          title: "Create thing",
          description: "Create a thing.",
          mutates: true,
          dangerous: true,
        }),
      },
    });

    const runtime = buildActorRuntime(shape);
    expect(runtime.debugDescriptors).toEqual([
      {
        id: "testActor.createThing",
        actorKind: "testActor",
        title: "Create thing",
        description: "Create a thing.",
        messageType: "createThing",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["id", "payload"],
          properties: {
            id: { type: "string", default: "thing-1" },
            payload: { default: { ok: true } },
          },
          default: {
            id: "thing-1",
            payload: { ok: true },
          },
        },
        defaultValue: {
          id: "thing-1",
          payload: { ok: true },
        },
        dangerous: true,
      },
    ]);
  });

  it("derives message validators from message descriptors", () => {
    const validateMessage = buildMessageValidator({
      save: msg({
        id: field.string(),
        attempts: field.integer({ optional: true }),
        payload: field.object({
          enabled: field.boolean(),
        }),
      }),
      notify: msg({
        message: field.string(),
      }),
    });

    expect(validateMessage({ type: "save", id: "abc", payload: { enabled: true } })).toBe(true);
    expect(validateMessage({ type: "save", id: "abc", attempts: 2, payload: { enabled: true } })).toBe(true);
    expect(validateMessage({ type: "save", id: "abc", payload: { enabled: true }, extra: 1 })).toBe(false);
    expect(validateMessage({ type: "save", id: "abc", payload: {} })).toBe(false);
    expect(validateMessage({ type: "notify", message: "ok" })).toBe(true);
    expect(validateMessage({ type: "missing", message: "ok" })).toBe(false);
  });

  it("builds a composed actor runtime from a declarative shape", () => {
    const shape = defineActorShape({
      kind: "testActor",
      state: {
        count: field.integer({ default: 0 }),
        name: field.string({ default: "anon" }),
      },
      messages: {
        rename: msg({
          name: field.string(),
        }),
      },
      operations: {
        rename: op({
          title: "Rename",
          description: "Rename the actor.",
          mutates: true,
        }),
      },
      tree: {
        describeSelf({ state, operations }) {
          return {
            hasChildren: false,
            childCount: 0,
            operations,
            summary: { count: state.count, name: state.name },
          };
        },
      },
    });

    const runtime = buildActorRuntime(shape);

    expect(runtime.isMessage({ type: "rename", name: "updated" })).toBe(true);
    expect(runtime.isMessage({ type: "rename" })).toBe(false);
    expect(runtime.initState().state).toEqual({ count: 0, name: "anon" });
    expect(runtime.normalizeState({
      count: 0,
      name: "anon",
      lastResult: { ok: true },
    })).toEqual({ count: 0, name: "anon" });
    expect(runtime.withLastResult(runtime.initState().state, { ok: true })).toEqual({
      count: 0,
      name: "anon",
      lastResult: { ok: true },
    });
    expect(runtime.okResult({ itemId: "thing-1", skipped: undefined })).toEqual({ type: "ok", itemId: "thing-1" });
    expect(runtime.errorResult("invalidRequest", "Bad input", { field: "name" })).toEqual({
      type: "error",
      category: "invalidRequest",
      message: "Bad input",
      details: { field: "name" },
    });
    expect(runtime.debugDescriptors).toHaveLength(1);
    expect(runtime.present?.({ count: 3, name: "tree" })).toBeUndefined();
  });

  it("supports scalar literal unions and exposes shape-owned present on runtime", () => {
    const shape = defineActorShape({
      kind: "testActor",
      state: {
        status: field.union("created", "running", "completed"),
      },
      messages: {
        setStatus: msg({
          status: field.union("created", "running", "completed"),
        }),
      },
      present(state) {
        return { title: state.status };
      },
    });

    const runtime = buildActorRuntime(shape);

    expect(runtime.isMessage({ type: "setStatus", status: "running" })).toBe(true);
    expect(runtime.isMessage({ type: "setStatus", status: "invalid" })).toBe(false);
    expect(runtime.present?.({ status: "created" })).toEqual({ title: "created" });
  });

  it("strips transient fields during normalizeState", () => {
    const shape = defineActorShape({
      kind: "testActor",
      state: {
        persisted: field.string({ default: "kept" }),
        transientId: field.string({ optional: true, transient: true }),
      },
      messages: {
        ping: msg({}),
      },
    });

    const runtime = buildActorRuntime(shape);

    expect(runtime.normalizeState({
      persisted: "kept",
      transientId: "temp-1",
      lastResult: { ok: true },
    })).toEqual({ persisted: "kept" });
  });

  it("explains invalid messages with actionable field diagnostics", () => {
    const shape = defineActorShape({
      kind: "intent",
      messages: {
        humanReply: msg({
          communicationId: field.string(),
          answer: field.json(),
        }),
      },
    });

    expect(explainInvalidMessage(shape, { type: "humanReply" })).toEqual([
      'Invalid message for actor kind "intent":',
      '  message.type = "humanReply"',
      '  field "communicationId": expected string, got undefined',
      '  field "answer": expected json, got undefined',
    ]);
  });

  it("throws declaration errors eagerly for invalid defaults", () => {
    expect(() => defineActorShape({
      kind: "intent",
      state: {
        status: field.enum("created", "completed"),
      },
      init: {
        defaults: {
          status: "invalid",
        },
      },
    })).toThrow('defineActorShape("intent"): init.defaults.status = string("invalid") is not valid for enum("created", "completed")');
  });

  it("includes actor kind in thrown normalizeState errors", () => {
    const shape = defineActorShape({
      kind: "intent",
      state: {
        value: field.string(),
        transientValue: field.string({ optional: true, transient: true }),
      },
      messages: {
        ping: msg({}),
      },
    });

    const runtime = buildActorRuntime(shape);
    expect(() => runtime.normalizeState(new Proxy({ value: "ok", transientValue: "temp" }, {
      get(target, property, receiver) {
        if (property === "value") {
          throw new Error("unexpected field \"foo\" in state");
        }
        return Reflect.get(target, property, receiver);
      },
      deleteProperty() {
        throw new Error("unexpected field \"foo\" in state");
      },
    }) as any)).toThrow('Error in normalizeState for actor kind "intent": unexpected field "foo" in state');
  });

  it("builds a minimal actor definition from a declarative shape", () => {
    const registry = defineRegistry({
      testActor: actorType<
        { readonly count: number; readonly name: string; readonly lastResult?: unknown },
        { readonly type: "rename"; readonly name: string },
        { readonly name?: string },
        "active",
        never
      >(),
    });

    const shape = defineActorShape({
      kind: "testActor",
      state: {
        count: field.integer({ default: 0 }),
        name: field.string({ default: "anon" }),
      },
      messages: {
        rename: msg({
          name: field.string(),
        }),
      },
    });

    const definition = buildActorDefinition<typeof registry, "testActor", typeof shape>(shape, {
      kind: "testActor",
      receive: {
        active() {},
      },
      present(input) {
        return { title: input.state.name };
      },
    });

    expect(definition.kind).toBe("testActor");
    expect(definition.isMessage?.({ type: "rename", name: "next" })).toBe(true);
    expect(definition.init({}).state).toEqual({ count: 0, name: "anon" });
    expect(definition.present?.({
      id: {} as never,
      kind: "testActor",
      status: ActorStatus.Running,
      behavior: "active",
      state: { count: 0, name: "anon" },
      generation: 0,
      version: 0,
    })?.title).toBe("anon");
  });

  it("uses shape-owned present when buildActorDefinition options omit it", () => {
    const registry = defineRegistry({
      testActor: actorType<
        { readonly count: number; readonly name: string; readonly lastResult?: unknown },
        { readonly type: "rename"; readonly name: string },
        {},
        "active",
        never
      >(),
    });

    const shape = defineActorShape({
      kind: "testActor",
      state: {
        count: field.integer({ default: 0 }),
        name: field.string({ default: "anon" }),
      },
      messages: {
        rename: msg({ name: field.string() }),
      },
      present(state) {
        return { title: state.name, subtitle: `${state.count}` };
      },
    });

    const definition = buildActorDefinition<typeof registry, "testActor", typeof shape>(shape, {
      kind: "testActor",
      receive: { active() {} },
    });

    expect(definition.present?.({
      id: {} as never,
      kind: "testActor",
      status: ActorStatus.Running,
      behavior: "active",
      state: { count: 2, name: "shape-owned" },
      generation: 0,
      version: 0,
    })).toEqual({ title: "shape-owned", subtitle: "2" });
  });

  it("injects declaration-derived runtime helpers onto ctx.rt", () => {
    const registry = defineRegistry({
      testActor: actorType<
        { readonly count: number; readonly temp?: string; readonly lastResult?: unknown },
        { readonly type: "rename"; readonly name: string },
        {},
        "active",
        never
      >(),
    });

    const shape = defineActorShape({
      kind: "testActor",
      state: {
        count: field.integer({ default: 0 }),
        temp: field.string({ optional: true, transient: true }),
      },
      messages: {
        rename: msg({
          name: field.string(),
        }),
      },
    });

    let seenTitle: string | undefined;
    const definition = buildActorDefinition<typeof registry, "testActor", typeof shape>(shape, {
      kind: "testActor",
      receive: {
        active(ctx) {
          const ok = ctx.rt.okResult({ renamedTo: "next" }) as { readonly type: string };
          seenTitle = ok.type;
          ctx.setState(ctx.rt.withLastResult(ctx.rt.normalizeState({
            count: ctx.state.count,
            temp: "discard-me",
          }), ok));
        },
      },
    });

    const effects: Array<unknown> = [];
    definition.receive.active({
      self: {} as never,
      parent: undefined,
      sender: undefined,
      state: { count: 0, temp: "x" },
      behavior: "active",
      envelope: {} as never,
      now: new Date(),
      signal: new AbortController().signal,
      send() {},
      spawn() { return {} as never; },
      setState(state) { effects.push(state); },
      become() {},
      stop() {},
      stopChild() {},
    }, { type: "rename", name: "next" });

    expect(seenTitle).toBe("ok");
    expect(effects).toEqual([{ count: 0, lastResult: { type: "ok", renamedTo: "next" } }]);
  });

  it("passes lifecycle hooks through buildActorDefinition", () => {
    const registry = defineRegistry({
      testActor: actorType<
        { readonly count: number; readonly lastResult?: unknown },
        { readonly type: "ping" },
        {},
        "active",
        never
      >(),
    });

    const shape = defineActorShape({
      kind: "testActor",
      state: {
        count: field.integer({ default: 0 }),
      },
      messages: {
        ping: msg({}),
      },
    });

    let seenCount: number | undefined;
    const onStart = (ctx: any) => {
      seenCount = ctx.rt.initState().state.count;
    };

    const definition = buildActorDefinition<typeof registry, "testActor", typeof shape>(shape, {
      kind: "testActor",
      receive: {
        active() {},
      },
      onStart,
    });

    definition.onStart?.({
      self: {} as never,
      parent: undefined,
      sender: undefined,
      state: { count: 4 },
      behavior: "active",
      envelope: {} as never,
      now: new Date(),
      signal: new AbortController().signal,
      send() {},
      spawn() { return {} as never; },
      setState() {},
      become() {},
      stop() {},
      stopChild() {},
    });

    expect(seenCount).toBe(0);
  });

  it("allows custom init and isMessage overrides in buildActorDefinition", () => {
    const registry = defineRegistry({
      testActor: actorType<
        { readonly value: string; readonly lastResult?: unknown },
        { readonly type: "ping"; readonly id: string },
        { readonly seed: string },
        "active",
        never
      >(),
    });

    const shape = defineActorShape({
      kind: "testActor",
      state: {
        value: field.string({ default: "default" }),
      },
      messages: {
        ping: msg({
          id: field.string(),
        }),
      },
    });

    const definition = buildActorDefinition<typeof registry, "testActor", typeof shape>(shape, {
      kind: "testActor",
      init(input) {
        return { state: { value: input.seed }, behavior: "active" };
      },
      isMessage(value): value is { readonly type: "ping"; readonly id: string } {
        return typeof value === "object"
          && value !== null
          && !Array.isArray(value)
          && (value as { readonly type?: unknown }).type === "ping"
          && typeof (value as { readonly id?: unknown }).id === "string";
      },
      receive: {
        active() {},
      },
    });

    expect(definition.init({ seed: "custom" }).state).toEqual({ value: "custom" });
    expect(definition.isMessage?.({ type: "ping", id: "abc" })).toBe(true);
    expect(definition.isMessage?.({ type: "ping" })).toBe(false);
  });

  it("allows buildActorDefinition without declarative messages when custom wiring is supplied", () => {
    const registry = defineRegistry({
      testActor: actorType<
        { readonly value: number; readonly lastResult?: unknown },
        { readonly type: "custom" },
        {},
        "active",
        never
      >(),
    });

    const shape = defineActorShape({
      kind: "testActor",
      state: {
        value: field.integer({ default: 1 }),
      },
    });

    const definition = buildActorDefinition<typeof registry, "testActor", typeof shape>(shape, {
      kind: "testActor",
      isMessage(value): value is { readonly type: "custom" } {
        return typeof value === "object"
          && value !== null
          && !Array.isArray(value)
          && (value as { readonly type?: unknown }).type === "custom";
      },
      receive: {
        active() {},
      },
    });

    expect(definition.init({}).state).toEqual({ value: 1 });
    expect(definition.isMessage?.({ type: "custom" })).toBe(true);
  });
});