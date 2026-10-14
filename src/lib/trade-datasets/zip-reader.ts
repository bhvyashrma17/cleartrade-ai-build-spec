/**
 * A streaming ZIP reader for multi-gigabyte retained archives (docs/36 §3.1).
 *
 * JSZip, used elsewhere for small authority bundles, holds the whole archive in memory. A BACI
 * release is gigabytes, so this reads the central directory from the end of the file and then
 * streams one member at a time through `inflateRaw`, checking each member's CRC-32 and size
 * against the directory. ZIP64 records are honoured. Encrypted members and compression methods
 * other than stored (0) and deflate (8) are refused rather than guessed at.
 */
import { createReadStream } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { createInflateRaw, crc32 } from 'node:zlib';

export const ZIP_READER_VERSION = 'zip-stream-reader-v1';

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_U16 = 0xffff;
const MAX_U32 = 0xffffffff;
const MAX_EOCD_SEARCH = 22 + MAX_U16;

export interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export class ZipFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipFormatError';
  }
}

function safeNumber(value: bigint, field: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipFormatError(`${field} exceeds the safe integer range.`);
  return Number(value);
}

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) throw new ZipFormatError(`Unexpected end of archive reading ${length} bytes at ${position}.`);
  return buffer;
}

/** Applies a ZIP64 extended-information extra field to the fields the 32-bit record saturated. */
function applyZip64Extra(entry: ZipEntry, extra: Buffer) {
  let offset = 0;
  while (offset + 4 <= extra.length) {
    const headerId = extra.readUInt16LE(offset);
    const size = extra.readUInt16LE(offset + 2);
    const body = extra.subarray(offset + 4, offset + 4 + size);
    if (headerId === 0x0001) {
      let cursor = 0;
      const next = (field: string) => {
        if (cursor + 8 > body.length) throw new ZipFormatError(`ZIP64 extra field is missing ${field} for ${entry.name}.`);
        const value = safeNumber(body.readBigUInt64LE(cursor), field);
        cursor += 8;
        return value;
      };
      if (entry.uncompressedSize === MAX_U32) entry.uncompressedSize = next('uncompressed size');
      if (entry.compressedSize === MAX_U32) entry.compressedSize = next('compressed size');
      if (entry.localHeaderOffset === MAX_U32) entry.localHeaderOffset = next('local header offset');
      return;
    }
    offset += 4 + size;
  }
  if (entry.uncompressedSize === MAX_U32 || entry.compressedSize === MAX_U32 || entry.localHeaderOffset === MAX_U32) {
    throw new ZipFormatError(`Entry ${entry.name} needs a ZIP64 extra field that is not present.`);
  }
}

/** Reads the central directory. Throws on multi-disk, truncated or inconsistent archives. */
export async function listZipEntries(path: string): Promise<ZipEntry[]> {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    if (size < 22) throw new ZipFormatError('File is too small to be a ZIP archive.');
    const tailLength = Math.min(size, MAX_EOCD_SEARCH);
    const tail = await readAt(handle, size - tailLength, tailLength);
    let eocd = -1;
    for (let index = tail.length - 22; index >= 0; index -= 1) {
      if (tail.readUInt32LE(index) === EOCD_SIGNATURE && index + 22 + tail.readUInt16LE(index + 20) === tail.length) { eocd = index; break; }
    }
    if (eocd < 0) throw new ZipFormatError('No end-of-central-directory record found.');
    const diskNumber = tail.readUInt16LE(eocd + 4);
    const directoryDisk = tail.readUInt16LE(eocd + 6);
    let entryCount = tail.readUInt16LE(eocd + 10);
    let directorySize = tail.readUInt32LE(eocd + 12);
    let directoryOffset = tail.readUInt32LE(eocd + 16);
    const eocdPosition = size - tailLength + eocd;

    if (entryCount === MAX_U16 || directorySize === MAX_U32 || directoryOffset === MAX_U32) {
      if (eocdPosition < 20) throw new ZipFormatError('ZIP64 locator expected but missing.');
      const locator = await readAt(handle, eocdPosition - 20, 20);
      if (locator.readUInt32LE(0) !== ZIP64_LOCATOR_SIGNATURE) throw new ZipFormatError('ZIP64 locator expected but missing.');
      const zip64Offset = safeNumber(locator.readBigUInt64LE(8), 'ZIP64 record offset');
      const record = await readAt(handle, zip64Offset, 56);
      if (record.readUInt32LE(0) !== ZIP64_EOCD_SIGNATURE) throw new ZipFormatError('ZIP64 end-of-central-directory record is corrupt.');
      entryCount = safeNumber(record.readBigUInt64LE(32), 'entry count');
      directorySize = safeNumber(record.readBigUInt64LE(40), 'central directory size');
      directoryOffset = safeNumber(record.readBigUInt64LE(48), 'central directory offset');
    } else if (diskNumber !== 0 || directoryDisk !== 0) {
      throw new ZipFormatError('Multi-disk ZIP archives are not supported.');
    }
    if (directoryOffset + directorySize > size) throw new ZipFormatError('Central directory extends past the end of the file.');

    const directory = await readAt(handle, directoryOffset, directorySize);
    const entries: ZipEntry[] = [];
    let offset = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
        throw new ZipFormatError(`Central directory entry ${index} is corrupt.`);
      }
      const flags = directory.readUInt16LE(offset + 8);
      const method = directory.readUInt16LE(offset + 10);
      const nameLength = directory.readUInt16LE(offset + 28);
      const extraLength = directory.readUInt16LE(offset + 30);
      const commentLength = directory.readUInt16LE(offset + 32);
      const nameBytes = directory.subarray(offset + 46, offset + 46 + nameLength);
      const name = (flags & 0x0800 ? nameBytes.toString('utf8') : nameBytes.toString('latin1'));
      const entry: ZipEntry = {
        name,
        method,
        flags,
        crc32: directory.readUInt32LE(offset + 16),
        compressedSize: directory.readUInt32LE(offset + 20),
        uncompressedSize: directory.readUInt32LE(offset + 24),
        localHeaderOffset: directory.readUInt32LE(offset + 42),
      };
      applyZip64Extra(entry, directory.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength));
      if (entry.localHeaderOffset + 30 > size) throw new ZipFormatError(`Entry ${name} points past the end of the file.`);
      entries.push(entry);
      offset += 46 + nameLength + extraLength + commentLength;
    }
    const names = new Set<string>();
    for (const entry of entries) {
      if (names.has(entry.name)) throw new ZipFormatError(`Duplicate member name ${entry.name}.`);
      names.add(entry.name);
    }
    return entries;
  } finally {
    await handle.close();
  }
}

function verifier(entry: ZipEntry) {
  let crc = 0;
  let bytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      crc = crc32(chunk, crc);
      bytes += chunk.length;
      if (bytes > entry.uncompressedSize) { callback(new ZipFormatError(`${entry.name} inflates past its declared size.`)); return; }
      callback(null, chunk);
    },
    flush(callback) {
      if (bytes !== entry.uncompressedSize) { callback(new ZipFormatError(`${entry.name} is ${bytes} bytes; the directory declares ${entry.uncompressedSize}.`)); return; }
      if ((crc >>> 0) !== (entry.crc32 >>> 0)) { callback(new ZipFormatError(`${entry.name} fails its CRC-32 check.`)); return; }
      callback();
    },
  });
}

/** Streams one member's decompressed bytes; the stream errors on any size or CRC mismatch. */
export async function openZipEntry(path: string, entry: ZipEntry): Promise<Readable> {
  if (entry.flags & 0x0001) throw new ZipFormatError(`${entry.name} is encrypted.`);
  if (entry.method !== 0 && entry.method !== 8) throw new ZipFormatError(`${entry.name} uses unsupported compression method ${entry.method}.`);
  const handle = await open(path, 'r');
  let dataOffset: number;
  try {
    const local = await readAt(handle, entry.localHeaderOffset, 30);
    if (local.readUInt32LE(0) !== LOCAL_SIGNATURE) throw new ZipFormatError(`${entry.name} has a corrupt local header.`);
    dataOffset = entry.localHeaderOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
  } finally {
    await handle.close();
  }
  if (entry.compressedSize === 0) return Readable.from([]).pipe(verifier(entry));
  const raw = createReadStream(path, { start: dataOffset, end: dataOffset + entry.compressedSize - 1 });
  const check = verifier(entry);
  const forward = (error: Error) => check.destroy(error);
  if (entry.method === 0) {
    raw.on('error', forward);
    return raw.pipe(check);
  }
  const inflate = createInflateRaw();
  raw.on('error', forward);
  inflate.on('error', (error) => check.destroy(new ZipFormatError(`${entry.name} is not valid deflate data: ${error.message}`)));
  return raw.pipe(inflate).pipe(check);
}
