import { describe, expect, it } from "vitest";
import { cloneJson, isJsonValue } from "../src/core/json.js";

describe("json", () => {
  it("accepts plain json values", () => {
    expect(isJsonValue({ a: [1, true, null] })).toBe(true);
  });

  it("rejects unsupported values and clones", () => {
    expect(isJsonValue(new Date())).toBe(false);
    const value = { a: 1, b: [2] };
    expect(cloneJson(value)).toEqual(value);
  });
});