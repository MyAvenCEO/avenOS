import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const blockedLiterals = [
  '"running"',
  '"queued"',
  '"processing"',
  '"lifecycle.stop"',
  '"supervision"',
  '"restart"',
  '"retry"',
  '"deadLetter"',
  '"activationCommitted"',
];

function collectTsFiles(root: string): string[] {
  const entries = readdirSync(root);
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...collectTsFiles(path));
      continue;
    }
    if (path.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

describe("no magic strings", () => {
  it("does not compare raw protocol literals in runtime and persistence sources", () => {
    const srcRoot = join(process.cwd(), "src");
    const offenders: string[] = [];
    for (const path of collectTsFiles(srcRoot)) {
      const rel = relative(srcRoot, path);
      if (rel === "core/constants.ts") {
        continue;
      }
      const content = readFileSync(path, "utf8");
      for (const literal of blockedLiterals) {
        if (content.includes(`=== ${literal}`) || content.includes(`!== ${literal}`)) {
          offenders.push(`${rel}:${literal}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});