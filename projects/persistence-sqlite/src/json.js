export function stringifyJson(value) {
    return JSON.stringify(value ?? null);
}
export function parseJson(value) {
    return JSON.parse(value);
}
