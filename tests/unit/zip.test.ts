import { describe, it, expect } from 'vitest';
import { crc32, makeStoredZip } from '@/lib/zip';

describe('crc32', () => {
  it('matches the canonical "123456789" vector', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });
  it('is 0 for empty input', () => {
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });
});

describe('makeStoredZip', () => {
  it('produces a structurally valid zip with the right signatures and entry count', () => {
    const entries = [
      { name: 'a/manifest.json', data: Buffer.from('{"x":1}') },
      { name: 'a/background.js', data: Buffer.from('console.log(1)') },
    ];
    const zip = makeStoredZip(entries);

    // Local file header signature at the start
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);

    // End-of-central-directory at the end (fixed 22-byte EOCD, no comment)
    const eocd = zip.length - 22;
    expect(zip.readUInt32LE(eocd)).toBe(0x06054b50);
    expect(zip.readUInt16LE(eocd + 10)).toBe(2); // total entries
    const cdOffset = zip.readUInt32LE(eocd + 16);
    expect(zip.readUInt32LE(cdOffset)).toBe(0x02014b50); // first central dir header

    // Stored entries embed their raw bytes verbatim
    expect(zip.includes(Buffer.from('console.log(1)'))).toBe(true);
  });
});
