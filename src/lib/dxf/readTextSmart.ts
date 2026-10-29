// src/lib/dxf/readTextSmart.ts
//
// File.text() always assumes UTF-8. A DXF saved as UTF-16 (a real AutoCAD
// export option) decodes to mostly NUL bytes and the parser then sees "no
// entities". This sniffs the encoding from raw bytes instead.
// Pure function over bytes so it works in the browser and under tests.

export function decodeTextSmart(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(b.subarray(3));
  }
  if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b.subarray(2));

  // No BOM: UTF-16 of mostly-ASCII text has a NUL in every other byte.
  const n = Math.min(b.length, 4000);
  let evenNul = 0, oddNul = 0;
  for (let i = 0; i < n; i++) {
    if (b[i] === 0 && i % 2 === 0) {
      evenNul++;
    } else if (b[i] === 0) {
      oddNul++;
    } else {
      // not a NUL byte
    }
  }
  const half = n / 2;
  if (oddNul > half * 0.4 && evenNul < half * 0.1) return new TextDecoder('utf-16le').decode(b);
  if (evenNul > half * 0.4 && oddNul < half * 0.1) return new TextDecoder('utf-16be').decode(b);

  // Strict UTF-8 first; legacy ANSI exports (accented room names) fall back to latin1.
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); }
  catch { return new TextDecoder('windows-1252').decode(b); }
}
