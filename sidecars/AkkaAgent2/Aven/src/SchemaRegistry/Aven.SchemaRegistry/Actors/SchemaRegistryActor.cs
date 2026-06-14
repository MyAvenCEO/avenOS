using Aven.ActorKernel;
using Aven.Toolkit.Core.Serialization;

namespace Aven.SchemaRegistry.Actors;

public sealed class SchemaRegistryActor : AvenPersistentActor
{
    private readonly SimpleJsonSchemaValidator _validator = new();
    private SchemaRegistryState _state = SchemaRegistryState.Empty;

    public SchemaRegistryActor(string persistenceId)
    {
        PersistenceId = persistenceId;

        Command<SchemaRegister>(HandleRegister);
        Command<SchemaGet>(HandleGet);
        Command<SchemaGetLatest>(HandleGetLatest);
        Command<SchemaListFamilyVersions>(HandleListFamilyVersions);
        Command<SchemaValidate>(HandleValidate);

        RecoverEvent<SchemaVersionRegistered>(e => Apply(e));
    }

    public override string PersistenceId { get; }

    private void HandleRegister(SchemaRegister command)
    {
        var identity = SchemaIdentity.Parse(command.SchemaRef);
        var incomingHash = new CanonicalJsonSerializer().Hash(command.JsonSchema);
        if (_state.Schemas.TryGetValue(command.SchemaRef.Value, out var existing))
        {
            if (StringComparer.Ordinal.Equals(existing.SchemaHash, incomingHash))
            {
                Sender.Tell(new SchemaRegistered(existing.SchemaRef, existing.JsonSchema, existing.Description, existing.RegisteredAt), Self);
                return;
            }

            Sender.Tell(new SchemaRegistrationConflict(command.SchemaRef, existing.SchemaHash, incomingHash), Self);
            return;
        }

        var registered = new RegisteredSchema(command.SchemaRef, command.JsonSchema, incomingHash, command.Description, DateTimeOffset.UtcNow, identity.FamilyRef, identity.Version);
        var replyTo = Sender;
        var evt = new SchemaVersionRegistered(
            registered.SchemaRef,
            registered.JsonSchema,
            registered.Description,
            registered.SchemaHash,
            registered.RegisteredAt);
        PersistEvent(evt, MetadataFor<SchemaVersionRegistered>(
            new ActorAddress("schema/registry", "local"),
            nameof(SchemaRegistryActor),
            ActorLocalCorrelationId(),
            evt,
            occurredAt: registered.RegisteredAt), _ =>
        {
            Apply(registered);
            replyTo.Tell(new SchemaRegistered(registered.SchemaRef, registered.JsonSchema, registered.Description, registered.RegisteredAt), Self);
        });
    }

    private void HandleGet(SchemaGet command)
    {
        if (_state.Schemas.TryGetValue(command.SchemaRef.Value, out var schema))
        {
            Sender.Tell(schema, Self);
            return;
        }

        Sender.Tell(new SchemaNotFound(command.SchemaRef), Self);
    }

    private void HandleGetLatest(SchemaGetLatest command)
    {
        if (!TryGetFamilySchemas(command.FamilyRef, out var schemas))
        {
            Sender.Tell(new SchemaFamilyNotFound(command.FamilyRef), Self);
            return;
        }

        Sender.Tell(schemas[^1], Self);
    }

    private void HandleListFamilyVersions(SchemaListFamilyVersions command)
    {
        if (!TryGetFamilySchemas(command.FamilyRef, out var schemas))
        {
            Sender.Tell(new SchemaFamilyNotFound(command.FamilyRef), Self);
            return;
        }

        Sender.Tell(new SchemaFamilyVersionsListed(command.FamilyRef, schemas), Self);
    }

    private void HandleValidate(SchemaValidate command)
    {
        if (!_state.Schemas.TryGetValue(command.SchemaRef.Value, out var schema))
        {
            Sender.Tell(new SchemaNotFound(command.SchemaRef), Self);
            return;
        }

        IReadOnlyList<string> errors;
        try
        {
            errors = _validator.Validate(schema.JsonSchema, command.Json);
        }
        catch (Exception ex)
        {
            errors = new[] { ex.Message };
        }

        Sender.Tell(
            errors.Count == 0
                ? new SchemaValidationSucceeded(command.SchemaRef, command.Json)
                : new SchemaValidationFailed(command.SchemaRef, command.Json, errors),
            Self);
    }

    private void Apply(RegisteredSchema schema)
    {
        var updated = new Dictionary<string, RegisteredSchema>(_state.Schemas, StringComparer.Ordinal)
        {
            [schema.SchemaRef.Value] = schema
        };

        var updatedFamilies = new Dictionary<string, IReadOnlyList<string>>(_state.FamilyVersions, StringComparer.Ordinal);
        if (!updatedFamilies.TryGetValue(schema.FamilyRef, out var existingVersions))
        {
            updatedFamilies[schema.FamilyRef] = new[] { schema.SchemaRef.Value };
        }
        else if (!existingVersions.Contains(schema.SchemaRef.Value, StringComparer.Ordinal))
        {
            updatedFamilies[schema.FamilyRef] = existingVersions
                .Append(schema.SchemaRef.Value)
                .OrderBy(static value => SchemaIdentity.Parse(new SchemaRef(value)).Version)
                .ToArray();
        }

        _state = new SchemaRegistryState(updated, updatedFamilies);
    }

    private void Apply(SchemaVersionRegistered registered)
    {
        var identity = SchemaIdentity.Parse(registered.SchemaRef);
        Apply(new RegisteredSchema(
            registered.SchemaRef,
            registered.JsonSchema,
            registered.SchemaHash,
            registered.Description,
            registered.RegisteredAt,
            identity.FamilyRef,
            identity.Version));
    }

    private bool TryGetFamilySchemas(string familyRef, out IReadOnlyList<RegisteredSchema> schemas)
    {
        if (_state.FamilyVersions.TryGetValue(familyRef, out var schemaRefs))
        {
            schemas = schemaRefs.Select(schemaRef => _state.Schemas[schemaRef]).ToArray();
            return true;
        }

        schemas = Array.Empty<RegisteredSchema>();
        return false;
    }

    private sealed record SchemaIdentity(string FamilyRef, int Version)
    {
        public static SchemaIdentity Parse(SchemaRef schemaRef)
        {
            var value = schemaRef.Value;
            var atIndex = value.LastIndexOf('@');
            if (atIndex <= 0 || atIndex == value.Length - 1)
            {
                throw new ArgumentException($"SchemaRef '{value}' must end with @<version>.", nameof(schemaRef));
            }

            var familyRef = value[..atIndex];
            var versionText = value[(atIndex + 1)..];
            if (!int.TryParse(versionText, out var version) || version <= 0)
            {
                throw new ArgumentException($"SchemaRef '{value}' must use a positive integer version suffix.", nameof(schemaRef));
            }

            return new SchemaIdentity(familyRef, version);
        }
    }
}