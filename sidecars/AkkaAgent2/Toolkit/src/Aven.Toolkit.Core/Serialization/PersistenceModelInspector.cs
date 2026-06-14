using System.Reflection;

namespace Aven.Toolkit.Core.Serialization;

public static class PersistenceModelInspector
{
    public static IReadOnlyList<string> FindForbiddenTypePaths<T>(Func<Type, bool> isForbiddenType) =>
        FindForbiddenTypePaths(typeof(T), isForbiddenType);

    public static IReadOnlyList<string> FindForbiddenTypePaths(Type type, Func<Type, bool> isForbiddenType)
    {
        var results = new List<string>();
        Visit(type, type.Name, results, new HashSet<Type>(), isForbiddenType);
        return results;
    }

    private static void Visit(Type type, string path, List<string> results, HashSet<Type> visiting, Func<Type, bool> isForbiddenType)
    {
        if (isForbiddenType(type))
        {
            results.Add(path);
            return;
        }

        if (type.IsPrimitive || type.IsEnum || type == typeof(string) || type == typeof(decimal) || type == typeof(DateTime) ||
            type == typeof(DateTimeOffset) || type == typeof(Guid) || type == typeof(TimeSpan))
        {
            return;
        }

        if (!visiting.Add(type))
        {
            return;
        }

        foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            Visit(property.PropertyType, $"{path}.{property.Name}", results, visiting, isForbiddenType);
        }

        visiting.Remove(type);
    }
}