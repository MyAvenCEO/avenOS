using System.Net;
using System.Text;
using System.Text.Json;
using Akka.Actor;
using Akka.Configuration;
using Aven.Akka.Hosting;
using Aven.Resources.Llm;
using Aven.Resources.Llm.Contracts.Interfaces;
using Aven.Resources.Llm.Contracts.Commands;
using Aven.Resources.Llm.Contracts.Responses;
using Aven.Resources.Llm.Contracts.Models;
using Aven.Contracts.Protocol;
using Aven.Routing.Contracts.Schemas;
using Aven.Routing.Schemas;

namespace Aven.Tests.Routing;

public sealed class Phase20LlmRoutingTests
{
    [Fact]
    public async Task StubLlm_RanksAccountant_ForInvoicePdf()
    {
        CapturedHttpRequest? captured = null;
        var router = CreateLlmRouter(
            (request, _) =>
            {
                captured = request.ToCapturedRequest();
                return JsonResponse(new
                {
                    provider = "stub-http",
                    model = "stub-routing-model",
                    structuredJson = new
                    {
                        decision = "route",
                        candidateRoleAgentIds = new[] { "agent-accountant", "agent-research" },
                        reason = "Invoice document best matches accountant."
                    },
                    finishReason = "structured_stop",
                    usage = new { promptTokens = 30, completionTokens = 10, totalTokens = 40, cost = 0.12m },
                    citations = Array.Empty<string>(),
                    degradations = Array.Empty<object>(),
                    toolCalls = Array.Empty<object>()
                });
            },
            out var deliveries,
            out var accountantId,
            out var researchId);

        var result = Assert.IsType<RouteCommitted>(router.Route(CreateInput("phase20-invoice", "invoice pdf from vendor", "accounting.invoice")));

        Assert.Equal(accountantId, result.RoleAgentId);
        Assert.NotNull(result.Attempt.LlmTrace);
        Assert.True(result.Attempt.LlmTrace!.Used);
        Assert.Single(result.Attempt.LlmTrace.Attempts);
        Assert.NotNull(captured);
        using var json = JsonDocument.Parse(captured!.Body);
        Assert.Equal("stub-http", json.RootElement.GetProperty("provider").GetString());
        Assert.Equal("stub-routing-model", json.RootElement.GetProperty("model").GetString());
        Assert.Equal("schema://routing/decision@1", json.RootElement.GetProperty("structuredOutput").GetProperty("schemaRef").GetString());

        await AssertEventually(() =>
        {
            Assert.Single(deliveries[accountantId]);
            Assert.Empty(deliveries[researchId]);
        });
    }

    [Fact]
    public void AccountantRejects_UnrelatedInput_AndRouterTriesAnotherCandidate()
    {
        var router = CreateLlmRouter(
            (_, _) => JsonResponse(new
            {
                provider = "stub-http",
                model = "stub-routing-model",
                structuredJson = new
                {
                    decision = "route",
                    candidateRoleAgentIds = new[] { "agent-accountant", "agent-research" },
                    reason = "Try accountant first, then research."
                },
                finishReason = "structured_stop",
                usage = new { promptTokens = 22, completionTokens = 8, totalTokens = 30, cost = 0.08m },
                citations = Array.Empty<string>(),
                degradations = Array.Empty<object>(),
                toolCalls = Array.Empty<object>()
            }),
            out var deliveries,
            out _,
            out var researchId);

        var result = Assert.IsType<RouteCommitted>(router.Route(CreateInput("phase20-reroute", "paper about transformers and benchmarks", "research.paper")));

        Assert.Equal(researchId, result.RoleAgentId);
        Assert.Collection(
            result.Attempt.AuditEntries,
            accountant => Assert.Equal("rejected", accountant.DecisionKind),
            research => Assert.Equal("accepted", research.DecisionKind));
    }

    [Fact]
    public void AmbiguousInput_AsksUserClarification()
    {
        var router = CreateLlmRouter(
            (_, _) => JsonResponse(new
            {
                provider = "stub-http",
                model = "stub-routing-model",
                structuredJson = new
                {
                    decision = "clarify",
                    candidateRoleAgentIds = new[] { "agent-accountant", "agent-research" },
                    reason = "Document could belong to either role.",
                    clarificationQuestion = "Is this for bookkeeping or research tracking?"
                },
                finishReason = "structured_stop",
                usage = new { promptTokens = 18, completionTokens = 7, totalTokens = 25, cost = 0.05m },
                citations = Array.Empty<string>(),
                degradations = Array.Empty<object>(),
                toolCalls = Array.Empty<object>()
            }),
            out _,
            out var accountantId,
            out var researchId);

        var result = Assert.IsType<RouteNeedsClarification>(router.Route(CreateInput("phase20-ambiguous", "mixed finance and research notes", "mixed.document")));

        Assert.Equal("Is this for bookkeeping or research tracking?", result.Question);
        Assert.Equal(new[] { accountantId, researchId }, result.CandidateRoleAgentIds);
    }

    [Fact]
    public async Task ActorBackedRouteInspection_PersistsLlmClarificationCandidateIdsAcrossRestart()
    {
        var databasePath = Path.Combine(Path.GetTempPath(), $"aven-phase20-clarification-{Guid.NewGuid():N}.sqlite");
        const string persistenceId = "phase20/routing-clarification-candidate-ids";
        var attemptId = new RoutingAttemptId("phase20-clarification-candidate-ids");

        try
        {
            await WithSystem(databasePath, async system =>
            {
                var router = CreateLlmRouter(
                    system,
                    persistenceId,
                    (_, _) => JsonResponse(new
                    {
                        provider = "stub-http",
                        model = "stub-routing-model",
                        structuredJson = new
                        {
                            decision = "clarify",
                            candidateRoleAgentIds = new[] { "agent-accountant", "agent-research" },
                            reason = "Document could belong to either role.",
                            clarificationQuestion = "Is this for bookkeeping or research tracking?"
                        },
                        finishReason = "structured_stop",
                        usage = new { promptTokens = 18, completionTokens = 7, totalTokens = 25, cost = 0.05m },
                        citations = Array.Empty<string>(),
                        degradations = Array.Empty<object>(),
                        toolCalls = Array.Empty<object>()
                    }),
                    out _,
                    out var accountantId,
                    out var researchId);

                var result = Assert.IsType<RouteNeedsClarification>(router.Route(CreateInput(attemptId.Value, "mixed finance and research notes", "mixed.document")));
                Assert.Equal(new[] { accountantId, researchId }, result.CandidateRoleAgentIds);
                await Task.CompletedTask;
            });

            await WithSystem(databasePath, async system =>
            {
                var router = CreateLlmRouter(
                    system,
                    persistenceId,
                    (_, _) => JsonResponse(new
                    {
                        provider = "stub-http",
                        model = "stub-routing-model",
                        structuredJson = new
                        {
                            decision = "clarify",
                            candidateRoleAgentIds = new[] { "agent-accountant", "agent-research" },
                            reason = "Document could belong to either role.",
                            clarificationQuestion = "Is this for bookkeeping or research tracking?"
                        },
                        finishReason = "structured_stop",
                        usage = new { promptTokens = 18, completionTokens = 7, totalTokens = 25, cost = 0.05m },
                        citations = Array.Empty<string>(),
                        degradations = Array.Empty<object>(),
                        toolCalls = Array.Empty<object>()
                    }),
                    out _,
                    out var accountantId,
                    out var researchId);

                var attempt = router.GetAttempt(attemptId);
                Assert.NotNull(attempt);
                Assert.Equal(RouteAttemptStatus.ClarificationRequired, attempt!.Status);
                Assert.Equal(new[] { accountantId, researchId }, attempt.ClarificationCandidateRoleAgentIds.OrderBy(x => x.Value).ToArray());
                await Task.CompletedTask;
            });
        }
        finally
        {
            if (File.Exists(databasePath))
            {
                File.Delete(databasePath);
            }
        }
    }

    [Fact]
    public async Task MalformedRoutingJson_TriggersBoundedRepair()
    {
        var callCount = 0;
        var router = CreateLlmRouter(
            (_, _) =>
            {
                callCount++;
                return JsonResponse(new
                {
                    provider = "stub-http",
                    model = "stub-routing-model",
                    structuredJson = callCount == 1
                        ? "{\"decision\":\"route\",\"candidateRoleAgentIds\":[\"agent-accountant\"]}"
                        : "{\"decision\":\"route\",\"candidateRoleAgentIds\":[\"agent-accountant\"],\"reason\":\"Invoice matches accountant.\"}",
                    finishReason = "structured_stop",
                    usage = new { promptTokens = 18, completionTokens = 7, totalTokens = 25, cost = 0.05m },
                    citations = Array.Empty<string>(),
                    degradations = Array.Empty<object>(),
                    toolCalls = Array.Empty<object>()
                });
            },
            out var deliveries,
            out var accountantId,
            out _);

        var result = Assert.IsType<RouteCommitted>(router.Route(CreateInput("phase20-repair", "invoice pdf from vendor", "accounting.invoice")));

        Assert.Equal(2, callCount);
        Assert.Equal(accountantId, result.RoleAgentId);
        Assert.Equal(2, result.Attempt.LlmTrace!.Attempts.Count);
        Assert.False(result.Attempt.LlmTrace.Attempts[0].SchemaValidated);
        Assert.True(result.Attempt.LlmTrace.Attempts[1].SchemaValidated);

        await AssertEventually(() =>
        {
            Assert.Single(deliveries[accountantId]);
        });
    }

    [Fact]
    public void RepeatedMalformedRouting_ReachesClarification_InsteadOfInfiniteLoop()
    {
        var callCount = 0;
        var router = CreateLlmRouter(
            (_, _) =>
            {
                callCount++;
                return JsonResponse(new
                {
                    provider = "stub-http",
                    model = "stub-routing-model",
                    structuredJson = "{\"decision\":\"route\",\"candidateRoleAgentIds\":[\"agent-accountant\"]}",
                    finishReason = "structured_stop",
                    usage = new { promptTokens = 18, completionTokens = 7, totalTokens = 25, cost = 0.05m },
                    citations = Array.Empty<string>(),
                    degradations = Array.Empty<object>(),
                    toolCalls = Array.Empty<object>()
                });
            },
            out _,
            out _,
            out _);

        var result = Assert.IsType<RouteNeedsClarification>(router.Route(CreateInput("phase20-bad", "invoice pdf from vendor", "accounting.invoice")));

        Assert.Equal(2, callCount);
        Assert.Contains("could not safely determine", result.Question, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(2, result.Attempt.LlmTrace!.Attempts.Count);
    }

    [Fact]
    public async Task ProviderUnavailable_FallsBackToDeterministicRouting()
    {
        using var system = CreateSystem();
        var router = CreateLlmRouter(
            system,
            $"phase20/routing-provider-unavailable-{Guid.NewGuid():N}",
            new UnavailableLlmProvider(),
            out var deliveries,
            out var accountantId,
            out var researchId);

        var result = Assert.IsType<RouteCommitted>(router.Route(CreateInput("phase20-provider-unavailable", "invoice pdf from vendor", "accounting.invoice")));

        Assert.Equal(accountantId, result.RoleAgentId);
        Assert.NotNull(result.Attempt.LlmTrace);
        Assert.False(result.Attempt.LlmTrace!.Used);
        Assert.True(result.Attempt.LlmTrace.FallbackToDeterministic);

        await AssertEventually(() =>
        {
            Assert.Single(deliveries[accountantId]);
            Assert.Empty(deliveries[researchId]);
        });
    }

    [Fact]
    public void EmptyCandidateOutput_YieldsClarificationWithoutInventingCandidates()
    {
        using var system = CreateSystem();
        var router = CreateLlmRouter(
            system,
            $"phase20/routing-empty-candidates-{Guid.NewGuid():N}",
            (_, _) => JsonResponse(new
            {
                provider = "stub-http",
                model = "stub-routing-model",
                structuredJson = new
                {
                    decision = "route",
                    candidateRoleAgentIds = Array.Empty<string>(),
                    reason = "No viable candidates found."
                },
                finishReason = "structured_stop",
                usage = new { promptTokens = 18, completionTokens = 7, totalTokens = 25, cost = 0.05m },
                citations = Array.Empty<string>(),
                degradations = Array.Empty<object>(),
                toolCalls = Array.Empty<object>()
            }),
            out _,
            out _,
            out _);

        var result = Assert.IsType<RouteNeedsClarification>(router.Route(CreateInput("phase20-empty-candidates", "invoice pdf from vendor", "accounting.invoice")));

        Assert.Contains("could not determine", result.Question, StringComparison.OrdinalIgnoreCase);
        Assert.Empty(result.CandidateRoleAgentIds);
        Assert.NotNull(result.Attempt.LlmTrace);
        Assert.True(result.Attempt.LlmTrace!.Used);
    }

    [Fact]
    public void RoutingTrace_IncludesPromptSummary_ModelOutput_SchemaValidation_Offers_AndIntakeDecisions()
    {
        var router = CreateLlmRouter(
            (_, _) => JsonResponse(new
            {
                provider = "stub-http",
                model = "stub-routing-model",
                structuredJson = new
                {
                    decision = "route",
                    candidateRoleAgentIds = new[] { "agent-accountant", "agent-research" },
                    reason = "Invoice best matches accountant."
                },
                finishReason = "structured_stop",
                usage = new { promptTokens = 18, completionTokens = 7, totalTokens = 25, cost = 0.05m },
                citations = Array.Empty<string>(),
                degradations = Array.Empty<object>(),
                toolCalls = Array.Empty<object>()
            }),
            out _,
            out _,
            out _);

        var decision = router.Route(CreateInput("phase20-trace", "invoice pdf from vendor", "accounting.invoice"));
        var inspection = router.Inspect();
        var attempt = inspection.Attempts[decision.Attempt.RoutingAttemptId];

        Assert.NotNull(attempt.LlmTrace);
        Assert.Single(attempt.LlmTrace!.Attempts);
        Assert.Contains("Route input", attempt.LlmTrace.Attempts[0].PromptSummary, StringComparison.Ordinal);
        Assert.NotNull(attempt.LlmTrace.Attempts[0].ModelOutputJson);
        Assert.True(attempt.LlmTrace.Attempts[0].SchemaValidated);
        Assert.Contains(attempt.AuditEntries, static entry => entry.DecisionKind == "accepted");
    }

    private static RoleRoutingClient CreateLlmRouter(
        Func<HttpRequestMessage, CancellationToken, HttpResponseMessage> responder,
        out Dictionary<RoleAgentId, List<OperationResolved>> deliveries,
        out RoleAgentId accountantId,
        out RoleAgentId researchId)
    {
        var system = CreateSystem();
        return CreateLlmRouter(system, $"phase20/routing/{Guid.NewGuid():N}", responder, out deliveries, out accountantId, out researchId);
    }

    private static RoleRoutingClient CreateLlmRouter(
        ActorSystem system,
        string persistenceId,
        Func<HttpRequestMessage, CancellationToken, HttpResponseMessage> responder,
        out Dictionary<RoleAgentId, List<OperationResolved>> deliveries,
        out RoleAgentId accountantId,
        out RoleAgentId researchId)
        => CreateLlmRouter(
            system,
            persistenceId,
            new HttpLlmProvider(
                new HttpClient(new StubHttpMessageHandler(responder)),
                new LlmProviderConfiguration("stub-http", "https://stub-provider.local", "secret-token", "stub-routing-model", true)),
            out deliveries,
            out accountantId,
            out researchId);

    private static RoleRoutingClient CreateLlmRouter(
        ActorSystem system,
        string persistenceId,
        ILlmProvider provider,
        out Dictionary<RoleAgentId, List<OperationResolved>> deliveries,
        out RoleAgentId accountantId,
        out RoleAgentId researchId)
    {
        accountantId = new RoleAgentId("agent-accountant");
        researchId = new RoleAgentId("agent-research");
        deliveries = new Dictionary<RoleAgentId, List<OperationResolved>>
        {
            [accountantId] = new(),
            [researchId] = new()
        };
        var deliveriesLocal = deliveries;

        var profiles = new[]
        {
            CreateAccountantProfile(accountantId),
            CreateResearchProfile(researchId)
        };

        var registry = new Aven.RoleAgents.Registry.Clients.InMemoryRoleAgentRegistryClient();
        foreach (var profile in profiles)
        {
            registry.Register(profile);
        }

        var intakes = profiles.ToDictionary(
            static profile => profile.RoleAgentId,
            profile => CreateIntake(system, profile, deliveriesLocal[profile.RoleAgentId]));

        var gatewayActor = system.ActorOf(
            Props.Create(() => new TestLlmGatewayActor(provider)),
            $"phase20-llm-gateway-{Guid.NewGuid():N}");

        var engine = new LlmRoleSelector(
            gatewayActor,
            new LlmRoleSelectorOptions(new LlmModelCapabilities("stub-routing-model", true, true, true, true, true, false), MaxRepairAttempts: 2, MaxCandidateRetries: 3));

        var actor = system.ActorOf(
            Props.Create(() => new Aven.Routing.Actors.RoleRouterActor(persistenceId, registry, agentId => intakes[agentId], engine)),
            $"phase20-routing-{Guid.NewGuid():N}");
        return new RoleRoutingClient(actor);
    }

    private static WorkIntakeClient CreateIntake(ActorSystem system, RoleAgentProfile profile, List<OperationResolved> deliveries)
    {
        var agentState = RoleAgentState.Create(profile.RoleAgentId, new RoleDescriptor(profile.RoleName, profile.DisplayName), profile.Objective);
        var resolver = new LocalActorAddressRegistry();
        var recipientAddress = new ActorAddress($"agent/{profile.RoleAgentId.Value}", "local");
        var recipient = system.ActorOf(Props.Create(() => new RecordingRecipientActor(recipientAddress, deliveries)), $"phase20-{profile.RoleAgentId.Value}-recipient");
        resolver.Register(recipientAddress, recipient);
        return CreateWorkIntakeClient(
            system,
            $"phase20/intake/{profile.RoleAgentId.Value}",
            profile.RoleAgentId,
            () => agentState,
            decisionFactory: (offer, _) => Decide(profile, offer),
            resolver: resolver,
            agentGatewayAddress: recipientAddress);
    }

    private static WorkOfferDecision Decide(RoleAgentProfile profile, WorkOffer offer)
    {
        if (profile.RoleName.Equals("accountant", StringComparison.OrdinalIgnoreCase))
        {
            return offer.ProposedIntent.Contains("invoice", StringComparison.OrdinalIgnoreCase)
                   || offer.ProposedIntent.Contains("account", StringComparison.OrdinalIgnoreCase)
                ? Accept(profile.RoleAgentId, offer, "accounting_documents", "accounting.ingest_document")
                : new WorkOfferRejectedDecision(offer.RoutingAttemptId, offer.OfferId, profile.RoleAgentId, "out_of_scope", "Offer is outside accountant scope.", false, ["research"]);
        }

        if (profile.RoleName.Equals("research", StringComparison.OrdinalIgnoreCase))
        {
            return offer.ProposedIntent.Contains("research", StringComparison.OrdinalIgnoreCase)
                   || offer.ContentSummary.Contains("paper", StringComparison.OrdinalIgnoreCase)
                ? Accept(profile.RoleAgentId, offer, "research_documents", "research.ingest_document")
                : new WorkOfferRejectedDecision(offer.RoutingAttemptId, offer.OfferId, profile.RoleAgentId, "out_of_scope", "Offer is outside research scope.", false, ["accountant"]);
        }

        return new WorkOfferNeedsClarification(offer.RoutingAttemptId, offer.OfferId, profile.RoleAgentId, "Can you clarify the target role?");
    }

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

    private static ActorSystem CreateSystem()
    {
        var databasePath = Path.Combine(Path.GetTempPath(), $"aven-phase20-{Guid.NewGuid():N}.sqlite");
        return CreateSystem(databasePath);
    }

    private static ActorSystem CreateSystem(string databasePath)
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
                  connection-string = "Data Source={{databasePath.Replace("\\", "\\\\", StringComparison.Ordinal)}}"
                  auto-initialize = on
                }
                snapshot-store.sqlite {
                  class = "Akka.Persistence.Sqlite.Snapshot.SqliteSnapshotStore, Akka.Persistence.Sqlite"
                  plugin-dispatcher = "akka.actor.default-dispatcher"
                  connection-string = "Data Source={{databasePath.Replace("\\", "\\\\", StringComparison.Ordinal)}}"
                  auto-initialize = on
                }
              }
            }
            """);
        return ActorSystem.Create($"aven-phase20-{Guid.NewGuid():N}", config);
    }

    private static async Task WithSystem(string databasePath, Func<ActorSystem, Task> action)
    {
        var system = CreateSystem(databasePath);
        try
        {
            await action(system);
        }
        finally
        {
            await system.Terminate();
        }
    }

    private static async Task AssertEventually(Action assertion, int attempts = 80, int delayMs = 25)
    {
        Exception? last = null;

        for (var attempt = 0; attempt < attempts; attempt++)
        {
            try
            {
                assertion();
                return;
            }
            catch (Exception ex)
            {
                last = ex;
                await Task.Delay(delayMs);
            }
        }

        throw last ?? new TimeoutException("Condition was not met.");
    }

    private sealed class RecordingRecipientActor : Aven.ActorKernel.Actors.InboxLedgerPersistentActor
    {
        private readonly ActorAddress _address;
        private readonly List<OperationResolved> _deliveries;

        public RecordingRecipientActor(ActorAddress address, List<OperationResolved> deliveries)
            : base($"phase20-recipient-{address.Value.Replace('/', '-')}")
        {
            _address = address;
            _deliveries = deliveries;
            Command<DeliveryAttemptOffer>(Handle);
        }

        private void Handle(DeliveryAttemptOffer offer)
        {
            var decision = Decide(offer.Envelope.CommandId, offer.PayloadHash);
            switch (decision.Kind)
            {
                case Aven.ActorKernel.Ledgers.ProcessedCommandDecisionKind.Accepted:
                    {
                        var resolved = JsonSerializer.Deserialize<OperationResolved>(offer.Envelope.Payload)
                            ?? throw new InvalidOperationException("OperationResolved payload was empty.");
                        var replyTo = Sender;
                        PersistAcceptance(
                            new Aven.ActorKernel.Messages.ProcessedCommandAccepted(offer.Envelope.CommandId, offer.PayloadHash, DateTimeOffset.UtcNow, "accepted"),
                            _ =>
                            {
                                _deliveries.Add(resolved);
                                replyTo.Tell(new DeliveryAccepted(offer.DeliveryId, offer.Envelope.CommandId, _address, "accepted"));
                            });
                        break;
                    }
                case Aven.ActorKernel.Ledgers.ProcessedCommandDecisionKind.Duplicate:
                    Sender.Tell(new DeliveryAccepted(offer.DeliveryId, offer.Envelope.CommandId, _address, "duplicate"));
                    break;
                case Aven.ActorKernel.Ledgers.ProcessedCommandDecisionKind.Conflict:
                    Sender.Tell(new DeliveryRejected(offer.DeliveryId, offer.Envelope.CommandId, _address, new OperationError("payload_conflict", "Conflicting duplicate payload.", false)));
                    break;
            }
        }
    }

    private static WorkOfferAcceptedDecision Accept(RoleAgentId agentId, WorkOffer offer, string scope, string commandType) =>
        new(
            offer.RoutingAttemptId,
            offer.OfferId,
            agentId,
            new WorkClaimId($"claim-{offer.OfferId.Value}"),
            0.95m,
            scope,
            commandType,
            DateTimeOffset.UtcNow.AddMinutes(10),
            $"Matches {scope}.");

    private static RoleAgentProfile CreateAccountantProfile(RoleAgentId id) =>
        new(
            id,
            "accountant",
            "Accountant",
            "Handle invoices and statements",
            "Accounting documents",
            ["pdf", "image"],
            [new SchemaRef("schema://accounting/invoice@3")],
            "Routes invoices and statements",
            ["invoice", "account statement"],
            ["research paper"],
            "recent accounting summary",
            "monthly",
            "running");

    private static RoleAgentProfile CreateResearchProfile(RoleAgentId id) =>
        new(
            id,
            "research",
            "Research Watch",
            "Handle papers and research notes",
            "Research documents",
            ["pdf", "text"],
            [new SchemaRef("schema://research/paper@1")],
            "Routes papers and findings",
            ["research paper", "benchmark report"],
            ["invoice"],
            "recent research summary",
            "weekly",
            "running");

    private static RouteInput CreateInput(string routeId, string summary, string proposedIntent) =>
        new(
            new RoutingAttemptId(routeId),
            $"incoming-{routeId}",
            "pdf",
            ["artifact://sample.pdf"],
            summary,
            proposedIntent,
            "router proposal",
            Array.Empty<SchemaRef>(),
            new CorrelationId($"corr-{routeId}"),
            new ActorAddress("router/a", "local"));

    private static HttpResponseMessage JsonResponse(object body) =>
        new(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json")
        };

    private sealed class StubHttpMessageHandler(Func<HttpRequestMessage, CancellationToken, HttpResponseMessage> responder) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => Task.FromResult(responder(request, cancellationToken));
    }

    private sealed class TestLlmGatewayActor : ReceiveActor
    {
        private readonly ILlmProvider _provider;

        public TestLlmGatewayActor(ILlmProvider provider)
        {
            _provider = provider;
            ReceiveAsync<LlmStructuredGenerationCommand>(HandleAsync);
        }

        private async Task HandleAsync(LlmStructuredGenerationCommand command)
        {
            var health = _provider.GetHealth();
            if (!health.IsHealthy)
            {
                Sender.Tell(new LlmStructuredGenerationFailed(new OperationError(health.StatusCode, health.Message, false)));
                return;
            }

            var request = new LlmRequest(
                new OperationKey(command.Caller, command.RequestId, "llm.structured_generate"),
                command.CorrelationId,
                new ActorAddress("gateway/llm", "local"),
                new ActorAddress("reply/routing-test", "local"),
                command.Model,
                command.Input,
                new StructuredOutputContract(new SchemaRef("schema://routing/decision@1"), """
                {
                  "type": "object",
                  "required": ["decision", "candidateRoleAgentIds", "reason"],
                  "properties": {
                    "decision": { "type": "string" },
                    "candidateRoleAgentIds": { "type": "array" },
                    "reason": { "type": "string" },
                    "clarificationQuestion": { "type": "string" }
                  }
                }
                """, true),
                Array.Empty<ProviderFileDescriptor>(),
                command.Reasoning,
                command.Budget,
                command.Safety,
                command.CapabilityId);

            try
            {
                var response = await _provider.ExecuteAsync(request).ConfigureAwait(false);
                if (string.IsNullOrWhiteSpace(response.StructuredJson))
                {
                    Sender.Tell(new LlmStructuredGenerationFailed(new OperationError("structured_output_invalid", "Routing provider returned no structured JSON.", false)));
                    return;
                }

                Sender.Tell(new LlmStructuredGenerationSucceeded(
                    request.Key,
                    command.CorrelationId,
                    response,
                    response.StructuredJson));
            }
            catch (LlmProviderException ex)
            {
                Sender.Tell(new LlmStructuredGenerationFailed(ex.Error));
            }
        }
    }

    private sealed class UnavailableLlmProvider : ILlmProvider
    {
        public string Name => "stub-unavailable";

        public LlmProviderHealth GetHealth()
            => new(Name, false, false, "blocked_missing_provider", "Provider is unavailable.", "stub-routing-model");

        public Task<LlmResponse> ExecuteAsync(LlmRequest request, CancellationToken cancellationToken = default)
            => throw new NotSupportedException("Unavailable provider should not be executed.");
    }

    internal sealed record CapturedHttpRequest(string Body)
    {
        public static CapturedHttpRequest From(HttpRequestMessage request)
            => new(request.Content?.ReadAsStringAsync().GetAwaiter().GetResult() ?? string.Empty);
    }
}

file static class HttpRequestCaptureExtensions
{
    public static Phase20LlmRoutingTests.CapturedHttpRequest ToCapturedRequest(this HttpRequestMessage request)
        => Phase20LlmRoutingTests.CapturedHttpRequest.From(request);
}