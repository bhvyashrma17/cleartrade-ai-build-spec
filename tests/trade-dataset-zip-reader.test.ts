import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { listZipEntries, openZipEntry, ZipFormatError } from '../src/lib/trade-datasets/zip-reader';
import { buildZip, type ZipMember } from './zip-builder';

const dir = mkdtempSync(join(tmpdir(), 'zip-reader-'));
let counter = 0;
function writeZip(members: ZipMember[], options?: { zip64?: boolean }) {
  const path = join(dir, `archive-${counter += 1}.zip`);
  writeFileSync(path, buildZip(members, options));
  return path;
}

async function readAll(path: string, name: string): Promise<Buffer> {
  const entry = (await listZipEntries(path)).find((candidate) => candidate.name === name)!;
  const chunks: Buffer[] = [];
  for await (const chunk of await openZipEntry(path, entry)) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

describe('streaming ZIP reader', () => {
  test('lists members and streams stored and deflated members byte for byte', async () => {
    const big = 'a,b,c\n'.repeat(50_000);
    const path = writeZip([{ name: 'stored.txt', data: 'hello', method: 0 }, { name: 'dir/big.csv', data: big }, { name: 'empty.txt', data: '', method: 0 }]);
    const entries = await listZipEntries(path);
    expect(entries.map((entry) => entry.name)).toEqual(['stored.txt', 'dir/big.csv', 'empty.txt']);
    expect(entries[1].uncompressedSize).toBe(big.length);
    expect(entries[1].compressedSize).toBeLessThan(big.length);
    expect((await readAll(path, 'stored.txt')).toString()).toBe('hello');
    expect((await readAll(path, 'dir/big.csv')).toString()).toBe(big);
    expect((await readAll(path, 'empty.txt')).length).toBe(0);
  });

  test('reads ZIP64 directories and size fields', async () => {
    const path = writeZip([{ name: 'one.csv', data: 'x\n'.repeat(1000) }, { name: 'two.csv', data: 'y\n', method: 0 }], { zip64: true });
    const entries = await listZipEntries(path);
    expect(entries.map((entry) => [entry.name, entry.uncompressedSize])).toEqual([['one.csv', 2000], ['two.csv', 2]]);
    expect((await readAll(path, 'one.csv')).toString()).toBe('x\n'.repeat(1000));
    expect((await readAll(path, 'two.csv')).toString()).toBe('y\n');
  });

  test('a member whose bytes do not match its CRC-32 errors instead of yielding silently wrong data', async () => {
    const path = writeZip([{ name: 'bad.csv', data: 'value\n'.repeat(100), corruptCrc: true }]);
    await expect(readAll(path, 'bad.csv')).rejects.toThrow(/CRC-32/);
  });

  test('encrypted members and unsupported compression are refused, not guessed at', async () => {
    const path = writeZip([{ name: 'secret.csv', data: 'x', method: 0, flags: 0x0001 }, { name: 'bzip.csv', data: 'x', method: 12 }]);
    const [secret, bzip] = await listZipEntries(path);
    await expect(openZipEntry(path, secret)).rejects.toThrow(/encrypted/);
    await expect(openZipEntry(path, bzip)).rejects.toThrow(/unsupported compression method 12/);
  });

  test('a truncated archive has no directory and is refused', async () => {
    const bytes = buildZip([{ name: 'a.csv', data: 'a\n' }]);
    const path = join(dir, 'truncated.zip');
    writeFileSync(path, bytes.subarray(0, bytes.length - 10));
    await expect(listZipEntries(path)).rejects.toBeInstanceOf(ZipFormatError);
  });

  test('duplicate member names are refused', async () => {
    const path = writeZip([{ name: 'same.csv', data: '1' }, { name: 'same.csv', data: '2' }]);
    await expect(listZipEntries(path)).rejects.toThrow(/Duplicate member name/);
  });
});
