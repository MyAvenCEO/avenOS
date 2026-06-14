using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Akka.Persistence;
using Aven.ActorKernel;

namespace Aven.Tests.ActorKernel;

public sealed class Phase30EventResetArchitectureTests
{
    private static readonly string RepoRoot = FindRepoRoot();
    private static readonly string SrcRoot = Path.Combine(RepoRoot, "Aven", "src");
    private static readonly string TestsRoot = Path.Combine(RepoRoot, "Aven", "tests");
    private static readonly string ToolkitSrcRoot = Path.Combine(RepoRoot, "Toolkit", "src");
    private static readonly string ToolkitTestsRoot = Path.Combine(RepoRoot, "Toolkit", "tests");
    private static readonly string ToolsRoot = Path.Combine(RepoRoot, "tools");
    private static readonly string ApiRoot = Path.Combine(SrcRoot, "Aven.Api");
    private static readonly string ResourcesRuntimeRoot = Path.Combine(SrcRoot, "Resources", "Runtime", "Aven.Resources.Runtime");
    private static readonly string ShellRuntimeRoot = Path.Combine(SrcRoot, "Resources", "Shell", "Aven.Resources.Shell");
    private static readonly string RoutingRoot = Path.Combine(SrcRoot, "Routing", "Aven.Routing");
    private static readonly string RoleAgentsRoot = Path.Combine(SrcRoot, "Agent", "Aven.RoleAgents");
    private static readonly string RoleAgentsContractsRoot = Path.Combine(SrcRoot, "Agent", "Aven.RoleAgents.Contracts");
    private static readonly string RoleRegistryRoot = Path.Combine(SrcRoot, "RoleRegistry", "Aven.RoleAgents.Registry");
    private static readonly string WorkIntakeRoot = Path.Combine(SrcRoot, "WorkIntake", "Aven.WorkIntake");
    private static readonly string DeliveryRoot = Path.Combine(SrcRoot, "Delivery", "Aven.DurableDelivery");
    private static readonly string SubmissionRoot = Path.Combine(SrcRoot, "Submission", "Aven.Submission");
    private static readonly string SchedulingRoot = Path.Combine(SrcRoot, "Scheduling", "Aven.Scheduling");
    private static readonly string CapabilitiesRoot = Path.Combine(SrcRoot, "Capabilities", "Aven.Capabilities");
    private static readonly string ArtifactsContractsRoot = Path.Combine(SrcRoot, "Resources", "Artifacts", "Aven.Resources.Artifacts.Contracts");
    private static readonly string ArtifactsRoot = Path.Combine(SrcRoot, "Resources", "Artifacts", "Aven.Resources.Artifacts");
    private static readonly string HumanRoot = Path.Combine(SrcRoot, "Resources", "Human", "Aven.Resources.Human");
    private static readonly string LlmRoot = Path.Combine(SrcRoot, "Resources", "Llm", "Aven.Resources.Llm");
    private static readonly string LlmContractsRoot = Path.Combine(SrcRoot, "Resources", "Llm", "Aven.Resources.Llm.Contracts");
    private static readonly string MetadataRoot = Path.Combine(SrcRoot, "Resources", "Metadata", "Aven.Resources.Metadata");
    private static readonly string RolesRoot = Path.Combine(SrcRoot, "Aven.Roles");
    private static readonly string RolesContractsRoot = Path.Combine(SrcRoot, "RoleRegistry", "Aven.Roles.Contracts");
    private static readonly string SchemaRegistryRoot = Path.Combine(SrcRoot, "SchemaRegistry", "Aven.SchemaRegistry");
    private static readonly string TraceRoot = Path.Combine(SrcRoot, "Aven.Trace");

    private static readonly Assembly[] ProductionAssemblies =
    [
        typeof(AvenPersistentActor).Assembly,
        typeof(Aven.RoleAgents.RoleAgentActor).Assembly,
        typeof(Aven.RoleAgents.Registry.Actors.RoleAgentRegistryActor).Assembly,
        typeof(Aven.WorkIntake.Actors.WorkOfferActor).Assembly,
        typeof(RuntimeCompositionRoot).Assembly,
        typeof(CapabilityGrantRegistryActor).Assembly,
        typeof(Aven.DurableDelivery.Actors.DurableDeliveryActor).Assembly,
        typeof(Aven.Submission.Actors.MessageSubmissionActor).Assembly,
        typeof(Aven.Routing.Actors.RoleRouterActor).Assembly,
        typeof(Aven.Resources.Metadata.MetadataStoreActor).Assembly,
        typeof(Aven.Resources.Artifacts.SqliteArtifactStore).Assembly,
        typeof(Aven.Resources.Human.Actors.HumanPromptActor).Assembly,
        typeof(Aven.Resources.Llm.Actors.LlmRequestWorkerActor).Assembly,
        typeof(Aven.Resources.Llm.Actors.ProviderFileRegistryActor).Assembly,
        typeof(Aven.Resources.Shell.Gateways.ShellGatewayActor).Assembly,
        typeof(Aven.SchemaRegistry.Actors.SchemaRegistryActor).Assembly,
        typeof(Aven.Scheduling.Actors.ScheduledWorkActor).Assembly
    ];

    private static readonly string[] CompatibilityMarkers =
    [
        "Legacy",
        "OldEvent",
        "Upcast",
        "Upcaster",
        "BackwardCompatibility",
        "CompatibilityEvent"
    ];

    private static readonly HashSet<string> BannedPayloadTypeNames = new(StringComparer.Ordinal)
    {
        nameof(DeliveryState),
        nameof(RouteAttemptRecord),
        nameof(RouteResolution),
        nameof(SubmittedMessageRecord),
        nameof(LlmRequest),
        nameof(LlmResponse),
        nameof(MetadataRecord),
        nameof(RegisteredSchema),
        nameof(CapabilityGrant),
        nameof(ProviderFileDescriptor),
        nameof(AvenEnvelope<object>),
        nameof(WorkOffer),
        nameof(WorkOfferDecisionRecord),
        nameof(WorkClaimCommitRecord),
        nameof(WorkStartDeliveryReceipt),
        "UploadedArtifactRecordPersisted",
        "ScheduledRoleWorkRegistration"
    };

    private static readonly HashSet<string> BannedPayloadPropertyNames = new(StringComparer.Ordinal)
    {
        "ContentBase64",
        "InlineDataUrl",
        "Content",
        "Bytes",
        "Base64",
        "DataUrl"
    };

    private static readonly HashSet<string> BannedTopLevelPropertyNames = new(StringComparer.Ordinal)
    {
        "Record",
        "Attempt",
        "Request",
        "Response",
        "Schema",
        "Descriptor",
        "Registration",
        "Data"
    };

    private static readonly string[] BannedStalePathEntries =
    [
        "Aven/src/Agent/Aven.RoleAgents.Contracts/Enums/AgentStatus.cs",
        "Aven/src/Agent/Aven.RoleAgents.Contracts/State/AgentState.cs",
        "Aven/src/Agent/Aven.RoleAgents.Contracts/Responses/AgentStartAccepted.cs",
        "Aven/src/Agent/Aven.RoleAgents.Contracts/Responses/AgentIgnoredLateReply.cs",
        "Aven/src/Capabilities/Aven.Capabilities/Services",
        "Aven/src/Resources/Llm/Aven.Resources.Llm/Services",
        "Aven/src/RoleRegistry/Aven.RoleAgents.Registry/Services"
    ];

    private static readonly string[] BannedNamespaceReferences =
    [
        Namespace("Aven", "Capabilities", ServiceSuffix()),
        Namespace("Aven", "Resources", "Llm", ServiceSuffix()),
        Namespace("Aven", "RoleAgents", "Registry", ServiceSuffix())
    ];

    [Fact]
    public void SubmissionRouteResolution_UsesExplicitRouterResolutionLookup_InsteadOfInspection()
    {
        var submissionActorPath = Path.Combine(SubmissionRoot, "Actors", "MessageSubmissionActor.cs");
        var routingClientPath = Path.Combine(RoutingRoot, "Clients", "RoleRoutingClient.cs");
        var routingActorPath = Path.Combine(RoutingRoot, "Actors", "RoleRouterActor.cs");
        var resolutionCommandPath = Path.Combine(SrcRoot, "Routing", "Aven.Routing.Contracts", "Commands", "GetRouteResolutionCommand.cs");

        var submissionActor = File.ReadAllText(submissionActorPath);
        var routingClient = File.ReadAllText(routingClientPath);
        var routingActor = File.ReadAllText(routingActorPath);
        var resolutionCommand = File.ReadAllText(resolutionCommandPath);

        Assert.Contains("_router.GetResolution(", submissionActor, StringComparison.Ordinal);
        Assert.DoesNotContain("ResolveRouteResolution(routeInput)", submissionActor, StringComparison.Ordinal);
        Assert.DoesNotContain("_router.Inspect()", submissionActor, StringComparison.Ordinal);
        Assert.Contains("public RouteResolution? GetResolution(RoutingAttemptId id)", routingClient, StringComparison.Ordinal);
        Assert.Contains("Command<GetRouteResolutionCommand>", routingActor, StringComparison.Ordinal);
        Assert.Contains("public sealed record GetRouteResolutionCommand", resolutionCommand, StringComparison.Ordinal);
    }

    [Fact]
    public void PersistedEvents_AreSealed_AndSemantic()
    {
        var eventTypes = EventTypes().OrderBy(static x => x.FullName, StringComparer.Ordinal).ToArray();
        var catalog = BuildEventCatalog(eventTypes);
        var offenders = eventTypes
            .SelectMany(ValidateEventType)
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(
            offenders.Length == 0,
            "Semantic event violations: " + string.Join(", ", offenders) + Environment.NewLine + Environment.NewLine + "Event catalog:" + Environment.NewLine + catalog);
    }

    [Fact]
    public void PersistentActors_DeriveFromAvenPersistentActor()
    {
        var offenders = ProductionAssemblies
            .SelectMany(static assembly => assembly.GetTypes())
            .Where(static type => type is { IsAbstract: false, IsClass: true })
            .Where(static type => typeof(PersistentActor).IsAssignableFrom(type) || typeof(ReceivePersistentActor).IsAssignableFrom(type) || typeof(UntypedPersistentActor).IsAssignableFrom(type))
            .Where(static type => !typeof(AvenPersistentActor).IsAssignableFrom(type))
            .Select(static type => type.FullName ?? type.Name)
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Persistent actors must derive from AvenPersistentActor: " + string.Join(", ", offenders));
    }

    [Fact]
    public void ProductionSource_DoesNotCallPersist_OutsideAvenPersistentActor()
    {
        var offenders = FindSourceFiles()
            .Where(path => !path.EndsWith("AvenPersistentActor.cs", StringComparison.Ordinal))
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .Where(x => Regex.IsMatch(x.content, @"\bPersist\s*\("))
            .Select(x => Relative(x.path))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Persist( must only appear in AvenPersistentActor. Offenders: " + string.Join(", ", offenders));
    }

    [Fact]
    public void RoleAgentRuntimeHelpers_DoNotOwn_Persistence_Timers_Or_Replies()
    {
        var runtimeRoot = Path.Combine(RoleAgentsRoot, "Runtime");
        var bannedPatterns = new (string Label, string Pattern)[]
        {
            ("persist", @"\bPersist(?:Event)?\s*\("),
            ("timers", @"\bTimers\s*\."),
            ("sender", @"(?<!\.)\bSender\b"),
            ("self", @"\bSelf\b"),
            ("actorrefs", @"\bActorRefs\b"),
            ("reply_tell", @"\.Tell\s*\("),
            ("actorof", @"\bActorOf\s*\(")
        };

        var offenders = EnumerateCodeFiles(runtimeRoot)
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .SelectMany(x => bannedPatterns
                .Where(rule => Regex.IsMatch(x.content, rule.Pattern, RegexOptions.CultureInvariant))
                .Select(rule => $"{Relative(x.path)}:{rule.Label}"))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(
            offenders.Length == 0,
            "RoleAgent runtime helpers must not own persistence, timers, or replies: " + string.Join(", ", offenders));
    }

    [Fact]
    public void RoleAgentRuntimeDispatcher_IsThe_Only_Helper_Allowed_To_Use_DeliveryLauncher_Context_And_EnvelopeBuilder()
    {
        var runtimeRoot = Path.Combine(RoleAgentsRoot, "Runtime");
        var dispatcherPath = Path.Combine(runtimeRoot, "RoleAgentOperationDispatcher.cs");
        var helperFiles = EnumerateCodeFiles(runtimeRoot)
            .Select(Relative)
            .OrderBy(static x => x)
            .ToArray();

        Assert.Contains(Relative(dispatcherPath), helperFiles);

        var deliveryConstructionTokens = new[]
        {
            "DurableDeliveryFactory",
            "IUntypedActorContext",
            "AvenEnvelopeBuilder",
            "StartOrResume(",
            "DurableDeliveryStartFactory"
        };

        var offenders = EnumerateCodeFiles(runtimeRoot)
            .Where(path => !path.EndsWith("RoleAgentOperationDispatcher.cs", StringComparison.Ordinal))
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .SelectMany(x => deliveryConstructionTokens
                .Where(token => x.content.Contains(token, StringComparison.Ordinal))
                .Select(token => $"{Relative(x.path)}:{token}"))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(
            offenders.Length == 0,
            "Only RoleAgentOperationDispatcher may use delivery-launch construction helpers inside RoleAgent runtime helpers: " + string.Join(", ", offenders));
    }

    [Fact]
    public void ProductionActors_AndAdapterRail_DoNotUseBlockingGetResultOrWait()
    {
        var actorRoots = new[]
        {
            Path.Combine(ApiRoot, "Actors"),
            Path.Combine(ResourcesRuntimeRoot, "Gateways"),
            Path.Combine(ResourcesRuntimeRoot, "Inbox"),
            Path.Combine(ArtifactsRoot, "Gateways"),
            Path.Combine(ArtifactsRoot, "Workers"),
            Path.Combine(MetadataRoot, "Gateways"),
            Path.Combine(MetadataRoot, "Workers"),
            Path.Combine(LlmRoot, "Gateways"),
            Path.Combine(LlmRoot, "Workers"),
            Path.Combine(HumanRoot, "Gateways"),
            Path.Combine(HumanRoot, "Workers"),
            Path.Combine(SchedulingRoot, "Gateways"),
            Path.Combine(SchedulingRoot, "Workers"),
            Path.Combine(ShellRuntimeRoot, "Gateways"),
            Path.Combine(ShellRuntimeRoot, "Workers"),
            Path.Combine(RoutingRoot, "Actors"),
            RoleAgentsRoot,
            Path.Combine(LlmRoot, "Registries"),
            Path.Combine(LlmRoot, "Actors"),
            Path.Combine(HumanRoot, "Actors")
        };

        var actorFiles = actorRoots
            .Where(Directory.Exists)
            .SelectMany(EnumerateCodeFiles)
            .Concat(Directory.EnumerateFiles(Path.Combine(RoutingRoot, "Engines"), "LlmRoleSelector.cs", SearchOption.TopDirectoryOnly))
            .Concat(Directory.EnumerateFiles(MetadataRoot, "*Actor.cs", SearchOption.TopDirectoryOnly))
            .Concat(Directory.EnumerateFiles(Path.Combine(HumanRoot, "Actors"), "*.cs", SearchOption.TopDirectoryOnly))
            .Concat(Directory.EnumerateFiles(Path.Combine(LlmRoot, "Actors"), "*.cs", SearchOption.TopDirectoryOnly))
            .Where(path => !path.EndsWith("RuntimeCompositionRoot.cs", StringComparison.Ordinal))
            .Where(path => !path.EndsWith("Client.cs", StringComparison.Ordinal))
            .Where(path => path.EndsWith("ResourceGatewayRail.cs", StringComparison.Ordinal)
                || path.Contains("Actor", StringComparison.Ordinal)
                || path.EndsWith("LlmRoleSelector.cs", StringComparison.Ordinal))
            .Distinct(StringComparer.Ordinal)
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .Where(x => x.content.Contains(".GetAwaiter().GetResult()", StringComparison.Ordinal) || x.content.Contains(".Wait(", StringComparison.Ordinal))
            .Select(x => Relative(x.path))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(actorFiles.Length == 0, "Production actor/routing source must not block with GetResult/Wait: " + string.Join(", ", actorFiles));
    }

    [Fact]
    public void ProductionActors_DoNotUseSynchronousCapabilityAdmission()
    {
        var roots = new[]
        {
            Path.Combine(ApiRoot, "Actors"),
            MetadataRoot,
            HumanRoot,
            LlmRoot,
            RoutingRoot,
            RoleAgentsRoot
        };

        var offenders = roots
            .Where(Directory.Exists)
            .SelectMany(EnumerateCodeFiles)
            .Where(path => path.Contains("Actor", StringComparison.Ordinal) || path.EndsWith("LlmRoleSelector.cs", StringComparison.Ordinal))
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .Where(x => x.content.Contains(".Admit(", StringComparison.Ordinal))
            .Select(x => Relative(x.path))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Production actor/routing source must use AdmitAsync instead of Admit: " + string.Join(", ", offenders));
    }

    [Fact]
    public void ProductionSource_DoesNotContainCompatibilityMarkers()
    {
        var offenders = FindSourceFiles()
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .SelectMany(x => CompatibilityMarkers
                .Where(marker => Regex.IsMatch(x.content, $@"\b{Regex.Escape(marker)}\b", RegexOptions.CultureInvariant))
                .Select(marker => $"{Relative(x.path)}:{marker}"))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Compatibility markers remain in production source: " + string.Join(", ", offenders));
    }

    [Fact]
    public void RemovedLegacySurfaces_AreAbsent_FromSourceAndTests()
    {
        var bannedPatterns = new[]
        {
            "Aven.Inspection",
            "InspectionService",
            "/api/inspection",
            "Aven.AppHost",
            "AvenMvpScenarioRunner",
            "AvenRuntimeConfigLoader",
            "Aven.Operations",
            "Aven.Providers",
            "Aven.Terminal",
            "Aven.Workers",
            "Aven.Planning"
        };

        var offenders = EnumerateCodeFiles(SrcRoot)
            .Concat(EnumerateCodeFiles(TestsRoot))
            .Concat(EnumerateCodeFiles(ToolsRoot))
            .Where(path => !path.EndsWith("Aven/tests/Aven.Tests.ActorKernel/Phase30EventResetArchitectureTests.cs", StringComparison.Ordinal))
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .SelectMany(x => bannedPatterns
                .Where(pattern => x.content.Contains(pattern, StringComparison.Ordinal))
                .Select(pattern => $"{Relative(x.path)}:{pattern}"))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Removed legacy surfaces remain in source/tests/tools: " + string.Join(", ", offenders));
    }

    [Fact]
    public void ActorBackedClients_DoNotExposeRemovedInMemoryFallbackBranches()
    {
        var bannedTexts = new[]
        {
            "In-memory CapabilityAdmissionClient mode has been removed",
            "In-memory RoleAgentRegistryClient mode has been removed",
            "In-memory MetadataStoreClient mode has been removed",
            "In-memory MessageSubmissionClient mode has been removed"
        };

        var offenders = FindSourceFiles()
            .Select(path => (path, content: File.ReadAllText(path)))
            .SelectMany(x => bannedTexts.Where(text => x.content.Contains(text, StringComparison.Ordinal)).Select(text => $"{Relative(x.path)}:{text}"))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Removed in-memory fallback markers remain in source: " + string.Join(", ", offenders));

        var capabilityCtor = typeof(Aven.Capabilities.Clients.CapabilityAdmissionClient)
            .GetConstructors(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
            .SingleOrDefault(static ctor => ctor.IsFamily && ctor.GetParameters().Length == 0);
        Assert.Null(capabilityCtor);

        var registryCtor = typeof(Aven.RoleAgents.Registry.Clients.RoleAgentRegistryClient)
            .GetConstructors(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
            .SingleOrDefault(static ctor => ctor.IsFamily && ctor.GetParameters().Length == 0);
        Assert.Null(registryCtor);

        var messageSubmissionSource = File.ReadAllText(Path.Combine(RepoRoot, "Aven/src/Submission/Aven.Submission/MessageSubmissionClient.cs"));
        Assert.DoesNotContain("IActorRef? _submissionActor", messageSubmissionSource, StringComparison.Ordinal);

        Assert.False(
            File.Exists(Path.Combine(RepoRoot, "Aven/src/Resources/Metadata/Aven.Resources.Metadata/MetadataStoreClient.cs")),
            "Production metadata client wrapper must not remain under src.");
    }

    [Fact]
    public void Production_Client_Wrappers_Do_Not_Create_Actors()
    {
        var offenders = EnumerateCodeFiles(SrcRoot)
            .Where(path => path.EndsWith("Client.cs", StringComparison.Ordinal))
            .Where(path => !path.Contains("/InMemory", StringComparison.Ordinal))
            .Where(path => !path.Contains("Aven.Testing", StringComparison.Ordinal))
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .Where(x => x.content.Contains("ActorOf(", StringComparison.Ordinal))
            .Select(x => Relative(x.path))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Production *Client.cs wrappers must not call ActorOf. Offenders: " + string.Join(", ", offenders));
    }

    [Fact]
    public void ExplicitFakes_DoNotInheritActorBackedClients()
    {
        Assert.Contains(typeof(Aven.Capabilities.Clients.ICapabilityAdmissionClient), typeof(Aven.Capabilities.Clients.InMemoryCapabilityAdmissionClient).GetInterfaces());
        Assert.NotEqual(typeof(Aven.Capabilities.Clients.CapabilityAdmissionClient), typeof(Aven.Capabilities.Clients.InMemoryCapabilityAdmissionClient).BaseType);

        Assert.Contains(typeof(Aven.RoleAgents.Registry.Clients.IRoleAgentRegistryClient), typeof(Aven.RoleAgents.Registry.Clients.InMemoryRoleAgentRegistryClient).GetInterfaces());
        Assert.NotEqual(typeof(Aven.RoleAgents.Registry.Clients.RoleAgentRegistryClient), typeof(Aven.RoleAgents.Registry.Clients.InMemoryRoleAgentRegistryClient).BaseType);

        Assert.Contains(typeof(Aven.Resources.Metadata.IMetadataStoreClient), typeof(Aven.Resources.Metadata.InMemoryMetadataStoreClient).GetInterfaces());
    }

    [Fact]
    public void Production_Source_Does_Not_Declare_TestOnly_InMemory_Or_Fake_Types()
    {
        var offenders = EnumerateCodeFiles(SrcRoot)
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .SelectMany(x => Regex.Matches(x.content, @"\b(?:class|record|struct|interface|enum)\s+(Fake\w+|InMemory\w+)\b", RegexOptions.CultureInvariant)
                .Cast<Match>()
                .Select(match => $"{Relative(x.path)}:{match.Groups[1].Value}"))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Production source must not declare Fake*/InMemory* test-only types: " + string.Join(", ", offenders));
    }

    [Fact]
    public void Production_Runtime_Actors_Do_Not_Reference_InMemory_Test_Providers_Or_Clients()
    {
        var actorRoots = new[]
        {
            Path.Combine(ApiRoot, "Actors"),
            MetadataRoot,
            HumanRoot,
            LlmRoot,
            RoutingRoot,
            RoleAgentsRoot,
            RoleRegistryRoot
        };

        var offenders = actorRoots
            .Where(Directory.Exists)
            .SelectMany(EnumerateCodeFiles)
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .Where(x => Regex.IsMatch(x.content, @"\bInMemory(?:CapabilityAdmissionClient|RoleAgentRegistryClient|MetadataStoreClient|LlmProvider|LlmResponsePlan|LlmScenarioKind|ProviderFileRegistry)\b", RegexOptions.CultureInvariant))
            .Select(x => Relative(x.path))
            .Distinct(StringComparer.Ordinal)
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Production runtime actors/gateways must not reference in-memory test providers/clients: " + string.Join(", ", offenders));
    }

    [Fact]
    public void TestOnly_Client_Abstractions_Do_Not_Remain_Under_Src()
    {
        var bannedPaths = new[]
        {
            "Aven/src/Resources/Metadata/Aven.Resources.Metadata/MetadataStoreClient.cs",
            "Aven/src/Resources/Metadata/Aven.Resources.Metadata/IMetadataStoreClient.cs",
            "Aven/src/Resources/Metadata/Aven.Resources.Metadata/InMemoryMetadataStoreClient.cs",
            "Aven/src/Capabilities/Aven.Capabilities/Clients/InMemoryCapabilityAdmissionClient.cs",
            "Aven/src/RoleRegistry/Aven.RoleAgents.Registry/Clients/InMemoryRoleAgentRegistryClient.cs",
            "Aven/src/Resources/Llm/Aven.Resources.Llm/InMemoryLlmProvider.cs",
            "Aven/src/Resources/Llm/Aven.Resources.Llm.Contracts/Models/InMemoryLlmResponsePlan.cs",
            "Aven/src/Resources/Llm/Aven.Resources.Llm.Contracts/Enums/InMemoryLlmScenarioKind.cs",
            "Aven/src/Resources/Llm/Aven.Resources.Llm/Registries/InMemoryProviderFileRegistry.cs",
            "Toolkit/src/Aven.Toolkit.Metadata/InMemoryMetadataStore.cs"
        };

        var offenders = bannedPaths
            .Where(path => File.Exists(Path.Combine(RepoRoot, path)))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Test-only client/provider seams must not remain under src: " + string.Join(", ", offenders));
    }

    [Fact]
    public void DomainActorProjects_DoNotReferenceHostingCompositionProject()
    {
        var projects = new[]
        {
            "Aven/src/Delivery/Aven.DurableDelivery/Aven.DurableDelivery.csproj",
            "Aven/src/Agent/Aven.RoleAgents/Aven.RoleAgents.csproj",
            "Aven/src/WorkIntake/Aven.WorkIntake/Aven.WorkIntake.csproj",
            "Aven/src/Submission/Aven.Submission/Aven.Submission.csproj",
            "Aven/src/Scheduling/Aven.Scheduling/Aven.Scheduling.csproj"
        };

        var offenders = projects
            .Where(project => File.ReadAllText(Path.Combine(RepoRoot, project)).Contains("Aven.Akka.Hosting", StringComparison.Ordinal))
            .ToArray();

        Assert.True(offenders.Length == 0, "Domain actor projects still reference Aven.Akka.Hosting: " + string.Join(", ", offenders));
    }

    [Fact]
    public void Repository_Has_Only_Authoritative_Solution_File()
    {
        Assert.True(File.Exists(Path.Combine(RepoRoot, "Aven.sln")), "Aven.sln must exist.");
        Assert.False(File.Exists(Path.Combine(RepoRoot, "Aven.slnx")), "Aven.slnx must be removed.");
        Assert.False(File.Exists(Path.Combine(RepoRoot, "AkkaAgent2.sln")), "AkkaAgent2.sln must be removed.");
    }

    [Fact]
    public void Source_And_Test_Project_Directories_Have_Readme_Files()
    {
        var offenders = EnumerateProjectFiles(SrcRoot)
            .Concat(EnumerateProjectFiles(TestsRoot))
            .Concat(EnumerateProjectFiles(ToolkitSrcRoot))
            .Concat(EnumerateProjectFiles(ToolkitTestsRoot))
            .Select(Path.GetDirectoryName)
            .Where(static directory => !string.IsNullOrWhiteSpace(directory))
            .Select(static directory => directory!)
            .Distinct(StringComparer.Ordinal)
            .Where(directory => !File.Exists(Path.Combine(directory, "README.md")))
            .Select(Relative)
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Project directories missing README.md: " + string.Join(", ", offenders));
    }

    [Fact]
    public void Solution_Trees_Have_Readme_Files()
    {
        var required = new[]
        {
            Path.Combine(SrcRoot, "README.md"),
            Path.Combine(TestsRoot, "README.md"),
            Path.Combine(ToolkitSrcRoot, "README.md"),
            Path.Combine(ToolkitTestsRoot, "README.md"),
            Path.Combine(ToolsRoot, "README.md")
        };

        var offenders = required
            .Where(path => !File.Exists(path))
            .Select(Relative)
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Solution tree README files missing: " + string.Join(", ", offenders));
    }

    [Fact]
    public void Required_Architecture_Documents_Exist()
    {
        var required = new[]
        {
            Path.Combine(RepoRoot, "Docs", "ARCHITECTURE_MODULE_MAP.md"),
            Path.Combine(RepoRoot, "Docs", "ASSEMBLY_INDEX.md"),
            Path.Combine(RepoRoot, "Docs", "SERVICE_AND_PORT_CLASSIFICATION.md"),
            Path.Combine(RepoRoot, "docs", "skills.md"),
            Path.Combine(RepoRoot, "docs", "adding-resource-operation.md")
        };

        var offenders = required
            .Where(path => !File.Exists(path))
            .Select(Relative)
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Required architecture documents missing: " + string.Join(", ", offenders));
    }

    [Fact]
    public void Source_And_Tests_DoNotContain_UnicodeEscapeSequences()
    {
        var offenders = EnumerateCodeFiles(SrcRoot)
            .Concat(EnumerateCodeFiles(TestsRoot))
            .Concat(EnumerateCodeFiles(ToolkitSrcRoot))
            .Concat(EnumerateCodeFiles(ToolkitTestsRoot))
            .Select(path => (path, content: File.ReadAllText(path)))
            .Where(x => Regex.IsMatch(x.content, @"\\u[0-9A-Fa-f]{4}", RegexOptions.CultureInvariant))
            .Select(x => Relative(x.path))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Source/tests contain Unicode escape sequences: " + string.Join(", ", offenders));
    }

    [Fact]
    public void ProductionSource_DoesNotContain_FakeNamedTypes()
    {
        var offenders = EnumerateCodeFiles(SrcRoot)
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .SelectMany(x => Regex.Matches(x.content, @"\b(?:class|record|interface|enum)\s+(Fake\w+)\b")
                .Cast<Match>()
                .Select(match => $"{Relative(x.path)}:{match.Groups[1].Value}"))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Production source must not contain Fake* type declarations: " + string.Join(", ", offenders));
    }

    [Fact]
    public void Repository_DoesNotContain_Stale_RoleAgentContractPaths_Or_ServiceFolders()
    {
        var repoEntries = Directory
            .EnumerateFileSystemEntries(RepoRoot, "*", SearchOption.AllDirectories)
            .Select(Relative)
            .ToHashSet(StringComparer.Ordinal);

        var offenders = BannedStalePathEntries
            .Where(repoEntries.Contains)
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Stale file/folder paths remain in repository: " + string.Join(", ", offenders));
    }

    [Fact]
    public void Source_And_Tests_DoNotReference_Banned_ServiceNamespaces()
    {
        var offenders = EnumerateCodeFiles(SrcRoot)
            .Concat(EnumerateCodeFiles(TestsRoot))
            .Where(path => !path.EndsWith("Aven/tests/Aven.Tests.ActorKernel/Phase30EventResetArchitectureTests.cs", StringComparison.Ordinal))
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .SelectMany(x => BannedNamespaceReferences
                .Where(banned => x.content.Contains(banned, StringComparison.Ordinal))
                .Select(banned => $"{Relative(x.path)}:{banned}"))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Banned service namespace references remain in source/tests: " + string.Join(", ", offenders));
    }

    [Fact]
    public void Source_And_Tests_DoNotDeclare_ServicesNamespaces()
    {
        var namespacePattern = BuildServicesNamespaceDeclarationPattern();
        var offenders = EnumerateCodeFiles(SrcRoot)
            .Concat(EnumerateCodeFiles(TestsRoot))
            .Concat(EnumerateCodeFiles(ToolkitSrcRoot))
            .Concat(EnumerateCodeFiles(ToolkitTestsRoot))
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .SelectMany(x => Regex.Matches(x.content, namespacePattern, RegexOptions.Multiline | RegexOptions.CultureInvariant)
                .Cast<Match>()
                .Select(match => $"{Relative(x.path)}:{match.Groups[1].Value}"))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Source/tests must not declare .Services namespaces: " + string.Join(", ", offenders));
    }

    [Fact]
    public void ProductionSource_ServiceSuffix_Is_Reserved_For_Trace_Query_ReadSide()
    {
        var allowed = new HashSet<string>(StringComparer.Ordinal)
        {
            "ITraceQueryService",
            "TraceQueryService"
        };

        var offenders = FindSourceFiles()
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .SelectMany(x => Regex.Matches(x.content, @"\b(?:class|interface|record)\s+(I?\w*Service)\b")
                .Cast<Match>()
                .Select(match => (path: Relative(x.path), name: match.Groups[1].Value)))
            .Where(x => !allowed.Contains(x.name))
            .Select(x => $"{x.path}:{x.name}")
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Production source must use Actor/Client/Adapter/Provider naming instead of Service: " + string.Join(", ", offenders));
    }

    [Fact]
    public void DocsReadme_DoesNot_List_Removed_Modules_As_Active()
    {
        var docsReadmePath = Path.Combine(RepoRoot, "Docs", "README.md");
        Assert.True(File.Exists(docsReadmePath), "Docs/README.md must exist.");

        var docsReadme = File.ReadAllText(docsReadmePath);
        var authoritativeStart = docsReadme.IndexOf("## Current authoritative docs", StringComparison.Ordinal);
        var authoritativeEnd = docsReadme.IndexOf("Current-repo facts to keep in mind while reading older material:", StringComparison.Ordinal);
        Assert.True(authoritativeStart >= 0 && authoritativeEnd > authoritativeStart, "Docs/README.md must contain a bounded current authoritative docs list.");

        var authoritativeSection = docsReadme[authoritativeStart..authoritativeEnd];
        var offenders = new[]
            {
                "Aven.AppHost",
                "Aven.Protocols",
                "Aven.Inspection",
                "/api/inspection",
                "scenario-runner"
            }
            .Where(pattern => authoritativeSection.Contains(pattern, StringComparison.Ordinal))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Docs/README.md lists removed modules or proof paths as active in the authoritative docs section: " + string.Join(", ", offenders));
    }

    [Fact]
    public void RoleFacing_Source_DoesNot_Expose_BlobRef_Or_StorageRef()
    {
        var roots = new[]
        {
            RolesRoot,
            RolesContractsRoot,
            RoleAgentsRoot,
            RoleAgentsContractsRoot
        };

        var offenders = roots
            .Where(Directory.Exists)
            .SelectMany(EnumerateCodeFiles)
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .Where(x => Regex.IsMatch(x.content, @"\bBlobRef\b|\bstorageRef\b", RegexOptions.CultureInvariant))
            .Select(x => Relative(x.path))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Role-facing source must not expose BlobRef or storageRef: " + string.Join(", ", offenders));
    }

    [Fact]
    public void ProductionSource_DoesNot_Use_PathGetTempPath_For_Runtime_Code()
    {
        var offenders = FindSourceFiles()
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .Where(x => x.content.Contains("Path.GetTempPath()", StringComparison.Ordinal))
            .Select(x => Relative(x.path))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Production source must not use Path.GetTempPath() in runtime code: " + string.Join(", ", offenders));
    }

    [Fact]
    public void ArtifactContracts_DoNot_Retain_Legacy_Dto_Families()
    {
        var banned = new[]
        {
            "Aven/src/Resources/Artifacts/Aven.Resources.Artifacts.Contracts/Abstractions/ArtifactWriteReply.cs",
            "Aven/src/Resources/Artifacts/Aven.Resources.Artifacts.Contracts/Abstractions/ArtifactWriteRequest.cs",
            "Aven/src/Resources/Artifacts/Aven.Resources.Artifacts.Contracts/Commands/ArtifactInspect.cs",
            "Aven/src/Resources/Artifacts/Aven.Resources.Artifacts.Contracts/Events/ArtifactRevisionRecorded.cs",
            "Aven/src/Resources/Artifacts/Aven.Resources.Artifacts.Contracts/Models/ArtifactAppendRevision.cs",
            "Aven/src/Resources/Artifacts/Aven.Resources.Artifacts.Contracts/Models/ArtifactCreate.cs",
            "Aven/src/Resources/Artifacts/Aven.Resources.Artifacts.Contracts/Models/ArtifactRevision.cs",
            "Aven/src/Resources/Artifacts/Aven.Resources.Artifacts.Contracts/Models/ArtifactWriteReceipt.cs",
            "Aven/src/Resources/Artifacts/Aven.Resources.Artifacts.Contracts/Models/StoredArtifactBlob.cs",
            "Aven/src/Resources/Artifacts/Aven.Resources.Artifacts.Contracts/Responses/ArtifactWriteConflict.cs",
            "Aven/src/Resources/Artifacts/Aven.Resources.Artifacts.Contracts/Responses/ArtifactWriteRejected.cs",
            "Aven/src/Resources/Artifacts/Aven.Resources.Artifacts.Contracts/Responses/ArtifactWriteSucceeded.cs",
            "Aven/src/Resources/Artifacts/Aven.Resources.Artifacts.Contracts/State/ArtifactState.cs"
        };

        var offenders = banned
            .Where(path => File.Exists(Path.Combine(RepoRoot, path)))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Legacy artifact DTO families remain on disk: " + string.Join(", ", offenders));
    }

    [Fact]
    public void Documentation_Explains_ArtifactRef_BlobRef_And_Query_Semantics()
    {
        var protocolsPath = Path.Combine(RepoRoot, "docs", "04-protocols-and-contracts.md");
        Assert.True(File.Exists(protocolsPath), "docs/04-protocols-and-contracts.md must exist.");

        var content = File.ReadAllText(protocolsPath);
        var required = new[]
        {
            "ArtifactRef",
            "BlobRef",
            "artifact query",
            "metadata query"
        };

        var missing = required
            .Where(token => !content.Contains(token, StringComparison.OrdinalIgnoreCase))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(missing.Length == 0, "Artifact substrate/query semantics are missing from docs/04-protocols-and-contracts.md: " + string.Join(", ", missing));
    }

    [Fact]
    public void Solution_DoesNot_List_Removed_Projects()
    {
        var solution = File.ReadAllText(Path.Combine(RepoRoot, "Aven.sln"));
        var removedProjectNames = new[]
        {
            "Aven.Protocols",
            "Aven.Inspection",
            "Aven.AppHost",
            "Aven.Providers",
            "Aven.Operations",
            "Aven.Terminal",
            "Aven.Workers",
            "Aven.Planning",
            "Aven.Tests.Providers",
            "Aven.Tests.Operations"
        };

        var offenders = removedProjectNames.Where(solution.Contains).ToArray();
        Assert.True(offenders.Length == 0, "Removed projects remain in Aven.sln: " + string.Join(", ", offenders));
    }

    [Fact]
    public void LegacyProtocols_Project_And_SourceTree_AreAbsent()
    {
        var protocolsRoot = Path.Combine(SrcRoot, "Aven.Protocols");
        Assert.False(Directory.Exists(protocolsRoot), "Aven/src/Aven.Protocols must not exist after the contracts split.");
        Assert.False(File.Exists(Path.Combine(protocolsRoot, "Aven.Protocols.csproj")), "Aven.Protocols.csproj must not exist after the contracts split.");
    }

    [Fact]
    public void ProductionSource_DoesNotReference_LegacyProtocolsNamespace()
    {
        var offenders = FindSourceFiles()
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .Where(x => Regex.IsMatch(x.content, @"\bAven\.Protocols\b"))
            .Select(x => Relative(x.path))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Production source still references Aven.Protocols: " + string.Join(", ", offenders));
    }

    [Fact]
    public void ContractProjects_DoNotReference_ImplementationProjects_Or_Akka()
    {
        var offenders = Directory
            .EnumerateFiles(SrcRoot, "*.Contracts.csproj", SearchOption.AllDirectories)
            .SelectMany(ValidateContractProject)
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Contract project dependency violations: " + string.Join(", ", offenders));
    }

    [Fact]
    public void ToolkitProjects_DoNotReference_RuntimeProjects_Or_Akka()
    {
        var offenders = Directory
            .EnumerateFiles(ToolkitSrcRoot, "Aven.Toolkit.*.csproj", SearchOption.AllDirectories)
            .SelectMany(ValidateToolkitProject)
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Toolkit project dependency violations: " + string.Join(", ", offenders));
    }

    [Fact]
    public void ToolkitTests_DoNotReference_RuntimeProjects_Or_Akka()
    {
        var offenders = Directory
            .EnumerateFiles(ToolkitTestsRoot, "Aven.Toolkit.*.csproj", SearchOption.AllDirectories)
            .SelectMany(ValidateToolkitTestProject)
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Toolkit test project dependency violations: " + string.Join(", ", offenders));
    }

    [Fact]
    public void RuntimeProjects_MayReference_Toolkit_But_Toolkit_Must_Not_Reference_Runtime()
    {
        var toolkitProjectNames = EnumerateProjectFiles(ToolkitSrcRoot)
            .Where(path => Path.GetFileNameWithoutExtension(path).StartsWith("Aven.Toolkit.", StringComparison.Ordinal))
            .Select(path => Path.GetFileNameWithoutExtension(path))
            .ToHashSet(StringComparer.Ordinal);

        var runtimeProjectNames = EnumerateProjectFiles(SrcRoot)
            .Where(path => !Path.GetFileNameWithoutExtension(path).StartsWith("Aven.Toolkit.", StringComparison.Ordinal))
            .Select(path => Path.GetFileNameWithoutExtension(path))
            .ToHashSet(StringComparer.Ordinal);

        var offenders = EnumerateProjectFiles(ToolkitSrcRoot)
            .Where(path => Path.GetFileNameWithoutExtension(path).StartsWith("Aven.Toolkit.", StringComparison.Ordinal))
            .SelectMany(path => ValidateToolkitDirection(path, runtimeProjectNames, toolkitProjectNames))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Toolkit/runtime dependency direction violations: " + string.Join(", ", offenders));
    }

    [Fact]
    public void Canonical_Core_Primitives_Do_Not_Have_Duplicate_Runtime_Implementations()
    {
        var exceptions = new HashSet<string>(StringComparer.Ordinal)
        {
            "Aven/src/Aven.Contracts/TypeForwards.cs:SchemaRef",
            "Aven/src/Aven.Contracts/TypeForwards.cs:OperationError",
            "Aven/src/Aven.Contracts/TypeForwards.cs:OperationValue"
        };

        var offenders = FindDuplicatePrimitiveDeclarations(
                ("ArtifactId", 1),
                ("ArtifactRevisionId", 1),
                ("CapabilityId", 1),
                ("CommandId", 1),
                ("CorrelationId", 1),
                ("DeliveryId", 1),
                ("LlmRequestId", 1),
                ("MessageId", 1),
                ("PromptId", 1),
                ("ProviderFileKey", 1),
                ("RequestId", 1),
                ("ReservationId", 1),
                ("RoleAgentId", 1),
                ("RoutingAttemptId", 1),
                ("SchemaRef", 1),
                ("OperationError", 1),
                ("OperationValue", 1),
                ("ArtifactRef", 1),
                ("BlobRef", 1),
                ("CapabilityConstraints", 1),
                ("LlmInputBlock", 1),
                ("LlmBlockKind", 1),
                ("TextInputBlock", 1),
                ("JsonInputBlock", 1),
                ("ToolDefinitionInputBlock", 1),
                ("ToolResultInputBlock", 1),
                ("ArtifactInputBlock", 1),
                ("ProviderFileInputBlock", 1),
                ("LlmInputBlockSummary", 1),
                ("LlmModelCapabilities", 1),
                ("ArtifactSourceDescriptor", 1),
                ("LlmToolCall", 1),
                ("LlmProviderDegradation", 1),
                ("LlmUsage", 1),
                ("TraceSubjectDto", 1),
                ("TraceLinkDto", 1),
                ("TraceInvariantDto", 1),
                ("TraceTimelineItemDto", 1),
                ("TraceTimelineResult", 1),
                ("TraceQueryOptions", 1),
                ("TraceStuckQueryOptions", 1),
                ("TraceProjectionOptions", 1),
                ("TraceProjectionHealth", 1),
                ("TraceEntityRefDto", 1),
                ("TraceEntityDetail", 1),
                ("ITraceQueryService", 1))
            .Where(offender => !exceptions.Contains(offender.Location))
            .OrderBy(static offender => offender.Name, StringComparer.Ordinal)
            .ThenBy(static offender => offender.Location, StringComparer.Ordinal)
            .ToArray();

        Assert.True(
            offenders.Length == 0,
            "Duplicate canonical primitive declarations remain: " + string.Join(", ", offenders.Select(static x => $"{x.Name}@{x.Location}")));
    }

    [Fact]
    public void Production_Llm_Request_Dtos_Do_Not_Expose_InMemory_Response_Planning_Types()
    {
        var requestFiles = new[]
        {
            "Aven/src/Resources/Llm/Aven.Resources.Llm.Contracts/Models/LlmRequest.cs",
            "Aven/src/Resources/Llm/Aven.Resources.Llm.Contracts/Models/LlmExtractionRequest.cs"
        };

        var bannedTypes = new[]
        {
            "InMemoryLlmResponsePlan",
            "InMemoryLlmScenarioKind"
        };

        var offenders = requestFiles
            .Select(path => (path, content: StripComments(File.ReadAllText(Path.Combine(RepoRoot, path)))))
            .SelectMany(x => bannedTypes
                .Where(typeName => Regex.IsMatch(x.content, $@"\b{Regex.Escape(typeName)}\b", RegexOptions.CultureInvariant))
                .Select(typeName => $"{x.path}:{typeName}"))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(
            offenders.Length == 0,
            "Production LLM request DTOs must not expose in-memory response planning types: " + string.Join(", ", offenders));
    }

    [Fact]
    public void Removed_Source_Projects_Are_Not_Present_As_Active_Project_Directories()
    {
        var removedProjects = new[]
        {
            "Aven.Protocols",
            "Aven.Inspection",
            "Aven.AppHost",
            "Aven.Providers",
            "Aven.Operations",
            "Aven.Terminal",
            "Aven.Workers",
            "Aven.Planning"
        };

        var offenders = removedProjects
            .SelectMany(projectName => new[]
            {
                Path.Combine(SrcRoot, projectName),
                Path.Combine(SrcRoot, projectName, projectName + ".csproj")
            })
            .Where(path => Directory.Exists(path) || File.Exists(path))
            .Select(Relative)
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Removed source projects remain present on disk: " + string.Join(", ", offenders));
    }

    [Fact]
    public void ProductionSource_Only_DurableDeliveryFactory_Constructs_DurableDeliveryActor()
    {
        var allowed = "Aven/src/Delivery/Aven.DurableDelivery/DurableDeliveryFactory.cs";
        var offenders = FindSourceFiles()
            .Select(path => (relative: Relative(path), content: StripComments(File.ReadAllText(path))))
            .Where(x => Regex.IsMatch(x.content, @"\bnew\s+DurableDeliveryActor\s*\("))
            .Where(x => x.relative != allowed)
            .Select(x => x.relative)
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Only DurableDeliveryFactory may construct DurableDeliveryActor in production: " + string.Join(", ", offenders));
        Assert.True(File.ReadAllText(Path.Combine(RepoRoot, allowed)).Contains("new DurableDeliveryActor(", StringComparison.Ordinal), "DurableDeliveryFactory must remain the construction rail for DurableDeliveryActor.");
    }

    [Fact]
    public void ProductionSource_DoesNotUse_WaitStyleDeliveryCompletionApis()
    {
        var bannedPatterns = new Dictionary<string, string>
        {
            ["DeliveryAwaitTerminal"] = @"\bDeliveryAwaitTerminal\b",
            ["Ask<DeliveryState>"] = @"Ask\s*<\s*DeliveryState\s*>",
            ["PipeTo"] = @"\bPipeTo\s*\("
        };

        var offenders = FindSourceFiles()
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .SelectMany(x => bannedPatterns
                .Where(pattern => Regex.IsMatch(x.content, pattern.Value))
                .Select(pattern => $"{Relative(x.path)}:{pattern.Key}"))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Production source still contains wait-style delivery completion APIs: " + string.Join(", ", offenders));
    }

    [Fact]
    public void CommittedWorkItem_DeliverySemantics_Are_Wired_EndToEnd()
    {
        var intakeActor = File.ReadAllText(Path.Combine(SrcRoot, "WorkIntake", "Aven.WorkIntake", "Actors", "WorkOfferActor.cs"));
        Assert.Contains("WorkIntakeDeliveryPlanner.CreatePlan(", intakeActor, StringComparison.Ordinal);
        Assert.Contains("StartOrResume(", intakeActor, StringComparison.Ordinal);
        Assert.DoesNotContain("OperationResolved", StripComments(intakeActor), StringComparison.Ordinal);

        var agentActor = File.ReadAllText(Path.Combine(SrcRoot, "Agent", "Aven.RoleAgents", "RoleAgentActor.cs"));
        Assert.Contains("case CommittedWorkItem.MessageType:", agentActor, StringComparison.Ordinal);
        Assert.Contains("HandleCommittedInputOffer(offer, replyTo);", agentActor, StringComparison.Ordinal);
        Assert.Contains("unsupported_agent_delivery_message", agentActor, StringComparison.Ordinal);
    }

    [Fact]
    public void RoleAgentState_Remains_Bounded_Hot_State_Only()
    {
        var stateType = typeof(RoleAgentState);
        var properties = stateType.GetProperties(BindingFlags.Instance | BindingFlags.Public);

        Assert.Contains(properties, x => x.Name == nameof(RoleAgentState.OpenWorkItems) && x.PropertyType == typeof(IReadOnlyDictionary<WorkItemId, OpenWorkItemState>));
        Assert.Contains(properties, x => x.Name == nameof(RoleAgentState.ActiveRuns) && x.PropertyType == typeof(IReadOnlyDictionary<WorkItemId, ActiveRunState>));
        Assert.Contains(properties, x => x.Name == nameof(RoleAgentState.PendingOperations) && x.PropertyType == typeof(IReadOnlyDictionary<OperationId, PendingOperationState>));

        var offenders = properties
            .Where(x => x.PropertyType == typeof(IReadOnlyList<RunSnapshot>)
                || x.PropertyType == typeof(IReadOnlyList<OperationSnapshot>)
                || x.PropertyType == typeof(List<RunSnapshot>)
                || x.PropertyType == typeof(List<OperationSnapshot>)
                || x.Name.Contains("History", StringComparison.Ordinal)
                || x.Name.Contains("Snapshot", StringComparison.Ordinal))
            .Select(x => x.Name)
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "RoleAgentState must remain bounded hot state only. Offenders: " + string.Join(", ", offenders));
    }

    [Fact]
    public void RoleBehavior_PublicModelShape_Uses_Unambiguous_Operation_Semantics()
    {
        var contextProperties = typeof(RoleBehaviorContext).GetProperties(BindingFlags.Instance | BindingFlags.Public);
        var resultProperties = typeof(RoleBehaviorResult).GetProperties(BindingFlags.Instance | BindingFlags.Public);

        Assert.Contains(contextProperties, x => x.Name == "OutstandingOperations" && x.PropertyType == typeof(IReadOnlyList<RoleOperation>));
        Assert.DoesNotContain(contextProperties, x => x.Name == "PendingOperations");

        Assert.Contains(resultProperties, x => x.Name == "OperationsToRequest" && x.PropertyType == typeof(IReadOnlyList<RoleOperation>));
        Assert.DoesNotContain(resultProperties, x => x.Name == "PendingOperations");
    }

    [Fact]
    public void Ledger_ReadSide_Uses_Bounded_Default_And_Max_Limits()
    {
        var ledgerStore = File.ReadAllText(Path.Combine(SrcRoot, "Agent", "Aven.RoleAgents", "RoleAgentLedgerStore.cs"));

        Assert.Contains("private const int DefaultLimit = 50;", ledgerStore, StringComparison.Ordinal);
        Assert.Contains("private const int MaxLimit = 200;", ledgerStore, StringComparison.Ordinal);
        Assert.Contains("Math.Clamp(limit ?? DefaultLimit, 1, MaxLimit)", ledgerStore, StringComparison.Ordinal);
    }

    [Fact]
    public void Ledger_Query_Endpoints_Are_Exposed_As_ReadSide_APIs()
    {
        var program = File.ReadAllText(Path.Combine(ApiRoot, "Program.cs"));
        Assert.Contains("/api/role-agents/{roleAgentId}/work-items", program, StringComparison.Ordinal);
        Assert.Contains("/api/role-agents/{roleAgentId}/runs", program, StringComparison.Ordinal);
        Assert.Contains("/api/role-agents/{roleAgentId}/operations", program, StringComparison.Ordinal);

        var runtime = File.ReadAllText(Path.Combine(ApiRoot, "Runtime", "RuntimeCompositionRoot.cs"));
        Assert.Contains("_roleAgentLedgerStore.ListWorkItemsAsync", runtime, StringComparison.Ordinal);
        Assert.Contains("_roleAgentLedgerStore.ListRunsAsync", runtime, StringComparison.Ordinal);
        Assert.Contains("_roleAgentLedgerStore.ListOperationsAsync", runtime, StringComparison.Ordinal);
    }

    [Fact]
    public void RoleAgent_Ledger_Contracts_Preserve_OperationKey_Idempotency_Seam()
    {
        Assert.NotNull(typeof(PendingOperationState).GetProperty(nameof(PendingOperationState.OperationKey)));
        Assert.NotNull(typeof(OperationRequested).GetProperty(nameof(OperationRequested.OperationKey)));

        var roleAgentActor = File.ReadAllText(Path.Combine(SrcRoot, "Agent", "Aven.RoleAgents", "RoleAgentActor.cs"));
        Assert.Contains("pendingOperation.OperationKey", roleAgentActor, StringComparison.Ordinal);
        Assert.Contains("new OperationKey(_selfAddress, new RequestId(operation.RequestId), operation.TargetOperationType)", roleAgentActor, StringComparison.Ordinal);
    }


    [Fact]
    public void AccountingDocumentClassification_DoesNotUseLanguageKeywordMatching()
    {
        var classifierPath = Path.Combine(RolesRoot, "Accounting", "Extraction", "AccountingDocumentClassifier.cs");
        var promptPath = Path.Combine(RolesRoot, "Accounting", "Extraction", "AccountingExtractionPrompts.cs");
        var classifier = StripComments(File.ReadAllText(classifierPath));
        var prompt = StripComments(File.ReadAllText(promptPath));

        var bannedClassifierFragments = new[]
        {
            "StatementKeywords",
            "InvoiceKeywords",
            "ContainsAny(",
            "kontoauszug",
            "rechnung",
            "factura",
            "invoice pdf from vendor",
            "bank statement"
        };

        var offenders = bannedClassifierFragments
            .Where(fragment => classifier.Contains(fragment, StringComparison.OrdinalIgnoreCase))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Accounting document classification must be explicit-schema or LLM semantics, not language keyword matching: " + string.Join(", ", offenders));
        Assert.Contains("ClassifyDeterministically", classifier, StringComparison.Ordinal);
        Assert.Contains("RequiredSchemas", classifier, StringComparison.Ordinal);
        Assert.Contains("classify by document semantics", prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("any language supported by the model", prompt, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void AccountingSchemas_DoNotRegister_LegacyAccountingV1Schemas()
    {
        var refsSource = File.ReadAllText(Path.Combine(RolesRoot, "Accounting", "Schemas", "AccountingSchemaRefs.cs"));
        var catalogSource = File.ReadAllText(Path.Combine(RolesRoot, "Accounting", "Schemas", "AccountingSchemaCatalog.cs"));
        var roleCatalog = File.ReadAllText(Path.Combine(RolesRoot, "Catalogs", "BuiltInRoleDefinitionCatalog.cs"));
        var classifier = File.ReadAllText(Path.Combine(RolesRoot, "Accounting", "Extraction", "AccountingDocumentClassifier.cs"));

        Assert.DoesNotContain("InvoiceV1", refsSource, StringComparison.Ordinal);
        Assert.DoesNotContain("AccountStatementV1", refsSource, StringComparison.Ordinal);
        Assert.DoesNotContain("TransactionV1", refsSource, StringComparison.Ordinal);
        Assert.DoesNotContain("PaymentMatchV1", refsSource, StringComparison.Ordinal);
        Assert.DoesNotContain("LedgerV1", refsSource, StringComparison.Ordinal);
        Assert.DoesNotContain("Legacy", catalogSource, StringComparison.Ordinal);
        Assert.DoesNotContain("@1", roleCatalog, StringComparison.Ordinal);
        Assert.DoesNotContain("AccountStatementV1", classifier, StringComparison.Ordinal);
        Assert.DoesNotContain("InvoiceV1", classifier, StringComparison.Ordinal);
    }

    [Fact]
    public void ResourceGateways_DoNotPerformDangerousOrParallelWorkInline()
    {
        var gatewayFiles = EnumerateResourceGatewayActorFiles()
            .OrderBy(static x => x)
            .ToArray();

        var bannedPatterns = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["gateway_start_async"] = @"\bStartAsync\s*\(",
            ["gateway_ask"] = @"\.Ask<",
            ["gateway_llm_extract"] = @"\bExtractAsync\s*\(",
            ["gateway_llm_structured"] = @"\bProcessStructuredAsync\s*\(",
            ["gateway_shell_command_executor"] = @"\bShellCommandExecutor\b",
            ["gateway_artifact_put"] = @"\bPutAsync\s*\(",
            ["gateway_artifact_create"] = @"\bCreateArtifactAsync\s*\(",
            ["gateway_artifact_append"] = @"\bAppendRevisionAsync\s*\(",
            ["gateway_metadata_create"] = @"\bMetadataCreateCommand\b",
            ["gateway_metadata_query"] = @"\bMetadataQueryCommand\b",
            ["gateway_schema_get"] = @"\bSchemaGet\b",
            ["gateway_schema_validate"] = @"\bSchemaValidate\b"
        };

        var offenders = gatewayFiles
            .Select(path => (relative: Relative(path), content: StripComments(File.ReadAllText(path))))
            .SelectMany(x => bannedPatterns
                .Where(pattern => Regex.IsMatch(x.content, pattern.Value, RegexOptions.CultureInvariant))
                .Select(pattern => $"{x.relative}:{pattern.Key}"))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Gateways must authorize/record/dispatch only. Dangerous or parallel work belongs in worker actors: " + string.Join(", ", offenders));

        var rail = StripComments(File.ReadAllText(Path.Combine(ResourcesRuntimeRoot, "Gateways", "ResourceGatewayRail.cs")));
        Assert.DoesNotContain("StartAsync(", rail, StringComparison.Ordinal);
    }

    [Fact]
    public void ResourceRuntime_HasExplicitWorkers_ForDangerousAndParallelWork()
    {
        var requiredWorkers = new[]
        {
            "Aven/src/Resources/Artifacts/Aven.Resources.Artifacts/Workers/ArtifactReadWorkerActor.cs",
            "Aven/src/Resources/Artifacts/Aven.Resources.Artifacts/Workers/ArtifactWriteWorkerActor.cs",
            "Aven/src/Resources/Llm/Aven.Resources.Llm/Workers/LlmExtractionWorkerActor.cs",
            "Aven/src/Resources/Llm/Aven.Resources.Llm/Workers/LlmStructuredGenerationWorkerActor.cs",
            "Aven/src/Resources/Metadata/Aven.Resources.Metadata/Workers/MetadataQueryWorkerActor.cs",
            "Aven/src/Resources/Metadata/Aven.Resources.Metadata/Workers/MetadataReadWorkerActor.cs",
            "Aven/src/Resources/Metadata/Aven.Resources.Metadata/Workers/MetadataWriteWorkerActor.cs",
            "Aven/src/Resources/Shell/Aven.Resources.Shell/Workers/ShellExecutionWorkerActor.cs",
            "Aven/src/Scheduling/Aven.Scheduling/Workers/ScheduleCreateWorkerActor.cs",
            "Aven/src/Resources/Human/Aven.Resources.Human/Workers/HumanPromptRegistrationWorkerActor.cs",
            "Aven/src/Resources/Human/Aven.Resources.Human/Workers/HumanTerminalReplyStoreWorkerActor.cs"
        };

        var missing = requiredWorkers
            .Where(relative => !File.Exists(Path.Combine(RepoRoot, relative)))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(missing.Length == 0, "Required resource worker actors missing: " + string.Join(", ", missing));

        var gatewaySource = string.Join(Environment.NewLine, EnumerateResourceGatewayActorFiles().Select(File.ReadAllText));

        foreach (var worker in requiredWorkers.Select(path => Path.GetFileNameWithoutExtension(path)))
        {
            Assert.Contains(worker!, gatewaySource, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void RuntimeCompositionRoot_ReadsArtifactsAndMetadataThroughGateways()
    {
        var runtime = StripComments(File.ReadAllText(Path.Combine(ApiRoot, "Runtime", "RuntimeCompositionRoot.cs")));

        Assert.Contains("GetResourceGatewayActor(ResourceKinds.Artifact)", runtime, StringComparison.Ordinal);
        Assert.Contains("ArtifactGatewayReadCommand", runtime, StringComparison.Ordinal);
        Assert.Contains("ArtifactGatewayQueryCommand", runtime, StringComparison.Ordinal);
        Assert.Contains("GetResourceGatewayActor(ResourceKinds.Metadata)", runtime, StringComparison.Ordinal);
        Assert.Contains("MetadataGatewayQueryCommand", runtime, StringComparison.Ordinal);
        Assert.Contains("MetadataGatewayInspectAllCommand", runtime, StringComparison.Ordinal);

        Assert.DoesNotContain("_artifactStore.GetArtifactAsync", runtime, StringComparison.Ordinal);
        Assert.DoesNotContain("_artifactStore.QueryArtifactsAsync", runtime, StringComparison.Ordinal);
        Assert.DoesNotContain("_metadataActor.Ask<Metadata", runtime, StringComparison.Ordinal);
    }

    [Fact]
    public void ResourceGateways_UseTheSharedRail()
    {
        var adapterFiles = EnumerateResourceGatewayActorFiles()
            .Select(Relative)
            .OrderBy(static x => x)
            .ToArray();

        Assert.NotEmpty(adapterFiles);

        var offenders = adapterFiles
            .Where(relative =>
            {
                var content = StripComments(File.ReadAllText(Path.Combine(RepoRoot, relative)));
                return !content.Contains("ResourceGatewayRail", StringComparison.Ordinal);
            })
            .ToArray();

        Assert.True(offenders.Length == 0, "Resource operation gateways must use ResourceGatewayRail: " + string.Join(", ", offenders));
    }

    [Fact]
    public void DescriptorDrivenResourceAdapters_UseResourceOperationDescriptors()
    {
        var requiredDescriptorAdapters = new[]
        {
            "Aven/src/Resources/Metadata/Aven.Resources.Metadata/Gateways/MetadataGatewayActor.cs",
            "Aven/src/Scheduling/Aven.Scheduling/Gateways/ScheduleGatewayActor.cs",
            "Aven/src/Resources/Artifacts/Aven.Resources.Artifacts/Gateways/ArtifactGatewayActor.cs",
            "Aven/src/Resources/Llm/Aven.Resources.Llm/Gateways/LlmGatewayActor.cs",
            "Aven/src/Resources/Shell/Aven.Resources.Shell/Gateways/ShellGatewayActor.cs"
        };

        var offenders = requiredDescriptorAdapters
            .Select(relative => (relative, content: StripComments(File.ReadAllText(Path.Combine(RepoRoot, relative)))))
            .Where(x => !x.content.Contains("ResourceOperationDescriptor<", StringComparison.Ordinal)
                || !x.content.Contains("PayloadCapabilityId", StringComparison.Ordinal)
                || !Regex.IsMatch(x.content, @"\.TryStart\s*\(", RegexOptions.CultureInvariant))
            .Select(x => x.relative)
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Descriptor-driven resource gateways are missing descriptor wiring: " + string.Join(", ", offenders));
    }

    [Fact]
    public void DescriptorDrivenResourceGateways_UseEnvelopeSenderForOperationKeyIdentity()
    {
        var requiredDescriptorGateways = new[]
        {
            "Aven/src/Resources/Metadata/Aven.Resources.Metadata/Gateways/MetadataGatewayActor.cs",
            "Aven/src/Scheduling/Aven.Scheduling/Gateways/ScheduleGatewayActor.cs",
            "Aven/src/Resources/Artifacts/Aven.Resources.Artifacts/Gateways/ArtifactGatewayActor.cs",
            "Aven/src/Resources/Llm/Aven.Resources.Llm/Gateways/LlmGatewayActor.cs",
            "Aven/src/Resources/Shell/Aven.Resources.Shell/Gateways/ShellGatewayActor.cs"
        };

        var offenders = requiredDescriptorGateways
            .Select(relative => (relative, content: StripComments(File.ReadAllText(Path.Combine(RepoRoot, relative)))))
            .Where(x => !Regex.IsMatch(x.content, @"\(sender,\s*payload\)\s*=>\s*new\s+OperationKey\s*\(\s*sender\s*,", RegexOptions.CultureInvariant))
            .Select(x => x.relative)
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Descriptor-driven resource gateways must derive operation-key caller identity from the envelope sender: " + string.Join(", ", offenders));
    }

    [Fact]
    public void RuntimeCompositionRoot_UsesExplicitResourceGatewayModules()
    {
        var runtime = File.ReadAllText(Path.Combine(ApiRoot, "Runtime", "RuntimeCompositionRoot.cs"));
        var moduleInterface = File.ReadAllText(Path.Combine(ResourcesRuntimeRoot, "Modules", "IAvenResourceModule.cs"));
        Assert.Contains("StartResourceGateways()", runtime, StringComparison.Ordinal);
        Assert.Contains("CreateResourceModules()", runtime, StringComparison.Ordinal);
        Assert.Contains("IReadOnlyList<IAvenResourceModule>", runtime, StringComparison.Ordinal);
        Assert.Contains("new LlmResourceModule", runtime, StringComparison.Ordinal);
        Assert.Contains("new ArtifactResourceModule", runtime, StringComparison.Ordinal);
        Assert.Contains("new MetadataResourceModule", runtime, StringComparison.Ordinal);
        Assert.Contains("new ScheduleResourceModule", runtime, StringComparison.Ordinal);
        Assert.Contains("new HumanResourceModule", runtime, StringComparison.Ordinal);
        Assert.Contains("new ShellResourceModule", runtime, StringComparison.Ordinal);
        Assert.Contains("RecoverResourceOperations()", runtime, StringComparison.Ordinal);
        Assert.Contains("interface IAvenResourceModule", moduleInterface, StringComparison.Ordinal);
        Assert.DoesNotContain("RuntimeResourceRecipientModule", runtime, StringComparison.Ordinal);
    }

    [Fact]
    public void ResourceAddresses_Use_Gateway_Not_For()
    {
        var source = File.ReadAllText(Path.Combine(RepoRoot, "Aven/src/Aven.Contracts/Protocol/ResourceAddresses.cs"));
        Assert.Contains("public static ActorAddress Gateway(string resourceKind)", source, StringComparison.Ordinal);
        Assert.DoesNotContain("public static ActorAddress For(string resourceKind)", source, StringComparison.Ordinal);
    }

    [Fact]
    public void ResourceGateways_Are_Named_As_Gateways_Not_Recipients_Or_Adapters()
    {
        Assert.False(Directory.Exists(Path.Combine(ApiRoot, "Actors", "Recipients")));
        Assert.False(Directory.Exists(Path.Combine(ApiRoot, "Actors", "ResourceGateways")));

        var sourceFiles = EnumerateCodeFiles(ApiRoot)
            .Select(path => (relative: Relative(path), content: File.ReadAllText(path)))
            .ToArray();

        Assert.DoesNotContain(sourceFiles, x => x.relative.EndsWith("OperationAdapterActor.cs", StringComparison.Ordinal));
        Assert.DoesNotContain(sourceFiles, x => x.content.Contains("namespace Aven.Api.Actors.Recipients", StringComparison.Ordinal));
        Assert.DoesNotContain(sourceFiles, x => x.content.Contains("ResourceOperationAdapterRail", StringComparison.Ordinal));
    }

    [Fact]
    public void RoleAgentResourceDispatch_UsesGatewayLanguage_NotDeliveryRecipients()
    {
        var roleAgentSource = File.ReadAllText(Path.Combine(RoleAgentsRoot, "RoleAgentActor.cs"));
        var dispatcherSource = File.ReadAllText(Path.Combine(RoleAgentsRoot, "Runtime", "RoleAgentOperationDispatcher.cs"));

        Assert.DoesNotContain("deliveryRecipients", roleAgentSource, StringComparison.Ordinal);
        Assert.DoesNotContain("_deliveryRecipients", roleAgentSource, StringComparison.Ordinal);
        Assert.Contains("_resourceGateways", roleAgentSource, StringComparison.Ordinal);

        Assert.DoesNotContain("deliveryRecipients", dispatcherSource, StringComparison.Ordinal);
        Assert.DoesNotContain("_deliveryRecipients", dispatcherSource, StringComparison.Ordinal);
        Assert.Contains("resourceGateways", dispatcherSource, StringComparison.Ordinal);
    }

    [Fact]
    public void ResourceGatewayRail_DoesNotContain_StaleAdapterFailureText_AndSingleStartWorkArm()
    {
        var railSource = File.ReadAllText(Path.Combine(ResourcesRuntimeRoot, "Gateways", "ResourceGatewayRail.cs"));

        Assert.DoesNotContain("Adapter work failed", railSource, StringComparison.Ordinal);
        Assert.Equal(
            1,
            Regex.Matches(railSource, @"ExecutionDisposition\.StartWork\s*=>\s*CreateMarkProcessingMessage\(started,\s*startWorkFactory\)", RegexOptions.CultureInvariant).Count);
    }

    [Fact]
    public void ResourceTests_DoNotRetain_Phase11ApiOperationAdapterRailsTests_Name()
    {
        var resourcesTestsRoot = Path.Combine(TestsRoot, "Aven.Tests.Resources");
        var sourceFiles = EnumerateCodeFiles(resourcesTestsRoot)
            .Select(path => (relative: Relative(path), content: File.ReadAllText(path)))
            .ToArray();

        Assert.DoesNotContain(sourceFiles, x => x.relative.EndsWith("Phase11ApiOperationAdapterRailsTests.cs", StringComparison.Ordinal));
        Assert.DoesNotContain(sourceFiles, x => x.content.Contains("Phase11ApiOperationAdapterRailsTests", StringComparison.Ordinal));
        Assert.Contains(sourceFiles, x => x.relative.EndsWith("Phase11ResourceGatewayRailTests.cs", StringComparison.Ordinal));
    }

    [Fact]
    public void RuntimeResourceModules_Expose_Gateway_API()
    {
        var source = File.ReadAllText(Path.Combine(ResourcesRuntimeRoot, "Modules", "IAvenResourceModule.cs"));
        Assert.Contains("GatewayAddress", source, StringComparison.Ordinal);
        Assert.Contains("GatewayActorName", source, StringComparison.Ordinal);
        Assert.Contains("StartGateway", source, StringComparison.Ordinal);
        Assert.DoesNotContain("RecipientAddress", source, StringComparison.Ordinal);
        Assert.DoesNotContain("RecipientActorName", source, StringComparison.Ordinal);
        Assert.DoesNotContain("StartRecipient", source, StringComparison.Ordinal);
    }

    [Fact]
    public void GatewayLayer_Owns_Product_ResourceOperation_CapabilityAdmission()
    {
        var runtime = File.ReadAllText(Path.Combine(ApiRoot, "Runtime", "RuntimeCompositionRoot.cs"));
        var artifactGateway = File.ReadAllText(Path.Combine(ArtifactsRoot, "Gateways", "ArtifactGatewayActor.cs"));
        var scheduleGateway = File.ReadAllText(Path.Combine(SchedulingRoot, "Gateways", "ScheduleGatewayActor.cs"));
        var metadataGateway = File.ReadAllText(Path.Combine(MetadataRoot, "Gateways", "MetadataGatewayActor.cs"));
        var llmGateway = File.ReadAllText(Path.Combine(LlmRoot, "Gateways", "LlmGatewayActor.cs"));
        var metadataStore = File.ReadAllText(Path.Combine(RepoRoot, "Aven/src/Resources/Metadata/Aven.Resources.Metadata/MetadataStoreActor.cs"));
        var llmWorker = File.ReadAllText(Path.Combine(RepoRoot, "Aven/src/Resources/Llm/Aven.Resources.Llm/Actors/LlmRequestWorkerActor.cs"));

        Assert.Contains("StartCapabilityGate", artifactGateway, StringComparison.Ordinal);
        Assert.Contains("StartCapabilityGate", scheduleGateway, StringComparison.Ordinal);
        Assert.Contains("StartCapabilityGate", metadataGateway, StringComparison.Ordinal);
        Assert.Contains("StartCapabilityGate", llmGateway, StringComparison.Ordinal);
        Assert.DoesNotContain("new MetadataStoreActor(\"api/metadata\", ValidateAgainstSchema, _capabilityAuthority)", runtime, StringComparison.Ordinal);
        Assert.DoesNotContain("new LlmExtractionPipeline(_system, llmProvider, _artifactStore, _artifactBlobStore, new LlmInputPreparer(providerFileRegistry), _capabilityAuthority", runtime, StringComparison.Ordinal);
        Assert.DoesNotContain("ICapabilityAdmissionClient", metadataStore, StringComparison.Ordinal);
        Assert.DoesNotContain("CapabilityAdmissionRequest", metadataStore, StringComparison.Ordinal);
        Assert.DoesNotContain("AdmitAsync", metadataStore, StringComparison.Ordinal);
        Assert.DoesNotContain("ICapabilityAdmissionClient", llmWorker, StringComparison.Ordinal);
        Assert.DoesNotContain("CapabilityAdmissionRequest", llmWorker, StringComparison.Ordinal);
        Assert.DoesNotContain("AdmitAsync", llmWorker, StringComparison.Ordinal);
    }

    [Fact]
    public void RuntimeCompositionRoot_UploadArtifact_RoutesThrough_ArtifactGatewayActor()
    {
        var runtime = File.ReadAllText(Path.Combine(ApiRoot, "Runtime", "RuntimeCompositionRoot.cs"));

        Assert.Contains("ArtifactGatewayUploadCommand", runtime, StringComparison.Ordinal);
        Assert.DoesNotContain("_artifactBlobStore.PutAsync", runtime[(runtime.IndexOf("public ArtifactUploadResponse UploadArtifact", StringComparison.Ordinal))..runtime.IndexOf("public AgentInspectionView? InspectAgent", StringComparison.Ordinal)], StringComparison.Ordinal);
        Assert.DoesNotContain("_artifactStore.CreateArtifactAsync", runtime[(runtime.IndexOf("public ArtifactUploadResponse UploadArtifact", StringComparison.Ordinal))..runtime.IndexOf("public AgentInspectionView? InspectAgent", StringComparison.Ordinal)], StringComparison.Ordinal);
    }

    [Fact]
    public void SchemaCatalogOwnership_StaysOutside_ResourcesRuntime_And_ApiSupport()
    {
        var runtimeFiles = EnumerateCodeFiles(ResourcesRuntimeRoot)
            .Select(path => (relative: Relative(path), content: File.ReadAllText(path)))
            .ToArray();
        var apiFiles = EnumerateCodeFiles(ApiRoot)
            .Select(path => (relative: Relative(path), content: File.ReadAllText(path)))
            .ToArray();

        Assert.False(File.Exists(Path.Combine(ResourcesRuntimeRoot, "Support", "ContractCatalog.cs")));
        Assert.False(File.Exists(Path.Combine(ApiRoot, "Support", "ContractCatalog.cs")));
        Assert.DoesNotContain(runtimeFiles, x => x.content.Contains("ContractCatalog", StringComparison.Ordinal));
        Assert.DoesNotContain(apiFiles, x => x.content.Contains("ContractCatalog", StringComparison.Ordinal));
    }

    [Fact]
    public void ResourcesRuntime_DoesNot_Contain_ProductSchemaRefs()
    {
        var runtimeFiles = EnumerateCodeFiles(ResourcesRuntimeRoot)
            .Select(path => (relative: Relative(path), content: File.ReadAllText(path)))
            .ToArray();

        Assert.DoesNotContain(runtimeFiles, x => Regex.IsMatch(x.content, "schema://accounting/|schema://contracts/|schema://research/", RegexOptions.CultureInvariant));
    }

    [Fact]
    public void RuntimeCompositionRoot_RegistersSchemas_From_Role_And_Routing_Schema_Catalogs()
    {
        var runtime = File.ReadAllText(Path.Combine(ApiRoot, "Runtime", "RuntimeCompositionRoot.cs"));
        Assert.Contains("BuiltInRoleSchemaCatalog.All", runtime, StringComparison.Ordinal);
        Assert.Contains("RoutingSchemaCatalog.All", runtime, StringComparison.Ordinal);
        Assert.DoesNotContain("BuiltInSchemaCatalog.All", runtime, StringComparison.Ordinal);
        Assert.DoesNotContain("ContractCatalog.All", runtime, StringComparison.Ordinal);
    }

    [Fact]
    public void LlmWorkers_Use_SchemaRegistryLookup_Not_ContractCatalog()
    {
        var gateway = File.ReadAllText(Path.Combine(LlmRoot, "Gateways", "LlmGatewayActor.cs"));
        var extractionWorker = File.ReadAllText(Path.Combine(LlmRoot, "Workers", "LlmExtractionWorkerActor.cs"));
        var structuredWorker = File.ReadAllText(Path.Combine(LlmRoot, "Workers", "LlmStructuredGenerationWorkerActor.cs"));

        Assert.DoesNotContain("ContractCatalog", gateway, StringComparison.Ordinal);
        Assert.DoesNotContain("ContractCatalog.All.First", gateway, StringComparison.Ordinal);
        Assert.DoesNotContain("new SchemaGet(", gateway, StringComparison.Ordinal);
        Assert.DoesNotContain("new SchemaValidate(", gateway, StringComparison.Ordinal);

        Assert.Contains("new SchemaGet(payload.SchemaRef)", extractionWorker, StringComparison.Ordinal);
        Assert.Contains("SchemaRegistered", extractionWorker, StringComparison.Ordinal);
        Assert.Contains("new SchemaGet(command.SchemaRef)", structuredWorker, StringComparison.Ordinal);
        Assert.Contains("new SchemaValidate(command.SchemaRef, structuredJson)", structuredWorker, StringComparison.Ordinal);
        Assert.Contains("SchemaRegistered", structuredWorker, StringComparison.Ordinal);
        Assert.DoesNotContain("ContractCatalog", extractionWorker, StringComparison.Ordinal);
        Assert.DoesNotContain("ContractCatalog", structuredWorker, StringComparison.Ordinal);
    }

    [Fact]
    public void RoleRouterActor_Uses_RuntimeHelpers_For_PureRoutingLogic()
    {
        var actor = File.ReadAllText(Path.Combine(RoutingRoot, "Actors", "RoleRouterActor.cs"));

        Assert.DoesNotContain("BuildEvents(", actor, StringComparison.Ordinal);
        Assert.DoesNotContain("GetCandidateProfiles(", actor, StringComparison.Ordinal);
        Assert.DoesNotContain("DescribeDecisionKind(", actor, StringComparison.Ordinal);
        Assert.DoesNotContain("DescribeDecisionSummary(", actor, StringComparison.Ordinal);
        Assert.DoesNotContain("BuildResolution(", actor, StringComparison.Ordinal);
        Assert.DoesNotContain("ResolvePersistedResolution(", actor, StringComparison.Ordinal);
        Assert.Contains("private async Task<RouteResolution> EvaluateRouteAsync", actor, StringComparison.Ordinal);
    }

    [Fact]
    public void RoutingRuntimeHelpers_DoNot_Own_ActorApis()
    {
        var runtimeRoot = Path.Combine(RoutingRoot, "Runtime");
        var bannedPatterns = new (string Label, string Pattern)[]
        {
            ("sender", @"\bSender\b"),
            ("self", @"\bSelf\b"),
            ("context", @"\bContext\b"),
            ("persist_event", @"PersistEvent"),
            ("tell", @"\.Tell\s*\("),
            ("actorof", @"\bActorOf\s*\("),
            ("timers", @"\bIWithTimers\b|\bITimerScheduler\b")
        };

        var offenders = EnumerateCodeFiles(runtimeRoot)
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .SelectMany(x => bannedPatterns
                .Where(rule => Regex.IsMatch(x.content, rule.Pattern, RegexOptions.CultureInvariant))
                .Select(rule => $"{Relative(x.path)}:{rule.Label}"))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Routing runtime helpers must not use actor-owned APIs: " + string.Join(", ", offenders));
    }

    [Fact]
    public void RuntimeCompositionRoot_DoesNot_Use_DeliveryRecipients_Name_For_ResourceGateways()
    {
        var runtime = File.ReadAllText(Path.Combine(ApiRoot, "Runtime", "RuntimeCompositionRoot.cs"));
        Assert.DoesNotContain("deliveryRecipients", runtime, StringComparison.Ordinal);
    }


    [Fact]
    public void WorkOfferActor_Uses_RuntimeHelpers_For_PureIntakeLogic()
    {
        var actor = File.ReadAllText(Path.Combine(WorkIntakeRoot, "Actors", "WorkOfferActor.cs"));

        Assert.DoesNotContain("ComputeHash(", actor, StringComparison.Ordinal);
        Assert.DoesNotContain("ComputeHashText(", actor, StringComparison.Ordinal);
        Assert.DoesNotContain("CreateCommittedCommand(", actor, StringComparison.Ordinal);
        Assert.Contains("WorkOfferDefaultDecisionPlanner.Decide(", actor, StringComparison.Ordinal);
        Assert.Contains("StartOrResume(", actor, StringComparison.Ordinal);
    }

    [Fact]
    public void WorkIntakeRuntimeHelpers_DoNot_Own_ActorApis()
    {
        var runtimeRoot = Path.Combine(WorkIntakeRoot, "Runtime");
        var bannedPatterns = new (string Label, string Pattern)[]
        {
            ("sender", @"\bSender\b"),
            ("self", @"\bSelf\b"),
            ("context", @"\bContext\b"),
            ("persist_event", @"PersistEvent"),
            ("tell", @"\.Tell\s*\("),
            ("actorof", @"\bActorOf\s*\("),
            ("start_or_resume", @"StartOrResume\s*\("),
            ("timers", @"\bIWithTimers\b|\bITimerScheduler\b")
        };

        var offenders = EnumerateCodeFiles(runtimeRoot)
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .SelectMany(x => bannedPatterns
                .Where(rule => Regex.IsMatch(x.content, rule.Pattern, RegexOptions.CultureInvariant))
                .Select(rule => $"{Relative(x.path)}:{rule.Label}"))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Work-intake runtime helpers must not use actor-owned APIs: " + string.Join(", ", offenders));
    }

    [Fact]
    public void WorkIntakeHost_And_RuntimeCompositionRoot_Use_AgentAddress_Name()
    {
        var host = File.ReadAllText(Path.Combine(WorkIntakeRoot, "Hosting", "WorkIntakeHost.cs"));
        var runtime = File.ReadAllText(Path.Combine(ApiRoot, "Runtime", "RuntimeCompositionRoot.cs"));

        Assert.DoesNotContain("agentRecipientAddress", host, StringComparison.Ordinal);
        Assert.DoesNotContain("agentRecipientAddress", runtime, StringComparison.Ordinal);
        Assert.Contains("agentAddress", host, StringComparison.Ordinal);
        Assert.Contains("agentAddress:", runtime, StringComparison.Ordinal);
    }

    [Fact]
    public void ArtifactGatewayActor_Handles_ArtifactGatewayUploadCommand()
    {
        var gatewaySource = File.ReadAllText(Path.Combine(ArtifactsRoot, "Gateways", "ArtifactGatewayActor.cs"));

        Assert.Contains("ArtifactGatewayUploadCommand", gatewaySource, StringComparison.Ordinal);
        Assert.Contains("Receive<ArtifactGatewayUploadCommand>", gatewaySource, StringComparison.Ordinal);
        Assert.Contains("ArtifactGatewayUploadSucceeded", gatewaySource, StringComparison.Ordinal);
    }

    [Fact]
    public void ProductionSource_OnlyAllowlistedPaths_Construct_AvenEnvelopes_Directly()
    {
        var allowed = new HashSet<string>(StringComparer.Ordinal)
        {
            "Aven/src/Aven.Contracts/Protocol/Envelopes/AvenEnvelopeBuilder.cs",
            "Aven/src/Delivery/Aven.DurableDelivery/Actors/DurableDeliveryActor.cs"
        };

        var offenders = Directory
            .EnumerateFiles(SrcRoot, "*.cs", SearchOption.AllDirectories)
            .Select(path => Relative(path))
            .Where(relative => !allowed.Contains(relative))
            .Where(relative => Regex.IsMatch(File.ReadAllText(Path.Combine(RepoRoot, relative)), @"new\s+AvenEnvelope<", RegexOptions.CultureInvariant))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Production source must use AvenEnvelopeBuilder except for allowlisted recovery/rehydration paths: " + string.Join(", ", offenders));
    }

    [Fact]
    public void ProductionProjections_DoNotUseUnboundedBuffersWithoutOptions()
    {
        var projectionFiles = new[]
        {
            Path.Combine(TraceRoot, "Actors", "TraceProjectionActor.cs"),
            Path.Combine(SrcRoot, "Agent", "Aven.RoleAgents", "RoleAgentLedgerProjectionActor.cs")
        }
            .Where(File.Exists)
            .ToArray();

        var unboundedPatterns = new[]
        {
            @"new\s+List<",
            @"new\s+Queue<",
            @"ConcurrentQueue<",
            @"Channel\.CreateUnbounded"
        };
        var boundedMarkers = new[] { "MaxBuffered", "MaxPending", "MaxQueue", "ProjectionOptions" };

        var offenders = projectionFiles
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .Where(x => unboundedPatterns.Any(pattern => Regex.IsMatch(x.content, pattern)))
            .Where(x => !boundedMarkers.Any(markerText => x.content.Contains(markerText, StringComparison.Ordinal)))
            .Select(x => Relative(x.path))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Production projections must pair queue/list buffers with explicit bounded options: " + string.Join(", ", offenders));
    }

    [Fact]
    public void ResourceGateways_DoNotHandRollProtocolReplies()
    {
        var adapterFiles = EnumerateResourceGatewayActorFiles()
            .OrderBy(static x => x)
            .ToArray();

        var bannedPatterns = new Dictionary<string, string>
        {
            ["DeliveryAccepted"] = @"\bnew\s+DeliveryAccepted\s*\(",
            ["DeliveryRejected"] = @"\bnew\s+DeliveryRejected\s*\(",
            ["OperationResolved"] = @"\bnew\s+OperationResolved\s*\(",
            ["OperationFailed"] = @"\bnew\s+OperationFailed\s*\("
        };

        var offenders = adapterFiles
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .SelectMany(x => bannedPatterns
                .Where(pattern => Regex.IsMatch(x.content, pattern.Value))
                .Select(pattern => $"{Relative(x.path)}:{pattern.Key}"))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Resource operation gateways must not hand-roll terminal protocol replies: " + string.Join(", ", offenders));

        var railPath = Path.Combine(ResourcesRuntimeRoot, "Gateways", "ResourceGatewayRail.cs");
        var railSource = File.ReadAllText(railPath);
        Assert.Contains("new DeliveryAccepted(", railSource, StringComparison.Ordinal);
        Assert.Contains("new DeliveryRejected(", railSource, StringComparison.Ordinal);
        Assert.Contains("new OperationResolved(", railSource, StringComparison.Ordinal);
        Assert.Contains("new Aven.Contracts.Operations.OperationFailed(", railSource, StringComparison.Ordinal);
    }

    [Fact]
    public void ResourceGateways_DoNotManuallyAcceptDelivery()
    {
        var adapterFiles = EnumerateResourceGatewayActorFiles()
            .OrderBy(static x => x)
            .ToArray();

        var offenders = adapterFiles
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .Where(x => Regex.IsMatch(x.content, @"\bnew\s+DeliveryAccepted\s*\(") || x.content.Contains("AcceptanceKindRecorded", StringComparison.Ordinal))
            .Select(x => Relative(x.path))
            .ToArray();

        Assert.True(offenders.Length == 0, "Resource operation gateways must not manually construct delivery acceptance replies: " + string.Join(", ", offenders));
    }

    [Fact]
    public void ResourceGateways_HaveUniformDeliveryAcceptanceKind()
    {
        var railPath = Path.Combine(ResourcesRuntimeRoot, "Gateways", "ResourceGatewayRail.cs");
        var railSource = File.ReadAllText(railPath);
        Assert.Contains("internal const string AcceptanceKindRecorded = \"resource_operation_recorded\";", railSource, StringComparison.Ordinal);

        var offenders = EnumerateResourceGatewayActorFiles()
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .Where(x => x.content.Contains("artifact_written", StringComparison.Ordinal)
                || x.content.Contains("metadata_written", StringComparison.Ordinal)
                || x.content.Contains("schedule_created", StringComparison.Ordinal)
                || x.content.Contains("human_prompt_registered", StringComparison.Ordinal)
                || x.content.Contains("llm_operation_started", StringComparison.Ordinal))
            .Select(x => Relative(x.path))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Legacy resource acceptance kinds remain in gateways: " + string.Join(", ", offenders));
    }

    [Fact]
    public void ResourceGateways_CannotAcceptWithoutInboxRecord()
    {
        var railPath = Path.Combine(ResourcesRuntimeRoot, "Gateways", "ResourceGatewayRail.cs");
        var railSource = StripComments(File.ReadAllText(railPath));
        Assert.Matches(@"RecordIntentAsync\(started\.InboxRecord\).*Accept\(started\.DeliverySender, started\.Offer, AcceptanceKindRecorded\)", railSource.Replace(Environment.NewLine, " "));
    }

    [Fact]
    public void ResourceGateways_RequireInjectedInboxStore()
    {
        var adapterFiles = EnumerateResourceGatewayActorFiles()
            .OrderBy(static x => x)
            .ToArray();

        var offenders = adapterFiles
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .Where(x => x.content.Contains("CreateFallbackInboxStore", StringComparison.Ordinal)
                || x.content.Contains("Guid.NewGuid():N}.sqlite", StringComparison.Ordinal))
            .Select(x => Relative(x.path))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Resource operation gateways must not create fallback inbox stores: " + string.Join(", ", offenders));

        var missingInjection = adapterFiles
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .Where(x => !x.content.Contains("IResourceOperationInboxStore inboxStore", StringComparison.Ordinal))
            .Select(x => Relative(x.path))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(missingInjection.Length == 0, "Resource operation gateways must require injected inbox stores: " + string.Join(", ", missingInjection));
    }

    [Fact]
    public void ResourceGateways_DoNotIgnoreStoreCommandFailures()
    {
        var adapterFiles = EnumerateResourceGatewayActorFiles()
            .OrderBy(static x => x)
            .ToArray();

        var ignoredPattern = @"StoreCommandFailed>\s*\([^\)]*=>\s*\{\s*\}\s*\)";

        var ignored = adapterFiles
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .Where(x => Regex.IsMatch(x.content, ignoredPattern, RegexOptions.CultureInvariant))
            .Select(x => Relative(x.path))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(ignored.Length == 0, "Resource operation gateways must not ignore StoreCommandFailed messages: " + string.Join(", ", ignored));

        var missingHandler = adapterFiles
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .Where(x => !x.content.Contains("HandleStoreCommandFailed", StringComparison.Ordinal))
            .Select(x => Relative(x.path))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(missingHandler.Length == 0, "Resource operation gateways must route store command failures through HandleStoreCommandFailed: " + string.Join(", ", missingHandler));
    }

    [Fact]
    public void ResourceGateways_RecoverInboxOnPreStart()
    {
        var adapterFiles = EnumerateResourceGatewayActorFiles()
            .OrderBy(static x => x)
            .ToArray();

        var missingPreStartRecovery = adapterFiles
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .Where(x => !x.content.Contains("protected override void PreStart()", StringComparison.Ordinal)
                || !x.content.Contains("RecoverPendingOperations();", StringComparison.Ordinal))
            .Select(x => Relative(x.path))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(missingPreStartRecovery.Length == 0, "Resource operation gateways must recover inbox rows during PreStart: " + string.Join(", ", missingPreStartRecovery));
    }

    [Fact]
    public void ResourceOperationInboxStoreCommandException_Exists()
    {
        var railPath = Path.Combine(ResourcesRuntimeRoot, "Gateways", "ResourceGatewayRail.cs");
        var railSource = File.ReadAllText(railPath);

        Assert.Contains("internal sealed class ResourceOperationInboxStoreCommandException : Exception", railSource, StringComparison.Ordinal);
        Assert.Contains("HandleStoreCommandFailed", railSource, StringComparison.Ordinal);
    }

    [Fact]
    public void ResourceOperationInbox_IsTheOnlyResourceAcceptancePath()
    {
        var supportFiles = Directory
            .EnumerateFiles(Path.Combine(ResourcesRuntimeRoot, "Inbox"), "*.cs", SearchOption.TopDirectoryOnly)
            .OrderBy(static x => x)
            .ToArray();

        var offenders = supportFiles
            .Where(path => !path.EndsWith("ResourceGatewayRail.cs", StringComparison.Ordinal))
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .Where(x => x.content.Contains("resource_operation_recorded", StringComparison.Ordinal) || Regex.IsMatch(x.content, @"\bnew\s+DeliveryAccepted\s*\("))
            .Select(x => Relative(x.path))
            .ToArray();

        Assert.True(offenders.Length == 0, "Only ResourceGatewayRail should define resource delivery acceptance semantics: " + string.Join(", ", offenders));
    }

    [Fact]
    public void PublicTopLevelType_FileNames_Match_WhenSinglePublicTypeIsDeclared()
    {
        var allowedFileNames = new HashSet<string>(StringComparer.Ordinal)
        {
            "GlobalUsings.cs",
            "AssemblyInfo.cs"
        };

        var offenders = EnumerateCodeFiles(SrcRoot)
            .Where(path => !allowedFileNames.Contains(Path.GetFileName(path)))
            .Where(path => !path.EndsWith(".g.cs", StringComparison.Ordinal) && !path.EndsWith(".generated.cs", StringComparison.Ordinal))
            .Select(path => (path, publicTypes: Regex.Matches(StripComments(File.ReadAllText(path)), @"^\s*public\s+(?:sealed\s+|abstract\s+|static\s+|partial\s+)*(?:class|record|interface|enum|struct)\s+(\w+)", RegexOptions.Multiline)
                .Cast<Match>()
                .Select(match => match.Groups[1].Value)
                .Distinct(StringComparer.Ordinal)
                .ToArray()))
            .Where(x => x.publicTypes.Length == 1 && !string.Equals(Path.GetFileNameWithoutExtension(x.path), x.publicTypes[0], StringComparison.Ordinal))
            .Select(x => $"{Relative(x.path)}=>{x.publicTypes[0]}")
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Single-public-type files must match the type name: " + string.Join(", ", offenders));
    }

    [Fact]
    public void ContractResultFamilies_LiveTogether_UnderResponses()
    {
        var requiredPaths = new[]
        {
            "Aven/src/Capabilities/Aven.Capabilities.Contracts/Responses/CapabilityAdmitted.cs",
            "Aven/src/Capabilities/Aven.Capabilities.Contracts/Responses/CapabilityRejected.cs",
            "Aven/src/Routing/Aven.Routing.Contracts/Responses/RouteResolution.cs",
            "Aven/src/Routing/Aven.Routing.Contracts/Responses/RouteCommitted.cs",
            "Aven/src/Routing/Aven.Routing.Contracts/Responses/RouteNeedsClarification.cs",
            "Aven/src/Routing/Aven.Routing.Contracts/Responses/RouteRejected.cs",
            "Aven/src/WorkIntake/Aven.WorkIntake.Contracts/Responses/WorkOfferDecision.cs",
            "Aven/src/WorkIntake/Aven.WorkIntake.Contracts/Responses/WorkOfferAcceptedDecision.cs",
            "Aven/src/WorkIntake/Aven.WorkIntake.Contracts/Responses/WorkOfferRejectedDecision.cs",
            "Aven/src/WorkIntake/Aven.WorkIntake.Contracts/Responses/WorkOfferNeedsClarification.cs",
            "Aven/src/Resources/Metadata/Aven.Resources.Metadata.Contracts/Responses/MetadataCreateReply.cs",
            "Aven/src/Resources/Metadata/Aven.Resources.Metadata.Contracts/Responses/MetadataCreateSucceeded.cs",
            "Aven/src/Resources/Metadata/Aven.Resources.Metadata.Contracts/Responses/MetadataCreateConflict.cs",
            "Aven/src/Resources/Metadata/Aven.Resources.Metadata.Contracts/Responses/MetadataCreateRejected.cs"
        };

        var missing = requiredPaths
            .Where(path => !File.Exists(Path.Combine(RepoRoot, path)))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(missing.Length == 0, "Response result families are not co-located under Responses: " + string.Join(", ", missing));
    }

    [Fact]
    public void ContractAbstractions_DoNotContain_PublicResultBaseRecords()
    {
        var offenders = EnumerateCodeFiles(SrcRoot)
            .Where(path => path.Contains("Contracts/Abstractions", StringComparison.Ordinal))
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .Where(x => Regex.IsMatch(x.content, @"^\s*public\s+(?:abstract\s+)?record\s+\w*(Decision|Resolution|Reply)\b", RegexOptions.Multiline))
            .Select(x => Relative(x.path))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Public result-base records remain under Contracts/Abstractions: " + string.Join(", ", offenders));
    }

    [Fact]
    public void OldMisplacedContractPaths_AreGone()
    {
        var oldPaths = new[]
        {
            "Aven/src/Capabilities/Aven.Capabilities.Contracts/Models/CapabilityAdmitted.cs",
            "Aven/src/Routing/Aven.Routing.Contracts/Abstractions/RouteResolution.cs",
            "Aven/src/Routing/Aven.Routing.Contracts/Models/RouteCommitted.cs",
            "Aven/src/Routing/Aven.Routing.Contracts/Models/RouteNeedsClarification.cs",
            "Aven/src/WorkIntake/Aven.WorkIntake.Contracts/Abstractions/WorkOfferDecision.cs",
            "Aven/src/WorkIntake/Aven.WorkIntake.Contracts/Models/WorkOfferNeedsClarification.cs",
            "Aven/src/Resources/Metadata/Aven.Resources.Metadata.Contracts/Abstractions/MetadataCreateReply.cs",
            "Aven/src/Scheduling/Aven.Scheduling.Contracts/Models/CancelSchedule.cs",
            "Aven/src/Scheduling/Aven.Scheduling.Contracts/Models/ScheduleFired.cs",
            "Aven/src/Scheduling/Aven.Scheduling.Contracts/Models/ScheduleSkipped.cs",
            "Aven/src/Scheduling/Aven.Scheduling.Contracts/Models/SchedulePromptRequested.cs",
            "Aven/src/Scheduling/Aven.Scheduling.Contracts/Models/ScheduleDeliveryRequested.cs",
            "Aven/src/Scheduling/Aven.Scheduling.Contracts/Models/ScheduleCancellationAccepted.cs",
            "Aven/src/Delivery/Aven.DurableDelivery.Contracts/Models/DeliveryStart.cs",
            "Aven/src/Delivery/Aven.DurableDelivery.Contracts/Models/DeliveryCancel.cs",
            "Aven/src/Delivery/Aven.DurableDelivery.Contracts/Models/DeliveryAttemptOffer.cs",
            "Aven/src/Delivery/Aven.DurableDelivery.Contracts/Models/DeliveryTerminalSignal.cs",
            "Aven/src/Resources/Human/Aven.Resources.Human.Contracts/Models/HumanPromptTerminalReplyReady.cs",
            "Aven/src/Resources/Human/Aven.Resources.Human.Contracts/Models/HumanPromptTerminalReplyAcknowledged.cs",
            "Aven/src/Agent/Aven.RoleAgents.Contracts/Models/CommittedWorkItem.cs",
            "Aven/src/Agent/Aven.RoleAgents.Contracts/Models/ScheduledWorkTriggered.cs",
            "Aven/src/RoleRegistry/Aven.Roles.Contracts/Commands/RoleAgentRegistryListCommand.cs",
            "Aven/src/RoleRegistry/Aven.Roles.Contracts/Commands/RoleAgentRegistryGetCommand.cs",
            "Aven/src/RoleRegistry/Aven.Roles.Contracts/Commands/RoleAgentRegistryUpsertCommand.cs",
            "Aven/src/RoleRegistry/Aven.Roles.Contracts/Events/RoleAgentProfileRegisteredOrUpdated.cs",
            "Aven/src/WorkIntake/Aven.WorkIntake.Contracts/Commands/CommitWorkClaimCommand.cs",
            "Aven/src/WorkIntake/Aven.WorkIntake/Actors/Messages/WorkStartDeliveryCompleted.cs",
            "Aven/src/WorkIntake/Aven.WorkIntake/Actors/Messages/WorkStartDeliveryFailed.cs"
        };

        var offenders = oldPaths
            .Where(path => File.Exists(Path.Combine(RepoRoot, path)))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Old misplaced contract paths still exist: " + string.Join(", ", offenders));
    }

    [Fact]
    public void RoleRegistryTerminology_DoesNotUse_Directory_Wording()
    {
        var candidates = EnumerateCodeFiles(SrcRoot)
            .Concat(EnumerateCodeFiles(TestsRoot))
            .Concat(Directory.Exists(Path.Combine(RepoRoot, "docs")) ? Directory.EnumerateFiles(Path.Combine(RepoRoot, "docs"), "*.md", SearchOption.AllDirectories) : Array.Empty<string>())
            .Concat(Directory.Exists(Path.Combine(RepoRoot, "Docs")) ? Directory.EnumerateFiles(Path.Combine(RepoRoot, "Docs"), "*.md", SearchOption.AllDirectories).Where(path => !IsArchivedDocPath(path)) : Array.Empty<string>())
            .Where(path => path.Contains("RoleRegistry", StringComparison.Ordinal)
                || path.Contains("RoleAgents.Registry", StringComparison.Ordinal)
                || path.Contains("Aven.Roles.Contracts", StringComparison.Ordinal)
                || path.Contains("Aven.Routing", StringComparison.Ordinal)
                || path.Contains("Aven.Submission", StringComparison.Ordinal)
                || path.Contains("Phase13RoleRegistry", StringComparison.Ordinal)
                || path.Contains("Phase14RoutingTests", StringComparison.Ordinal)
                || path.Contains("Phase16SubmissionInspectionTests", StringComparison.Ordinal)
                || path.Contains("Phase20LlmRoutingTests", StringComparison.Ordinal)
                || path.Contains("Phase31SemanticEventRecoveryAndMetadataTests", StringComparison.Ordinal))
            .Select(path => (path, content: File.ReadAllText(path)))
            .Where(x => Regex.IsMatch(x.content, @"\b(?:directory|Directory)\b|\bActorBackedDirectory_", RegexOptions.CultureInvariant)
                && Regex.IsMatch(x.content, @"role[\s-]?registry|role agent registry|routing|submission", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
            .Select(x => Relative(x.path))
            .Distinct(StringComparer.Ordinal)
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(candidates.Length == 0, "Role registry source/tests/docs still use directory terminology: " + string.Join(", ", candidates));
    }

    [Fact]
    public void ResourceGateways_Use_ProtocolConstants_ForHighValueWireStrings()
    {
        var banned = new (string ConstantName, string Literal)[]
        {
            ("ResourceOperationTypes.LlmGenerate", "\"llm.generate\""),
            ("ResourceOperationTypes.MetadataCreate", "\"metadata.create\""),
            ("ResourceOperationTypes.HumanApprove", "\"human.approve\""),
            ("ResourceOperationTypes.HumanAnswer", "\"human.answer\""),
            ("ResourceOperationTypes.ScheduleCreate", "\"schedule.create\""),
            ("ResourceOperationTypes.ScheduleSkipped", "\"schedule.skipped\""),
            ("ResourceOperationTypes.ArtifactCreate", "\"artifact.create\""),
            ("ResourceOperationTypes.ArtifactAppend", "\"artifact.append\""),
            ("ResourceOperationTypes.RoutingRank", "\"routing.rank\""),
            ("ResourceOperationTypes.ShellExecute", "\"shell.execute\""),
            ("ResourceKinds.Llm", "\"llm\""),
            ("ResourceKinds.Metadata", "\"metadata\""),
            ("ResourceKinds.Artifact", "\"artifact\""),
            ("ResourceKinds.Schedule", "\"schedule\""),
            ("ResourceKinds.Human", "\"human\""),
            ("ResourceKinds.Shell", "\"shell\"")
        };

        var offenders = Directory
            .EnumerateFiles(SrcRoot, "*.cs", SearchOption.AllDirectories)
            .Where(path => !path.EndsWith("ResourceKinds.cs", StringComparison.Ordinal))
            .Where(path => !path.EndsWith("ResourceOperationTypes.cs", StringComparison.Ordinal))
            .Where(path => !path.EndsWith("ResourceAddresses.cs", StringComparison.Ordinal))
            .Where(path => !path.EndsWith("SubmissionMessageTypes.cs", StringComparison.Ordinal))
            .Where(path => !path.Contains("SerializationFixtures", StringComparison.Ordinal))
            .Where(path => !path.Contains("TestFixtures", StringComparison.Ordinal))
            .Where(path => !path.EndsWith("HttpLlmProvider.cs", StringComparison.Ordinal))
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .SelectMany(x => banned.Where(token => x.content.Contains(token.Literal, StringComparison.Ordinal)).Select(token => $"{Relative(x.path)}:{token.ConstantName}:{token.Literal}"))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Production source still contains raw protocol identity literals: " + string.Join(", ", offenders));
    }

    [Fact]
    public void ScheduledRoleInput_NoLonger_Uses_OperationResolved_PublicWireContract()
    {
        var scheduleActor = StripComments(File.ReadAllText(Path.Combine(SchedulingRoot, "Actors", "ScheduledWorkActor.cs")));
        Assert.Contains("new ScheduledWorkTriggered(", scheduleActor, StringComparison.Ordinal);
        Assert.Contains("ScheduledWorkTriggered.MessageType", scheduleActor, StringComparison.Ordinal);
        Assert.DoesNotContain("\"operation.resolved\"", scheduleActor, StringComparison.Ordinal);
        Assert.DoesNotContain("new OperationResolved(", scheduleActor, StringComparison.Ordinal);

        var roleAgentActor = StripComments(File.ReadAllText(Path.Combine(RoleAgentsRoot, "RoleAgentActor.cs")));
        Assert.Contains("case ScheduledWorkTriggered.MessageType:", roleAgentActor, StringComparison.Ordinal);
        Assert.DoesNotContain("case \"operation.resolved\":", roleAgentActor, StringComparison.Ordinal);
    }

    [Fact]
    public void ActiveRailsDocs_DescribeCurrentRails_AndNotRemovedCompatibilityPaths()
    {
        var docPaths = new[]
        {
            Path.Combine(RepoRoot, "docs", "02-architecture.md"),
            Path.Combine(RepoRoot, "docs", "08-development-guide.md"),
            Path.Combine(RepoRoot, "docs", "09-operations.md"),
            Path.Combine(RepoRoot, "docs", "10-known-limits-and-risks.md"),
            Path.Combine(RepoRoot, "reference", "event-protocols.md")
        };

        foreach (var path in docPaths)
        {
            Assert.True(File.Exists(path), $"Required active rails doc is missing: {Relative(path)}");
        }

        var architecture = File.ReadAllText(docPaths[0]);
        Assert.Contains("RoleCapabilityIds.ForRoleAgent", architecture, StringComparison.Ordinal);
        Assert.Contains("ResourceGatewayRail", architecture, StringComparison.Ordinal);
        Assert.Contains("bounded", architecture, StringComparison.OrdinalIgnoreCase);

        var developmentGuide = File.ReadAllText(docPaths[1]);
        Assert.Contains("RoleCapabilityIds.ForRoleAgent", developmentGuide, StringComparison.Ordinal);
        Assert.Contains("ResourceGatewayRail", developmentGuide, StringComparison.Ordinal);
        Assert.Contains("self-message", developmentGuide, StringComparison.OrdinalIgnoreCase);

        var operations = File.ReadAllText(docPaths[2]);
        Assert.Contains("/api/debug/role-agent-ledger/health", operations, StringComparison.Ordinal);
        Assert.Contains("agent-scoped", operations, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("trace_projection_buffer_overflow", operations, StringComparison.Ordinal);

        var risks = File.ReadAllText(docPaths[3]);
        Assert.Contains("legacy alias seeding is intentionally gone", risks, StringComparison.Ordinal);
        Assert.Contains("Role-agent ledger projection overflow", risks, StringComparison.Ordinal);

        var protocols = File.ReadAllText(docPaths[4]);
        Assert.Contains("ResourceGatewayRail", protocols, StringComparison.Ordinal);
        Assert.Contains("RoleCapabilityIds.ForRoleAgent", protocols, StringComparison.Ordinal);
        Assert.Contains("Trace projection is a bounded debug/read-side projection", protocols, StringComparison.Ordinal);

        var bannedMarkers = new[]
        {
            "SeedLegacyStaticRoleCapabilityAliases",
            "legacy static aliases are supported",
            "optional legacy alias",
            "compatibility mode seeds legacy role capability aliases"
        };

        var offenders = docPaths
            .Select(path => (path, content: File.ReadAllText(path)))
            .SelectMany(x => bannedMarkers
                .Where(marker => x.content.Contains(marker, StringComparison.OrdinalIgnoreCase))
                .Select(marker => $"{Relative(x.path)}:{marker}"))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Active rails docs still describe removed compatibility paths as current behavior: " + string.Join(", ", offenders));
    }

    [Fact]
    public void OperationReplyProtocol_HasNoIgnoredNonTerminalReplies()
    {
        var bannedTokens = new[]
        {
            "OperationAccepted",
            "OperationQueued",
            "OperationAck",
            "non_terminal_acceptance_not_used_in_ledger_v1",
            "queued_reply_ignored",
            "ack_reply_ignored"
        };

        var allowedFiles = new HashSet<string>(StringComparer.Ordinal)
        {
            "Aven/tests/Aven.Tests.ActorKernel/Phase30EventResetArchitectureTests.cs",
            "Aven/tests/Aven.Tests.RoleAgents/Phase12RoleAgentCoreTests.cs"
        };

        var offenders = EnumerateCodeFiles(SrcRoot)
            .Concat(EnumerateCodeFiles(TestsRoot))
            .Concat(EnumerateCodeFiles(ToolkitSrcRoot))
            .Concat(EnumerateCodeFiles(ToolkitTestsRoot))
            .Concat(Directory.Exists(Path.Combine(RepoRoot, "docs")) ? Directory.EnumerateFiles(Path.Combine(RepoRoot, "docs"), "*.md", SearchOption.AllDirectories) : Array.Empty<string>())
            .Concat(Directory.Exists(Path.Combine(RepoRoot, "reference")) ? Directory.EnumerateFiles(Path.Combine(RepoRoot, "reference"), "*.md", SearchOption.AllDirectories) : Array.Empty<string>())
            .Select(path => (relative: Relative(path), content: File.ReadAllText(path)))
            .Where(x => !allowedFiles.Contains(x.relative))
            .SelectMany(x => bannedTokens
                .Where(token => x.content.Contains(token, StringComparison.Ordinal))
                .Select(token => $"{x.relative}:{token}"))
            .OrderBy(static x => x)
            .ToArray();

        Assert.True(offenders.Length == 0, "Ignored non-terminal operation replies remain in source/tests/docs/reference: " + string.Join(", ", offenders));
    }

    private static IEnumerable<Type> EventTypes() => ProductionAssemblies
        .Distinct()
        .SelectMany(static assembly => assembly.GetTypes())
        .Where(static type => typeof(IAvenEvent).IsAssignableFrom(type) && type is { IsInterface: false, IsAbstract: false })
        .Distinct();

    private static IEnumerable<string> ValidateContractProject(string projectPath)
    {
        var relativeProjectPath = Relative(projectPath);
        var document = XDocument.Load(projectPath);
        var projectReferences = document
            .Descendants()
            .Where(static element => element.Name.LocalName == "ProjectReference")
            .Select(static element => element.Attribute("Include")?.Value)
            .Where(static include => !string.IsNullOrWhiteSpace(include))
            .Select(static include => include!)
            .ToArray();

        foreach (var include in projectReferences)
        {
            var normalizedInclude = include.Replace('\\', Path.DirectorySeparatorChar);
            var referencedPath = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(projectPath)!, normalizedInclude));
            var referencedProjectName = Path.GetFileNameWithoutExtension(referencedPath);
            var isAllowed = referencedProjectName == "Aven.Contracts"
                || referencedProjectName == "Aven.Events"
                || referencedProjectName.EndsWith(".Contracts", StringComparison.Ordinal)
                || referencedProjectName.StartsWith("Aven.Toolkit.", StringComparison.Ordinal);

            if (!isAllowed)
            {
                yield return $"{relativeProjectPath}:project_reference:{referencedProjectName}";
            }
        }

        var packageReferences = document
            .Descendants()
            .Where(static element => element.Name.LocalName == "PackageReference")
            .Select(static element => element.Attribute("Include")?.Value)
            .Where(static include => !string.IsNullOrWhiteSpace(include))
            .Select(static include => include!)
            .ToArray();

        foreach (var packageReference in packageReferences.Where(static include => include.StartsWith("Akka", StringComparison.Ordinal)))
        {
            yield return $"{relativeProjectPath}:package_reference:{packageReference}";
        }
    }

    private static IEnumerable<string> ValidateToolkitProject(string projectPath)
    {
        var relativeProjectPath = Relative(projectPath);
        var document = XDocument.Load(projectPath);
        var forbiddenProjectPrefixes = new[]
        {
            "Aven.RoleAgents",
            "Aven.Routing",
            "Aven.Submission",
            "Aven.Api",
            "Aven.Akka.Hosting",
            "Aven.ActorKernel"
        };

        var projectReferences = document
            .Descendants()
            .Where(static element => element.Name.LocalName == "ProjectReference")
            .Select(static element => element.Attribute("Include")?.Value)
            .Where(static include => !string.IsNullOrWhiteSpace(include))
            .Select(static include => include!)
            .ToArray();

        foreach (var include in projectReferences)
        {
            var normalizedInclude = include.Replace('\\', Path.DirectorySeparatorChar);
            var referencedPath = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(projectPath)!, normalizedInclude));
            var referencedProjectName = Path.GetFileNameWithoutExtension(referencedPath);

            if (forbiddenProjectPrefixes.Any(prefix => referencedProjectName.Equals(prefix, StringComparison.Ordinal) || referencedProjectName.StartsWith(prefix + ".", StringComparison.Ordinal)))
            {
                yield return $"{relativeProjectPath}:project_reference:{referencedProjectName}";
            }
        }

        var packageReferences = document
            .Descendants()
            .Where(static element => element.Name.LocalName == "PackageReference")
            .Select(static element => element.Attribute("Include")?.Value)
            .Where(static include => !string.IsNullOrWhiteSpace(include))
            .Select(static include => include!)
            .ToArray();

        foreach (var packageReference in packageReferences.Where(static include => include.StartsWith("Akka", StringComparison.Ordinal)))
        {
            yield return $"{relativeProjectPath}:package_reference:{packageReference}";
        }
    }

    private static IEnumerable<string> ValidateToolkitTestProject(string projectPath)
    {
        var relativeProjectPath = Relative(projectPath);
        var document = XDocument.Load(projectPath);
        var forbiddenProjectPrefixes = new[]
        {
            "Aven.RoleAgents",
            "Aven.Routing",
            "Aven.Submission",
            "Aven.Api",
            "Aven.Akka.Hosting",
            "Aven.ActorKernel"
        };

        var projectReferences = document
            .Descendants()
            .Where(static element => element.Name.LocalName == "ProjectReference")
            .Select(static element => element.Attribute("Include")?.Value)
            .Where(static include => !string.IsNullOrWhiteSpace(include))
            .Select(static include => include!)
            .ToArray();

        foreach (var include in projectReferences)
        {
            var normalizedInclude = include.Replace('\\', Path.DirectorySeparatorChar);
            var referencedPath = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(projectPath)!, normalizedInclude));
            var referencedProjectName = Path.GetFileNameWithoutExtension(referencedPath);

            if (forbiddenProjectPrefixes.Any(prefix => referencedProjectName.Equals(prefix, StringComparison.Ordinal) || referencedProjectName.StartsWith(prefix + ".", StringComparison.Ordinal)))
            {
                yield return $"{relativeProjectPath}:project_reference:{referencedProjectName}";
            }
        }

        var packageReferences = document
            .Descendants()
            .Where(static element => element.Name.LocalName == "PackageReference")
            .Select(static element => element.Attribute("Include")?.Value)
            .Where(static include => !string.IsNullOrWhiteSpace(include))
            .Select(static include => include!)
            .ToArray();

        foreach (var packageReference in packageReferences.Where(static include => include.StartsWith("Akka", StringComparison.Ordinal)))
        {
            yield return $"{relativeProjectPath}:package_reference:{packageReference}";
        }
    }

    private static IEnumerable<string> ValidateToolkitDirection(string projectPath, IReadOnlySet<string> runtimeProjectNames, IReadOnlySet<string> toolkitProjectNames)
    {
        var relativeProjectPath = Relative(projectPath);
        var document = XDocument.Load(projectPath);
        var projectReferences = document
            .Descendants()
            .Where(static element => element.Name.LocalName == "ProjectReference")
            .Select(static element => element.Attribute("Include")?.Value)
            .Where(static include => !string.IsNullOrWhiteSpace(include))
            .Select(static include => include!)
            .ToArray();

        foreach (var include in projectReferences)
        {
            var normalizedInclude = include.Replace('\\', Path.DirectorySeparatorChar);
            var referencedPath = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(projectPath)!, normalizedInclude));
            var referencedProjectName = Path.GetFileNameWithoutExtension(referencedPath);

            if (runtimeProjectNames.Contains(referencedProjectName) && !toolkitProjectNames.Contains(referencedProjectName))
            {
                yield return $"{relativeProjectPath}:project_reference:{referencedProjectName}";
            }
        }
    }

    private static IEnumerable<string> ValidateEventType(Type type)
    {
        if (!type.IsSealed)
        {
            yield return $"{type.FullName}:not_sealed";
        }

        if (type.Name.EndsWith("Snapshot", StringComparison.Ordinal))
        {
            yield return $"{type.FullName}:name_ends_with_snapshot";
        }

        if (type.Name.Contains("Legacy", StringComparison.Ordinal) || type.Name.Contains("Old", StringComparison.Ordinal))
        {
            yield return $"{type.FullName}:legacy_name";
        }

        var properties = type.GetProperties(BindingFlags.Instance | BindingFlags.Public);
        foreach (var property in properties)
        {
            if (IsBannedLargeInlinePropertyName(property.Name) && !IsAllowedLargeContentException(type, property))
            {
                yield return $"{type.FullName}:{property.Name}_large_inline_content_property_forbidden";
            }

            if (IsAvenEnvelopeType(property.PropertyType))
            {
                yield return $"{type.FullName}:{property.Name}_references_banned_payload_type_{property.PropertyType.FullName}";
            }

            if (IsForbiddenTopLevelProperty(type, property))
            {
                yield return $"{type.FullName}:{property.Name}_top_level_property_name_forbidden";
            }

            if (property.Name == "State")
            {
                yield return $"{type.FullName}:{property.Name}_property_forbidden";
            }

            var propertyTypeName = property.PropertyType.Name;
            if (propertyTypeName.EndsWith("State", StringComparison.Ordinal))
            {
                yield return $"{type.FullName}:{property.Name}_type_ends_with_state";
            }

            if (propertyTypeName.EndsWith("Snapshot", StringComparison.Ordinal))
            {
                yield return $"{type.FullName}:{property.Name}_type_ends_with_snapshot";
            }

            foreach (var violation in FindBannedPayloadTypes(type, property.PropertyType, property.Name, new HashSet<Type>()))
            {
                yield return violation;
            }
        }

        foreach (var violation in ValidateLlmResponseDurability(type, properties))
        {
            yield return violation;
        }

        foreach (var violation in ValidateSchedulePayloadException(type, properties))
        {
            yield return violation;
        }

        foreach (var violation in ValidatePersistedCommandPayloadConvention(type, type, type.Name, new HashSet<Type>()))
        {
            yield return violation;
        }

        if (properties.Length == 1
            && properties[0].PropertyType == typeof(string)
            && properties[0].Name.EndsWith("Json", StringComparison.Ordinal))
        {
            yield return $"{type.FullName}:single_json_string_payload";
        }

        if (type.Name.EndsWith("Response", StringComparison.Ordinal) || type.Name.EndsWith("Succeeded", StringComparison.Ordinal))
        {
            var hasAnyToolCallSemantics = properties.Any(static property => property.Name.Contains("ToolCall", StringComparison.Ordinal) || property.PropertyType.Name.Contains("ToolCall", StringComparison.Ordinal));
            var hasLlmOutputSemantics = properties.Any(static property => property.Name is "Provider" or "Model" or "Text" or "StructuredJson" or "ReasoningSummary" or "Citations");
            if (hasLlmOutputSemantics && !hasAnyToolCallSemantics)
            {
                yield return $"{type.FullName}:llm_response_event_missing_tool_call_semantics";
            }
        }
    }

    private static IEnumerable<string> FindBannedPayloadTypes(Type eventType, Type propertyType, string propertyPath, HashSet<Type> visited)
    {
        var candidate = Nullable.GetUnderlyingType(propertyType) ?? propertyType;
        if (!visited.Add(candidate))
        {
            yield break;
        }

        if (BannedPayloadTypeNames.Contains(candidate.Name))
        {
            yield return $"{eventType.FullName}:{propertyPath}_references_banned_payload_type_{candidate.FullName}";
            yield break;
        }

        if (IsAvenEnvelopeType(candidate))
        {
            yield return $"{eventType.FullName}:{propertyPath}_references_banned_payload_type_{candidate.FullName}";
            yield break;
        }

        if (candidate == typeof(string)
            || candidate.IsPrimitive
            || candidate.IsEnum
            || candidate == typeof(decimal)
            || candidate == typeof(DateTimeOffset)
            || candidate == typeof(TimeSpan))
        {
            yield break;
        }

        if (candidate.IsArray)
        {
            foreach (var violation in FindBannedPayloadTypes(eventType, candidate.GetElementType()!, propertyPath + "[]", visited))
            {
                yield return violation;
            }

            yield break;
        }

        if (TryGetEnumerableElementType(candidate, out var elementType))
        {
            foreach (var violation in FindBannedPayloadTypes(eventType, elementType!, propertyPath + "[]", visited))
            {
                yield return violation;
            }

            yield break;
        }

        if (!candidate.Namespace?.StartsWith("Aven", StringComparison.Ordinal) ?? true)
        {
            yield break;
        }

        foreach (var nestedProperty in candidate.GetProperties(BindingFlags.Instance | BindingFlags.Public))
        {
            if (IsBannedLargeInlinePropertyName(nestedProperty.Name) && !IsAllowedLargeContentException(eventType, nestedProperty))
            {
                yield return $"{eventType.FullName}:{propertyPath}.{nestedProperty.Name}_large_inline_content_property_forbidden";
            }

            foreach (var violation in FindBannedPayloadTypes(eventType, nestedProperty.PropertyType, propertyPath + "." + nestedProperty.Name, visited))
            {
                yield return violation;
            }
        }
    }

    private static IEnumerable<string> ValidateLlmResponseDurability(Type type, PropertyInfo[] properties)
    {
        if (type != typeof(LlmRequestSucceeded))
        {
            yield break;
        }

        var required = new[]
        {
            nameof(LlmRequestSucceeded.Provider),
            nameof(LlmRequestSucceeded.Model),
            nameof(LlmRequestSucceeded.Text),
            nameof(LlmRequestSucceeded.StructuredJson),
            nameof(LlmRequestSucceeded.ToolCalls),
            nameof(LlmRequestSucceeded.Refusal),
            nameof(LlmRequestSucceeded.SafetyBlock),
            nameof(LlmRequestSucceeded.ReasoningSummary),
            nameof(LlmRequestSucceeded.Citations),
            nameof(LlmRequestSucceeded.PromptTokens),
            nameof(LlmRequestSucceeded.CompletionTokens),
            nameof(LlmRequestSucceeded.Cost),
            nameof(LlmRequestSucceeded.FinishReason),
            nameof(LlmRequestSucceeded.Degradations),
            nameof(LlmRequestSucceeded.SchemaRef),
            nameof(LlmRequestSucceeded.StructuredOutputValidated)
        };

        var present = properties.Select(static x => x.Name).ToHashSet(StringComparer.Ordinal);
        foreach (var missing in required.Where(name => !present.Contains(name)))
        {
            yield return $"{type.FullName}:missing_durable_llm_response_field_{missing}";
        }

        var toolCalls = properties.SingleOrDefault(static x => x.Name == nameof(LlmRequestSucceeded.ToolCalls));
        if (toolCalls is null || GetSequenceElementType(toolCalls.PropertyType) != typeof(LlmToolCall))
        {
            yield return $"{type.FullName}:tool_calls_must_use_semantic_llm_tool_call_records";
        }

        var degradations = properties.SingleOrDefault(static x => x.Name == nameof(LlmRequestSucceeded.Degradations));
        if (degradations is null || GetSequenceElementType(degradations.PropertyType) != typeof(LlmProviderDegradation))
        {
            yield return $"{type.FullName}:degradations_must_preserve_code_and_message";
        }
    }

    private static IEnumerable<string> ValidateSchedulePayloadException(Type type, PropertyInfo[] properties)
    {
        if (type != typeof(ScheduleOccurrenceRecorded) && type != typeof(ScheduledRoleWorkRegistered))
        {
            yield break;
        }

        var present = properties.Select(static x => x.Name).ToHashSet(StringComparer.Ordinal);
        if (!present.Contains("PayloadHash"))
        {
            yield return $"{type.FullName}:schedule_payload_json_exception_missing_payload_hash";
        }

        if (!present.Contains("PayloadSizeBytes"))
        {
            yield return $"{type.FullName}:schedule_payload_json_exception_missing_payload_size_bytes";
        }

        if (type == typeof(ScheduleOccurrenceRecorded))
        {
            var workItem = properties.SingleOrDefault(static x => x.Name == nameof(ScheduleOccurrenceRecorded.WorkItem));
            var hasDocumentedCommandPayload = workItem?.PropertyType.GetProperty(nameof(ScheduledWorkItem.PayloadJson)) is not null;
            if (!hasDocumentedCommandPayload)
            {
                yield return $"{type.FullName}:schedule_occurrence_missing_documented_command_payload_json";
            }
        }
    }

    private static IEnumerable<string> ValidatePersistedCommandPayloadConvention(Type eventType, Type candidateType, string path, HashSet<Type> visited)
    {
        var candidate = Nullable.GetUnderlyingType(candidateType) ?? candidateType;
        if (candidate == typeof(PersistedCommandPayload))
        {
            yield break;
        }

        if (candidate == typeof(string)
            || candidate.IsPrimitive
            || candidate.IsEnum
            || candidate == typeof(decimal)
            || candidate == typeof(DateTimeOffset)
            || candidate == typeof(TimeSpan))
        {
            yield break;
        }

        if (candidate.IsArray)
        {
            foreach (var violation in ValidatePersistedCommandPayloadConvention(eventType, candidate.GetElementType()!, path + "[]", visited))
            {
                yield return violation;
            }
            yield break;
        }

        if (TryGetEnumerableElementType(candidate, out var elementType))
        {
            foreach (var violation in ValidatePersistedCommandPayloadConvention(eventType, elementType!, path + "[]", visited))
            {
                yield return violation;
            }
            yield break;
        }

        if (!candidate.Namespace?.StartsWith("Aven", StringComparison.Ordinal) ?? true)
        {
            yield break;
        }

        if (!visited.Add(candidate))
        {
            yield break;
        }

        var properties = candidate.GetProperties(BindingFlags.Instance | BindingFlags.Public);
        var present = properties.Select(static property => property.Name).ToHashSet(StringComparer.Ordinal);
        if (present.Contains("PayloadJson")
            && !(present.Contains("PayloadHash") && present.Contains("PayloadSizeBytes"))
            && !properties.Any(static property => property.PropertyType == typeof(PersistedCommandPayload)))
        {
            yield return $"{eventType.FullName}:{path}.PayloadJson_unbounded_command_payload";
        }

        if (eventType == typeof(OperationRequested)
            && present.Contains(nameof(OperationRequested.InputJson))
            && !(present.Contains("OperationKey")
                && present.Contains("RunId")
                && present.Contains("WorkItemId")
                && present.Contains("RoleAgentId")
                && present.Contains("ContractId")))
        {
            yield return $"{eventType.FullName}:{path}_missing_required_role_operation_ledger_identity_fields";
        }

        if (eventType == typeof(DeliveryInitialized) && candidate == typeof(DeliveryInitialized))
        {
            var hasSharedPayload = properties.Any(static property => property.Name == nameof(DeliveryInitialized.Payload) && property.PropertyType == typeof(PersistedCommandPayload));
            var hasDirectConvention = present.Contains("PayloadJson") && present.Contains("PayloadHash") && present.Contains("PayloadSizeBytes");
            if (!hasSharedPayload && !hasDirectConvention)
            {
                yield return $"{eventType.FullName}:delivery_initialized_missing_bounded_payload_convention";
            }
        }

        foreach (var property in properties)
        {
            foreach (var violation in ValidatePersistedCommandPayloadConvention(eventType, property.PropertyType, path + "." + property.Name, visited))
            {
                yield return violation;
            }
        }
    }

    private static IEnumerable<(string Name, string Location)> FindDuplicatePrimitiveDeclarations(params (string Name, int AllowedCount)[] rules)
    {
        var codeFiles = EnumerateCodeFiles(SrcRoot)
            .Concat(EnumerateCodeFiles(TestsRoot))
            .Concat(EnumerateCodeFiles(ToolkitSrcRoot))
            .Concat(EnumerateCodeFiles(ToolkitTestsRoot))
            .Select(path => (path, content: StripComments(File.ReadAllText(path))))
            .ToArray();

        foreach (var (name, allowedCount) in rules)
        {
            var matches = codeFiles
                .SelectMany(file => Regex.Matches(file.content, $@"\b(?:class|record|struct|interface|enum)\s+{Regex.Escape(name)}\b", RegexOptions.CultureInvariant)
                    .Cast<Match>()
                    .Select(_ => (Name: name, Location: Relative(file.path))))
                .Distinct()
                .ToArray();

            if (matches.Length > allowedCount)
            {
                foreach (var match in matches)
                {
                    yield return match;
                }
            }
        }
    }

    [Fact]
    public void Physical_Layout_Matches_Solution_Split()
    {
        var rootSrcProjects = Directory.Exists(Path.Combine(RepoRoot, "src"))
            ? Directory.EnumerateFiles(Path.Combine(RepoRoot, "src"), "*.csproj", SearchOption.AllDirectories)
                .Select(Relative)
                .OrderBy(static x => x)
                .ToArray()
            : Array.Empty<string>();

        var rootTestProjects = Directory.Exists(Path.Combine(RepoRoot, "tests"))
            ? Directory.EnumerateFiles(Path.Combine(RepoRoot, "tests"), "*.csproj", SearchOption.AllDirectories)
                .Select(Relative)
                .OrderBy(static x => x)
                .ToArray()
            : Array.Empty<string>();

        Assert.True(rootSrcProjects.Length == 0, "No .csproj may remain under root src/: " + string.Join(", ", rootSrcProjects));
        Assert.True(rootTestProjects.Length == 0, "No .csproj may remain under root tests/: " + string.Join(", ", rootTestProjects));

        var allProjects = EnumerateProjectFiles(SrcRoot)
            .Concat(EnumerateProjectFiles(TestsRoot))
            .Concat(EnumerateProjectFiles(ToolkitSrcRoot))
            .Concat(EnumerateProjectFiles(ToolkitTestsRoot))
            .Concat(EnumerateProjectFiles(ToolsRoot))
            .Select(Relative)
            .OrderBy(static x => x)
            .ToArray();

        var toolkitRuntimeOffenders = allProjects
            .Where(path => Path.GetFileNameWithoutExtension(path).StartsWith("Aven.Toolkit.", StringComparison.Ordinal)
                && !path.StartsWith("Toolkit/src/", StringComparison.Ordinal)
                && !path.StartsWith("Toolkit/tests/", StringComparison.Ordinal))
            .ToArray();

        var toolkitTestOffenders = allProjects
            .Where(path => Path.GetFileNameWithoutExtension(path).StartsWith("Aven.Toolkit.", StringComparison.Ordinal)
                && path.Contains(".Tests", StringComparison.Ordinal)
                && !path.StartsWith("Toolkit/tests/", StringComparison.Ordinal))
            .ToArray();

        var avenOffenders = allProjects
            .Where(path =>
            {
                var name = Path.GetFileNameWithoutExtension(path);
                if (name.StartsWith("Aven.Toolkit.", StringComparison.Ordinal) || name == "Aven.Debug")
                {
                    return false;
                }

                return !path.StartsWith("Aven/src/", StringComparison.Ordinal)
                    && !path.StartsWith("Aven/tests/", StringComparison.Ordinal)
                    && !path.StartsWith("tools/", StringComparison.Ordinal);
            })
            .ToArray();

        Assert.True(toolkitRuntimeOffenders.Length == 0, "All Aven.Toolkit.* projects must live under Toolkit/src or Toolkit/tests: " + string.Join(", ", toolkitRuntimeOffenders));
        Assert.True(toolkitTestOffenders.Length == 0, "All Aven.Toolkit.*.Tests projects must live under Toolkit/tests: " + string.Join(", ", toolkitTestOffenders));
        Assert.True(avenOffenders.Length == 0, "All non-toolkit Aven projects must live under Aven/src, Aven/tests, or tools: " + string.Join(", ", avenOffenders));
        Assert.True(File.Exists(Path.Combine(ToolsRoot, "Aven.Debug", "Aven.Debug.csproj")), "tools/Aven.Debug must remain under tools.");
    }

    private static bool IsForbiddenTopLevelProperty(Type eventType, PropertyInfo property)
    {
        if (!BannedTopLevelPropertyNames.Contains(property.Name))
        {
            return false;
        }

        if (eventType.IsGenericType
            && eventType.GetGenericTypeDefinition() == typeof(AvenEventEnvelope<>)
            && property.Name == nameof(AvenEventEnvelope<IAvenEvent>.Data))
        {
            return false;
        }

        if (property.PropertyType == typeof(EventMetadata))
        {
            return false;
        }

        if (eventType == typeof(RunProgressed)
            && property.Name == nameof(RunProgressed.RunStateJson))
        {
            return false;
        }

        return true;
    }

    private static bool IsAllowedLargeContentException(Type eventType, PropertyInfo property)
    {
        if (eventType == typeof(SchemaVersionRegistered) && property.Name == nameof(SchemaVersionRegistered.JsonSchema))
        {
            return true;
        }

        return false;
    }

    private static bool IsBannedLargeInlinePropertyName(string propertyName) =>
        BannedPayloadPropertyNames.Contains(propertyName);

    private static bool IsAvenEnvelopeType(Type type) =>
        type.IsGenericType && type.GetGenericTypeDefinition() == typeof(AvenEnvelope<>);

    private static Type? GetSequenceElementType(Type type)
    {
        if (type.IsArray)
        {
            return type.GetElementType();
        }

        return TryGetEnumerableElementType(type, out var elementType) ? elementType : null;
    }

    private static bool TryGetEnumerableElementType(Type candidate, out Type? elementType)
    {
        if (candidate.IsGenericType && candidate.GetGenericTypeDefinition() == typeof(IEnumerable<>))
        {
            elementType = candidate.GetGenericArguments()[0];
            return true;
        }

        var match = candidate
            .GetInterfaces()
            .FirstOrDefault(static iface => iface.IsGenericType && iface.GetGenericTypeDefinition() == typeof(IEnumerable<>));
        if (match is not null)
        {
            elementType = match.GetGenericArguments()[0];
            return true;
        }

        elementType = null;
        return false;
    }

    private static string BuildEventCatalog(IEnumerable<Type> eventTypes) => string.Join(
        Environment.NewLine,
        eventTypes.Select(type =>
        {
            var properties = type
                .GetProperties(BindingFlags.Instance | BindingFlags.Public)
                .Select(static property => $"{property.Name}:{FormatTypeName(property.PropertyType)}")
                .DefaultIfEmpty("<no public properties>");
            return $"- {type.FullName} => {string.Join(", ", properties)}";
        }));

    private static string FormatTypeName(Type type)
    {
        if (type.IsArray)
        {
            return FormatTypeName(type.GetElementType()!) + "[]";
        }

        if (!type.IsGenericType)
        {
            return type.Name;
        }

        var genericName = type.Name[..type.Name.IndexOf('`')];
        var arguments = string.Join(", ", type.GetGenericArguments().Select(FormatTypeName));
        return $"{genericName}<{arguments}>";
    }

    private static IEnumerable<string> FindSourceFiles() => Directory
        .EnumerateFiles(SrcRoot, "*.cs", SearchOption.AllDirectories)
        .Where(path => !path.Contains("/bin/", StringComparison.Ordinal))
        .Where(path => !path.Contains("/obj/", StringComparison.Ordinal));

    private static IEnumerable<string> EnumerateProjectFiles(string root)
    {
        if (!Directory.Exists(root))
        {
            return Array.Empty<string>();
        }

        return Directory
            .EnumerateFiles(root, "*.csproj", SearchOption.AllDirectories)
            .Where(path => !path.Contains("/bin/", StringComparison.Ordinal))
            .Where(path => !path.Contains("/obj/", StringComparison.Ordinal));
    }

    private static IEnumerable<string> EnumerateCodeFiles(string root)
    {
        if (!Directory.Exists(root))
        {
            return Array.Empty<string>();
        }

        return Directory
            .EnumerateFiles(root, "*.cs", SearchOption.AllDirectories)
            .Where(path => !path.Contains("/bin/", StringComparison.Ordinal))
            .Where(path => !path.Contains("/obj/", StringComparison.Ordinal));
    }

    private static IEnumerable<string> EnumerateResourceGatewayActorFiles()
    {
        var gatewayRoots = new[]
        {
            Path.Combine(ArtifactsRoot, "Gateways"),
            Path.Combine(MetadataRoot, "Gateways"),
            Path.Combine(LlmRoot, "Gateways"),
            Path.Combine(HumanRoot, "Gateways"),
            Path.Combine(SchedulingRoot, "Gateways"),
            Path.Combine(ShellRuntimeRoot, "Gateways")
        };

        foreach (var root in gatewayRoots.Where(Directory.Exists))
        {
            foreach (var path in Directory.EnumerateFiles(root, "*GatewayActor.cs", SearchOption.TopDirectoryOnly))
            {
                yield return path;
            }
        }
    }

    private static bool IsArchivedDocPath(string path)
        => path.Contains(Path.Combine("Docs", "Implementation"), StringComparison.Ordinal)
           || path.Contains(Path.Combine("Docs", "Ideas"), StringComparison.Ordinal)
           || path.Contains(Path.Combine("Docs", "durable-role-agent-architecture-docs"), StringComparison.Ordinal)
           || path.EndsWith(Path.Combine("Docs", "README.md"), StringComparison.Ordinal)
           || path.Contains("_DRAFT", StringComparison.OrdinalIgnoreCase)
           || path.Contains("_vNext", StringComparison.OrdinalIgnoreCase)
           || path.Contains("STANDALONE", StringComparison.OrdinalIgnoreCase)
           || path.Contains("implementation_review", StringComparison.OrdinalIgnoreCase);

    private static string Namespace(params string[] segments) => string.Join('.', segments);

    private static string ServiceSuffix() => string.Concat("Ser", "vices");

    private static string BuildServicesNamespaceDeclarationPattern() =>
        string.Concat(
            "^\\s*",
            "name",
            "space",
            "\\s+([A-Za-z0-9_.]+\\.",
            "Ser",
            "vices)",
            "\\s*;");

    private static string StripComments(string content)
    {
        content = Regex.Replace(content, @"//.*?$", string.Empty, RegexOptions.Multiline);
        content = Regex.Replace(content, @"/\*.*?\*/", string.Empty, RegexOptions.Singleline);
        return content;
    }

    private static string Relative(string path) => Path.GetRelativePath(RepoRoot, path).Replace('\\', '/');

    private static string FindRepoRoot([CallerFilePath] string sourceFile = "")
    {
        foreach (var start in new[] { Path.GetDirectoryName(sourceFile), Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
        {
            var current = string.IsNullOrWhiteSpace(start) ? null : new DirectoryInfo(start);
            while (current is not null)
            {
                if (File.Exists(Path.Combine(current.FullName, "Aven.sln")))
                {
                    return current.FullName;
                }

                current = current.Parent;
            }
        }

        throw new InvalidOperationException("Could not locate repository root containing Aven.sln.");
    }
}