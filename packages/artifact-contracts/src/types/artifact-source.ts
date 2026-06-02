export interface ArtifactSource {
  readonly kind: "humanUpload" | "toolOutput" | "shellOutput" | "llmOutput" | "system";
  readonly uri?: string;
}