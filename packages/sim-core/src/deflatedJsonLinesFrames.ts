import { appendFileSync, closeSync, openSync, readSync } from 'node:fs';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

export const DEFLATED_JSON_LINES_FRAME_FORMAT =
  'uint32be-length-prefixed-deflate-raw-jsonl-batch-v1';

export type DeflatedJsonLinesFrameScanResult = {
  readonly consumedBytes: number;
  readonly frameCount: number;
};

/**
 * Appends one independently decompressible JSONL frame. Independent frames keep
 * append-only crash boundaries and allow sparse byte-offset checkpoints.
 */
export function appendDeflatedJsonLinesFrame<TValue>(
  path: string,
  values: readonly TValue[],
): void {
  if (values.length === 0) {
    throw new Error('deflated JSONL frame must contain at least one value');
  }
  const payload = Buffer.from(`${values.map((value) => JSON.stringify(value)).join('\n')}\n`);
  const compressed = deflateRawSync(payload, { level: 6 });
  if (compressed.byteLength > 0xffff_ffff) {
    throw new Error('deflated JSONL frame exceeds uint32 length');
  }
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(compressed.byteLength, 0);
  appendFileSync(path, Buffer.concat([header, compressed]));
}

/**
 * Scans complete frames only and fails closed on truncation, corrupt deflate,
 * malformed JSON, empty frames, or a missing terminal newline.
 */
export function scanDeflatedJsonLinesFrames<TValue>(input: {
  readonly path: string;
  readonly fromByte: number;
  readonly toByte: number;
  readonly onFrame: (values: readonly TValue[], byteOffset: number) => boolean | void;
}): DeflatedJsonLinesFrameScanResult {
  if (input.toByte <= input.fromByte) {
    return { consumedBytes: 0, frameCount: 0 };
  }
  const file = openSync(input.path, 'r');
  let position = input.fromByte;
  let frameCount = 0;
  try {
    while (position < input.toByte) {
      const frameOffset = position;
      if (input.toByte - position < 4) {
        throw new Error(`deflated JSONL file has an incomplete frame header: ${input.path}`);
      }
      const header = Buffer.allocUnsafe(4);
      readExact(file, header, position, input.path);
      position += 4;
      const compressedByteLength = header.readUInt32BE(0);
      if (compressedByteLength === 0 || compressedByteLength > input.toByte - position) {
        throw new Error(`deflated JSONL file has an incomplete frame payload: ${input.path}`);
      }
      const compressed = Buffer.allocUnsafe(compressedByteLength);
      readExact(file, compressed, position, input.path);
      position += compressedByteLength;

      let values: readonly TValue[];
      try {
        const lines = inflateRawSync(compressed).toString('utf8').split('\n');
        if (lines.at(-1) !== '') {
          throw new Error('decompressed frame is missing its terminal newline');
        }
        lines.pop();
        values = lines.map((line) => JSON.parse(line) as TValue);
      } catch (error) {
        throw new Error(`deflated JSONL file contains an invalid frame: ${input.path}`, {
          cause: error,
        });
      }
      if (values.length === 0) {
        throw new Error(`deflated JSONL file contains an empty frame: ${input.path}`);
      }
      frameCount += 1;
      if (input.onFrame(values, frameOffset) === false) {
        return { consumedBytes: position - input.fromByte, frameCount };
      }
    }
    return { consumedBytes: position - input.fromByte, frameCount };
  } finally {
    closeSync(file);
  }
}

function readExact(descriptor: number, buffer: Buffer, position: number, path: string): void {
  let offset = 0;
  while (offset < buffer.byteLength) {
    const bytesRead = readSync(
      descriptor,
      buffer,
      offset,
      buffer.byteLength - offset,
      position + offset,
    );
    if (bytesRead === 0) {
      throw new Error(`deflated JSONL file ended during a frame read: ${path}`);
    }
    offset += bytesRead;
  }
}
