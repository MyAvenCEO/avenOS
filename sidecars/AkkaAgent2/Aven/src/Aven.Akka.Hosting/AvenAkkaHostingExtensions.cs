using Akka.Actor;
using Akka.Hosting;
using Microsoft.Extensions.DependencyInjection;

namespace Aven.Akka.Hosting;

public static class AvenAkkaHostingExtensions
{
    public static IServiceCollection AddAvenAkkaHosting(
        this IServiceCollection services,
        string actorSystemName,
        Action<ActorSystem, IActorRegistry, LocalActorAddressRegistry>? configureActors = null)
    {
        services.AddSingleton<LocalActorAddressRegistry>();
        services.AddSingleton<IActorAddressResolver>(sp => sp.GetRequiredService<LocalActorAddressRegistry>());

        services.AddAkka(actorSystemName, (builder, provider) =>
        {
            builder.WithActors((system, registry) =>
            {
                var addressRegistry = provider.GetRequiredService<LocalActorAddressRegistry>();
                configureActors?.Invoke(system, registry, addressRegistry);
            });
        });

        return services;
    }
}