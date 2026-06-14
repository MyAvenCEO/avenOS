using System.Collections.Concurrent;
using Akka.Actor;
using Akka.Configuration;
using Aven.RoleAgents;
using Aven.RoleAgents.Contracts.Commands;
using Aven.RoleAgents.Contracts.Responses;
using Aven.Akka.Hosting;
using Aven.Submission;
using Aven.Resources.Metadata;
using Aven.Resources.Artifacts;
using Aven.Resources.Llm;
using Aven.SchemaRegistry.Actors;
using Aven.Toolkit.Core.Serialization;
using Aven.Trace;
using Aven.Roles.Schemas;
using Aven.Roles.Support;
using Aven.Routing.Actors;
using Aven.Routing.Clients;
using Aven.Routing.Schemas;
using Aven.WorkIntake.Contracts.Support;
using Aven.WorkIntake.Clients;
using Aven.WorkIntake.Hosting;

namespace Aven.Api.Runtime;

public sealed class RuntimeCompositionRoot : IAsyncDisposable
{
    private static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(5);

    private readonly ActorSystem _system;
    private readonly LocalActorAddressRegistry _resolver = new();
    private readonly CanonicalJsonSerializer _serializer = new();
    private readonly string _artifactConnectionString;
    private readonly ResourceOperationInboxStore _resourceOperationInboxStore;
    private readonly string _artifactBlobRoot;
    private readonly IArtifactBlobStore _artifactBlobStore;
    private readonly IArtifactStore _artifactStore;
    private readonly ArtifactIntegrityChecker _artifactIntegrityChecker;
    private readonly Aven.RoleAgents.Registry.Clients.RoleAgentRegistryClient _roleAgentRegistry;
    private readonly RoleRoutingClient _router;
    private readonly MessageSubmissionClient _ingress;
    private readonly IActorRef _schemaRegistryActor;
    private readonly IActorRef _metadataActor;
    private readonly IActorRef _scheduleRegistryActor;
    private readonly IActorRef _humanPromptRegistryActor;
    private readonly LlmExtractionPipeline _llmExtractionPipeline;
    private readonly CapabilityAdmissionClient _capabilityAuthority;
    private readonly ConcurrentDictionary<RoleAgentId, AgentRegistration> _registrations = new();
    private readonly ConcurrentDictionary<string, IActorRef> _scheduleActors = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, IActorRef> _humanPromptActors = new(StringComparer.OrdinalIgnoreCase);
    private readonly object _scheduleActorGate = new();
    private readonly object _humanPromptActorGate = new();
    private readonly HttpClient _llmHttpClient;
    private readonly LlmRoleSelector _llmRoutingEngine;
    private readonly LlmModelCapabilities _llmDefaultModel;
    private readonly ShellGatewayOptions _shellOptions;
    private readonly RoleAgentLedgerStore _roleAgentLedgerStore;
    private readonly TraceStore _traceStore;
    private readonly TraceQueryService _traceQueryService;
    private readonly IActorRef _traceProjectionActor;
    private readonly IActorRef _roleAgentLedgerProjectionActor;
    private readonly IReadOnlyList<IAvenResourceModule> _resourceModules;
    private readonly Dictionary<string, IActorRef> _resourceGatewayActors = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, RoleRegistration> _roleDefinitions = new(StringComparer.OrdinalIgnoreCase);
    private readonly IActorRef _runtimeEventForwarder;
    private volatile Action<Aven.Events.Interfaces.IAvenEventEnvelope>? _runtimeEventHandler;

    public RuntimeCompositionRoot(IConfiguration configuration)
    {
        var databasePath = ResolveSqlitePath(configuration);
        var traceDatabasePath = ResolveTraceSqlitePath(configuration, databasePath);
        var artifactBlobRoot = ResolveArtifactBlobRoot(configuration, databasePath);
        EnsureRuntimeDirectories(databasePath, traceDatabasePath, artifactBlobRoot);
        _artifactConnectionString = $"Data Source={databasePath}";
        _artifactBlobRoot = artifactBlobRoot;
        _traceStore = new TraceStore($"Data Source={traceDatabasePath}");
        _traceQueryService = new TraceQueryService(_traceStore);
        _system = ActorSystem.Create($"aven-api-{Guid.NewGuid():N}", BuildPersistenceConfig(databasePath));
        _artifactBlobStore = new Aven.Toolkit.Artifacts.FileSystemArtifactBlobStore(artifactBlobRoot);
        _artifactStore = new SqliteArtifactStore(_artifactConnectionString);
        _resourceOperationInboxStore = new ResourceOperationInboxStore(_artifactConnectionString);
        _artifactIntegrityChecker = new ArtifactIntegrityChecker(_artifactConnectionString, _artifactBlobRoot);
        _roleAgentLedgerStore = new RoleAgentLedgerStore($"Data Source={databasePath}");
        _traceProjectionActor = _system.ActorOf(Props.Create(() => new TraceProjectionActor(_traceStore, null, new TraceProjectionOptions())), "trace-projection");
        _roleAgentLedgerProjectionActor = _system.ActorOf(Props.Create(() => new RoleAgentLedgerProjectionActor(_roleAgentLedgerStore, new RoleAgentLedgerProjectionOptions(), null, null)), "role-agent-ledger-projection");
        _runtimeEventForwarder = _system.ActorOf(Props.Create(() => new RuntimeEventForwarderActor(RaiseRuntimeEvent)), "runtime-event-forwarder");
        var capabilityActor = CapabilityAdmissionHost.Start(_system, "api/capability-admission", "api-capability-admission");
        _capabilityAuthority = new CapabilityAdmissionClient(capabilityActor);
        _schemaRegistryActor = _system.ActorOf(Props.Create(() => new SchemaRegistryActor("api/schema-registry")), "api-schema-registry");
        _metadataActor = _system.ActorOf(Props.Create(() => new MetadataStoreActor("api/metadata")), "api-metadata");
        _scheduleRegistryActor = _system.ActorOf(Props.Create(() => new ScheduleRegistryActor("api/schedule-registry")), "api-schedule-registry");
        _humanPromptRegistryActor = _system.ActorOf(Props.Create(() => new HumanPromptRegistryActor("api/human-prompt-registry")), "api-human-prompt-registry");
        var llmProviderConfiguration = LoadLlmProviderConfiguration(configuration);
        _llmDefaultModel = CreateDefaultModelCapabilities(llmProviderConfiguration.DefaultModel ?? "api-runtime-model");
        _shellOptions = LoadShellGatewayOptions(configuration, databasePath);
        SeedBuiltInRoleDefinitions();
        _llmHttpClient = new HttpClient();
        var llmProvider = new HttpLlmProvider(_llmHttpClient, llmProviderConfiguration);
        var providerFileRegistry = new ActorBackedProviderFileRegistry(_system, "api/provider-files", llmProvider);
        _llmExtractionPipeline = new LlmExtractionPipeline(_system, llmProvider, _artifactStore, _artifactBlobStore, new LlmInputPreparer(providerFileRegistry));
        _resourceModules = CreateResourceModules();
        RegisterApiResourceCapabilities();
        RegisterSchemas();
        StartResourceGateways();
        _llmRoutingEngine = new LlmRoleSelector(
            GetResourceGatewayActor(ResourceKinds.Llm),
            new LlmRoleSelectorOptions(_llmDefaultModel));
        var roleAgentRegistryActor = Aven.RoleAgents.Registry.RoleAgentRegistryHost.Start(_system, "api/role-agent-registry", "api-role-agent-registry");
        _roleAgentRegistry = new Aven.RoleAgents.Registry.Clients.RoleAgentRegistryClient(roleAgentRegistryActor);
        var routerActor = _system.ActorOf(
            Props.Create(() => new RoleRouterActor("api/routing", _roleAgentRegistry, ResolveIntakeForAgent, _llmRoutingEngine)),
            "api-routing");
        _router = new RoleRoutingClient(routerActor);
        var submissionActor = MessageSubmissionHost.Start(_system, "message-submission", _resolver, _router, _serializer, "message-submission");
        _ingress = new MessageSubmissionClient(submissionActor);
        RecoverRegisteredAgents();
    }

    private static void EnsureRuntimeDirectories(string persistencePath, string tracePath, string artifactBlobRoot)
    {
        EnsureParentDirectoryExists(persistencePath);
        EnsureParentDirectoryExists(tracePath);

        if (!string.IsNullOrWhiteSpace(artifactBlobRoot))
        {
            Directory.CreateDirectory(artifactBlobRoot);
        }
    }

    private static void EnsureParentDirectoryExists(string filePath)
    {
        var directory = Path.GetDirectoryName(filePath);
        if (!string.IsNullOrWhiteSpace(directory))
        {
            Directory.CreateDirectory(directory);
        }
    }

    public IReadOnlyList<RoleProfile> ListRoleDefinitions() =>
        _roleDefinitions.Values
            .Select(static registration => registration.Profile)
            .OrderBy(static profile => profile.RoleName, StringComparer.OrdinalIgnoreCase)
            .ToArray();

    public RoleProfile UpsertRoleDefinition(RoleDefinitionRequest request)
    {
        var registration = ResolveRoleRegistration(
            request.RoleName,
            request.DisplayName,
            request.ResponsibilityScope,
            request.AcceptedInputTypes,
            request.PrimarySchemas,
            request.RoutingDescription,
            request.SchedulePolicy,
            request.RecentSummary,
            request.ExamplesOfRelevantInput,
            request.ExamplesOfIrrelevantInput,
            request.ExecutionMode,
            request.Hardness,
            request.SystemPrompt,
            request.AllowedSkills);
        _roleDefinitions[registration.Profile.RoleName] = registration;
        return registration.Profile;
    }

    public IReadOnlyList<SkillDefinition> ListSkills() => SkillCatalog.All;

    /// <summary>
    /// Register (or clear with <c>null</c>) a handler that receives every durable runtime
    /// event envelope as it is published to the actor system's event stream. Used by the
    /// stdio sidecar to project run/operation lifecycle into live UI events (M8). The handler
    /// runs on an actor thread and must not block; it should enqueue and return.
    /// </summary>
    public void OnRuntimeEvent(Action<Aven.Events.Interfaces.IAvenEventEnvelope>? handler) => _runtimeEventHandler = handler;

    private void RaiseRuntimeEvent(Aven.Events.Interfaces.IAvenEventEnvelope envelope) => _runtimeEventHandler?.Invoke(envelope);

    public CreateAgentResponse RegisterAgent(CreateAgentRequest request)
    {
        var agentId = new RoleAgentId(request.RoleAgentId);
        if (_registrations.TryGetValue(agentId, out var existing))
        {
            return new CreateAgentResponse(existing.RoleAgentId.Value, existing.Profile.RoleName, existing.Profile.DisplayName, existing.Profile.Status);
        }

        var roleRegistration = ResolveRoleRegistration(
            request.RoleName,
            request.DisplayName,
            request.ResponsibilityScope,
            request.AcceptedInputTypes,
            request.PrimarySchemas,
            request.RoutingDescription,
            request.SchedulePolicy,
            request.RecentSummary,
            request.ExamplesOfRelevantInput,
            request.ExamplesOfIrrelevantInput,
            request.ExecutionMode,
            request.Hardness,
            request.SystemPrompt,
            request.AllowedSkills);
        var roleProfile = new RoleDescriptor(roleRegistration.Profile.RoleName, roleRegistration.Profile.DisplayName);
        var persistenceId = $"api/agents/{agentId.Value}";
        var actorName = $"agent-{SanitizeName(agentId.Value)}-{Guid.NewGuid():N}";
        var resourceGateways = CreateDeliveryGateways();
        var roleBehaviorHandler = RoleBehaviorProvider.CreateHandler(roleRegistration.Profile, request.Objective);
        var agentActor = _system.ActorOf(
            Props.Create(() => new RoleAgentActor(persistenceId, agentId, roleProfile, request.Objective, _resolver, resourceGateways, null, _roleAgentLedgerStore, roleBehaviorHandler)),
            actorName);
        agentActor.Ask<StartRoleAgentAccepted>(new StartRoleAgent(), DefaultTimeout).GetAwaiter().GetResult();

        var recipientAddress = new ActorAddress($"agent/{agentId.Value}", "local");
        _resolver.Register(recipientAddress, agentActor);

        var profile = new RoleAgentProfile(
            agentId,
            roleRegistration.Profile.RoleName,
            roleRegistration.Profile.DisplayName,
            request.Objective,
            roleRegistration.Profile.ResponsibilityScope,
            roleRegistration.Profile.AcceptedInputTypes.ToArray(),
            roleRegistration.Profile.PrimarySchemas.ToArray(),
            roleRegistration.Profile.RoutingDescription,
            roleRegistration.Profile.ExamplesOfRelevantInput?.ToArray() ?? Array.Empty<string>(),
            roleRegistration.Profile.ExamplesOfIrrelevantInput?.ToArray() ?? Array.Empty<string>(),
            roleRegistration.Profile.RecentSummary ?? "",
            roleRegistration.Profile.SchedulePolicy,
            request.Status ?? "running",
            roleRegistration.Profile.ExecutionMode.ToString(),
            roleRegistration.Profile.Hardness.ToString(),
            roleRegistration.Profile.SystemPrompt,
            roleRegistration.Profile.AllowedSkills?.ToArray() ?? Array.Empty<string>());

        _roleAgentRegistry.Register(profile);

        var intakeActor = WorkIntakeHost.Start(
            _system,
            $"api/intake/{agentId.Value}",
            agentId,
            () => agentActor.Ask<RoleAgentState>(new InspectRoleAgent(), DefaultTimeout).GetAwaiter().GetResult(),
            decisionFactory: (offer, state) => Decide(profile, offer, state),
            resolver: _resolver,
            agentAddress: recipientAddress);
        var intake = new WorkIntakeClient(intakeActor);

        var registration = new AgentRegistration(agentId, profile, agentActor, recipientAddress, intake);
        _registrations[agentId] = registration;
        SeedRoleCapabilityGrants(agentId, recipientAddress, profile);

        return new CreateAgentResponse(agentId.Value, profile.RoleName, profile.DisplayName, profile.Status);
    }

    public IReadOnlyList<CreateAgentResponse> ListAgents()
    {
        foreach (var profile in _roleAgentRegistry.ListProfiles())
        {
            EnsureRecoveredAgentRegistration(profile);
        }

        return _registrations.Values
            .Select(static registration => new CreateAgentResponse(
                registration.Profile.RoleAgentId.Value,
                registration.Profile.RoleName,
                registration.Profile.DisplayName,
                registration.Profile.Status))
            .OrderBy(static agent => agent.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(static agent => agent.RoleAgentId, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    public object SubmitMessage(ApiMessageRequest request)
    {
        var normalizedInputType = InputTypeNormalizer.Normalize(request.InputType);
        if (!string.IsNullOrWhiteSpace(request.InputType) && normalizedInputType is null)
        {
            return new SubmitMessageRejected(
                request.IdempotencyKey,
                new OperationError(
                    "unsupported_input_type",
                    $"Input type '{request.InputType}' is not supported. Supported input types: {string.Join(", ", InputTypeNormalizer.SupportedInputTypes)}.",
                    false));
        }

        return _ingress.Submit(new SubmitMessageRequest(
            request.IdempotencyKey,
            request.IncomingItemRef,
            normalizedInputType ?? InputTypeNormalizer.InferFromIncomingItemRef(request.IncomingItemRef),
            request.AttachmentRefs ?? Array.Empty<string>(),
            request.ContentSummary,
            request.ProposedIntent,
            request.ProposedReason,
            (request.RequiredSchemas ?? Array.Empty<string>()).Select(static x => new SchemaRef(x)).ToArray()));
    }

    public ArtifactUploadResponse UploadArtifact(IFormFile file)
    {
        using var memory = new MemoryStream();
        file.CopyTo(memory);
        var bytes = memory.ToArray();
        var mimeType = string.IsNullOrWhiteSpace(file.ContentType) ? InferMimeType(file.FileName) : file.ContentType;
        var gateway = GetResourceGatewayActor(ResourceKinds.Artifact);
        var reply = gateway.Ask<ArtifactGatewayUploadReply>(
            new ArtifactGatewayUploadCommand(
                new RequestId($"api-upload-{Guid.NewGuid():N}"),
                new ActorAddress("api/artifacts", "http"),
                new CorrelationId($"corr-api-upload-{Guid.NewGuid():N}"),
                file.FileName,
                mimeType,
                "upload",
                bytes,
                null,
                new CapabilityId("api-upload-artifact-cap")),
            DefaultTimeout).GetAwaiter().GetResult();

        return reply switch
        {
            ArtifactGatewayUploadSucceeded succeeded => new ArtifactUploadResponse(
                succeeded.Result.ArtifactId.Value,
                succeeded.Result.RevisionId.Value,
                succeeded.Result.Filename,
                succeeded.Result.MimeType),
            ArtifactGatewayUploadRejected rejected => throw new InvalidOperationException($"{rejected.Error.Code}: {rejected.Error.Message}"),
            ArtifactGatewayUploadFailed failed => throw new InvalidOperationException($"{failed.Error.Code}: {failed.Error.Message}"),
            _ => throw new InvalidOperationException($"Unexpected artifact upload reply: {reply.GetType().Name}")
        };
    }

    public AgentInspectionView? InspectAgent(string agentId)
    {
        var key = new RoleAgentId(agentId);
        if (!_registrations.TryGetValue(key, out var registration))
        {
            return null;
        }

        var state = registration.RoleAgentActor.Ask<RoleAgentState>(new InspectRoleAgent(), DefaultTimeout).GetAwaiter().GetResult();
        return new AgentInspectionView(
            state.RoleAgentId.Value,
            state.Status.ToString(),
            state.RoleProfile.RoleName,
            state.RoleProfile.DisplayName,
            state.Objective,
            state.RoleMemoryJson,
            state.LastRunSummary,
            state.OpenWorkItems.Values.OrderBy(x => x.OpenedAt).ToArray(),
            state.ActiveRuns.Values.OrderBy(x => x.StartedAt).ToArray(),
            state.PendingOperations.Values.OrderBy(x => x.RequestedAt).ToArray());
    }

    public Task<IReadOnlyList<WorkItemSnapshot>> ListRoleAgentWorkItemsAsync(string roleAgentId, WorkItemStatus? status, int? limit, CancellationToken cancellationToken) =>
        _roleAgentLedgerStore.ListWorkItemsAsync(new RoleAgentId(roleAgentId), status, limit, cancellationToken);

    public Task<IReadOnlyList<RunSnapshot>> ListRoleAgentRunsAsync(string roleAgentId, string? workItemId, RunStatus? status, int? limit, CancellationToken cancellationToken) =>
        _roleAgentLedgerStore.ListRunsAsync(new RoleAgentId(roleAgentId), string.IsNullOrWhiteSpace(workItemId) ? null : new WorkItemId(workItemId), status, limit, cancellationToken);

    public Task<IReadOnlyList<OperationSnapshot>> ListRoleAgentOperationsAsync(string roleAgentId, string? runId, OperationStatus? status, int? limit, CancellationToken cancellationToken) =>
        _roleAgentLedgerStore.ListOperationsAsync(new RoleAgentId(roleAgentId), string.IsNullOrWhiteSpace(runId) ? null : new RunId(runId), status, limit, cancellationToken);

    public ArtifactInspectionView? InspectArtifact(string artifactId)
    {
        var gateway = GetResourceGatewayActor(ResourceKinds.Artifact);
        var reply = gateway.Ask<ArtifactGatewayReadReply>(
            new ArtifactGatewayReadCommand(new Aven.Toolkit.Core.Identifiers.ArtifactId(artifactId)),
            DefaultTimeout).GetAwaiter().GetResult();

        if (reply is ArtifactGatewayReadNotFound)
        {
            return null;
        }

        if (reply is ArtifactGatewayReadFailed failed)
        {
            throw new InvalidOperationException($"Artifact read failed: {failed.Error.Code}: {failed.Error.Message}");
        }

        var artifact = reply is ArtifactGatewayReadSucceeded succeeded
            ? succeeded.Artifact
            : throw new InvalidOperationException($"Unexpected artifact gateway reply '{reply.GetType().Name}'.");

        return new ArtifactInspectionView(
            artifact.ArtifactId.Value,
            artifact.CurrentRevisionId.Value,
            artifact.Filename,
            artifact.MimeType,
            artifact.SourceKind,
            artifact.CreatedAt,
            artifact.Revisions.Select(static revision => new ArtifactRevisionView(
                revision.RevisionId.Value,
                revision.Blob.Algorithm,
                revision.Blob.Hash,
                revision.Blob.SizeBytes,
                revision.CreatedAt,
                revision.Description)).ToArray());
    }

    public async Task<ArtifactContentView?> GetArtifactContentAsync(string artifactId, CancellationToken cancellationToken)
    {
        var gateway = GetResourceGatewayActor(ResourceKinds.Artifact);
        var reply = await gateway.Ask<ArtifactGatewayReadReply>(
            new ArtifactGatewayReadCommand(new Aven.Toolkit.Core.Identifiers.ArtifactId(artifactId)),
            DefaultTimeout);

        if (reply is ArtifactGatewayReadNotFound)
        {
            return null;
        }

        if (reply is ArtifactGatewayReadFailed failed)
        {
            throw new InvalidOperationException($"Artifact read failed: {failed.Error.Code}: {failed.Error.Message}");
        }

        var artifact = reply is ArtifactGatewayReadSucceeded succeeded
            ? succeeded.Artifact
            : throw new InvalidOperationException($"Unexpected artifact gateway reply '{reply.GetType().Name}'.");

        var revision = artifact.Revisions
            .OrderByDescending(static x => x.CreatedAt)
            .FirstOrDefault();

        if (revision is null)
        {
            return null;
        }

        var bytes = await _artifactBlobStore.GetAsync(revision.Blob, cancellationToken);
        return new ArtifactContentView(artifact.Filename, artifact.MimeType, bytes);
    }

    public IReadOnlyList<ArtifactDescriptor> QueryArtifacts(string? filenameContains, string? mimeType, string? sourceKind, int? limit)
    {
        var gateway = GetResourceGatewayActor(ResourceKinds.Artifact);
        var reply = gateway.Ask<ArtifactGatewayQueryReply>(
            new ArtifactGatewayQueryCommand(filenameContains, mimeType, sourceKind, limit),
            DefaultTimeout).GetAwaiter().GetResult();

        return reply switch
        {
            ArtifactGatewayQuerySucceeded succeeded => succeeded.Artifacts,
            ArtifactGatewayQueryFailed failed => throw new InvalidOperationException($"Artifact query failed: {failed.Error.Code}: {failed.Error.Message}"),
            _ => throw new InvalidOperationException($"Unexpected artifact gateway query reply '{reply.GetType().Name}'.")
        };
    }

    public ArtifactIntegrityReport CheckArtifactIntegrity(bool verifyBytes = false) =>
        _artifactIntegrityChecker.CheckAsync(verifyBytes, CancellationToken.None).GetAwaiter().GetResult();

    public ScheduleInspectionView? InspectSchedule(string scheduleId)
    {
        var registration = _scheduleRegistryActor.Ask<ScheduledRoleWorkRegistration?>(new ScheduleRegistryGet(scheduleId), DefaultTimeout).GetAwaiter().GetResult();
        if (registration is null)
        {
            return null;
        }

        var actor = GetOrCreateScheduledWorkActor(registration);
        var state = actor.Ask<ScheduleState>(new ScheduleInspect(), DefaultTimeout).GetAwaiter().GetResult();
        return new ScheduleInspectionView(state.ScheduleId, state.DueAt, state.Status.ToString(), state.FireCount, state.PendingPrompt);
    }

    public object TriggerScheduleDue(string scheduleId, DateTimeOffset now)
    {
        var registration = _scheduleRegistryActor.Ask<ScheduledRoleWorkRegistration?>(new ScheduleRegistryGet(scheduleId), DefaultTimeout).GetAwaiter().GetResult()
            ?? throw new InvalidOperationException($"Schedule '{scheduleId}' is not registered.");
        var actor = GetOrCreateScheduledWorkActor(registration);
        return actor.Ask<object>(new CheckScheduleDue(now), DefaultTimeout).GetAwaiter().GetResult();
    }

    public MetadataRecord[] InspectMetadata()
    {
        var gateway = GetResourceGatewayActor(ResourceKinds.Metadata);
        var reply = gateway.Ask<MetadataGatewayReadReply>(new MetadataGatewayInspectAllCommand(), DefaultTimeout).GetAwaiter().GetResult();
        return reply switch
        {
            MetadataGatewayInspectAllSucceeded succeeded => succeeded.Records,
            MetadataGatewayReadFailed failed => throw new InvalidOperationException($"Metadata inspection failed: {failed.Error.Code}: {failed.Error.Message}"),
            _ => throw new InvalidOperationException($"Unexpected metadata gateway inspect reply '{reply.GetType().Name}'.")
        };
    }

    public IReadOnlyList<SchemaSummaryView> ListSchemas() =>
        KnownSchemas()
            .Select(static entry =>
            {
                var identity = ParseSchemaIdentity(entry.Key.Value);
                return new SchemaSummaryView(
                    entry.Key.Value,
                    identity.FamilyRef,
                    identity.Version,
                    BuildSchemaLabel(identity.FamilyRef, identity.Version),
                    entry.Value.Length);
            })
            .OrderBy(static x => x.FamilyRef, StringComparer.OrdinalIgnoreCase)
            .ThenByDescending(static x => x.Version)
            .ToArray();

    public SchemaDetailView? GetSchema(string schemaRef)
    {
        var reply = _schemaRegistryActor.Ask<object>(new SchemaGet(new SchemaRef(schemaRef)), DefaultTimeout).GetAwaiter().GetResult();
        return reply switch
        {
            Aven.SchemaRegistry.Contracts.Models.RegisteredSchema registered => new SchemaDetailView(
                registered.SchemaRef.Value,
                registered.FamilyRef,
                registered.Version,
                registered.Description,
                registered.RegisteredAt,
                registered.JsonSchema),
            SchemaNotFound => null,
            _ => throw new InvalidOperationException($"Unexpected schema lookup reply '{reply.GetType().Name}'.")
        };
    }

    public SchemaValidationView ValidateSchema(string schemaRef, string json)
    {
        var reply = _schemaRegistryActor.Ask<object>(new SchemaValidate(new SchemaRef(schemaRef), json), DefaultTimeout).GetAwaiter().GetResult();
        return reply switch
        {
            SchemaValidationSucceeded succeeded => new SchemaValidationView(succeeded.SchemaRef.Value, true, Array.Empty<string>(), succeeded.Json),
            SchemaValidationFailed failed => new SchemaValidationView(failed.SchemaRef.Value, false, failed.Errors, failed.Json),
            SchemaNotFound notFound => new SchemaValidationView(notFound.SchemaRef.Value, false, ["Schema not found."], json),
            _ => throw new InvalidOperationException($"Unexpected schema validation reply '{reply.GetType().Name}'.")
        };
    }

    public ActorTreeSnapshotView CaptureActorTreeSnapshot()
    {
        var coreChildren = new List<ActorTreeNodeView>
        {
            Node("trace-projection", "Trace projection", "projection", "running"),
            Node("role-agent-ledger-projection", "Role-agent ledger projection", "projection", "running"),
            Node("api-schema-registry", "Schema registry", "registry", "running"),
            Node("api-metadata", "Metadata store", "resource", "running"),
            Node("api-schedule-registry", "Schedule registry", "registry", "running"),
            Node("api-human-prompt-registry", "Human prompt registry", "registry", "running")
        };

        var gatewayNodes = _resourceGatewayActors.Keys
            .OrderBy(static x => x, StringComparer.OrdinalIgnoreCase)
            .Select(kind => Node($"gateway/{kind}", kind, "gateway", "running"))
            .ToArray();

        var agentNodes = _registrations.Values
            .OrderBy(static x => x.Profile.DisplayName, StringComparer.OrdinalIgnoreCase)
            .Select(static registration =>
                Node(
                    $"agent/{registration.RoleAgentId.Value}",
                    registration.Profile.DisplayName,
                    "agent",
                    registration.Profile.Status,
                    Node($"agent/{registration.RoleAgentId.Value}/intake", "Work intake", "intake", "running"),
                    Node($"agent/{registration.RoleAgentId.Value}/actor", registration.Profile.RoleName, "role", registration.Profile.Status)))
            .ToArray();

        var scheduleNodes = _scheduleActors.Keys
            .OrderBy(static x => x, StringComparer.OrdinalIgnoreCase)
            .Select(id => Node($"schedule/{id}", id, "schedule", "loaded"))
            .ToArray();

        var promptNodes = _humanPromptActors.Keys
            .OrderBy(static x => x, StringComparer.OrdinalIgnoreCase)
            .Select(id => Node($"prompt/{id}", id, "prompt", "loaded"))
            .ToArray();

        return new ActorTreeSnapshotView(
            DateTimeOffset.UtcNow,
            Node(
                "aven-api",
                "Aven API runtime",
                "root",
                "running",
                Node("system/core", "Core actors", "group", "running", coreChildren),
                Node("system/gateways", "Resource gateways", "group", "running", gatewayNodes),
                Node("system/agents", "Role agents", "group", $"{agentNodes.Length} active", agentNodes),
                Node("system/schedules", "Schedule actors", "group", $"{scheduleNodes.Length} loaded", scheduleNodes),
                Node("system/prompts", "Human prompt actors", "group", $"{promptNodes.Length} loaded", promptNodes)));
    }

    public IReadOnlyList<AccountingInvoiceView> ListAccountingInvoices() =>
        QueryMetadataRecords(
                SubjectKinds: [Aven.Roles.Accounting.Metadata.AccountingMetadataSubjects.Invoice],
                SchemaRefs: [Aven.Roles.Accounting.Schemas.AccountingSchemaRefs.InvoiceV3])
            .Select(AccountingViews.ToInvoiceView)
            .OrderBy(static x => x.InvoiceNumber, StringComparer.Ordinal)
            .ToArray();

    public IReadOnlyList<AccountingStatementView> ListAccountingStatements() =>
        QueryMetadataRecords(
                SubjectKinds: [Aven.Roles.Accounting.Metadata.AccountingMetadataSubjects.AccountStatement],
                SchemaRefs: [Aven.Roles.Accounting.Schemas.AccountingSchemaRefs.AccountStatementV3])
            .Select(AccountingViews.ToStatementView)
            .OrderBy(static x => x.StatementSubjectId, StringComparer.Ordinal)
            .ToArray();

    public IReadOnlyList<AccountingPaymentMatchView> ListAccountingPaymentMatches() =>
        QueryMetadataRecords(
                SubjectKinds: [Aven.Roles.Accounting.Metadata.AccountingMetadataSubjects.PaymentMatch],
                SchemaRefs: [Aven.Roles.Accounting.Schemas.AccountingSchemaRefs.PaymentMatchV3])
            .Select(AccountingViews.ToPaymentMatchView)
            .OrderBy(static x => x.InvoiceSubjectId, StringComparer.Ordinal)
            .ThenByDescending(static x => x.CreatedAt)
            .ToArray();

    public IReadOnlyList<AccountingSupplierSpendView> ListAccountingSuppliers() =>
        AccountingViews.AggregateSupplierSpend(ListAccountingInvoices(), ListAccountingPaymentMatches(), null);

    public AccountingSupplierSpendSummaryView GetAccountingSupplierSpend(string supplierIdOrName, string? period) =>
        AccountingViews.BuildSupplierSpendSummary(ListAccountingInvoices(), ListAccountingPaymentMatches(), supplierIdOrName, period);

    public AccountingQuestionResponse AskAccountingQuestion(string query) =>
        AccountingViews.AnswerQuestion(ListAccountingInvoices(), ListAccountingPaymentMatches(), query);


    private MetadataRecord[] QueryMetadataRecords(
        IReadOnlyList<string>? SubjectKinds = null,
        IReadOnlyList<string>? SubjectIds = null,
        IReadOnlyList<SchemaRef>? SchemaRefs = null,
        int limit = 500)
    {
        var gateway = GetResourceGatewayActor(ResourceKinds.Metadata);
        var query = new MetadataQuery(
            Limit: limit,
            Timeout: TimeSpan.FromSeconds(2),
            SubjectKinds: SubjectKinds,
            SubjectIds: SubjectIds,
            SchemaRefs: SchemaRefs);
        var reply = gateway.Ask<MetadataGatewayReadReply>(new MetadataGatewayQueryCommand(query), DefaultTimeout).GetAwaiter().GetResult();
        var result = reply switch
        {
            MetadataGatewayQuerySucceeded succeeded => succeeded.Result,
            MetadataGatewayReadFailed failed => throw new InvalidOperationException($"Metadata query failed: {failed.Error.Code}: {failed.Error.Message}"),
            _ => throw new InvalidOperationException($"Unexpected metadata gateway query reply '{reply.GetType().Name}'.")
        };
        return result.Records.ToArray();
    }

    public HumanPromptView[] ListHumanPrompts() =>
        _humanPromptRegistryActor
            .Ask<HumanPromptRegistration[]>(new HumanPromptRegistryList(), DefaultTimeout)
            .GetAwaiter().GetResult()
            .Select(ToHumanPromptView)
            .ToArray();

    public HumanPromptView? GetHumanPrompt(string promptId)
    {
        var registration = LookupHumanPromptRegistration(promptId);
        return registration is null ? null : ToHumanPromptView(registration);
    }

    public object? AnswerHumanPrompt(string promptId, string answer)
    {
        var registration = LookupHumanPromptRegistration(promptId);
        if (registration is null)
        {
            return null;
        }

        var actor = GetOrCreateHumanPromptActor(registration);
        var reply = actor.Ask<object>(
            new HumanPromptAnswer(
                new PromptId(promptId),
                answer,
                DateTimeOffset.UtcNow,
                string.IsNullOrWhiteSpace(registration.CapabilityId) ? null : new CapabilityId(registration.CapabilityId)),
            DefaultTimeout).GetAwaiter().GetResult();

        return reply;
    }

    public object? CancelHumanPrompt(string promptId, string? reason)
    {
        var registration = LookupHumanPromptRegistration(promptId);
        if (registration is null)
        {
            return null;
        }

        var actor = GetOrCreateHumanPromptActor(registration);
        var reply = actor.Ask<object>(
            new HumanPromptCancel(new PromptId(promptId), reason, DateTimeOffset.UtcNow),
            DefaultTimeout).GetAwaiter().GetResult();

        return reply;
    }

    public ITraceQueryService TraceQueryService => _traceQueryService;

    public async Task<TraceProjectionHealth> GetTraceProjectionHealthAsync()
    {
        var projection = await _traceProjectionActor.Ask<TraceProjectionHealth>(new GetTraceProjectionHealth(), DefaultTimeout);
        var storeAvailable = await _traceStore.CanConnectAsync(CancellationToken.None);
        return projection with { Healthy = projection.Healthy && storeAvailable };
    }

    public async Task<RoleAgentLedgerProjectionHealth> GetRoleAgentLedgerProjectionHealthAsync() =>
        await _roleAgentLedgerProjectionActor.Ask<RoleAgentLedgerProjectionHealth>(new GetRoleAgentLedgerProjectionHealth(), DefaultTimeout);

    public Task<TraceProjectionFlushed> FlushTraceProjectionAsync() =>
        _traceProjectionActor.Ask<TraceProjectionFlushed>(new FlushTraceProjection(), DefaultTimeout);

    public async ValueTask DisposeAsync()
    {
        _llmHttpClient.Dispose();
        await _system.Terminate();
    }

    private WorkIntakeClient ResolveIntakeForAgent(RoleAgentId agentId)
    {
        if (_registrations.TryGetValue(agentId, out var registration))
        {
            return registration.Intake;
        }

        throw new InvalidOperationException($"Agent '{agentId.Value}' is not registered.");
    }

    private IActorRef GetOrCreateScheduledWorkActor(object plan) => plan switch
    {
        ScheduledWorkOperationPayload genericPlan => GetOrCreateScheduledWorkActor(CreateScheduledWorkRegistration(genericPlan)),
        ScheduledRoleWorkRegistration registration => GetOrCreateScheduledWorkActor(registration),
        _ => throw new InvalidOperationException($"Unsupported schedule plan type: {plan.GetType().Name}")
    };

    private IActorRef GetOrCreateScheduledWorkActor(ScheduledRoleWorkRegistration registration)
    {
        _ = _scheduleRegistryActor.Ask<ScheduledRoleWorkRegistration>(
            new ScheduleRegistryUpsert(registration),
            DefaultTimeout).GetAwaiter().GetResult();

        if (_scheduleActors.TryGetValue(registration.ScheduleId, out var existing))
        {
            return existing;
        }

        lock (_scheduleActorGate)
        {
            if (_scheduleActors.TryGetValue(registration.ScheduleId, out existing))
            {
                return existing;
            }

            var missedRunPolicy = Enum.TryParse<MissedRunPolicy>(registration.MissedRunPolicy, ignoreCase: true, out var parsedPolicy)
                ? parsedPolicy
                : MissedRunPolicy.RunImmediately;
            var recurrence = TimeSpan.TryParse(registration.Recurrence, out var parsedRecurrence)
                ? parsedRecurrence
                : (TimeSpan?)null;
            var recipientAddress = new ActorAddress(registration.TargetAgentValue, registration.TargetAgentProtocol);
            var resolver = _resolver;

            var created = _system.ActorOf(
                Props.Create(() => new ScheduledWorkActor(
                    $"api/schedules/{registration.ScheduleId}",
                    registration.ScheduleId,
                    new OperationKey(ResourceAddresses.Gateway(ResourceKinds.Schedule), new RequestId(registration.RequestId), registration.TargetOperationType),
                    registration.CorrelationId,
                    registration.DueAt,
                    recurrence,
                    missedRunPolicy,
                    registration.CommandPayloadJson,
                    recipientAddress,
                    registration.TargetOperationType,
                    resolver,
                    recipientAddress)),
                $"schedule-{SanitizeName(registration.ScheduleId)}");

            _scheduleActors[registration.ScheduleId] = created;
            return created;
        }
    }

    private static ScheduledRoleWorkRegistration CreateScheduledWorkRegistration(ScheduledWorkOperationPayload plan) =>
        new(
            plan.ScheduleId,
            plan.RequestId,
            plan.TargetAgent.Value,
            plan.TargetAgent.Protocol,
            plan.TargetOperationType,
            plan.CommandPayloadJson,
            plan.CorrelationId,
            plan.DueAt,
            plan.Summary,
            plan.MissedRunPolicy,
            plan.Recurrence);

    private void StartResourceGateways()
    {
        foreach (var module in _resourceModules)
        {
            var gateway = module.StartGateway(_system, _resolver);
            _resourceGatewayActors[module.ResourceKind] = gateway;
            _resolver.Register(module.GatewayAddress, gateway);

            if (module.RecoverOnStartup)
            {
                gateway.Tell(new RecoverResourceOperations());
            }
        }
    }

    private IActorRef GetResourceGatewayActor(string resourceKind)
        => _resourceGatewayActors.TryGetValue(resourceKind, out var gateway)
            ? gateway
            : throw new InvalidOperationException($"Resource gateway actor for '{resourceKind}' is not registered.");

    private IReadOnlyList<IAvenResourceModule> CreateResourceModules() =>
    [
        new LlmResourceModule(_schemaRegistryActor, _llmExtractionPipeline, _resourceOperationInboxStore, _capabilityAuthority, _llmDefaultModel),
        new ArtifactResourceModule(_artifactStore, _artifactBlobStore, _resourceOperationInboxStore, _capabilityAuthority),
        new MetadataResourceModule(_metadataActor, _schemaRegistryActor, _resourceOperationInboxStore, _capabilityAuthority),
        new ScheduleResourceModule(GetOrCreateScheduledWorkActor, _resourceOperationInboxStore, _capabilityAuthority),
        new HumanResourceModule(GetOrCreateHumanPromptActor, _humanPromptRegistryActor, _resourceOperationInboxStore),
        new ShellResourceModule(_resourceOperationInboxStore, _capabilityAuthority, _shellOptions)
    ];

    private void RegisterApiResourceCapabilities()
    {
        _capabilityAuthority.UpsertGrant(new CapabilityGrant(
            new CapabilityId("api-upload-artifact-cap"),
            new ActorAddress("api/artifacts", "http"),
            ResourceAddresses.Gateway(ResourceKinds.Artifact),
            new HashSet<string>(StringComparer.Ordinal) { ResourceOperationTypes.ArtifactCreate },
            new CapabilityConstraints(MaxUses: 1000),
            false,
            null,
            DateTimeOffset.UtcNow.AddYears(1),
            null));
        _capabilityAuthority.UpsertGrant(new CapabilityGrant(
            new CapabilityId("api-routing-llm-cap"),
            new ActorAddress("api/routing", "local"),
            ResourceAddresses.Gateway(ResourceKinds.Llm),
            new HashSet<string>(StringComparer.Ordinal) { ResourceOperationTypes.LlmStructuredGenerate },
            new CapabilityConstraints(MaxUses: 1000),
            false,
            null,
            DateTimeOffset.UtcNow.AddYears(1),
            null));
    }

    private Dictionary<string, ActorAddress> CreateDeliveryGateways() =>
        _resourceModules.ToDictionary(module => module.ResourceKind, module => module.GatewayAddress, StringComparer.OrdinalIgnoreCase);

    private void RegisterSchemas()
    {
        RegisterSchemaCatalog(BuiltInRoleSchemaCatalog.All);
        RegisterSchemaCatalog(RoutingSchemaCatalog.All);
    }

    private IReadOnlyList<KeyValuePair<SchemaRef, string>> KnownSchemas() =>
        BuiltInRoleSchemaCatalog.All.Concat(RoutingSchemaCatalog.All)
            .GroupBy(static x => x.Key.Value, StringComparer.Ordinal)
            .Select(static group => group.First())
            .ToArray();

    private void RegisterSchemaCatalog(IReadOnlyList<KeyValuePair<SchemaRef, string>> schemas)
    {
        foreach (var entry in schemas)
        {
            _ = _schemaRegistryActor
                .Ask<object>(new SchemaRegister(entry.Key, entry.Value, $"Registered for {entry.Key.Value}"), DefaultTimeout)
                .GetAwaiter()
                .GetResult();
        }
    }

    private void RecoverRegisteredAgents()
    {
        foreach (var profile in _roleAgentRegistry.ListProfiles())
        {
            EnsureRecoveredAgentRegistration(profile);
        }
    }

    private AgentRegistration EnsureRecoveredAgentRegistration(RoleAgentProfile profile)
    {
        if (_registrations.TryGetValue(profile.RoleAgentId, out var existing))
        {
            return existing;
        }

        var roleProfile = new RoleDescriptor(profile.RoleName, profile.DisplayName);
        var persistenceId = $"api/agents/{profile.RoleAgentId.Value}";
        var actorName = $"agent-{SanitizeName(profile.RoleAgentId.Value)}-{Guid.NewGuid():N}";
        var resourceGateways = CreateDeliveryGateways();
        var recoveredRoleRegistration = ResolveRoleRegistration(profile);
        var roleBehaviorHandler = RoleBehaviorProvider.CreateHandler(recoveredRoleRegistration.Profile, profile.Objective);

        var agentActor = _system.ActorOf(
            Props.Create(() => new RoleAgentActor(persistenceId, profile.RoleAgentId, roleProfile, profile.Objective, _resolver, resourceGateways, null, _roleAgentLedgerStore, roleBehaviorHandler)),
            actorName);
        agentActor.Ask<StartRoleAgentAccepted>(new StartRoleAgent(), DefaultTimeout).GetAwaiter().GetResult();

        var recipientAddress = new ActorAddress($"agent/{profile.RoleAgentId.Value}", "local");
        _resolver.Register(recipientAddress, agentActor);

        var intakeActor = WorkIntakeHost.Start(
            _system,
            $"api/intake/{profile.RoleAgentId.Value}",
            profile.RoleAgentId,
            () => agentActor.Ask<RoleAgentState>(new InspectRoleAgent(), DefaultTimeout).GetAwaiter().GetResult(),
            decisionFactory: (offer, state) => Decide(profile, offer, state),
            resolver: _resolver,
            agentAddress: recipientAddress);
        var intake = new WorkIntakeClient(intakeActor);

        var registration = new AgentRegistration(profile.RoleAgentId, profile, agentActor, recipientAddress, intake);
        _registrations[profile.RoleAgentId] = registration;
        SeedRoleCapabilityGrants(profile.RoleAgentId, recipientAddress, profile);
        return registration;
    }

    private void SeedRoleCapabilityGrants(RoleAgentId agentId, ActorAddress holder, RoleAgentProfile profile)
    {
        var builtInSpecs = RuntimeRoleCapabilitySpecs.ForRole(profile.RoleName);
        foreach (var spec in builtInSpecs)
        {
            UpsertCapability(RoleCapabilityIds.ForRoleAgent(agentId, spec.LocalName), holder, spec.Target, spec.MessageType);
        }

        var isDynamic = string.Equals(profile.ExecutionMode, RoleExecutionMode.Dynamic.ToString(), StringComparison.OrdinalIgnoreCase)
            || builtInSpecs.Count == 0;
        if (!isDynamic)
        {
            return;
        }

        UpsertCapability(
            RoleCapabilityIds.ForRoleAgent(agentId, "dynamic-llm"),
            holder,
            ResourceAddresses.Gateway(ResourceKinds.Llm),
            ResourceOperationTypes.LlmStructuredGenerate);

        var allowedSkills = profile.AllowedSkills is { Count: > 0 }
            ? profile.AllowedSkills
            : SkillCatalog.DefaultDynamicSkillIds;
        foreach (var skillId in allowedSkills.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (string.Equals(skillId, SkillCatalog.MetadataQuery, StringComparison.OrdinalIgnoreCase))
            {
                UpsertCapability(RoleCapabilityIds.ForRoleAgent(agentId, "dynamic-metadata-query"), holder, ResourceAddresses.Gateway(ResourceKinds.Metadata), ResourceOperationTypes.MetadataQuery);
                continue;
            }

            if (string.Equals(skillId, SkillCatalog.ShellExecute, StringComparison.OrdinalIgnoreCase))
            {
                UpsertCapability(RoleCapabilityIds.ForRoleAgent(agentId, "dynamic-shell"), holder, ResourceAddresses.Gateway(ResourceKinds.Shell), ResourceOperationTypes.ShellExecute);
                continue;
            }

            if (string.Equals(skillId, SkillCatalog.HumanReview, StringComparison.OrdinalIgnoreCase))
            {
                UpsertCapability(RoleCapabilityIds.ForRoleAgent(agentId, "dynamic-human"), holder, ResourceAddresses.Gateway(ResourceKinds.Human), ResourceOperationTypes.HumanApprove);
                continue;
            }

            if (string.Equals(skillId, SkillCatalog.LlmStructuredGenerate, StringComparison.OrdinalIgnoreCase))
            {
                UpsertCapability(RoleCapabilityIds.ForRoleAgent(agentId, "dynamic-llm"), holder, ResourceAddresses.Gateway(ResourceKinds.Llm), ResourceOperationTypes.LlmStructuredGenerate);
            }
        }
    }

    private void UpsertCapability(string capabilityId, ActorAddress holder, ActorAddress target, string messageType)
    {
        _capabilityAuthority.UpsertGrant(new CapabilityGrant(
            new CapabilityId(capabilityId),
            holder,
            target,
            new HashSet<string>(StringComparer.Ordinal) { messageType },
            new CapabilityConstraints(MaxUses: 1000),
            false,
            null,
            DateTimeOffset.UtcNow.AddYears(1),
            null));
    }

    private WorkOfferDecision Decide(RoleAgentProfile profile, WorkOffer offer, RoleAgentState state)
    {
        var role = ResolveRoleRegistration(profile);
        var normalizedInputType = InputTypeNormalizer.NormalizeOrInfer(offer.InputType, offer.IncomingItemRef);
        var inputTypeAccepted = profile.AcceptedInputTypes.Any(x => string.Equals(x, normalizedInputType, StringComparison.OrdinalIgnoreCase));
        var schemaAccepted = profile.PrimarySchemas.Count == 0 || offer.RequiredSchemas.Count == 0 || offer.RequiredSchemas.Any(required => profile.PrimarySchemas.Contains(required));
        var roleSemanticMatch = RoleBehaviorSupport.OfferMatchesRole(role, offer.ProposedIntent, offer.ContentSummary, offer.RequiredSchemas);

        if (schemaAccepted && (inputTypeAccepted || roleSemanticMatch))
        {
            var commandType = role.Inputs.FirstOrDefault()?.CommandType ?? $"{profile.RoleName}.ingest_document";

            return new WorkOfferAcceptedDecision(
                offer.RoutingAttemptId,
                offer.OfferId,
                profile.RoleAgentId,
                new WorkClaimId($"claim-{offer.OfferId.Value}"),
                0.96m,
                role.Profile.ResponsibilityScope,
                commandType,
                DateTimeOffset.UtcNow.AddMinutes(10),
                $"Accepted by {profile.DisplayName} based on declared input types and schemas.");
        }

        return new WorkOfferRejectedDecision(
            offer.RoutingAttemptId,
            offer.OfferId,
            profile.RoleAgentId,
            "out_of_scope",
            $"Offer does not match {profile.DisplayName}'s declared input/schema scope.",
            false,
            Array.Empty<string>());
    }

    private static string ResolveSqlitePath(IConfiguration configuration)
    {
        var configured = configuration["Aven:Persistence:SqlitePath"];
        if (!string.IsNullOrWhiteSpace(configured))
        {
            return configured;
        }

        return Path.Combine(ResolveDefaultRuntimeDataRoot(), "aven-api.sqlite");
    }

    private static string ResolveTraceSqlitePath(IConfiguration configuration, string persistencePath)
    {
        var configured = configuration["Aven:Trace:SqlitePath"];
        if (!string.IsNullOrWhiteSpace(configured))
        {
            return configured;
        }

        var directory = Path.GetDirectoryName(persistencePath);
        return Path.Combine(string.IsNullOrWhiteSpace(directory) ? ResolveDefaultRuntimeDataRoot() : directory, "aven.trace.sqlite");
    }

    private static string ResolveArtifactBlobRoot(IConfiguration configuration, string persistencePath)
    {
        var configured = configuration["Aven:Artifacts:BlobRoot"];
        if (!string.IsNullOrWhiteSpace(configured))
        {
            return configured;
        }

        var directory = Path.GetDirectoryName(persistencePath);
        return Path.Combine(string.IsNullOrWhiteSpace(directory) ? ResolveDefaultRuntimeDataRoot() : directory, "artifacts", "blobs");
    }

    private static string ResolveDefaultRuntimeDataRoot() =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Aven", "runtime");

    private static LlmModelCapabilities CreateDefaultModelCapabilities(string modelName) =>
        new(
            modelName,
            SupportsImages: true,
            SupportsPdfArtifacts: true,
            SupportsProviderFiles: true,
            SupportsStrictStructuredOutput: true,
            SupportsToolCalls: true,
            SupportsRecoveryPolling: false);

    private static ShellGatewayOptions LoadShellGatewayOptions(IConfiguration configuration, string persistencePath)
    {
        var section = configuration.GetSection("Aven:Shell");
        var enabledValue = FirstNonEmpty(Environment.GetEnvironmentVariable("AVEN_SHELL_ENABLED"), section["Enabled"]);
        var enabled = bool.TryParse(enabledValue, out var parsedEnabled) && parsedEnabled;
        var workingDirectory = FirstNonEmpty(Environment.GetEnvironmentVariable("AVEN_SHELL_WORKDIR"), section["DefaultWorkingDirectory"]);
        if (string.IsNullOrWhiteSpace(workingDirectory))
        {
            var baseDirectory = Path.GetDirectoryName(persistencePath);
            workingDirectory = Path.Combine(string.IsNullOrWhiteSpace(baseDirectory) ? ResolveDefaultRuntimeDataRoot() : baseDirectory, "shell-workspaces");
        }

        var timeoutSeconds = int.TryParse(FirstNonEmpty(Environment.GetEnvironmentVariable("AVEN_SHELL_TIMEOUT_SECONDS"), section["DefaultTimeoutSeconds"]), out var parsedTimeout)
            ? parsedTimeout
            : 10;
        var maxOutputBytes = int.TryParse(FirstNonEmpty(Environment.GetEnvironmentVariable("AVEN_SHELL_MAX_OUTPUT_BYTES"), section["MaxOutputBytes"]), out var parsedMaxOutput)
            ? parsedMaxOutput
            : 65536;

        return new ShellGatewayOptions(enabled, workingDirectory, timeoutSeconds, maxOutputBytes);
    }

    private static LlmProviderConfiguration LoadLlmProviderConfiguration(IConfiguration configuration)
    {
        var section = configuration.GetSection("Aven:Llm");

        var provider = FirstNonEmpty(
            Environment.GetEnvironmentVariable("AVEN_LLM_PROVIDER"),
            section["Provider"]);

        var baseUrl = FirstNonEmpty(
            Environment.GetEnvironmentVariable("AVEN_LLM_BASE_URL"),
            section["BaseUrl"]);

        var apiKey = FirstNonEmpty(
            Environment.GetEnvironmentVariable("AVEN_LLM_API_KEY"),
            section["ApiKey"]);

        var model = FirstNonEmpty(
            Environment.GetEnvironmentVariable("AVEN_LLM_MODEL"),
            section["Model"]);

        var protocol = FirstNonEmpty(
            Environment.GetEnvironmentVariable("AVEN_LLM_PROTOCOL"),
            section["Protocol"]);

        var enabledValue = FirstNonEmpty(
            Environment.GetEnvironmentVariable("AVEN_LLM_ENABLED"),
            section["Enabled"]);

        var enabled = bool.TryParse(enabledValue, out var parsedEnabled)
            ? parsedEnabled
            : !string.IsNullOrWhiteSpace(provider)
              || !string.IsNullOrWhiteSpace(baseUrl)
              || !string.IsNullOrWhiteSpace(apiKey)
              || !string.IsNullOrWhiteSpace(model);

        return new LlmProviderConfiguration(
            provider ?? "missing",
            baseUrl,
            apiKey,
            model,
            enabled,
            protocol);
    }

    private static string? FirstNonEmpty(params string?[] values) =>
        values.FirstOrDefault(static value => !string.IsNullOrWhiteSpace(value));

    private static Config BuildPersistenceConfig(string databasePath)
    {
        var escapedPath = databasePath.Replace("\\", "\\\\", StringComparison.Ordinal);
        return ConfigurationFactory.ParseString($$"""
            akka {
              loglevel = WARNING
              stdout-loglevel = WARNING
              persistence {
                journal.plugin = "akka.persistence.journal.sqlite"
                snapshot-store.plugin = "akka.persistence.snapshot-store.sqlite"
                journal.sqlite {
                  class = "Akka.Persistence.Sqlite.Journal.SqliteJournal, Akka.Persistence.Sqlite"
                  plugin-dispatcher = "akka.actor.default-dispatcher"
                  connection-string = "Data Source={{escapedPath}}"
                  auto-initialize = on
                }
                snapshot-store.sqlite {
                  class = "Akka.Persistence.Sqlite.Snapshot.SqliteSnapshotStore, Akka.Persistence.Sqlite"
                  plugin-dispatcher = "akka.actor.default-dispatcher"
                  connection-string = "Data Source={{escapedPath}}"
                  auto-initialize = on
                }
              }
            }
            """);
    }

    private static string SanitizeName(string value)
    {
        Span<char> buffer = stackalloc char[value.Length];
        var index = 0;
        foreach (var ch in value)
        {
            buffer[index++] = char.IsLetterOrDigit(ch) || ch is '-' or '_' ? ch : '-';
        }

        return new string(buffer[..index]);
    }

    private static string InferMimeType(string fileName) =>
        Path.GetExtension(fileName).ToLowerInvariant() switch
        {
            ".pdf" => "application/pdf",
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".json" => "application/json",
            _ => "application/octet-stream"
        };

    private HumanPromptRegistration? LookupHumanPromptRegistration(string promptId) =>
        _humanPromptRegistryActor.Ask<HumanPromptRegistration?>(new HumanPromptRegistryGet(promptId), DefaultTimeout).GetAwaiter().GetResult();

    private IActorRef GetOrCreateHumanPromptActor(HumanPromptRegistration registration)
    {
        if (_humanPromptActors.TryGetValue(registration.PromptId, out var existing))
        {
            return existing;
        }

        lock (_humanPromptActorGate)
        {
            if (_humanPromptActors.TryGetValue(registration.PromptId, out existing))
            {
                return existing;
            }

            var created = _system.ActorOf(
                Props.Create(() => new HumanPromptActor(
                    $"api/human-prompts/{registration.PromptId}",
                    new OperationKey(
                        new ActorAddress(registration.CallerValue, registration.CallerProtocol),
                        new RequestId(registration.RequestId),
                        registration.OperationType),
                    new CorrelationId(registration.CorrelationId),
                    new ActorAddress(registration.AdapterValue, registration.AdapterProtocol),
                    registration.PromptText,
                    registration.ExpiresAt,
                    registration.CapabilityId,
                    _capabilityAuthority,
                    ResourceAddresses.Gateway(ResourceKinds.Human),
                    _resolver)),
                $"human-prompt-{SanitizeName(registration.PromptId)}");

            _humanPromptActors[registration.PromptId] = created;
            return created;
        }
    }

    private HumanPromptView ToHumanPromptView(HumanPromptRegistration registration)
    {
        var actor = GetOrCreateHumanPromptActor(registration);
        var state = actor.Ask<HumanPromptState>(new HumanPromptEnsureRegistered(), DefaultTimeout).GetAwaiter().GetResult();
        return new HumanPromptView(
            state.PromptId.Value,
            state.Status.ToString(),
            state.PromptText,
            state.Key.RequestId.Value,
            state.Key.OperationType,
            state.CorrelationId.Value,
            $"{registration.CallerProtocol}://{registration.CallerValue}",
            $"{registration.AdapterProtocol}://{registration.AdapterValue}",
            $"{registration.ReplyToProtocol}://{registration.ReplyToValue}",
            registration.CapabilityId,
            state.Answer,
            state.AnsweredAt,
            state.ExpiresAt);
    }

    private void SeedBuiltInRoleDefinitions()
    {
        foreach (var registration in BuiltInRoleDefinitionCatalog.All)
        {
            _roleDefinitions[registration.Profile.RoleName] = registration;
        }
    }

    private RoleRegistration ResolveRoleRegistration(RoleAgentProfile profile) =>
        ResolveRoleRegistration(
            profile.RoleName,
            profile.DisplayName,
            profile.ResponsibilityScope,
            profile.AcceptedInputTypes,
            profile.PrimarySchemas.Select(static schema => schema.Value).ToArray(),
            profile.RoutingDescription,
            profile.SchedulePolicy,
            profile.RecentSummary,
            profile.ExamplesOfRelevantInput,
            profile.ExamplesOfIrrelevantInput,
            profile.ExecutionMode,
            profile.Hardness,
            profile.SystemPrompt,
            profile.AllowedSkills);

    private RoleRegistration ResolveRoleRegistration(
        string roleName,
        string displayName,
        string responsibilityScope,
        IReadOnlyList<string>? acceptedInputTypes,
        IReadOnlyList<string>? primarySchemas,
        string? routingDescription,
        string? schedulePolicy,
        string? recentSummary,
        IReadOnlyList<string>? examplesOfRelevantInput,
        IReadOnlyList<string>? examplesOfIrrelevantInput,
        string? executionMode,
        string? hardness,
        string? systemPrompt,
        IReadOnlyList<string>? allowedSkills)
    {
        var mode = ParseEnumOrDefault(executionMode, RoleExecutionMode.HardCoded);
        var parsedHardness = ParseEnumOrDefault(hardness, RoleHardness.Hard);
        if (!_roleDefinitions.TryGetValue(roleName, out var catalogEntry))
        {
            mode = string.IsNullOrWhiteSpace(executionMode) ? RoleExecutionMode.Dynamic : mode;
            parsedHardness = string.IsNullOrWhiteSpace(hardness) ? RoleHardness.Soft : parsedHardness;
            var dynamicAllowedSkills = allowedSkills?.ToArray() ?? SkillCatalog.DefaultDynamicSkillIds.ToArray();
            var profile = new RoleProfile(
                roleName,
                string.IsNullOrWhiteSpace(displayName) ? roleName : displayName,
                responsibilityScope,
                acceptedInputTypes?.ToArray() ?? ["pdf", "image", "text"],
                primarySchemas?.Select(static x => new SchemaRef(x)).ToArray() ?? Array.Empty<SchemaRef>(),
                routingDescription ?? responsibilityScope,
                schedulePolicy ?? "manual",
                recentSummary,
                examplesOfRelevantInput,
                examplesOfIrrelevantInput,
                mode,
                parsedHardness,
                systemPrompt ?? responsibilityScope,
                dynamicAllowedSkills);
            return new RoleRegistration(
                profile,
                [new RoleInputContract($"{roleName}.ingest_document", $"Ingest work for {roleName}.", Array.Empty<SchemaRef>())],
                Array.Empty<RoleOutputContract>(),
                new RoleAgentPolicy(roleName, true, true, true));
        }

        var profileMode = string.IsNullOrWhiteSpace(executionMode) ? catalogEntry.Profile.ExecutionMode : mode;
        var profileHardness = string.IsNullOrWhiteSpace(hardness) ? catalogEntry.Profile.Hardness : parsedHardness;
        return catalogEntry with
        {
            Profile = catalogEntry.Profile with
            {
                DisplayName = string.IsNullOrWhiteSpace(displayName) ? catalogEntry.Profile.DisplayName : displayName,
                ResponsibilityScope = string.IsNullOrWhiteSpace(responsibilityScope) ? catalogEntry.Profile.ResponsibilityScope : responsibilityScope,
                AcceptedInputTypes = acceptedInputTypes?.ToArray() ?? catalogEntry.Profile.AcceptedInputTypes,
                PrimarySchemas = primarySchemas?.Select(static x => new SchemaRef(x)).ToArray() ?? catalogEntry.Profile.PrimarySchemas,
                RoutingDescription = routingDescription ?? catalogEntry.Profile.RoutingDescription,
                SchedulePolicy = schedulePolicy ?? catalogEntry.Profile.SchedulePolicy,
                RecentSummary = recentSummary ?? catalogEntry.Profile.RecentSummary,
                ExamplesOfRelevantInput = examplesOfRelevantInput ?? catalogEntry.Profile.ExamplesOfRelevantInput,
                ExamplesOfIrrelevantInput = examplesOfIrrelevantInput ?? catalogEntry.Profile.ExamplesOfIrrelevantInput,
                ExecutionMode = profileMode,
                Hardness = profileHardness,
                SystemPrompt = systemPrompt ?? catalogEntry.Profile.SystemPrompt,
                AllowedSkills = allowedSkills ?? catalogEntry.Profile.AllowedSkills
            }
        };
    }

    private static TEnum ParseEnumOrDefault<TEnum>(string? value, TEnum fallback)
        where TEnum : struct
    {
        return Enum.TryParse<TEnum>(value, ignoreCase: true, out var parsed)
            ? parsed
            : fallback;
    }

    private static (string FamilyRef, int Version) ParseSchemaIdentity(string schemaRef)
    {
        var atIndex = schemaRef.LastIndexOf('@');
        if (atIndex <= 0 || atIndex == schemaRef.Length - 1)
        {
            return (schemaRef, 0);
        }

        return int.TryParse(schemaRef[(atIndex + 1)..], out var version)
            ? (schemaRef[..atIndex], version)
            : (schemaRef[..atIndex], 0);
    }

    private static string BuildSchemaLabel(string familyRef, int version)
    {
        var tail = familyRef.Split('/').LastOrDefault() ?? familyRef;
        return $"{tail} v{version}";
    }

    private static ActorTreeNodeView Node(string id, string label, string kind, string status, params ActorTreeNodeView[] children) =>
        new(id, label, kind, status, children);

    private static ActorTreeNodeView Node(string id, string label, string kind, string status, IReadOnlyList<ActorTreeNodeView> children) =>
        new(id, label, kind, status, children);

}
