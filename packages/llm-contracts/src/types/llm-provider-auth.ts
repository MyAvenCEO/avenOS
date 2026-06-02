export type LlmProviderAuth =
  | { readonly type: "none" }
  | { readonly type: "bearer"; readonly token: string }
  | { readonly type: "bearerEnv"; readonly env: string };