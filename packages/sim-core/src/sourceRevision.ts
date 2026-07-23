export const GIT_WORKSPACE_FINGERPRINT_POLICY_VERSION = 'git-workspace-fingerprint-v1';

export type SourceWorkspaceFingerprint = {
  readonly policyVersion: typeof GIT_WORKSPACE_FINGERPRINT_POLICY_VERSION;
  readonly sha256: string;
  readonly pathCount: number;
};

export type SourceRevision = {
  readonly commit: string;
  readonly dirty: boolean;
  readonly workspaceFingerprint?: SourceWorkspaceFingerprint;
};

export function assertSourceWorkspaceFingerprint(
  value: unknown,
  name: string = 'workspaceFingerprint',
): asserts value is SourceWorkspaceFingerprint {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  const fingerprint = value as Readonly<Record<string, unknown>>;
  if (fingerprint.policyVersion !== GIT_WORKSPACE_FINGERPRINT_POLICY_VERSION) {
    throw new Error(`${name}.policyVersion must equal ${GIT_WORKSPACE_FINGERPRINT_POLICY_VERSION}`);
  }
  if (
    typeof fingerprint.sha256 !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/u.test(fingerprint.sha256)
  ) {
    throw new Error(`${name}.sha256 must be a lowercase SHA-256 digest`);
  }
  if (
    typeof fingerprint.pathCount !== 'number' ||
    !Number.isSafeInteger(fingerprint.pathCount) ||
    fingerprint.pathCount < 0
  ) {
    throw new Error(`${name}.pathCount must be a non-negative safe integer`);
  }
}

export function cloneSourceRevision(sourceRevision: SourceRevision): SourceRevision {
  return {
    commit: sourceRevision.commit,
    dirty: sourceRevision.dirty,
    ...(sourceRevision.workspaceFingerprint === undefined
      ? {}
      : { workspaceFingerprint: { ...sourceRevision.workspaceFingerprint } }),
  };
}

export function assertReproducibleSourceRevision(
  sourceRevision: SourceRevision,
  name: string = 'sourceRevision',
): void {
  if (sourceRevision.dirty && sourceRevision.workspaceFingerprint === undefined) {
    throw new Error(`${name} requires a workspaceFingerprint when dirty`);
  }
  if (sourceRevision.workspaceFingerprint !== undefined) {
    assertSourceWorkspaceFingerprint(
      sourceRevision.workspaceFingerprint,
      `${name}.workspaceFingerprint`,
    );
  }
}

export function sourceRevisionsEqual(left: SourceRevision, right: SourceRevision): boolean {
  return (
    left.commit === right.commit &&
    left.dirty === right.dirty &&
    workspaceFingerprintsEqual(left.workspaceFingerprint, right.workspaceFingerprint)
  );
}

function workspaceFingerprintsEqual(
  left: SourceWorkspaceFingerprint | undefined,
  right: SourceWorkspaceFingerprint | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return (
    left.policyVersion === right.policyVersion &&
    left.sha256 === right.sha256 &&
    left.pathCount === right.pathCount
  );
}
