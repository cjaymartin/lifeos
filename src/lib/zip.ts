// Minimal dependency-free ZIP writer (STORE / no compression). Enough to
// package the small text-file browser extension for download — avoids pulling
// in archiver/jszip and works anywhere Node runs (the prod container has no
// `zip` binary). Files are tiny, so skipping deflate is fine.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry { name: string; data: Buffer; }

/** Build a valid ZIP (stored, uncompressed) from in-memory entries. */
export function makeStoredZip(entries: ZipEntry[]): Buffer {
  const fileChunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const DOS_TIME = 0;       // 00:00:00
  const DOS_DATE = 0x21;    // 1980-01-01 (minimal valid DOS date)

  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const size = e.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4);         // version needed
    local.writeUInt16LE(0, 6);          // flags
    local.writeUInt16LE(0, 8);          // method: 0 = store
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);      // compressed size
    local.writeUInt32LE(size, 20 + 2);  // uncompressed size (offset 22)
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);         // extra length
    fileChunks.push(local, name, e.data);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);   // central dir header signature
    cen.writeUInt16LE(20, 4);           // version made by
    cen.writeUInt16LE(20, 6);           // version needed
    cen.writeUInt16LE(0, 8);            // flags
    cen.writeUInt16LE(0, 10);           // method
    cen.writeUInt16LE(DOS_TIME, 12);
    cen.writeUInt16LE(DOS_DATE, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(size, 20);        // compressed
    cen.writeUInt32LE(size, 24);        // uncompressed
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt16LE(0, 30);           // extra
    cen.writeUInt16LE(0, 32);           // comment
    cen.writeUInt16LE(0, 34);           // disk number start
    cen.writeUInt16LE(0, 36);           // internal attrs
    cen.writeUInt32LE(0, 38);           // external attrs
    cen.writeUInt32LE(offset, 42);      // local header offset
    central.push(cen, name);

    offset += local.length + name.length + e.data.length;
  }

  const cd = Buffer.concat(central);
  const cdOffset = offset;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);    // end of central dir signature
  eocd.writeUInt16LE(0, 4);             // disk number
  eocd.writeUInt16LE(0, 6);             // disk with central dir
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);            // comment length

  return Buffer.concat([...fileChunks, cd, eocd]);
}
