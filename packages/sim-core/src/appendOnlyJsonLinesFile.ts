import {
  appendFileSync,
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs';

type FileSignature = {
  readonly device: number;
  readonly inode: number;
  readonly size: number;
  readonly modifiedAtMs: number;
  readonly changedAtMs: number;
};

/**
 * Keeps an in-process projection of an append-only JSONL file.
 *
 * Reads are backed by a stable array until the file changes. Appends are parsed
 * incrementally, while replacement or truncation rebuilds the projection. This
 * preserves restart and cross-instance visibility without reparsing the entire
 * log for every repository lookup.
 */
export class AppendOnlyJsonLinesFile<TValue> {
  private records: TValue[] = [];
  private committedBytes = 0;
  private signature: FileSignature | undefined;

  constructor(private readonly path: string) {
    assertNonEmpty(path, 'path');
  }

  read(): readonly TValue[] {
    this.refresh();
    return this.records;
  }

  append(values: readonly TValue[]): void {
    if (values.length === 0) {
      return;
    }

    // Observe externally appended rows before writing our own rows. The second
    // refresh then projects every byte committed since the previous offset.
    this.refresh();
    const payload = values.map((value) => JSON.stringify(value)).join('\n');
    appendFileSync(this.path, `${payload}\n`);
    this.refresh();
  }

  private refresh(): void {
    if (!existsSync(this.path)) {
      this.reset();
      return;
    }

    const nextSignature = readSignature(this.path);
    if (sameSignature(this.signature, nextSignature)) {
      return;
    }

    if (this.requiresRebuild(nextSignature)) {
      const content = readFileSync(this.path);
      const parsed = parseCompleteJsonLines<TValue>(content);
      this.records = parsed.values;
      this.committedBytes = parsed.consumedBytes;
      this.signature = nextSignature;
      return;
    }

    if (nextSignature.size > this.committedBytes) {
      const suffix = readFileRange(this.path, this.committedBytes, nextSignature.size);
      const parsed = parseCompleteJsonLines<TValue>(suffix);
      this.records.push(...parsed.values);
      this.committedBytes += parsed.consumedBytes;
    }
    this.signature = nextSignature;
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

    // A metadata change without growth means the append-only contract was not
    // followed (for example, an in-place rewrite). Rebuild defensively.
    return (
      nextSignature.size === this.committedBytes &&
      (this.signature.modifiedAtMs !== nextSignature.modifiedAtMs ||
        this.signature.changedAtMs !== nextSignature.changedAtMs)
    );
  }

  private reset(): void {
    this.records = [];
    this.committedBytes = 0;
    this.signature = undefined;
  }
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

function readFileRange(path: string, fromByte: number, toByte: number): Buffer {
  const length = toByte - fromByte;
  const buffer = Buffer.allocUnsafe(length);
  const descriptor = openSync(path, 'r');
  try {
    let offset = 0;
    while (offset < length) {
      const bytesRead = readSync(descriptor, buffer, offset, length - offset, fromByte + offset);
      if (bytesRead === 0) {
        break;
      }
      offset += bytesRead;
    }
    return offset === length ? buffer : buffer.subarray(0, offset);
  } finally {
    closeSync(descriptor);
  }
}

function parseCompleteJsonLines<TValue>(content: Buffer): {
  readonly values: TValue[];
  readonly consumedBytes: number;
} {
  const lastNewline = content.lastIndexOf(0x0a);
  if (lastNewline < 0) {
    return { values: [], consumedBytes: 0 };
  }

  const completeContent = content.subarray(0, lastNewline).toString('utf8').trim();
  return {
    values:
      completeContent.length === 0
        ? []
        : completeContent.split('\n').map((line) => JSON.parse(line) as TValue),
    consumedBytes: lastNewline + 1,
  };
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}
