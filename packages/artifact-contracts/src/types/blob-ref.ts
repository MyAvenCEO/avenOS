export interface BlobRef {
  readonly algorithm: "sha256";
  readonly hash: string;
  readonly sizeBytes: number;
}