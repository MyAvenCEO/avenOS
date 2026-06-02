import { describe, expect, it } from "vitest";
import { ActorId } from "../src/core/actor-id.js";

describe("ActorId", () => {
  it("parses valid ids and relationships", () => {
    const root = ActorId.root("root");
    const child = root.child("child");
    expect(child.parent()?.equals(root)).toBe(true);
    expect(root.isAncestorOf(child)).toBe(true);
    expect(ActorId.parse("/root/child").equals(child)).toBe(true);
  });

  it("creates deterministic stable ids", () => {
    const root = ActorId.root("root");
    expect(root.stable("run", { a: 1 }).toString()).toBe(root.stable("run", { a: 1 }).toString());
  });

  it.each(["", ".", "..", "line\nbreak", "tab\tchar"])("rejects invalid root segment %j", (value) => {
    expect(() => ActorId.root(value)).toThrow();
    expect(ActorId.tryParse(`/${value}`)).toBeUndefined();
  });

  it("root rejects slash-containing segment", () => {
    expect(() => ActorId.root("a/b")).toThrow();
  });

  it("rejects empty child segment", () => {
    expect(() => ActorId.root("root").child("")).toThrow();
  });

  it("parse throws for invalid values", () => {
    expect(() => ActorId.parse("not-an-actor-id")).toThrow();
    expect(() => ActorId.parse("/foo//bar")).toThrow();
  });

  it("ancestor check is structural", () => {
    expect(ActorId.parse("/foo/bar").isAncestorOf(ActorId.parse("/foo/bar2"))).toBe(false);
  });

  it("stable ids canonicalize object key order and hide key material", () => {
    const root = ActorId.root("root");
    const left = root.stable("job", { a: 1, b: 2 }).toString();
    const right = root.stable("job", { b: 2, a: 1 }).toString();
    expect(left).toBe(right);
    expect(left).toContain("/root/job~");
    expect(left).not.toContain("\"a\"");
    expect(left).not.toContain("\"b\"");
  });
});