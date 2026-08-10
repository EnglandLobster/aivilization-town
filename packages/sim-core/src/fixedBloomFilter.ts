import { createHash } from 'node:crypto';

/**
 * Fixed-memory negative index. A negative lookup is exact; a positive lookup must be confirmed by
 * the authoritative store because Bloom filters may return false positives.
 */
export class FixedBloomFilter {
  private readonly bytes: Uint8Array;

  constructor(input: { readonly bitCount: number; readonly hashCount: number }) {
    assertPositiveSafeInteger(input.bitCount, 'bitCount');
    assertPositiveSafeInteger(input.hashCount, 'hashCount');
    this.bitCount = input.bitCount;
    this.hashCount = input.hashCount;
    this.bytes = new Uint8Array(Math.ceil(input.bitCount / 8));
  }

  readonly bitCount: number;
  readonly hashCount: number;

  get byteLength(): number {
    return this.bytes.byteLength;
  }

  add(value: string): void {
    for (const bit of this.bitPositions(value)) {
      const byteIndex = Math.floor(bit / 8);
      this.bytes[byteIndex] = this.bytes[byteIndex]! | (1 << (bit % 8));
    }
  }

  mightContain(value: string): boolean {
    return this.bitPositions(value).every(
      (bit) => (this.bytes[Math.floor(bit / 8)]! & (1 << (bit % 8))) !== 0,
    );
  }

  private bitPositions(value: string): number[] {
    const digest = createHash('sha256').update(value, 'utf8').digest();
    const first = digest.readUInt32BE(0);
    const second = (digest.readUInt32BE(4) | 1) >>> 0;
    return Array.from(
      { length: this.hashCount },
      (_, index) => (first + index * second) % this.bitCount,
    );
  }
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}
