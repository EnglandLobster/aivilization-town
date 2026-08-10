import { describe, expect, test } from 'vitest';
import { FixedBloomFilter } from './fixedBloomFilter';

describe('fixed Bloom filter', () => {
  test('has exact negatives before insertion and no false negatives after insertion', () => {
    const filter = new FixedBloomFilter({ bitCount: 128, hashCount: 7 });

    expect(filter.mightContain('trace-1')).toBe(false);
    filter.add('trace-1');

    expect(filter.mightContain('trace-1')).toBe(true);
    expect(filter.bitCount).toBe(128);
    expect(filter.hashCount).toBe(7);
    expect(filter.byteLength).toBe(16);
  });

  test('validates fixed-memory policy inputs', () => {
    expect(() => new FixedBloomFilter({ bitCount: 0, hashCount: 7 })).toThrow(
      'bitCount must be a positive safe integer',
    );
    expect(() => new FixedBloomFilter({ bitCount: 8, hashCount: 0 })).toThrow(
      'hashCount must be a positive safe integer',
    );
  });
});
