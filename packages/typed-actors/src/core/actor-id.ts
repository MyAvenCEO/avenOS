import { createHash } from "node:crypto";
import { canonicalJsonString, type JsonValue } from "./json.js";
import type { ActorIdString, ActorPathSegment } from "./ids.js";

export type StableIdentityKey = JsonValue;

function assertValidSegment(segment: string): asserts segment is ActorPathSegment {
  if (
    segment.length === 0 ||
    segment.includes("/") ||
    segment === "." ||
    segment === ".." ||
    /[\u0000-\u001F\u007F]/u.test(segment)
  ) {
    throw new Error(`Invalid actor path segment: ${segment}`);
  }
}

function toActorPathSegment(segment: string): ActorPathSegment {
  assertValidSegment(segment);
  return segment as ActorPathSegment;
}

function sha256Base64Url(input: string): string {
  return createHash("sha256").update(input).digest("base64url");
}

export class ActorId {
  static root(name: string): ActorId {
    return new ActorId([toActorPathSegment(name)]);
  }

  static parse(value: string): ActorId {
    const parsed = ActorId.tryParse(value);
    if (!parsed) {
      throw new Error(`Invalid actor id: ${value}`);
    }
    return parsed;
  }

  static tryParse(value: string): ActorId | undefined {
    if (!value.startsWith("/")) {
      return undefined;
    }
    const parts = value.slice(1).split("/");
    if (parts.length === 0 || parts.some((part) => part.length === 0)) {
      return undefined;
    }
    try {
      return new ActorId(parts.map(toActorPathSegment));
    } catch {
      return undefined;
    }
  }

  readonly path: readonly ActorPathSegment[];
  readonly value: ActorIdString;

  constructor(path: readonly ActorPathSegment[]) {
    if (path.length === 0) {
      throw new Error("ActorId path must not be empty");
    }
    this.path = [...path];
    this.value = (`/${path.join("/")}`) as ActorIdString;
  }

  parent(): ActorId | undefined {
    if (this.path.length === 1) {
      return undefined;
    }
    return new ActorId(this.path.slice(0, -1));
  }

  child(segment: string): ActorId {
    return new ActorId([...this.path, toActorPathSegment(segment)]);
  }

  named(segment: string): ActorId {
    return this.child(segment);
  }

  stable(prefix: string, key: StableIdentityKey): ActorId {
    const digest = sha256Base64Url(canonicalJsonString(key)).slice(0, 16);
    return this.child(`${prefix}~${digest}`);
  }

  isRoot(): boolean {
    return this.path.length === 1;
  }

  isAncestorOf(other: ActorId): boolean {
    if (this.path.length >= other.path.length) {
      return false;
    }
    return this.path.every((segment, index) => segment === other.path[index]);
  }

  isDescendantOf(other: ActorId): boolean {
    return other.isAncestorOf(this);
  }

  equals(other: ActorId): boolean {
    return this.value === other.value;
  }

  toString(): ActorIdString {
    return this.value;
  }
}