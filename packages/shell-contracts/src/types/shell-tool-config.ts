export interface ShellToolConfig {
  readonly maxInlineOutputChars: number;
  readonly maxMemoryBytes: number;
  readonly defaultTimeoutSeconds: number;
  readonly maxTimeoutSeconds: number;
  readonly cwd: string;
  readonly allowedCommands: readonly string[];
  readonly env: Record<string, string>;
}