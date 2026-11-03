/**
 * Builds small ZIP archives in memory for tests of the streaming reader and the trade dataset
 * importer. Not a general-purpose writer: it emits exactly the record layouts those tests need,
 * including ZIP64 records, and can deliberately corrupt a member's CRC.
 */
import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipMember {
  name: string;
  data: Buffer | string;
  /** 0 = stored, 8 = deflate (default). Any other number is written as-is to test refusals. */
  method?: number;
  flags?: number;
  corruptCrc?: boolean;
}

export function buildZip(members: ZipMember[], options: { zip64?: boolean } = {}): Buffer {
  const zip64 = options.zip64 ?? false;
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const member of members) {
    const data = typeof member.data === 'string' ? Buffer.from(member.data, 'utf8') : member.data;
    const method = member.method ?? 8;
    const body = method === 8 ? deflateRawSync(data) : data;
    const crc = (member.corruptCrc ? (crc32(data) ^ 0xffff) : crc32(data)) >>> 0;
    const name = Buffer.from(member.name, 'utf8');
    const flags = (member.flags ?? 0) | 0x0800;
    const zip64Extra = Buffer.alloc(4 + 24);
    zip64Extra.writeUInt16LE(0x0001, 0);
    zip64Extra.writeUInt16LE(24, 2);
    zip64Extra.writeBigUInt64LE(BigInt(data.length), 4);
    zip64Extra.writeBigUInt64LE(BigInt(body.length), 12);
    zip64Extra.writeBigUInt64LE(BigInt(offset), 20);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(zip64 ? 45 : 20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(zip64 ? 0xffffffff : body.length, 18);
    local.writeUInt32LE(zip64 ? 0xffffffff : data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const localExtra = zip64 ? Buffer.from(zip64Extra.subarray(0, 20)) : Buffer.alloc(0);
    if (zip64) localExtra.writeUInt16LE(16, 2);
    local.writeUInt16LE(localExtra.length, 28);
    const localRecord = Buffer.concat([local, name, localExtra, body]);
    locals.push(localRecord);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4);
    central.writeUInt16LE(zip64 ? 45 : 20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(zip64 ? 0xffffffff : body.length, 20);
    central.writeUInt32LE(zip64 ? 0xffffffff : data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(zip64 ? zip64Extra.length : 0, 30);
    central.writeUInt32LE(zip64 ? 0xffffffff : offset, 42);
    centrals.push(Buffer.concat([central, name, zip64 ? zip64Extra : Buffer.alloc(0)]));
    offset += localRecord.length;
  }
  const directory = Buffer.concat(centrals);
  const directoryOffset = offset;
  const tail: Buffer[] = [];
  if (zip64) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50, 0);
    record.writeBigUInt64LE(BigInt(44), 4);
    record.writeUInt16LE(45, 12);
    record.writeUInt16LE(45, 14);
    record.writeBigUInt64LE(BigInt(members.length), 24);
    record.writeBigUInt64LE(BigInt(members.length), 32);
    record.writeBigUInt64LE(BigInt(directory.length), 40);
    record.writeBigUInt64LE(BigInt(directoryOffset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(directoryOffset + directory.length), 8);
    locator.writeUInt32LE(1, 16);
    tail.push(record, locator);
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(zip64 ? 0xffff : members.length, 8);
  eocd.writeUInt16LE(zip64 ? 0xffff : members.length, 10);
  eocd.writeUInt32LE(zip64 ? 0xffffffff : directory.length, 12);
  eocd.writeUInt32LE(zip64 ? 0xffffffff : directoryOffset, 16);
  return Buffer.concat([...locals, directory, ...tail, eocd]);
}
