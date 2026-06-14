using Akka.Actor;
using Akka.Configuration;
using Aven.Roles.Support;

namespace Aven.Tests.Capabilities;

public sealed class Phase06CapabilitiesTests
{
    [Fact]
    public void MissingCapability_IsRejected()
    {
        var authority = new InMemoryCapabilityAdmissionClient();
        var request = CreateRequest(new CapabilityId("cap-missing"));

        var result = authority.Admit(request);

        var rejected = Assert.IsType<CapabilityRejected>(result);
        Assert.Equal("capability_missing", rejected.Error.Code);
    }

    [Fact]
    public void WrongTarget_IsRejected()
    {
        var authority = new InMemoryCapabilityAdmissionClient();
        var holder = new ActorAddress("holder/a", "local");
        var grant = CreateGrant(holder: holder, target: new ActorAddress("target/a", "local"));
        authority.UpsertGrant(grant);

        var result = authority.Admit(CreateRequest(
            grant.Id,
            operationKey: CreateOperationKey("req-target", holder),
            target: new ActorAddress("target/b", "local")));

        var rejected = Assert.IsType<CapabilityRejected>(result);
        Assert.Equal("capability_wrong_target", rejected.Error.Code);
    }

    [Fact]
    public void WrongHolder_IsRejected_EvenWhenTargetAndMessageTypeMatch()
    {
        var authority = new InMemoryCapabilityAdmissionClient();
        var grant = CreateGrant(holder: new ActorAddress("holder/accountant", "local"));
        authority.UpsertGrant(grant);

        var result = authority.Admit(CreateRequest(
            grant.Id,
            operationKey: new OperationKey(new ActorAddress("holder/research", "local"), new RequestId("req-holder"), "artifact.create")));

        var rejected = Assert.IsType<CapabilityRejected>(result);
        Assert.Equal("capability_wrong_holder", rejected.Error.Code);
    }

    [Fact]
    public void ExpiredOrRevoked_IsRejected()
    {
        var authority = new InMemoryCapabilityAdmissionClient();
        var now = DateTimeOffset.UtcNow;
        var holder = new ActorAddress("holder/a", "local");

        var expired = CreateGrant(id: new CapabilityId("cap-expired"), holder: holder, expiresAt: now.AddMinutes(-1));
        var revoked = CreateGrant(id: new CapabilityId("cap-revoked"), holder: holder, revokedAt: now.AddMinutes(-1));
        authority.UpsertGrant(expired);
        authority.UpsertGrant(revoked);

        var expiredResult = Assert.IsType<CapabilityRejected>(authority.Admit(CreateRequest(expired.Id, operationKey: CreateOperationKey("req-expired", holder), requestedAt: now)));
        var revokedResult = Assert.IsType<CapabilityRejected>(authority.Admit(CreateRequest(revoked.Id, operationKey: CreateOperationKey("req-revoked", holder), requestedAt: now)));

        Assert.Equal("capability_expired", expiredResult.Error.Code);
        Assert.Equal("capability_revoked", revokedResult.Error.Code);
    }

    [Fact]
    public void MaxUse_CannotBeExceeded()
    {
        var authority = new InMemoryCapabilityAdmissionClient();
        var holder = new ActorAddress("holder/a", "local");
        var grant = CreateGrant(holder: holder, constraints: new CapabilityConstraints(MaxUses: 1));
        authority.UpsertGrant(grant);

        var first = authority.Admit(CreateRequest(grant.Id, operationKey: CreateOperationKey("req-1", holder)));
        var second = authority.Admit(CreateRequest(grant.Id, operationKey: CreateOperationKey("req-2", holder)));

        Assert.IsType<CapabilityAdmitted>(first);
        var rejected = Assert.IsType<CapabilityRejected>(second);
        Assert.Equal("capability_max_uses_exceeded", rejected.Error.Code);
    }

    [Fact]
    public void DuplicateSameOperationKey_DoesNotConsumeAnotherUse()
    {
        var authority = new InMemoryCapabilityAdmissionClient();
        var holder = new ActorAddress("holder/a", "local");
        var grant = CreateGrant(holder: holder, constraints: new CapabilityConstraints(MaxUses: 1));
        authority.UpsertGrant(grant);

        var operationKey = CreateOperationKey("req-dup", holder);
        var first = Assert.IsType<CapabilityAdmitted>(authority.Admit(CreateRequest(grant.Id, operationKey: operationKey)));
        var second = Assert.IsType<CapabilityAdmitted>(authority.Admit(CreateRequest(grant.Id, operationKey: operationKey)));

        Assert.Equal(1, first.TotalUsesConsumed);
        Assert.Equal(1, second.TotalUsesConsumed);
    }

    [Fact]
    public void DifferentHolders_CannotUseEachOthersGrants()
    {
        var authority = new InMemoryCapabilityAdmissionClient();
        var accountantGrant = CreateGrant(id: new CapabilityId("cap-accountant"), holder: new ActorAddress("agent/accountant", "local"));
        var researchGrant = CreateGrant(id: new CapabilityId("cap-research"), holder: new ActorAddress("agent/research", "local"));
        authority.UpsertGrant(accountantGrant);
        authority.UpsertGrant(researchGrant);

        var researchUsingAccountant = Assert.IsType<CapabilityRejected>(authority.Admit(CreateRequest(
            accountantGrant.Id,
            operationKey: new OperationKey(new ActorAddress("agent/research", "local"), new RequestId("req-cross-1"), "artifact.create"))));
        var accountantUsingResearch = Assert.IsType<CapabilityRejected>(authority.Admit(CreateRequest(
            researchGrant.Id,
            operationKey: new OperationKey(new ActorAddress("agent/accountant", "local"), new RequestId("req-cross-2"), "artifact.create"))));

        Assert.Equal("capability_wrong_holder", researchUsingAccountant.Error.Code);
        Assert.Equal("capability_wrong_holder", accountantUsingResearch.Error.Code);
    }

    [Fact]
    [Trait("Category", "FoundationUnit")]
    public void Capability_allowed_schema_caveat_rejects_out_of_scope_schema()
    {
        var authority = new InMemoryCapabilityAdmissionClient();
        var holder = new ActorAddress("holder/a", "local");
        var grant = CreateGrant(holder: holder, constraints: Caveats(("allowedSchemas", "schema://invoice@1")));
        authority.UpsertGrant(grant);

        var rejected = Assert.IsType<CapabilityRejected>(authority.Admit(CreateRequest(
            grant.Id,
            operationKey: CreateOperationKey("req-schema", holder),
            resourceAttributes: new Dictionary<string, string> { ["schema"] = "schema://payment@1" })));

        Assert.Equal("capability_schema_not_allowed", rejected.Error.Code);
    }

    [Fact]
    [Trait("Category", "FoundationUnit")]
    public void Capability_allowed_subject_type_caveat_rejects_out_of_scope_subject()
    {
        var authority = new InMemoryCapabilityAdmissionClient();
        var holder = new ActorAddress("holder/a", "local");
        var grant = CreateGrant(holder: holder, constraints: Caveats(("allowedSubjectTypes", "artifact-revision")));
        authority.UpsertGrant(grant);

        var rejected = Assert.IsType<CapabilityRejected>(authority.Admit(CreateRequest(
            grant.Id,
            operationKey: CreateOperationKey("req-subject", holder),
            resourceAttributes: new Dictionary<string, string> { ["subjectType"] = "agent" })));

        Assert.Equal("capability_subject_type_not_allowed", rejected.Error.Code);
    }

    [Fact]
    [Trait("Category", "FoundationUnit")]
    public void Capability_allowed_mime_type_caveat_rejects_out_of_scope_artifact()
    {
        var authority = new InMemoryCapabilityAdmissionClient();
        var holder = new ActorAddress("holder/a", "local");
        var grant = CreateGrant(holder: holder, constraints: Caveats(("allowedMimeTypes", "application/json")));
        authority.UpsertGrant(grant);

        var rejected = Assert.IsType<CapabilityRejected>(authority.Admit(CreateRequest(
            grant.Id,
            operationKey: CreateOperationKey("req-mime", holder),
            resourceAttributes: new Dictionary<string, string> { ["mimeType"] = "text/plain" })));

        Assert.Equal("capability_mime_type_not_allowed", rejected.Error.Code);
    }

    [Fact]
    [Trait("Category", "FoundationUnit")]
    public void Capability_require_evidence_handles_rejects_missing_handles()
    {
        var authority = new InMemoryCapabilityAdmissionClient();
        var holder = new ActorAddress("holder/a", "local");
        var grant = CreateGrant(holder: holder, constraints: Caveats(("requireEvidenceHandles", "true")));
        authority.UpsertGrant(grant);

        var rejected = Assert.IsType<CapabilityRejected>(authority.Admit(CreateRequest(
            grant.Id,
            operationKey: CreateOperationKey("req-evidence", holder),
            resourceAttributes: new Dictionary<string, string>())));

        Assert.Equal("capability_evidence_handles_required", rejected.Error.Code);
    }

    [Fact]
    [Trait("Category", "FoundationUnit")]
    public void Capability_allow_supersession_false_rejects_supersede()
    {
        var authority = new InMemoryCapabilityAdmissionClient();
        var holder = new ActorAddress("holder/a", "local");
        var grant = CreateGrant(holder: holder, constraints: Caveats(("allowSupersession", "false")));
        authority.UpsertGrant(grant);

        var rejected = Assert.IsType<CapabilityRejected>(authority.Admit(CreateRequest(
            grant.Id,
            operationKey: CreateOperationKey("req-supersede", holder),
            resourceAttributes: new Dictionary<string, string> { ["supersedesRecordId"] = "record-1" })));

        Assert.Equal("capability_supersession_not_allowed", rejected.Error.Code);
    }

    [Fact]
    [Trait("Category", "FoundationUnit")]
    public void Delegated_capability_can_only_attenuate_parent()
    {
        var authority = new InMemoryCapabilityAdmissionClient();
        var parent = CreateGrant(
            id: new CapabilityId("cap-parent"),
            holder: new ActorAddress("holder/parent", "local"),
            constraints: new CapabilityConstraints(MaxUses: 5),
            canDelegate: true,
            expiresAt: DateTimeOffset.UtcNow.AddHours(1));
        var childHolder = new ActorAddress("holder/child", "local");
        var child = CreateGrant(
            id: new CapabilityId("cap-child"),
            holder: childHolder,
            constraints: new CapabilityConstraints(MaxUses: 2),
            parentCapabilityId: parent.Id,
            expiresAt: DateTimeOffset.UtcNow.AddMinutes(30));
        authority.UpsertGrant(parent);
        authority.UpsertGrant(child);

        var admitted = authority.Admit(CreateRequest(child.Id, operationKey: CreateOperationKey("req-child", childHolder)));

        Assert.IsType<CapabilityAdmitted>(admitted);
    }

    [Fact]
    [Trait("Category", "FoundationUnit")]
    public void Delegated_capability_cannot_add_actions_or_broaden_resource()
    {
        var authority = new InMemoryCapabilityAdmissionClient();
        var parent = CreateGrant(
            id: new CapabilityId("cap-parent-action"),
            holder: new ActorAddress("holder/parent", "local"),
            canDelegate: true,
            allowedMessageTypes: new[] { "artifact.create" });
        var childHolder = new ActorAddress("holder/child", "local");
        var child = CreateGrant(
            id: new CapabilityId("cap-child-action"),
            holder: childHolder,
            parentCapabilityId: parent.Id,
            allowedMessageTypes: new[] { "artifact.create", "artifact.delete" });
        authority.UpsertGrant(parent);
        authority.UpsertGrant(child);

        var rejected = Assert.IsType<CapabilityRejected>(authority.Admit(CreateRequest(
            child.Id,
            operationKey: CreateOperationKey("req-child-action", childHolder),
            messageType: "artifact.create")));

        Assert.Equal("capability_delegation_broadens_actions", rejected.Error.Code);
    }

    [Fact]
    public async Task ActorBackedCapabilityRegistry_AdmitPersistsUsesAcrossRestart()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"aven-phase06-capability-{Guid.NewGuid():N}.sqlite");
        const string persistenceId = "capability-registry-persist-uses";
        var holder = new ActorAddress("holder/persist", "local");
        var grant = CreateGrant(
            id: new CapabilityId("cap-persist-uses"),
            holder: holder,
            constraints: new CapabilityConstraints(MaxUses: 1));

        try
        {
            await WithPersistentAuthority(dbPath, persistenceId, async authority =>
            {
                authority.UpsertGrant(grant);
                Assert.IsType<CapabilityAdmitted>(authority.Admit(CreateRequest(grant.Id, operationKey: CreateOperationKey("req-first", holder))));
                await Task.CompletedTask;
            });

            await WithPersistentAuthority(dbPath, persistenceId, async authority =>
            {
                var rejected = Assert.IsType<CapabilityRejected>(authority.Admit(CreateRequest(grant.Id, operationKey: CreateOperationKey("req-second", holder))));
                Assert.Equal("capability_max_uses_exceeded", rejected.Error.Code);
                await Task.CompletedTask;
            });
        }
        finally
        {
            if (File.Exists(dbPath))
            {
                File.Delete(dbPath);
            }
        }
    }

    [Fact]
    public async Task ActorBackedCapabilityRegistry_DuplicateSameOperationKeyAfterRestart_IsIdempotent()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"aven-phase06-capability-{Guid.NewGuid():N}.sqlite");
        const string persistenceId = "capability-registry-duplicate-restart";
        var holder = new ActorAddress("holder/idempotent", "local");
        var grant = CreateGrant(
            id: new CapabilityId("cap-idempotent"),
            holder: holder,
            constraints: new CapabilityConstraints(MaxUses: 1));
        var operationKey = CreateOperationKey("req-dup-restart", holder);

        try
        {
            await WithPersistentAuthority(dbPath, persistenceId, async authority =>
            {
                authority.UpsertGrant(grant);
                var first = Assert.IsType<CapabilityAdmitted>(authority.Admit(CreateRequest(grant.Id, operationKey: operationKey)));
                Assert.Equal(1, first.TotalUsesConsumed);
                await Task.CompletedTask;
            });

            await WithPersistentAuthority(dbPath, persistenceId, async authority =>
            {
                var second = Assert.IsType<CapabilityAdmitted>(authority.Admit(CreateRequest(grant.Id, operationKey: operationKey)));
                Assert.Equal(1, second.TotalUsesConsumed);

                var rejected = Assert.IsType<CapabilityRejected>(authority.Admit(CreateRequest(grant.Id, operationKey: CreateOperationKey("req-new-after-dup", holder))));
                Assert.Equal("capability_max_uses_exceeded", rejected.Error.Code);
                await Task.CompletedTask;
            });
        }
        finally
        {
            if (File.Exists(dbPath))
            {
                File.Delete(dbPath);
            }
        }
    }

    [Fact]
    public async Task ActorBackedCapabilityRegistry_RejectsDelegationParentMissingOrNotDelegable()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"aven-phase06-capability-{Guid.NewGuid():N}.sqlite");
        const string persistenceId = "capability-registry-delegation-validation";
        var childHolder = new ActorAddress("holder/delegate-child", "local");
        var parentHolder = new ActorAddress("holder/delegate-parent", "local");

        try
        {
            await WithPersistentAuthority(dbPath, persistenceId, async authority =>
            {
                var missingParentChild = CreateGrant(
                    id: new CapabilityId("cap-child-missing-parent"),
                    holder: childHolder,
                    parentCapabilityId: new CapabilityId("cap-parent-missing"));
                authority.UpsertGrant(missingParentChild);

                var missingParentRejected = Assert.IsType<CapabilityRejected>(authority.Admit(CreateRequest(
                    missingParentChild.Id,
                    operationKey: CreateOperationKey("req-missing-parent", childHolder))));
                Assert.Equal("capability_delegation_parent_missing", missingParentRejected.Error.Code);

                var parent = CreateGrant(
                    id: new CapabilityId("cap-parent-no-delegate"),
                    holder: parentHolder,
                    canDelegate: false);
                var child = CreateGrant(
                    id: new CapabilityId("cap-child-no-delegate"),
                    holder: childHolder,
                    parentCapabilityId: parent.Id);

                authority.UpsertGrant(parent);
                authority.UpsertGrant(child);

                var notDelegableRejected = Assert.IsType<CapabilityRejected>(authority.Admit(CreateRequest(
                    child.Id,
                    operationKey: CreateOperationKey("req-parent-not-delegable", childHolder))));
                Assert.Equal("capability_delegation_not_allowed", notDelegableRejected.Error.Code);
                await Task.CompletedTask;
            });
        }
        finally
        {
            if (File.Exists(dbPath))
            {
                File.Delete(dbPath);
            }
        }
    }

    [Fact]
    public async Task ActorBackedCapabilityRegistry_AllowsSameLocalCapabilityNameForDifferentAgentsWhenIdsAreScoped()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"aven-phase06-capability-{Guid.NewGuid():N}.sqlite");
        const string persistenceId = "capability-registry-agent-scoped-ids";
        var agentA = new RoleAgentId("agent-a");
        var agentB = new RoleAgentId("agent-b");
        var holderA = new ActorAddress("agent/agent-a", "local");
        var holderB = new ActorAddress("agent/agent-b", "local");
        var target = new ActorAddress("resource/artifact", "local");
        var agentACapabilityId = new CapabilityId(RoleCapabilityIds.ForRoleAgent(agentA, "ledger-create"));
        var agentBCapabilityId = new CapabilityId(RoleCapabilityIds.ForRoleAgent(agentB, "ledger-create"));

        try
        {
            await WithPersistentAuthority(dbPath, persistenceId, async authority =>
            {
                authority.UpsertGrant(CreateGrant(id: agentACapabilityId, holder: holderA, target: target));
                authority.UpsertGrant(CreateGrant(id: agentBCapabilityId, holder: holderB, target: target));

                Assert.IsType<CapabilityAdmitted>(authority.Admit(CreateRequest(agentACapabilityId, operationKey: CreateOperationKey("req-agent-a", holderA), target: target)));
                Assert.IsType<CapabilityAdmitted>(authority.Admit(CreateRequest(agentBCapabilityId, operationKey: CreateOperationKey("req-agent-b", holderB), target: target)));

                var rejected = Assert.IsType<CapabilityRejected>(authority.Admit(CreateRequest(agentBCapabilityId, operationKey: CreateOperationKey("req-agent-a-wrong-holder", holderA), target: target)));
                Assert.Equal("capability_wrong_holder", rejected.Error.Code);
                await Task.CompletedTask;
            });

            await WithPersistentAuthority(dbPath, persistenceId, async authority =>
            {
                Assert.IsType<CapabilityAdmitted>(authority.Admit(CreateRequest(agentACapabilityId, operationKey: CreateOperationKey("req-agent-a-restart", holderA), target: target)));
                Assert.IsType<CapabilityAdmitted>(authority.Admit(CreateRequest(agentBCapabilityId, operationKey: CreateOperationKey("req-agent-b-restart", holderB), target: target)));
                await Task.CompletedTask;
            });
        }
        finally
        {
            if (File.Exists(dbPath))
            {
                File.Delete(dbPath);
            }
        }
    }

    [Fact]
    public async Task ActorBackedCapabilityRegistry_RevokedGrantRejectsBeforeHolderTargetOrMessageChecks()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"aven-phase06-capability-{Guid.NewGuid():N}.sqlite");
        const string persistenceId = "capability-registry-revoked-precedence";
        var holderA = new ActorAddress("agent/holder-a", "local");

        try
        {
            await WithPersistentAuthority(dbPath, persistenceId, async authority =>
            {
                authority.UpsertGrant(CreateGrant(
                    id: new CapabilityId("cap-revoked-precedence"),
                    holder: holderA,
                    target: new ActorAddress("resource/artifact", "local"),
                    allowedMessageTypes: new[] { "artifact.create" },
                    revokedAt: DateTimeOffset.UtcNow.AddMinutes(-1)));

                var rejected = Assert.IsType<CapabilityRejected>(authority.Admit(CreateRequest(
                    new CapabilityId("cap-revoked-precedence"),
                    operationKey: new OperationKey(new ActorAddress("agent/holder-b", "local"), new RequestId("req-revoked-precedence"), "artifact.delete"),
                    target: new ActorAddress("resource/human", "local"),
                    messageType: "human.approve",
                    requestedAt: DateTimeOffset.UtcNow)));

                Assert.Equal("capability_revoked", rejected.Error.Code);
                await Task.CompletedTask;
            });
        }
        finally
        {
            if (File.Exists(dbPath))
            {
                File.Delete(dbPath);
            }
        }
    }

    [Fact]
    public void InMemoryCapabilityAdmissionClient_RevokedGrantRejectsBeforeHolderTargetOrMessageChecks()
    {
        var authority = new InMemoryCapabilityAdmissionClient();
        authority.UpsertGrant(CreateGrant(
            id: new CapabilityId("cap-fake-revoked-precedence"),
            holder: new ActorAddress("agent/holder-a", "local"),
            target: new ActorAddress("resource/artifact", "local"),
            allowedMessageTypes: new[] { "artifact.create" },
            revokedAt: DateTimeOffset.UtcNow.AddMinutes(-1)));

        var rejected = Assert.IsType<CapabilityRejected>(authority.Admit(CreateRequest(
            new CapabilityId("cap-fake-revoked-precedence"),
            operationKey: new OperationKey(new ActorAddress("agent/holder-b", "local"), new RequestId("req-fake-revoked-precedence"), "artifact.delete"),
            target: new ActorAddress("resource/human", "local"),
            messageType: "human.approve",
            requestedAt: DateTimeOffset.UtcNow)));

        Assert.Equal("capability_revoked", rejected.Error.Code);
    }

    private static CapabilityGrant CreateGrant(
        CapabilityId? id = null,
        ActorAddress? holder = null,
        ActorAddress? target = null,
        CapabilityConstraints? constraints = null,
        bool canDelegate = false,
        CapabilityId? parentCapabilityId = null,
        IEnumerable<string>? allowedMessageTypes = null,
        DateTimeOffset? expiresAt = null,
        DateTimeOffset? revokedAt = null)
        => new(
            id ?? new CapabilityId("cap-001"),
            holder ?? new ActorAddress("holder/a", "local"),
            target ?? new ActorAddress("target/a", "local"),
            (allowedMessageTypes ?? new[] { "artifact.create" }).ToHashSet(StringComparer.Ordinal),
            constraints ?? new CapabilityConstraints(),
            canDelegate,
            parentCapabilityId,
            expiresAt,
            revokedAt);

    private static CapabilityAdmissionRequest CreateRequest(
        CapabilityId capabilityId,
        OperationKey? operationKey = null,
        ActorAddress? target = null,
        string messageType = "artifact.create",
        DateTimeOffset? requestedAt = null,
        IReadOnlyDictionary<string, string>? resourceAttributes = null)
        => new(
            capabilityId,
            operationKey ?? CreateOperationKey("req-001"),
            target ?? new ActorAddress("target/a", "local"),
            messageType,
            requestedAt ?? DateTimeOffset.UtcNow,
            resourceAttributes);

    private static OperationKey CreateOperationKey(string requestId, ActorAddress? caller = null) =>
        new(caller ?? new ActorAddress("caller/a", "local"), new RequestId(requestId), "artifact.create");

    private static CapabilityConstraints Caveats(params (string Key, string Value)[] caveats) =>
        new(Metadata: caveats.ToDictionary(static caveat => caveat.Key, static caveat => caveat.Value, StringComparer.Ordinal));

    private static async Task WithPersistentAuthority(string dbPath, string persistenceId, Func<CapabilityAdmissionClient, Task> action)
    {
        var config = ConfigurationFactory.ParseString($$"""
            akka {
              loglevel = WARNING
              stdout-loglevel = WARNING
              persistence {
                journal.plugin = "akka.persistence.journal.sqlite"
                snapshot-store.plugin = "akka.persistence.snapshot-store.sqlite"
                journal.sqlite {
                  class = "Akka.Persistence.Sqlite.Journal.SqliteJournal, Akka.Persistence.Sqlite"
                  plugin-dispatcher = "akka.actor.default-dispatcher"
                  connection-string = "Data Source={{EscapeForHocon(dbPath)}}"
                  auto-initialize = on
                }
                snapshot-store.sqlite {
                  class = "Akka.Persistence.Sqlite.Snapshot.SqliteSnapshotStore, Akka.Persistence.Sqlite"
                  plugin-dispatcher = "akka.actor.default-dispatcher"
                  connection-string = "Data Source={{EscapeForHocon(dbPath)}}"
                  auto-initialize = on
                }
              }
            }
            """);

        var system = ActorSystem.Create($"aven-phase06-capability-{Guid.NewGuid():N}", config);
        try
        {
            var authority = CreateCapabilityAdmissionClient(system, persistenceId);
            await action(authority);
        }
        finally
        {
            await system.Terminate();
        }
    }

    private static CapabilityAdmissionClient CreateCapabilityAdmissionClient(ActorSystem system, string persistenceId)
    {
        var actor = CapabilityAdmissionHost.Start(system, persistenceId, persistenceId.Replace('/', '-'));
        return new CapabilityAdmissionClient(actor);
    }

    private static string EscapeForHocon(string path) => path.Replace("\\", "\\\\", StringComparison.Ordinal);
}