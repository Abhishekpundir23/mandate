export type WorkspaceKind = 'POLICY' | 'SESSION' | 'CASES' | 'TRACE' | 'CAMPAIGN';
export interface WorkspaceEntry {
  readonly id: string;
  readonly label: string;
  readonly kind: WorkspaceKind;
  readonly references: readonly string[];
  readonly payload: unknown;
}
export interface WorkspaceManifestEntry {
  readonly id: string;
  readonly kind: WorkspaceKind;
  readonly digest: string;
}
export interface WorkspaceBundle {
  readonly schemaVersion: 1;
  readonly kind: 'authority-workspace';
  readonly id: string;
  readonly label: string;
  readonly entries: readonly WorkspaceEntry[];
  readonly manifest: {
    readonly algorithm: 'SHA-256';
    readonly entries: readonly WorkspaceManifestEntry[];
    readonly rootDigest: string;
  };
}
export type WorkspaceVerification =
  | { readonly ok: true; readonly authenticated: false; readonly workspace: WorkspaceBundle }
  | {
      readonly ok: false;
      readonly authenticated: false;
      readonly code:
        | 'INVALID_INPUT'
        | 'INVALID_WORKSPACE'
        | 'INVALID_ENTRY'
        | 'REFERENCE_MISMATCH'
        | 'MANIFEST_MISMATCH';
    };
