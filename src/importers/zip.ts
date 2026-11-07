import { assert } from '../model/assert';

/**
 * Minimal ZIP reader — just enough to open a WhatsApp export (iPhone always zips the chat).
 * Reads the central directory, then inflates one entry with the browser's built-in
 * DecompressionStream, so no library is needed. Stored (0) and deflate (8) entries only.
 */

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const MAX_COMMENT = 0xffff;

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true) === LOCAL_HEADER;
}

export function listZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - MAX_COMMENT); i--) {
    if (view.getUint32(i, true) === END_OF_CENTRAL_DIRECTORY) {
      end = i;
      break;
    }
  }
  assert(end !== -1, 'this file is not a valid zip archive');
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const decoder = new TextDecoder('utf-8');
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    assert(view.getUint32(offset, true) === CENTRAL_ENTRY, 'zip archive is damaged (central directory)');
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    entries.push({
      method: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      localHeaderOffset: view.getUint32(offset + 42, true),
      name: decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export async function readZipEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = entry.localHeaderOffset;
  assert(view.getUint32(at, true) === LOCAL_HEADER, 'zip archive is damaged (local header)');
  const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) {
    return data;
  }
  assert(entry.method === 8, `zip entry "${entry.name}" uses an unsupported compression (${entry.method})`);
  // slice() copies into a plain ArrayBuffer, which Blob requires (a view may sit on a SharedArrayBuffer).
  const inflated = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(inflated).arrayBuffer());
}
