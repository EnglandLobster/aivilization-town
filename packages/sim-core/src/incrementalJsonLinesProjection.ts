import { createHash } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  openSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';

const SCAN_BUFFER_BYTES = 64 * 1024;
const REWRITE_BOUNDARY_BYTES = 4 * 1024;

type FileSignature = {
  readonly device: number;
  readonly inode: number;
  readonly size: number;
  readonly modifiedAtMs: number;
  readonly changedAtMs: number;
};

export type IncrementalJsonLinesProjectionDiagnostics = {
  readonly completeRecordCount: number;
  readonly committedBytes: number;
  readonly fileBytes: number;
  readonly hasIncompleteTrailingRow: boolean;
};

/**
 * Incrementally folds complete JSONL rows into a caller-owned projection without
 * retaining the historical rows. The caller owns append semantics so this class
 * can also project ledgers written by another process or repository instance.
 *
 * Replacement, truncation, same-size rewrite, and a changed committed boundary
 * reset the projection. Exact cold scans always read the unchanged committed
 * prefix and reject a concurrent mutation before returning.
 */
export class IncrementalJsonLinesProjection<TValue> {
  private committedBytes = 0;
  private completeRecordCount = 0;
  private committedBoundaryHash: string | undefined;
  private signature: FileSignature | undefined;

  constructor(
    private readonly input: {
      readonly path: string;
      readonly resetProjection: () => void;
      readonly project: (value: TValue) => void;
    },
  ) {
    assertNonEmpty(input.path, 'path');
  }

  refresh(): void {
    if (!existsSync(this.input.path)) {
      this.reset();
      return;
    }

    const nextSignature = readSignature(this.input.path);
    if (sameSignature(this.signature, nextSignature)) {
      return;
    }

    if (this.requiresRebuild(nextSignature)) {
      this.input.resetProjection();
      this.committedBytes = 0;
      this.completeRecordCount = 0;
    }

    if (nextSignature.size > this.committedBytes) {
      const scan = scanJsonLinesRange<TValue>({
        path: this.input.path,
        fromByte: this.committedBytes,
        toByte: nextSignature.size,
        visit: this.input.project,
      });
      this.committedBytes += scan.consumedBytes;
      this.completeRecordCount += scan.recordCount;
    }
    this.signature = nextSignature;
    this.committedBoundaryHash = hashCommittedBoundary(this.input.path, this.committedBytes);
  }

  append(values: readonly TValue[]): void {
    if (values.length === 0) {
      return;
    }

    this.refresh();
    const currentSignature = readSignature(this.input.path);
    if (!sameSignature(this.signature, currentSignature)) {
      this.refresh();
    }
    const appendSignature = readSignature(this.input.path);
    if (appendSignature.size !== this.committedBytes) {
      throw new Error(
        `cannot append to ${this.input.path}: JSONL ledger has an incomplete trailing row`,
      );
    }

    const payload = values.map((value) => JSON.stringify(value)).join('\n');
    appendFileSync(this.input.path, `${payload}\n`);
    this.refresh();
  }

  /**
   * Atomically replaces the committed ledger with a caller-computed projection.
   * This is intentionally a single-writer primitive: callers must not compact a
   * ledger that may be appended by another process at the same time.
   */
  replaceCommittedForSingleWriter(values: readonly TValue[]): {
    readonly previousBytes: number;
    readonly currentBytes: number;
  } {
    this.refresh();
    const signature = readSignature(this.input.path);
    if (signature.size !== this.committedBytes) {
      throw new Error(
        `cannot replace ${this.input.path}: JSONL ledger has an incomplete trailing row`,
      );
    }
    const previousBytes = signature.size;
    const payload =
      values.length === 0 ? '' : `${values.map((value) => JSON.stringify(value)).join('\n')}\n`;
    const temporaryPath = `${this.input.path}.compact-${process.pid}-${Date.now()}`;
    try {
      writeFileSync(temporaryPath, payload, { encoding: 'utf8', flag: 'wx' });
      renameSync(temporaryPath, this.input.path);
    } catch (error) {
      if (existsSync(temporaryPath)) {
        unlinkSync(temporaryPath);
      }
      throw error;
    }
    this.refresh();
    return { previousBytes, currentBytes: this.committedBytes };
  }

  scanCommitted(visit: (value: TValue) => void): number {
    this.refresh();
    const expectedCommittedBytes = this.committedBytes;
    const signatureBeforeScan = readSignature(this.input.path);
    const boundaryHashBeforeScan = hashCommittedBoundary(this.input.path, expectedCommittedBytes);
    const scan = scanJsonLinesRange<TValue>({
      path: this.input.path,
      fromByte: 0,
      toByte: expectedCommittedBytes,
      visit,
    });
    const signatureAfterScan = readSignature(this.input.path);
    const boundaryHashAfterScan = hashCommittedBoundary(this.input.path, expectedCommittedBytes);
    if (
      scan.consumedBytes !== expectedCommittedBytes ||
      !sameSignature(signatureBeforeScan, signatureAfterScan) ||
      boundaryHashBeforeScan !== boundaryHashAfterScan
    ) {
      throw new Error(
        `cannot scan ${this.input.path}: JSONL ledger changed during the committed scan`,
      );
    }
    return scan.recordCount;
  }

  diagnostics(): IncrementalJsonLinesProjectionDiagnostics {
    this.refresh();
    const fileBytes = this.signature?.size ?? 0;
    return {
      completeRecordCount: this.completeRecordCount,
      committedBytes: this.committedBytes,
      fileBytes,
      hasIncompleteTrailingRow: fileBytes !== this.committedBytes,
    };
  }

  private requiresRebuild(nextSignature: FileSignature): boolean {
    if (this.signature === undefined) {
      return true;
    }
    if (
      this.signature.device !== nextSignature.device ||
      this.signature.inode !== nextSignature.inode ||
      nextSignature.size < this.committedBytes
    ) {
      return true;
    }
    if (
      nextSignature.size > this.committedBytes &&
      this.committedBoundaryHash !== hashCommittedBoundary(this.input.path, this.committedBytes)
    ) {
      return true;
    }
    return (
      nextSignature.size === this.committedBytes &&
      (this.signature.modifiedAtMs !== nextSignature.modifiedAtMs ||
        this.signature.changedAtMs !== nextSignature.changedAtMs)
    );
  }

  private reset(): void {
    this.input.resetProjection();
    this.committedBytes = 0;
    this.completeRecordCount = 0;
    this.committedBoundaryHash = undefined;
    this.signature = undefined;
  }
}

function scanJsonLinesRange<TValue>(input: {
  readonly path: string;
  readonly fromByte: number;
  readonly toByte: number;
  readonly visit: (value: TValue) => void;
}): { readonly consumedBytes: number; readonly recordCount: number } {
  if (input.toByte <= input.fromByte) {
    return { consumedBytes: 0, recordCount: 0 };
  }

  const descriptor = openSync(input.path, 'r');
  let pending = Buffer.alloc(0);
  let cursor = input.fromByte;
  let bytesReadTotal = 0;
  let recordCount = 0;
  try {
    while (cursor < input.toByte) {
      const requestedBytes = Math.min(SCAN_BUFFER_BYTES, input.toByte - cursor);
      const chunk = Buffer.allocUnsafe(requestedBytes);
      const bytesRead = readSync(descriptor, chunk, 0, requestedBytes, cursor);
      if (bytesRead === 0) {
        break;
      }
      cursor += bytesRead;
      bytesReadTotal += bytesRead;

      const readableChunk = chunk.subarray(0, bytesRead);
      const buffered =
        pending.length === 0 ? readableChunk : Buffer.concat([pending, readableChunk]);
      let lineStart = 0;
      for (;;) {
        const newline = buffered.indexOf(0x0a, lineStart);
        if (newline < 0) {
          break;
        }
        const line = buffered.subarray(lineStart, newline).toString('utf8').trim();
        if (line.length > 0) {
          input.visit(JSON.parse(line) as TValue);
          recordCount += 1;
        }
        lineStart = newline + 1;
      }
      pending = lineStart === buffered.length ? Buffer.alloc(0) : buffered.subarray(lineStart);
    }
  } finally {
    closeSync(descriptor);
  }

  return {
    consumedBytes: bytesReadTotal - pending.length,
    recordCount,
  };
}

function readSignature(path: string): FileSignature {
  const stats = statSync(path);
  return {
    device: stats.dev,
    inode: stats.ino,
    size: stats.size,
    modifiedAtMs: stats.mtimeMs,
    changedAtMs: stats.ctimeMs,
  };
}

function hashCommittedBoundary(path: string, committedBytes: number): string | undefined {
  if (committedBytes === 0) {
    return undefined;
  }
  const fromByte = Math.max(0, committedBytes - REWRITE_BOUNDARY_BYTES);
  const length = committedBytes - fromByte;
  const descriptor = openSync(path, 'r');
  try {
    const buffer = Buffer.allocUnsafe(length);
    const bytesRead = readSync(descriptor, buffer, 0, length, fromByte);
    if (bytesRead !== length) {
      return undefined;
    }
    return createHash('sha256').update(buffer).digest('hex');
  } finally {
    closeSync(descriptor);
  }
}

function sameSignature(left: FileSignature | undefined, right: FileSignature): boolean {
  return (
    left !== undefined &&
    left.device === right.device &&
    left.inode === right.inode &&
    left.size === right.size &&
    left.modifiedAtMs === right.modifiedAtMs &&
    left.changedAtMs === right.changedAtMs
  );
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must be non-empty`);
  }
}
