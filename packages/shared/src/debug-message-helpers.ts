import type { JsonValue } from "typed-actors";

export interface DebugMessageDescriptorLike {
  readonly id: string;
  readonly actorKind: string;
  readonly title: string;
  readonly description?: string;
  readonly messageType: string;
  readonly schema: JsonValue;
  readonly defaultValue: JsonValue;
  readonly dangerous?: boolean;
}

export function groupDebugMessageDescriptorsByActorKind(
  descriptors: readonly DebugMessageDescriptorLike[],
): Readonly<Record<string, readonly DebugMessageDescriptorLike[]>> {
  const grouped: Record<string, DebugMessageDescriptorLike[]> = {};
  for (const descriptor of descriptors) {
    const current = grouped[descriptor.actorKind] ?? [];
    grouped[descriptor.actorKind] = [...current, descriptor];
  }
  return grouped;
}