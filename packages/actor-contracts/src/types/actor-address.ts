/**
 * Stable address of an actor that can receive messages from another actor or adapter.
 *
 * This is a public actor-facing contract and must stay runtime-agnostic.
 */
export interface ActorAddress<K extends string = string> {
  /** Stable actor id/path string. */
  readonly actorId: string;
  /** Runtime actor kind identifier. */
  readonly actorKind: K;
}
