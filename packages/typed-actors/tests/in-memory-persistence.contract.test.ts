import { describe, expect, it } from "vitest";
import { ActorId } from "../src/core/actor-id.js";
import { InMemoryActorPersistence } from "../src/persistence/in-memory/in-memory-persistence.js";
import { assertBasicPersistenceContract } from "../src/testing/persistence-contract.js";

describe("InMemoryActorPersistence", () => {
  it("supports basic create/load contract", async () => {
    const persistence = new InMemoryActorPersistence();
    await assertBasicPersistenceContract(persistence);
    const actor = await persistence.loadActor(ActorId.root("root"));
    expect(actor?.kind).toBe("counter");
  });
});