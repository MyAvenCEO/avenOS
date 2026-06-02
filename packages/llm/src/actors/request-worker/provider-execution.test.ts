import { describe, expect, it } from "bun:test";
import { extractSingleJsonDocument } from "./provider-execution.ts";

describe("extractSingleJsonDocument", () => {
  it("parses a raw JSON document", () => {
    expect(extractSingleJsonDocument('{"ok":true}')).toEqual({ ok: true });
  });

  it("parses a fenced JSON block", () => {
    expect(extractSingleJsonDocument('```json\n{"ok":true}\n```')).toEqual({ ok: true });
  });

  it("recovers a single balanced JSON object from surrounding prose", () => {
    expect(
      extractSingleJsonDocument('Here is the extracted invoice JSON:\n\n{"invoice_number":"INV-1","total":{"amount":12}}\n\nLet me know if you want a summary.'),
    ).toEqual({ invoice_number: "INV-1", total: { amount: 12 } });
  });

  it("recovers a fenced JSON block even when the provider adds surrounding prose", () => {
    expect(
      extractSingleJsonDocument('I extracted the invoice below.\n```json\n{"vendor":"Fly.io"}\n```\nDone.'),
    ).toEqual({ vendor: "Fly.io" });
  });

  it("prefers the complete JSON document over earlier nested objects", () => {
    expect(
      extractSingleJsonDocument('Vendor summary: {"name":"Fly.io, Inc."}\nFull invoice JSON: {"vendor":{"name":"Fly.io, Inc."},"buyer":{"name":"Visioncreator GmbH"},"header":{"document_kind":"invoice"},"statements":[]}'),
    ).toEqual({
      vendor: { name: "Fly.io, Inc." },
      buyer: { name: "Visioncreator GmbH" },
      header: { document_kind: "invoice" },
      statements: [],
    });
  });
});