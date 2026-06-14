using Akka.Actor;
using Akka.Configuration;
using Aven.Akka.Hosting;
using Aven.WorkIntake.Actors;
using Aven.WorkIntake.Actors.Messages;

namespace Aven.Tests.RoleAgents;

public sealed class Phase13RoleRegistryWorkIntakeTests : IAsyncLifetime
{
    private readonly string _databasePath = Path.Combine(Path.GetTempPath(), $"aven-phase13-{Guid.NewGuid():N}.sqlite");

    [Fact]
    public void RoleProfiles_AreDiscoverable()
    {
        var registry = new Aven.RoleAgents.Registry.Clients.InMemoryRoleAgentRegistryClient();
        registry.Register(new RoleAgentProfile(
            new RoleAgentId("agent-1"),
            "accountant",
            "Accountant",
            "Track invoices",
            "Accounting docs",
            ["pdf"],
            [new SchemaRef("schema://accounting/invoice@3")],
            "Routes invoices",
            ["invoice"],
            ["research paper"],
            "recent",
            "none",
            "running"));

        var profiles = registry.ListProfiles();

        Assert.Single(profiles);
        Assert.Equal("accountant", profiles[0].RoleName);
    }

    [Fact]
    public void BuiltInRoleDefinitionCatalog_ContainsAccountingAndContractWatcherRegistrations()
    {
        var registrations = BuiltInRoleDefinitionCatalog.All;

        Assert.Contains(registrations, x => x.Profile.RoleName == "accountant");
        Assert.Contains(registrations, x => x.Profile.RoleName == "contract_watcher");

        var accountant = BuiltInRoleDefinitionCatalog.Get("accountant");
        Assert.Contains(accountant.Inputs, x => x.CommandType == "accounting.ingest_document");

        var contractWatcher = BuiltInRoleDefinitionCatalog.Get("contract_watcher");
        Assert.Contains(contractWatcher.Inputs, x => x.CommandType == "contracts.ingest_document");
        Assert.Contains(contractWatcher.Outputs, x => x.ResultType == "schedule.create");
    }

    [Fact]
    public async Task ActorBackedRegistry_PersistsProfilesAcrossRestart_AndSupportsLookup()
    {
        var accountant = CreateProfile("agent-1", "accountant", "Accountant");
        var reviewer = CreateProfile("agent-2", "reviewer", "Reviewer");

        await WithSystem(system =>
        {
            var registry = CreateRoleAgentRegistryClient(system, "phase13/registry");
            registry.Register(reviewer);
            registry.Register(accountant);
            return Task.CompletedTask;
        });

        await WithSystem(system =>
        {
            var registry = CreateRoleAgentRegistryClient(system, "phase13/registry");

            var profiles = registry.ListProfiles();
            Assert.Equal(2, profiles.Count);
            Assert.Equal(new[] { "accountant", "reviewer" }, profiles.Select(static x => x.RoleName).ToArray());

            var found = registry.TryGet(accountant.RoleAgentId, out var profile);
            Assert.True(found);
            Assert.Equal("Accountant", profile.DisplayName);

            return Task.CompletedTask;
        });
    }

    private static Aven.RoleAgents.Registry.Clients.RoleAgentRegistryClient CreateRoleAgentRegistryClient(ActorSystem system, string persistenceId)
    {
        var actor = Aven.RoleAgents.Registry.RoleAgentRegistryHost.Start(system, persistenceId, persistenceId.Replace('/', '-'));
        return new Aven.RoleAgents.Registry.Clients.RoleAgentRegistryClient(actor);
    }

    [Fact]
    public async Task WrongCandidateRejects_And_AgentStateRemainsUnchanged()
    {
        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var agentId = new RoleAgentId("agent-1");
            var recipientAddress = new ActorAddress($"agent/{agentId.Value}", "local");
            var recipient = system.ActorOf(Props.Create(() => new RecordingRecipientActor(recipientAddress)), "phase13-reject-recipient");
            resolver.Register(recipientAddress, recipient);
            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor("accountant", "Accountant"), "Track invoices");
            var service = CreateWorkIntakeClient(system, "phase13/intake/reject", agentId, () => agentState, resolver: resolver, agentGatewayAddress: recipientAddress);

            var decision = service.Evaluate(CreateOffer("offer-reject", "research.paper", "paper about transformers"));

            var rejected = Assert.IsType<WorkOfferRejectedDecision>(decision);
            Assert.Equal("out_of_scope", rejected.ReasonCode);
            Assert.Equal(0, await recipient.Ask<int>(new GetDeliveredCount(), TimeSpan.FromSeconds(3)));
        });
    }

    [Fact]
    public async Task AcceptedClaimCommit_DeliversExactlyOnce()
    {
        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var agentId = new RoleAgentId("agent-1");
            var recipientAddress = new ActorAddress($"agent/{agentId.Value}", "local");
            var recipient = system.ActorOf(Props.Create(() => new RecordingRecipientActor(recipientAddress)), "phase13-accept-recipient");
            resolver.Register(recipientAddress, recipient);
            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor("accountant", "Accountant"), "Track invoices");
            var service = CreateWorkIntakeClient(system, "phase13/intake/accept", agentId, () => agentState, resolver: resolver, agentGatewayAddress: recipientAddress);

            var accepted = Assert.IsType<WorkOfferAcceptedDecision>(service.Evaluate(CreateOffer("offer-accept", "invoice.ingest", "invoice pdf")));

            var firstCommit = Assert.IsType<WorkClaimCommitAccepted>(service.Commit(new WorkClaimCommit(accepted.OfferId, accepted.ClaimId)));
            var secondCommit = Assert.IsType<WorkClaimCommitAccepted>(service.Commit(new WorkClaimCommit(accepted.OfferId, accepted.ClaimId)));

            Assert.False(firstCommit.Idempotent);
            Assert.True(secondCommit.Idempotent);

            await AssertEventually(async () =>
            {
                Assert.Equal(1, await recipient.Ask<int>(new GetDeliveredCount(), TimeSpan.FromSeconds(3)));
            });
        });
    }

    [Fact]
    public async Task AcceptedAccountingClaim_CommitBuildsSharedAccountingCommand()
    {
        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var agentId = new RoleAgentId("agent-1");
            var recipientAddress = new ActorAddress($"agent/{agentId.Value}", "local");
            var recipient = system.ActorOf(Props.Create(() => new RecordingRecipientActor(recipientAddress)), "phase13-accounting-recipient");
            resolver.Register(recipientAddress, recipient);
            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor("accountant", "Accountant"), "Track invoices");
            var service = CreateWorkIntakeClient(system, "phase13/intake/accounting", agentId, () => agentState, resolver: resolver, agentGatewayAddress: recipientAddress);

            var accepted = Assert.IsType<WorkOfferAcceptedDecision>(service.Evaluate(CreateOffer("offer-accounting", "invoice.ingest", "invoice pdf")));
            Assert.Equal("accounting.ingest_document", accepted.ExpectedCommandType);

            _ = Assert.IsType<WorkClaimCommitAccepted>(service.Commit(new WorkClaimCommit(accepted.OfferId, accepted.ClaimId)));

            await AssertEventually(async () =>
            {
                Assert.Equal(1, await recipient.Ask<int>(new GetDeliveredCount(), TimeSpan.FromSeconds(3)));
            });

            var delivery = await recipient.Ask<CommittedWorkItem>(new GetLastDelivered(), TimeSpan.FromSeconds(3));
            Assert.Equal("accounting.ingest_document", delivery.CommandType);

            var command = System.Text.Json.JsonSerializer.Deserialize<AccountingDocumentCommand>(delivery.CommandJson);
            Assert.NotNull(command);
            Assert.Equal(accepted.RoleAgentId, command.RoleAgentId);
            Assert.Equal("incoming-item", command.IncomingItemRef);
            Assert.Equal("invoice.ingest", command.ProposedIntent);
        });
    }

    [Fact]
    public async Task AcceptedContractWatcherClaim_CommitBuildsSharedContractWatcherCommand()
    {
        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var agentId = new RoleAgentId("agent-2");
            var recipientAddress = new ActorAddress($"agent/{agentId.Value}", "local");
            var recipient = system.ActorOf(Props.Create(() => new RecordingRecipientActor(recipientAddress)), "phase13-contract-recipient");
            resolver.Register(recipientAddress, recipient);
            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor("contract_watcher", "Contract Watcher"), "Track renewals");
            var service = CreateWorkIntakeClient(
                system,
                "phase13/intake/contract",
                agentId,
                () => agentState,
                decisionFactory: (_, state) => new WorkOfferAcceptedDecision(
                    new RoutingAttemptId("route-offer-contract"),
                    new WorkOfferId("offer-contract"),
                    state.RoleAgentId,
                    new WorkClaimId("claim-offer-contract"),
                    0.98m,
                    BuiltInRoleDefinitionCatalog.Get("contract_watcher").Profile.ResponsibilityScope,
                    BuiltInRoleDefinitionCatalog.Get("contract_watcher").Inputs.First().CommandType,
                    DateTimeOffset.UtcNow.AddMinutes(10),
                    "Accepted by contract watcher role catalog registration."),
                resolver: resolver,
                agentGatewayAddress: recipientAddress);

            var offer = new WorkOffer(
                new RoutingAttemptId("route-offer-contract"),
                new WorkOfferId("offer-contract"),
                agentState.RoleAgentId,
                "lease-2027.pdf",
                "pdf",
                Array.Empty<string>(),
                "lease renewal packet",
                "contracts.renewal",
                "proposed by router",
                [new SchemaRef("schema://contracts/contract-summary@1")],
                new CorrelationId("corr-offer-contract"),
                new ActorAddress("router/a", "local"));

            var accepted = Assert.IsType<WorkOfferAcceptedDecision>(service.Evaluate(offer));
            Assert.Equal("contracts.ingest_document", accepted.ExpectedCommandType);

            _ = Assert.IsType<WorkClaimCommitAccepted>(service.Commit(new WorkClaimCommit(accepted.OfferId, accepted.ClaimId)));

            await AssertEventually(async () =>
            {
                Assert.Equal(1, await recipient.Ask<int>(new GetDeliveredCount(), TimeSpan.FromSeconds(3)));
            });

            var delivery = await recipient.Ask<CommittedWorkItem>(new GetLastDelivered(), TimeSpan.FromSeconds(3));
            Assert.Equal("contracts.ingest_document", delivery.CommandType);

            var command = System.Text.Json.JsonSerializer.Deserialize<ContractWatcherDocumentCommand>(delivery.CommandJson);
            Assert.NotNull(command);
            Assert.Equal(agentState.RoleAgentId, command.RoleAgentId);
            Assert.Equal("lease-2027.pdf", command.IncomingItemRef);
            Assert.Equal("contracts.renewal", command.ProposedIntent);
            Assert.Contains(command.RequiredSchemas, x => x.Value == "schema://contracts/contract-summary@1");
        });
    }

    [Fact]
    public async Task ExpiredClaimCommit_IsRejected()
    {
        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var agentId = new RoleAgentId("agent-1");
            var recipientAddress = new ActorAddress($"agent/{agentId.Value}", "local");
            var recipient = system.ActorOf(Props.Create(() => new RecordingRecipientActor(recipientAddress)), "phase13-expired-recipient");
            resolver.Register(recipientAddress, recipient);
            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor("accountant", "Accountant"), "Track invoices");
            var service = CreateWorkIntakeClient(system, "phase13/intake/expired", agentId, () => agentState, resolver: resolver, agentGatewayAddress: recipientAddress);

            var accepted = Assert.IsType<WorkOfferAcceptedDecision>(service.Evaluate(CreateOffer("offer-expired", "invoice.ingest", "invoice pdf")));
            var expired = service.Commit(new WorkClaimCommit(accepted.OfferId, accepted.ClaimId, accepted.ExpiresAt.AddSeconds(1)));

            var rejected = Assert.IsType<WorkClaimCommitRejected>(expired);
            Assert.Equal("claim_expired", rejected.Error.Code);
            Assert.Equal(0, await recipient.Ask<int>(new GetDeliveredCount(), TimeSpan.FromSeconds(3)));
        });
    }

    [Fact]
    public async Task SameOfferDuplicate_ReplaysDecision_And_ConflictingPayloadConflicts()
    {
        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var agentId = new RoleAgentId("agent-1");
            var recipientAddress = new ActorAddress($"agent/{agentId.Value}", "local");
            var recipient = system.ActorOf(Props.Create(() => new RecordingRecipientActor(recipientAddress)), "phase13-dup-recipient");
            resolver.Register(recipientAddress, recipient);
            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor("accountant", "Accountant"), "Track invoices");
            var service = CreateWorkIntakeClient(system, "phase13/intake/dup", agentId, () => agentState, resolver: resolver, agentGatewayAddress: recipientAddress);

            var first = service.Evaluate(CreateOffer("offer-dup", "invoice.ingest", "invoice pdf"));
            var second = service.Evaluate(CreateOffer("offer-dup", "invoice.ingest", "invoice pdf"));
            var conflict = service.Evaluate(CreateOffer("offer-dup", "invoice.ingest", "different summary"));

            Assert.IsType<WorkOfferAcceptedDecision>(first);
            Assert.IsType<WorkOfferAcceptedDecision>(second);

            var rejected = Assert.IsType<WorkClaimCommitRejected>(conflict);
            Assert.Equal("intake_offer_conflict", rejected.Error.Code);
        });
    }

    [Fact]
    public async Task EvaluateSameOfferId_WithDifferentInputType_Conflicts()
    {
        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var agentId = new RoleAgentId("agent-input-type-conflict");
            var recipientAddress = new ActorAddress($"agent/{agentId.Value}", "local");
            var recipient = system.ActorOf(Props.Create(() => new RecordingRecipientActor(recipientAddress)), "phase13-input-type-conflict-recipient");
            resolver.Register(recipientAddress, recipient);
            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor("accountant", "Accountant"), "Track invoices");
            var service = CreateWorkIntakeClient(system, "phase13/intake/input-type-conflict", agentId, () => agentState, resolver: resolver, agentGatewayAddress: recipientAddress);

            var first = service.Evaluate(CreateOffer("offer-input-type-conflict", "invoice.ingest", "invoice pdf") with { CandidateRoleAgentId = agentId, InputType = "pdf" });
            var conflict = service.Evaluate(CreateOffer("offer-input-type-conflict", "invoice.ingest", "invoice pdf") with { CandidateRoleAgentId = agentId, InputType = "image" });

            Assert.IsType<WorkOfferAcceptedDecision>(first);
            Assert.Equal("intake_offer_conflict", Assert.IsType<WorkClaimCommitRejected>(conflict).Error.Code);
        });
    }

    [Fact]
    public async Task EvaluateSameOfferId_WithDifferentAttachmentsOrSchemas_Conflicts()
    {
        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var agentId = new RoleAgentId("agent-attachment-schema-conflict");
            var recipientAddress = new ActorAddress($"agent/{agentId.Value}", "local");
            var recipient = system.ActorOf(Props.Create(() => new RecordingRecipientActor(recipientAddress)), "phase13-attachment-schema-conflict-recipient");
            resolver.Register(recipientAddress, recipient);
            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor("accountant", "Accountant"), "Track invoices");
            var service = CreateWorkIntakeClient(system, "phase13/intake/attachment-schema-conflict", agentId, () => agentState, resolver: resolver, agentGatewayAddress: recipientAddress);

            var baseOffer = CreateOffer("offer-attachment-schema-conflict", "invoice.ingest", "invoice pdf") with { CandidateRoleAgentId = agentId };
            Assert.IsType<WorkOfferAcceptedDecision>(service.Evaluate(baseOffer));

            var attachmentConflict = service.Evaluate(baseOffer with { AttachmentRefs = ["attachment-2"] });
            Assert.Equal("intake_offer_conflict", Assert.IsType<WorkClaimCommitRejected>(attachmentConflict).Error.Code);

            var schemaOfferId = "offer-schema-conflict";
            var firstSchemaOffer = CreateOffer(schemaOfferId, "invoice.ingest", "invoice pdf") with { CandidateRoleAgentId = agentId, RequiredSchemas = [new SchemaRef("schema://accounting/invoice@3")] };
            Assert.IsType<WorkOfferAcceptedDecision>(service.Evaluate(firstSchemaOffer));

            var schemaConflict = service.Evaluate(firstSchemaOffer with { RequiredSchemas = [new SchemaRef("schema://accounting/account-statement@3")] });
            Assert.Equal("intake_offer_conflict", Assert.IsType<WorkClaimCommitRejected>(schemaConflict).Error.Code);
        });
    }

    [Fact]
    public async Task EvaluateSameOfferId_WithSameCanonicalPayload_IsIdempotent()
    {
        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var agentId = new RoleAgentId("agent-canonical-idempotent");
            var recipientAddress = new ActorAddress($"agent/{agentId.Value}", "local");
            var recipient = system.ActorOf(Props.Create(() => new RecordingRecipientActor(recipientAddress)), "phase13-canonical-idempotent-recipient");
            resolver.Register(recipientAddress, recipient);
            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor("accountant", "Accountant"), "Track invoices");
            var service = CreateWorkIntakeClient(system, "phase13/intake/canonical-idempotent", agentId, () => agentState, resolver: resolver, agentGatewayAddress: recipientAddress);

            var offer = CreateOffer("offer-canonical-idempotent", "invoice.ingest", "invoice pdf") with
            {
                CandidateRoleAgentId = agentId,
                InputType = "pdf",
                AttachmentRefs = ["attachment-1"],
                RequiredSchemas = [new SchemaRef("schema://accounting/invoice@3")]
            };

            var first = Assert.IsType<WorkOfferAcceptedDecision>(service.Evaluate(offer));
            var second = Assert.IsType<WorkOfferAcceptedDecision>(service.Evaluate(offer));

            Assert.Equal(first.ClaimId, second.ClaimId);
            Assert.Equal(first.OfferId, second.OfferId);
        });
    }

    [Fact]
    public async Task CommittedOffer_Reevaluation_IsIdempotent_And_DoesNotReopenLifecycle()
    {
        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var agentId = new RoleAgentId("agent-committed-replay");
            var recipientAddress = new ActorAddress($"agent/{agentId.Value}", "local");
            var recipient = system.ActorOf(Props.Create(() => new RecordingRecipientActor(recipientAddress)), "phase13-committed-replay-recipient");
            resolver.Register(recipientAddress, recipient);
            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor("accountant", "Accountant"), "Track invoices");
            var service = CreateWorkIntakeClient(system, "phase13/intake/committed-replay", agentId, () => agentState, resolver: resolver, agentGatewayAddress: recipientAddress);

            var offer = CreateOffer("offer-committed-replay", "invoice.ingest", "invoice pdf") with { CandidateRoleAgentId = agentId };
            var accepted = Assert.IsType<WorkOfferAcceptedDecision>(service.Evaluate(offer));
            _ = Assert.IsType<WorkClaimCommitAccepted>(service.Commit(new WorkClaimCommit(accepted.OfferId, accepted.ClaimId)));

            var replay = Assert.IsType<WorkOfferAcceptedDecision>(service.Evaluate(offer));
            Assert.Equal(accepted.ClaimId, replay.ClaimId);

            await AssertEventually(async () =>
            {
                var state = service.State;
                Assert.Equal(WorkIntakeLifecycleStatus.Committed, state.Offers[accepted.OfferId].Status);
                Assert.Equal(1, await recipient.Ask<int>(new GetDeliveredCount(), TimeSpan.FromSeconds(3)));
            });
        });
    }

    [Fact]
    public async Task MultipleOffers_RemainIndependent_AcrossCommitAndRestart()
    {
        var agentId = new RoleAgentId("agent-multi-offer");
        var recipientAddress = new ActorAddress($"agent/{agentId.Value}", "local");
        var firstOffer = CreateOffer("offer-multi-a", "invoice.ingest", "invoice a") with { CandidateRoleAgentId = agentId };
        var secondOffer = CreateOffer("offer-multi-b", "invoice.ingest", "invoice b") with { CandidateRoleAgentId = agentId };

        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var recipient = system.ActorOf(Props.Create(() => new RecordingRecipientActor(recipientAddress)), "phase13-multi-offer-recipient-1");
            resolver.Register(recipientAddress, recipient);
            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor("accountant", "Accountant"), "Track invoices");
            var service = CreateWorkIntakeClient(system, "phase13/intake/multi-offer", agentId, () => agentState, resolver: resolver, agentGatewayAddress: recipientAddress);

            var acceptedA = Assert.IsType<WorkOfferAcceptedDecision>(service.Evaluate(firstOffer));
            _ = Assert.IsType<WorkClaimCommitAccepted>(service.Commit(new WorkClaimCommit(acceptedA.OfferId, acceptedA.ClaimId)));

            var acceptedB = Assert.IsType<WorkOfferAcceptedDecision>(service.Evaluate(secondOffer));
            await AssertEventually(async () =>
            {
                var state = service.State;
                Assert.Equal(WorkIntakeLifecycleStatus.Committed, state.Offers[acceptedA.OfferId].Status);
                Assert.Equal(WorkIntakeLifecycleStatus.Claimed, state.Offers[acceptedB.OfferId].Status);
            });
        });

        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var recipient = system.ActorOf(Props.Create(() => new RecordingRecipientActor(recipientAddress)), "phase13-multi-offer-recipient-2");
            resolver.Register(recipientAddress, recipient);
            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor("accountant", "Accountant"), "Track invoices");
            var service = CreateWorkIntakeClient(system, "phase13/intake/multi-offer", agentId, () => agentState, resolver: resolver, agentGatewayAddress: recipientAddress);

            var recovered = service.State;
            var acceptedB = Assert.IsType<WorkOfferAcceptedDecision>(recovered.Offers[secondOffer.OfferId].Decision);
            Assert.Equal(WorkIntakeLifecycleStatus.Committed, recovered.Offers[firstOffer.OfferId].Status);
            Assert.Equal(WorkIntakeLifecycleStatus.Claimed, recovered.Offers[secondOffer.OfferId].Status);

            _ = Assert.IsType<WorkClaimCommitAccepted>(service.Commit(new WorkClaimCommit(acceptedB.OfferId, acceptedB.ClaimId)));
            await AssertEventually(async () =>
            {
                var finalState = service.State;
                Assert.Equal(WorkIntakeLifecycleStatus.Committed, finalState.Offers[firstOffer.OfferId].Status);
                Assert.Equal(WorkIntakeLifecycleStatus.Committed, finalState.Offers[secondOffer.OfferId].Status);
            });
        });
    }

    [Fact]
    public async Task ActorBackedCommit_DeliversExactlyOnce_ThroughDurableDeliveryActor()
    {
        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var agentId = new RoleAgentId("agent-actor-backed");
            var recipientAddress = new ActorAddress($"agent/{agentId.Value}", "local");
            var recipient = system.ActorOf(Props.Create(() => new RecordingRecipientActor(recipientAddress)), "phase13-recording-recipient");
            resolver.Register(recipientAddress, recipient);

            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor("accountant", "Accountant"), "Track invoices");
            var service = CreateWorkIntakeClient(
                system,
                "phase13/intake/actor-backed",
                agentId,
                () => agentState,
                resolver: resolver,
                agentGatewayAddress: recipientAddress);

            var accepted = Assert.IsType<WorkOfferAcceptedDecision>(service.Evaluate(CreateOffer("offer-actor", "invoice.ingest", "invoice pdf")));

            var firstCommit = Assert.IsType<WorkClaimCommitAccepted>(service.Commit(new WorkClaimCommit(accepted.OfferId, accepted.ClaimId)));
            var secondCommit = Assert.IsType<WorkClaimCommitAccepted>(service.Commit(new WorkClaimCommit(accepted.OfferId, accepted.ClaimId)));

            Assert.False(firstCommit.Idempotent);
            Assert.True(secondCommit.Idempotent);

            await AssertEventually(async () =>
            {
                var count = await recipient.Ask<int>(new GetDeliveredCount(), TimeSpan.FromSeconds(3));
                Assert.True(count >= 1);
            });
        });
    }

    [Fact]
    public async Task Commit_ReturnsAcceptedAfterCommitRequestIsPersisted_NotAfterRoleDeliveryTerminal()
    {
        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var agentId = new RoleAgentId("agent-commit-prompt");
            var recipientAddress = new ActorAddress($"agent/{agentId.Value}", "local");
            var recipient = system.ActorOf(Props.Create(() => new ControlledTerminalRecipientActor(recipientAddress)), "phase13-controlled-recipient");
            resolver.Register(recipientAddress, recipient);

            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor("accountant", "Accountant"), "Track invoices");
            var service = CreateWorkIntakeClient(system, "phase13/intake/commit-prompt", agentId, () => agentState, resolver: resolver, agentGatewayAddress: recipientAddress);

            var accepted = Assert.IsType<WorkOfferAcceptedDecision>(service.Evaluate(CreateOffer("offer-commit-prompt", "invoice.ingest", "invoice pdf")));

            var commit = Assert.IsType<WorkClaimCommitAccepted>(service.Commit(new WorkClaimCommit(accepted.OfferId, accepted.ClaimId)));
            Assert.False(commit.Idempotent);

            var committingState = service.State;
            Assert.Equal(WorkIntakeLifecycleStatus.Committing, committingState.Offers[accepted.OfferId].Status);

            await AssertEventually(async () =>
            {
                var pending = await recipient.Ask<int>(new GetPendingDeliveryCount(), TimeSpan.FromSeconds(3));
                Assert.Equal(1, pending);
            });

            recipient.Tell(new ReleaseAcceptedDeliveries());

            await AssertEventually(async () =>
            {
                var state = service.State;
                Assert.Equal(WorkIntakeLifecycleStatus.Committed, state.Offers[accepted.OfferId].Status);
            });
        });
    }

    [Fact]
    public async Task DuplicateCommitWhileCommitting_ReturnsIdempotentAcceptedBeforeTerminalDelivery()
    {
        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var agentId = new RoleAgentId("agent-commit-state");
            var recipientAddress = new ActorAddress($"agent/{agentId.Value}", "local");
            var recipient = system.ActorOf(Props.Create(() => new ControlledTerminalRecipientActor(recipientAddress)), "phase13-slow-recipient");
            resolver.Register(recipientAddress, recipient);

            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor("accountant", "Accountant"), "Track invoices");
            var service = CreateWorkIntakeClient(system, "phase13/intake/commit-state", agentId, () => agentState, resolver: resolver, agentGatewayAddress: recipientAddress);

            var accepted = Assert.IsType<WorkOfferAcceptedDecision>(service.Evaluate(CreateOffer("offer-commit-state", "invoice.ingest", "invoice pdf")));

            var firstCommit = Assert.IsType<WorkClaimCommitAccepted>(service.Commit(new WorkClaimCommit(accepted.OfferId, accepted.ClaimId)));
            Assert.False(firstCommit.Idempotent);

            var committingState = service.State;
            Assert.Equal(WorkIntakeLifecycleStatus.Committing, committingState.Offers[accepted.OfferId].Status);

            await AssertEventually(async () =>
            {
                Assert.Equal(1, await recipient.Ask<int>(new GetPendingDeliveryCount(), TimeSpan.FromSeconds(3)));
                Assert.Equal(0, await recipient.Ask<int>(new GetDeliveredCount(), TimeSpan.FromSeconds(3)));
            });

            var duplicateCommit = Assert.IsType<WorkClaimCommitAccepted>(service.Commit(new WorkClaimCommit(accepted.OfferId, accepted.ClaimId)));
            Assert.True(duplicateCommit.Idempotent);

            await AssertEventually(async () =>
            {
                Assert.Equal(1, await recipient.Ask<int>(new GetPendingDeliveryCount(), TimeSpan.FromSeconds(3)));
                Assert.Equal(0, await recipient.Ask<int>(new GetDeliveredCount(), TimeSpan.FromSeconds(3)));
            });

            recipient.Tell(new ReleaseAcceptedDeliveries());

            await AssertEventually(async () =>
            {
                var count = await recipient.Ask<int>(new GetDeliveredCount(), TimeSpan.FromSeconds(3));
                Assert.Equal(1, count);
            });

            await AssertEventually(async () =>
            {
                var state = service.State;
                Assert.Equal(WorkIntakeLifecycleStatus.Committed, state.Offers[accepted.OfferId].Status);
            });
        });
    }

    [Fact]
    public async Task CommittedWorkDeliveryPolicy_DoesNotQuarantineWhileControlledRecipientIsPendingBriefly()
    {
        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var agentId = new RoleAgentId("agent-commit-policy");
            var recipientAddress = new ActorAddress($"agent/{agentId.Value}", "local");
            var recipient = system.ActorOf(Props.Create(() => new ControlledTerminalRecipientActor(recipientAddress)), "phase13-commit-policy-recipient");
            resolver.Register(recipientAddress, recipient);

            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor("accountant", "Accountant"), "Track invoices");
            var service = CreateWorkIntakeClient(system, "phase13/intake/commit-policy", agentId, () => agentState, resolver: resolver, agentGatewayAddress: recipientAddress);

            var accepted = Assert.IsType<WorkOfferAcceptedDecision>(service.Evaluate(CreateOffer("offer-commit-policy", "invoice.ingest", "invoice pdf")));

            var commit = Assert.IsType<WorkClaimCommitAccepted>(service.Commit(new WorkClaimCommit(accepted.OfferId, accepted.ClaimId)));
            Assert.False(commit.Idempotent);

            await AssertEventually(async () =>
            {
                var state = service.State;
                Assert.Equal(WorkIntakeLifecycleStatus.Committing, state.Offers[accepted.OfferId].Status);
                Assert.Equal(1, await recipient.Ask<int>(new GetPendingDeliveryCount(), TimeSpan.FromSeconds(3)));
                Assert.Equal(0, await recipient.Ask<int>(new GetRejectedDeliveryCount(), TimeSpan.FromSeconds(3)));
            });

            await Task.Delay(250);

            var midState = service.State;
            Assert.Equal(WorkIntakeLifecycleStatus.Committing, midState.Offers[accepted.OfferId].Status);
            Assert.Equal(0, await recipient.Ask<int>(new GetRejectedDeliveryCount(), TimeSpan.FromSeconds(3)));

            recipient.Tell(new ReleaseAcceptedDeliveries());

            await AssertEventually(async () =>
            {
                var state = service.State;
                Assert.Equal(WorkIntakeLifecycleStatus.Committed, state.Offers[accepted.OfferId].Status);
            });
        });
    }

    [Fact]
    public async Task RestartAfterCommitting_DoesNotReportCommittedUntilDeliveryAcceptance()
    {
        var agentId = new RoleAgentId("agent-restart-commit");
        var recipientAddress = new ActorAddress($"agent/{agentId.Value}", "local");
        var offer = CreateOffer("offer-restart-commit", "invoice.ingest", "invoice pdf") with { CandidateRoleAgentId = agentId };

        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var recipient = system.ActorOf(Props.Create(() => new DelayedAcceptingRecipientActor(recipientAddress, TimeSpan.FromSeconds(10))), "phase13-restart-slow-recipient-1");
            resolver.Register(recipientAddress, recipient);
            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor("accountant", "Accountant"), "Track invoices");
            var service = CreateWorkIntakeClient(system, "phase13/intake/restart-commit", agentId, () => agentState, resolver: resolver, agentGatewayAddress: recipientAddress);

            var accepted = Assert.IsType<WorkOfferAcceptedDecision>(service.Evaluate(offer));
            _ = Task.Run(() => service.Commit(new WorkClaimCommit(accepted.OfferId, accepted.ClaimId)));

            await AssertEventually(async () =>
            {
                var state = service.State;
                Assert.Equal(WorkIntakeLifecycleStatus.Committing, state.Offers[accepted.OfferId].Status);
            });
        });

        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var recipient = system.ActorOf(Props.Create(() => new RecordingRecipientActor(recipientAddress)), "phase13-restart-slow-recipient-2");
            resolver.Register(recipientAddress, recipient);
            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor("accountant", "Accountant"), "Track invoices");
            var service = CreateWorkIntakeClient(system, "phase13/intake/restart-commit", agentId, () => agentState, resolver: resolver, agentGatewayAddress: recipientAddress);

            var recovered = service.State;
            var accepted = Assert.IsType<WorkOfferAcceptedDecision>(recovered.Offers[offer.OfferId].Decision);
            Assert.Equal(WorkIntakeLifecycleStatus.Committing, recovered.Offers[offer.OfferId].Status);

            await AssertEventually(async () =>
            {
                var state = service.State;
                Assert.Equal(WorkIntakeLifecycleStatus.Committed, state.Offers[offer.OfferId].Status);
            });
        });
    }

    [Fact]
    public async Task CommitDeliveryRejected_UpdatesStateAsynchronouslyAfterCommitWasAccepted()
    {
        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var agentId = new RoleAgentId("agent-reject-delivery");
            var recipientAddress = new ActorAddress($"agent/{agentId.Value}", "local");
            var recipient = system.ActorOf(Props.Create(() => new RejectingRecipientActor(recipientAddress)), "phase13-rejecting-recipient");
            resolver.Register(recipientAddress, recipient);

            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor("accountant", "Accountant"), "Track invoices");
            var service = CreateWorkIntakeClient(system, "phase13/intake/reject-delivery", agentId, () => agentState, resolver: resolver, agentGatewayAddress: recipientAddress);

            var accepted = Assert.IsType<WorkOfferAcceptedDecision>(service.Evaluate(CreateOffer("offer-reject-delivery", "invoice.ingest", "invoice pdf") with { CandidateRoleAgentId = agentId }));
            var commit = Assert.IsType<WorkClaimCommitAccepted>(service.Commit(new WorkClaimCommit(accepted.OfferId, accepted.ClaimId)));
            Assert.False(commit.Idempotent);

            var committingState = service.State;
            Assert.Equal(WorkIntakeLifecycleStatus.Committing, committingState.Offers[accepted.OfferId].Status);

            await AssertEventually(async () =>
            {
                var state = service.State;
                Assert.Equal(WorkIntakeLifecycleStatus.Rejected, state.Offers[accepted.OfferId].Status);
                Assert.Equal("delivery_rejected", state.Offers[accepted.OfferId].TerminalError?.Code);
                Assert.Equal("Recipient rejected delivery.", state.Offers[accepted.OfferId].TerminalError?.Message);
            });
        });
    }

    [Fact]
    public async Task NeedsClarificationDecision_IsPersistedAndReplayed()
    {
        var agentId = new RoleAgentId("agent-clarification-replay");
        var offer = CreateOffer("offer-clarification-replay", "invoice.ingest", "maybe invoice pdf") with { CandidateRoleAgentId = agentId };

        await WithSystem(async system =>
        {
            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor("accountant", "Accountant"), "Track invoices");
            var service = CreateWorkIntakeClient(
                system,
                "phase13/intake/clarification-replay",
                agentId,
                () => agentState,
                decisionFactory: (inputOffer, state) => new WorkOfferNeedsClarification(inputOffer.RoutingAttemptId, inputOffer.OfferId, state.RoleAgentId, "Need supplier clarification before claiming this work."));

            var clarification = Assert.IsType<WorkOfferNeedsClarification>(service.Evaluate(offer));
            Assert.Equal("Need supplier clarification before claiming this work.", clarification.Question);

            var state = service.State;
            var persisted = Assert.IsType<WorkOfferNeedsClarification>(state.Offers[offer.OfferId].Decision);
            Assert.Equal(WorkIntakeLifecycleStatus.Open, state.Offers[offer.OfferId].Status);
            Assert.Equal(offer.RoutingAttemptId, persisted.RoutingAttemptId);
            Assert.Equal(agentId, persisted.RoleAgentId);
            Assert.Equal("Need supplier clarification before claiming this work.", persisted.Question);
        });

        await WithSystem(async system =>
        {
            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor("accountant", "Accountant"), "Track invoices");
            var service = CreateWorkIntakeClient(
                system,
                "phase13/intake/clarification-replay",
                agentId,
                () => agentState,
                decisionFactory: (inputOffer, state) => new WorkOfferNeedsClarification(inputOffer.RoutingAttemptId, inputOffer.OfferId, state.RoleAgentId, "Need supplier clarification before claiming this work."));

            var recovered = service.State;
            var clarification = Assert.IsType<WorkOfferNeedsClarification>(recovered.Offers[offer.OfferId].Decision);
            Assert.Equal(WorkIntakeLifecycleStatus.Open, recovered.Offers[offer.OfferId].Status);
            Assert.Equal("Need supplier clarification before claiming this work.", clarification.Question);
        });
    }

    [Fact]
    public async Task DecisionFactoryFailure_ReturnsTypedRejectedDecision_AndDoesNotPersistOffer()
    {
        await WithSystem(async system =>
        {
            var agentId = new RoleAgentId("agent-decision-failure");
            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor("accountant", "Accountant"), "Track invoices");
            var service = CreateWorkIntakeClient(
                system,
                "phase13/intake/decision-failure",
                agentId,
                () => agentState,
                decisionFactory: (_, _) => throw new InvalidOperationException("decision factory blew up"));

            var reply = Assert.IsType<WorkOfferRejectedDecision>(service.Evaluate(CreateOffer("offer-decision-failure", "invoice.ingest", "invoice pdf") with { CandidateRoleAgentId = agentId }));
            Assert.Equal("work_offer_decision_failed", reply.ReasonCode);
            Assert.Contains("decision factory blew up", reply.Reason);

            Assert.Empty(service.State.Offers);
        });
    }

    [Fact]
    public async Task WorkIntakeClient_UsesClosedDecisionContract()
    {
        await WithSystem(async system =>
        {
            var agentId = new RoleAgentId("agent-closed-decision-contract");
            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor("accountant", "Accountant"), "Track invoices");
            var service = CreateWorkIntakeClient(system, "phase13/intake/closed-decision-contract", agentId, () => agentState);

            var decision = service.Evaluate(CreateOffer("offer-closed-decision-contract", "invoice.ingest", "invoice pdf") with { CandidateRoleAgentId = agentId });
            Assert.IsAssignableFrom<WorkOfferDecision>(decision);

            var hostStart = typeof(WorkIntakeHost).GetMethod(nameof(WorkIntakeHost.Start))
                ?? throw new InvalidOperationException("WorkIntakeHost.Start was not found.");
            var decisionFactoryParameter = hostStart.GetParameters().Single(parameter => parameter.Name == "decisionFactory");
            Assert.Equal(typeof(WorkOffer), decisionFactoryParameter.ParameterType.GenericTypeArguments[0]);
            Assert.Equal(typeof(RoleAgentState), decisionFactoryParameter.ParameterType.GenericTypeArguments[1]);
            Assert.Equal(typeof(WorkOfferDecision), decisionFactoryParameter.ParameterType.GenericTypeArguments[2]);

            var clientConstructor = typeof(WorkIntakeClient).GetConstructors().Single();
            var clientParameters = clientConstructor.GetParameters();
            Assert.Single(clientParameters);
            Assert.Equal(typeof(IActorRef), clientParameters[0].ParameterType);
        });
    }

    [Fact]
    public async Task DeliveryFailedMessage_MovesOfferToRejected_AndRepliesToCommitter()
    {
        var agentId = new RoleAgentId("agent-delivery-failed");
        var recipientAddress = new ActorAddress($"agent/{agentId.Value}", "local");
        var offer = CreateOffer("offer-delivery-failed", "invoice.ingest", "invoice pdf") with { CandidateRoleAgentId = agentId };

        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var recipient = system.ActorOf(Props.Create(() => new DelayedAcceptingRecipientActor(recipientAddress, TimeSpan.FromSeconds(10))), "phase13-delivery-failed-recipient-1");
            resolver.Register(recipientAddress, recipient);

            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor("accountant", "Accountant"), "Track invoices");
            var actor = CreateWorkOfferActor(system, "phase13/intake/delivery-failed", agentId, () => agentState, resolver: resolver, agentGatewayAddress: recipientAddress);

            var accepted = Assert.IsType<WorkOfferAcceptedDecision>(await actor.Ask<object>(new EvaluateWorkOfferCommand(offer), TimeSpan.FromSeconds(3)));
            var replyRecorder = system.ActorOf(Props.Create(() => new ReplyRecorderActor()), "phase13-delivery-failed-replies-1");
            var committer = system.ActorOf(Props.Create(() => new ForwardingCommitterActor(replyRecorder)), "phase13-delivery-failed-committer-1");

            committer.Tell(new StartCommit(actor, new WorkClaimCommit(accepted.OfferId, accepted.ClaimId)));

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<WorkIntakeState>(new InspectWorkIntake(), TimeSpan.FromSeconds(3));
                Assert.Equal(WorkIntakeLifecycleStatus.Committing, state.Offers[accepted.OfferId].Status);
                Assert.NotNull(state.Offers[accepted.OfferId].Commit);
            });

            var committingState = await actor.Ask<WorkIntakeState>(new InspectWorkIntake(), TimeSpan.FromSeconds(3));
            var commit = committingState.Offers[accepted.OfferId].Commit!;
            actor.Tell(new WorkIntakeDeliveryFailed(
                commit.DeliveryId,
                new OperationError("delivery_failed", "Durable delivery failed before recipient acceptance.", true),
                committer));

            var reply = await WaitForReplyAsync<WorkClaimCommitRejected>(replyRecorder, TimeSpan.FromSeconds(3));
            Assert.Equal(accepted.OfferId, reply.OfferId);
            Assert.Equal("delivery_failed", reply.Error.Code);

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<WorkIntakeState>(new InspectWorkIntake(), TimeSpan.FromSeconds(3));
                var persisted = state.Offers[accepted.OfferId];
                Assert.Equal(WorkIntakeLifecycleStatus.Rejected, persisted.Status);
                Assert.Equal("delivery_failed", persisted.TerminalError?.Code);
            });
        });

        await WithSystem(async system =>
        {
            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor("accountant", "Accountant"), "Track invoices");
            var actor = CreateWorkOfferActor(system, "phase13/intake/delivery-failed", agentId, () => agentState);

            var recovered = await actor.Ask<WorkIntakeState>(new InspectWorkIntake(), TimeSpan.FromSeconds(3));
            var persisted = recovered.Offers[offer.OfferId];
            Assert.Equal(WorkIntakeLifecycleStatus.Rejected, persisted.Status);
            Assert.Equal("delivery_failed", persisted.TerminalError?.Code);
        });
    }

    [Fact]
    public async Task RejectedOrExpiredClaim_CannotBeCommittedAgain()
    {
        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var agentId = new RoleAgentId("agent-terminal-claim");
            var recipientAddress = new ActorAddress($"agent/{agentId.Value}", "local");
            var rejectingRecipient = system.ActorOf(Props.Create(() => new RejectingRecipientActor(recipientAddress)), "phase13-terminal-rejecting-recipient");
            resolver.Register(recipientAddress, rejectingRecipient);
            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor("accountant", "Accountant"), "Track invoices");
            var service = CreateWorkIntakeClient(system, "phase13/intake/terminal-claim", agentId, () => agentState, resolver: resolver, agentGatewayAddress: recipientAddress);

            var rejectedOffer = CreateOffer("offer-terminal-rejected", "invoice.ingest", "invoice rejected") with { CandidateRoleAgentId = agentId };
            var acceptedRejected = Assert.IsType<WorkOfferAcceptedDecision>(service.Evaluate(rejectedOffer));
            var rejectedCommit = Assert.IsType<WorkClaimCommitAccepted>(service.Commit(new WorkClaimCommit(acceptedRejected.OfferId, acceptedRejected.ClaimId)));
            Assert.False(rejectedCommit.Idempotent);

            await AssertEventually(async () =>
            {
                var rejectedState = service.State;
                Assert.Equal(WorkIntakeLifecycleStatus.Rejected, rejectedState.Offers[acceptedRejected.OfferId].Status);
                Assert.Equal("delivery_rejected", rejectedState.Offers[acceptedRejected.OfferId].TerminalError?.Code);
            });

            var repeatRejectedCommit = Assert.IsType<WorkClaimCommitRejected>(service.Commit(new WorkClaimCommit(acceptedRejected.OfferId, acceptedRejected.ClaimId)));
            Assert.Equal("delivery_rejected", repeatRejectedCommit.Error.Code);

            var wrongRejectedClaim = Assert.IsType<WorkClaimCommitRejected>(service.Commit(new WorkClaimCommit(acceptedRejected.OfferId, new WorkClaimId("claim-after-reject"))));
            Assert.Equal("claim_not_found", wrongRejectedClaim.Error.Code);

            var expiredOffer = CreateOffer("offer-terminal-expired", "invoice.ingest", "invoice expired") with { CandidateRoleAgentId = agentId };
            var acceptedExpired = Assert.IsType<WorkOfferAcceptedDecision>(service.Evaluate(expiredOffer));
            var expiredCommit = Assert.IsType<WorkClaimCommitRejected>(service.Commit(new WorkClaimCommit(acceptedExpired.OfferId, acceptedExpired.ClaimId, acceptedExpired.ExpiresAt.AddSeconds(1))));
            Assert.Equal("claim_expired", expiredCommit.Error.Code);

            var repeatExpiredCommit = Assert.IsType<WorkClaimCommitRejected>(service.Commit(new WorkClaimCommit(acceptedExpired.OfferId, acceptedExpired.ClaimId)));
            Assert.Equal("claim_expired", repeatExpiredCommit.Error.Code);

            var wrongExpiredClaim = Assert.IsType<WorkClaimCommitRejected>(service.Commit(new WorkClaimCommit(acceptedExpired.OfferId, new WorkClaimId("claim-after-expire"))));
            Assert.Equal("claim_not_found", wrongExpiredClaim.Error.Code);
        });
    }

    [Fact]
    public async Task LateWorkIntakeDeliveryFailed_AfterCommitted_IsIgnored()
    {
        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var agentId = new RoleAgentId("agent-late-delivery-failed-committed");
            var recipientAddress = new ActorAddress($"agent/{agentId.Value}", "local");
            var recipient = system.ActorOf(Props.Create(() => new RecordingRecipientActor(recipientAddress)), "phase13-late-delivery-failed-committed-recipient");
            resolver.Register(recipientAddress, recipient);

            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor("accountant", "Accountant"), "Track invoices");
            var actor = CreateWorkOfferActor(system, "phase13/intake/late-delivery-failed-committed", agentId, () => agentState, resolver: resolver, agentGatewayAddress: recipientAddress);

            var accepted = Assert.IsType<WorkOfferAcceptedDecision>(await actor.Ask<object>(new EvaluateWorkOfferCommand(CreateOffer("offer-late-delivery-failed-committed", "invoice.ingest", "invoice pdf") with { CandidateRoleAgentId = agentId }), TimeSpan.FromSeconds(3)));
            var replyRecorder = system.ActorOf(Props.Create(() => new ReplyRecorderActor()), "phase13-late-delivery-failed-committed-replies");
            var committer = system.ActorOf(Props.Create(() => new ForwardingCommitterActor(replyRecorder)), "phase13-late-delivery-failed-committed-committer");

            committer.Tell(new StartCommit(actor, new WorkClaimCommit(accepted.OfferId, accepted.ClaimId)));

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<WorkIntakeState>(new InspectWorkIntake(), TimeSpan.FromSeconds(3));
                Assert.Equal(WorkIntakeLifecycleStatus.Committed, state.Offers[accepted.OfferId].Status);
                Assert.NotNull(state.Offers[accepted.OfferId].Commit);
                Assert.Equal(1, await recipient.Ask<int>(new GetDeliveredCount(), TimeSpan.FromSeconds(3)));
            });

            var committingState = await actor.Ask<WorkIntakeState>(new InspectWorkIntake(), TimeSpan.FromSeconds(3));
            var commit = committingState.Offers[accepted.OfferId].Commit!;
            Assert.Equal(WorkIntakeLifecycleStatus.Committed, committingState.Offers[accepted.OfferId].Status);
            Assert.Null(committingState.Offers[accepted.OfferId].TerminalError);

            actor.Tell(new WorkIntakeDeliveryFailed(
                commit.DeliveryId,
                new OperationError("late_delivery_failed", "Late direct delivery failure should be ignored after commit.", false),
                committer));

            await Task.Delay(200);

            var finalState = await actor.Ask<WorkIntakeState>(new InspectWorkIntake(), TimeSpan.FromSeconds(3));
            Assert.Equal(WorkIntakeLifecycleStatus.Committed, finalState.Offers[accepted.OfferId].Status);
            Assert.Null(finalState.Offers[accepted.OfferId].TerminalError);

            var replies = await replyRecorder.Ask<object[]>(new GetRecordedReplies(), TimeSpan.FromSeconds(3));
            Assert.DoesNotContain(replies, message => message is WorkClaimCommitRejected);
        });
    }

    [Fact]
    public async Task LateWorkIntakeDeliveryFailed_AfterRejected_IsIgnored()
    {
        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var agentId = new RoleAgentId("agent-late-delivery-failed-rejected");
            var recipientAddress = new ActorAddress($"agent/{agentId.Value}", "local");
            var recipient = system.ActorOf(Props.Create(() => new ControlledTerminalRecipientActor(recipientAddress)), "phase13-late-delivery-failed-rejected-recipient");
            resolver.Register(recipientAddress, recipient);

            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor("accountant", "Accountant"), "Track invoices");
            var actor = CreateWorkOfferActor(system, "phase13/intake/late-delivery-failed-rejected", agentId, () => agentState, resolver: resolver, agentGatewayAddress: recipientAddress);
            var replyRecorder = system.ActorOf(Props.Create(() => new ReplyRecorderActor()), "phase13-late-delivery-failed-rejected-replies");

            var accepted = Assert.IsType<WorkOfferAcceptedDecision>(await actor.Ask<object>(new EvaluateWorkOfferCommand(CreateOffer("offer-late-delivery-failed-rejected", "invoice.ingest", "invoice pdf") with { CandidateRoleAgentId = agentId }), TimeSpan.FromSeconds(3)));
            _ = Assert.IsType<WorkClaimCommitAccepted>(await actor.Ask<object>(new WorkClaimCommitCommand(new WorkClaimCommit(accepted.OfferId, accepted.ClaimId)), TimeSpan.FromSeconds(3)));

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<WorkIntakeState>(new InspectWorkIntake(), TimeSpan.FromSeconds(3));
                Assert.Equal(WorkIntakeLifecycleStatus.Committing, state.Offers[accepted.OfferId].Status);
                Assert.Equal(1, await recipient.Ask<int>(new GetPendingDeliveryCount(), TimeSpan.FromSeconds(3)));
            });

            var committingState = await actor.Ask<WorkIntakeState>(new InspectWorkIntake(), TimeSpan.FromSeconds(3));
            var commit = committingState.Offers[accepted.OfferId].Commit!;
            recipient.Tell(new ReleaseRejectedDeliveries());

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<WorkIntakeState>(new InspectWorkIntake(), TimeSpan.FromSeconds(3));
                Assert.Equal(WorkIntakeLifecycleStatus.Rejected, state.Offers[accepted.OfferId].Status);
                Assert.NotNull(state.Offers[accepted.OfferId].TerminalError);
            });

            var rejectedState = await actor.Ask<WorkIntakeState>(new InspectWorkIntake(), TimeSpan.FromSeconds(3));
            var originalErrorCode = rejectedState.Offers[accepted.OfferId].TerminalError!.Code;
            var originalErrorMessage = rejectedState.Offers[accepted.OfferId].TerminalError!.Message;

            actor.Tell(new WorkIntakeDeliveryFailed(
                commit.DeliveryId,
                new OperationError("late_delivery_failed", "Late direct delivery failure should not overwrite the original rejection.", true),
                replyRecorder));

            await AssertEventually(async () =>
            {
                var finalState = await actor.Ask<WorkIntakeState>(new InspectWorkIntake(), TimeSpan.FromSeconds(3));
                Assert.Equal(WorkIntakeLifecycleStatus.Rejected, finalState.Offers[accepted.OfferId].Status);
                Assert.Equal(originalErrorCode, finalState.Offers[accepted.OfferId].TerminalError?.Code);
                Assert.Equal(originalErrorMessage, finalState.Offers[accepted.OfferId].TerminalError?.Message);
            });

            await AssertNoRecordedReplyAsync<WorkClaimCommitRejected>(replyRecorder, TimeSpan.FromMilliseconds(300));
        });
    }

    private static IActorRef CreateWorkOfferActor(
        ActorSystem system,
        string persistenceId,
        RoleAgentId agentId,
        Func<RoleAgentState> agentStateProvider,
        Func<WorkOffer, RoleAgentState, WorkOfferDecision>? decisionFactory = null,
        Aven.ActorKernel.Addressing.IActorAddressResolver? resolver = null,
        ActorAddress? agentGatewayAddress = null) =>
        system.ActorOf(
            Props.Create(() => new WorkOfferActor(persistenceId, agentId, agentStateProvider, decisionFactory, resolver, agentGatewayAddress)),
            persistenceId.Replace('/', '-'));

    private static WorkIntakeClient CreateWorkIntakeClient(
        ActorSystem system,
        string persistenceId,
        RoleAgentId agentId,
        Func<RoleAgentState> agentStateProvider,
        Func<WorkOffer, RoleAgentState, WorkOfferDecision>? decisionFactory = null,
        Aven.ActorKernel.Addressing.IActorAddressResolver? resolver = null,
        ActorAddress? agentGatewayAddress = null)
    {
        var actor = WorkIntakeHost.Start(system, persistenceId, agentId, agentStateProvider, decisionFactory, resolver, agentGatewayAddress);
        return new WorkIntakeClient(actor);
    }

    private static WorkOffer CreateOffer(string offerId, string intent, string summary) => new(
        new RoutingAttemptId($"route-{offerId}"),
        new WorkOfferId(offerId),
        new RoleAgentId("agent-1"),
        "incoming-item",
        "text",
        Array.Empty<string>(),
        summary,
        intent,
        "proposed by router",
        Array.Empty<SchemaRef>(),
        new CorrelationId($"corr-{offerId}"),
        new ActorAddress("router/a", "local"));

    private static RoleAgentProfile CreateProfile(string agentId, string roleName, string displayName) => new(
        new RoleAgentId(agentId),
        roleName,
        displayName,
        $"Objective for {roleName}",
        $"Scope for {roleName}",
        ["pdf"],
        [new SchemaRef($"schema://profiles/{roleName}@1")],
        $"Routes {roleName} work",
        [$"relevant for {roleName}"],
        [$"irrelevant for {roleName}"],
        $"recent summary for {roleName}",
        "none",
        "running");

    public Task InitializeAsync() => Task.CompletedTask;

    public Task DisposeAsync()
    {
        if (File.Exists(_databasePath))
        {
            File.Delete(_databasePath);
        }

        return Task.CompletedTask;
    }

    private async Task WithSystem(Func<ActorSystem, Task> action)
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
                  connection-string = "Data Source={{EscapeForHocon(_databasePath)}}"
                  auto-initialize = on
                }
                snapshot-store.sqlite {
                  class = "Akka.Persistence.Sqlite.Snapshot.SqliteSnapshotStore, Akka.Persistence.Sqlite"
                  plugin-dispatcher = "akka.actor.default-dispatcher"
                  connection-string = "Data Source={{EscapeForHocon(_databasePath)}}"
                  auto-initialize = on
                }
              }
            }
            """);

        var system = ActorSystem.Create($"aven-phase13-{Guid.NewGuid():N}", config);
        try
        {
            await action(system);
        }
        finally
        {
            await system.Terminate();
        }
    }

    private static string EscapeForHocon(string path) => path.Replace("\\", "\\\\", StringComparison.Ordinal);

    private sealed record GetDeliveredCount;
    private sealed record GetLastDelivered;
    private sealed record GetPendingDeliveryCount;
    private sealed record GetRejectedDeliveryCount;
    private sealed record ReleaseAcceptedDeliveries;
    private sealed record ReleaseRejectedDeliveries;

    private sealed class RecordingRecipientActor : Aven.ActorKernel.Actors.InboxLedgerPersistentActor
    {
        private readonly ActorAddress _address;
        private readonly List<CommittedWorkItem> _delivered = new();

        public RecordingRecipientActor(ActorAddress address)
            : base($"recipient-{address.Value.Replace('/', '-')}")
        {
            _address = address;
            Command<DeliveryAttemptOffer>(Handle);
            Command<GetDeliveredCount>(_ => Sender.Tell(_delivered.Count));
            Command<GetLastDelivered>(_ => Sender.Tell(_delivered.Last()));
        }

        private void Handle(DeliveryAttemptOffer offer)
        {
            var replyTo = Sender;
            var decision = Decide(offer.Envelope.CommandId, offer.PayloadHash);

            switch (decision.Kind)
            {
                case Aven.ActorKernel.Ledgers.ProcessedCommandDecisionKind.Accepted:
                    {
                        var committed = System.Text.Json.JsonSerializer.Deserialize<CommittedWorkItem>(offer.Envelope.Payload)
                            ?? throw new InvalidOperationException("CommittedWorkItem payload was empty.");
                        PersistAcceptance(
                            new Aven.ActorKernel.Messages.ProcessedCommandAccepted(offer.Envelope.CommandId, offer.PayloadHash, DateTimeOffset.UtcNow, "accepted"),
                            _ =>
                            {
                                _delivered.Add(committed);
                                replyTo.Tell(new DeliveryAccepted(offer.DeliveryId, offer.Envelope.CommandId, _address, "accepted"));
                            });
                        break;
                    }
                case Aven.ActorKernel.Ledgers.ProcessedCommandDecisionKind.Duplicate:
                    replyTo.Tell(new DeliveryAccepted(offer.DeliveryId, offer.Envelope.CommandId, _address, "duplicate"));
                    break;
                case Aven.ActorKernel.Ledgers.ProcessedCommandDecisionKind.Conflict:
                    replyTo.Tell(new DeliveryRejected(
                        offer.DeliveryId,
                        offer.Envelope.CommandId,
                        _address,
                        new OperationError("payload_conflict", "Conflicting duplicate payload.", false)));
                    break;
            }
        }
    }

    private sealed class DelayedAcceptingRecipientActor : ReceiveActor
    {
        private readonly ActorAddress _address;
        private readonly TimeSpan _delay;
        private int _deliveredCount;

        public DelayedAcceptingRecipientActor(ActorAddress address, TimeSpan delay)
        {
            _address = address;
            _delay = delay;
            Receive<GetDeliveredCount>(_ => Sender.Tell(_deliveredCount));
            ReceiveAsync<DeliveryAttemptOffer>(async offer =>
            {
                var replyTo = Sender;
                await Task.Delay(_delay);
                _deliveredCount++;
                replyTo.Tell(new DeliveryAccepted(offer.DeliveryId, offer.Envelope.CommandId, _address, "accepted"));
            });
        }
    }

    private sealed class ControlledTerminalRecipientActor : ReceiveActor
    {
        private readonly ActorAddress _address;
        private readonly Dictionary<DeliveryId, (IActorRef ReplyTo, DeliveryAttemptOffer Offer)> _pending = new();
        private int _deliveredCount;
        private int _rejectedCount;

        public ControlledTerminalRecipientActor(ActorAddress address)
        {
            _address = address;
            Receive<DeliveryAttemptOffer>(offer => _pending[offer.DeliveryId] = (Sender, offer));
            Receive<GetDeliveredCount>(_ => Sender.Tell(_deliveredCount));
            Receive<GetPendingDeliveryCount>(_ => Sender.Tell(_pending.Count));
            Receive<GetRejectedDeliveryCount>(_ => Sender.Tell(_rejectedCount));
            Receive<ReleaseAcceptedDeliveries>(_ =>
            {
                foreach (var pending in _pending.Values.ToArray())
                {
                    _deliveredCount++;
                    pending.ReplyTo.Tell(new DeliveryAccepted(pending.Offer.DeliveryId, pending.Offer.Envelope.CommandId, _address, "accepted"));
                }

                _pending.Clear();
            });
            Receive<ReleaseRejectedDeliveries>(_ =>
            {
                foreach (var pending in _pending.Values.ToArray())
                {
                    _rejectedCount++;
                    pending.ReplyTo.Tell(new DeliveryRejected(
                        pending.Offer.DeliveryId,
                        pending.Offer.Envelope.CommandId,
                        _address,
                        new OperationError("delivery_rejected", "Recipient rejected delivery.", false)));
                }

                _pending.Clear();
            });
        }
    }

    private sealed class RejectingRecipientActor : ReceiveActor
    {
        public RejectingRecipientActor(ActorAddress address)
        {
            Receive<DeliveryAttemptOffer>(offer =>
            {
                Sender.Tell(new DeliveryRejected(
                    offer.DeliveryId,
                    offer.Envelope.CommandId,
                    address,
                    new OperationError("delivery_rejected", "Recipient rejected delivery.", false)));
            });
        }
    }

    private sealed record StartCommit(IActorRef WorkOfferActor, WorkClaimCommit Commit);
    private sealed record GetRecordedReplies;

    private sealed class ForwardingCommitterActor : ReceiveActor
    {
        private readonly IActorRef _forwardTo;

        public ForwardingCommitterActor(IActorRef forwardTo)
        {
            _forwardTo = forwardTo;
            Receive<StartCommit>(message => message.WorkOfferActor.Tell(new WorkClaimCommitCommand(message.Commit), Self));
            ReceiveAny(message => _forwardTo.Tell(message));
        }
    }

    private sealed class ReplyRecorderActor : ReceiveActor
    {
        private readonly List<object> _messages = new();

        public ReplyRecorderActor()
        {
            Receive<GetRecordedReplies>(_ => Sender.Tell(_messages.ToArray()));
            ReceiveAny(message => _messages.Add(message));
        }
    }

    private static async Task<TMessage> WaitForReplyAsync<TMessage>(IActorRef recorder, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            var messages = await recorder.Ask<object[]>(new GetRecordedReplies(), TimeSpan.FromSeconds(1));
            var match = messages.OfType<TMessage>().FirstOrDefault();
            if (match is not null)
            {
                return match;
            }

            await Task.Delay(50);
        }

        throw new TimeoutException($"Timed out waiting for {typeof(TMessage).Name}.");
    }

    private static async Task AssertNoRecordedReplyAsync<TMessage>(IActorRef recorder, TimeSpan duration)
    {
        var deadline = DateTime.UtcNow + duration;
        while (DateTime.UtcNow < deadline)
        {
            var messages = await recorder.Ask<object[]>(new GetRecordedReplies(), TimeSpan.FromSeconds(1));
            var unexpected = messages.OfType<TMessage>().FirstOrDefault();
            Assert.Null(unexpected);
            await Task.Delay(25);
        }
    }

    private static async Task AssertEventually(Func<Task> assertion, int attempts = 20, int delayMs = 100)
    {
        Exception? last = null;
        for (var i = 0; i < attempts; i++)
        {
            try
            {
                await assertion();
                return;
            }
            catch (Exception ex)
            {
                last = ex;
                await Task.Delay(delayMs);
            }
        }

        throw last ?? new InvalidOperationException("Expected assertion to succeed eventually.");
    }
}