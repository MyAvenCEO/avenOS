import { afterEach, describe, expect, it } from "vitest";
import { ActorId } from "../src/core/actor-id.js";
import { SqliteActorPersistence } from "../src/persistence/sqlite/sqlite-persistence.js";
import { assertBasicPersistenceContract } from "../src/testing/persistence-contract.js";

describe("SqliteActorPersistence", () => {
  let persistence: SqliteActorPersistence;

  afterEach(() => persistence?.close());

  it("supports basic create/load contract", async () => {
    persistence = new SqliteActorPersistence(":memory:");
    await assertBasicPersistenceContract(persistence);
    const actor = await persistence.loadActor(ActorId.root("root"));
    expect(actor?.kind).toBe("counter");
  });
});