import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, symlink, stat, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { writeOutputFile } from '../../src/utils/file.js';
import { deliverDocument } from '../../src/tools/output.js';

// Real filesystem, inside a scratch directory created (and removed) by each test.
const POSIX = process.platform !== 'win32';
let dir: string;

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'carbone-mcp-test-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('outputPath (stdio) never overwrites or follows an existing path', () => {
  test('a new path is created with the document, readable by the user only', async () => {
    const target = join(dir, 'out.pdf');
    const result = await writeOutputFile(target, Buffer.from('%PDF-new'));

    expect(result).toEqual({ path: target, size: 8 });
    expect(await readFile(target, 'utf8')).toBe('%PDF-new');
    if (POSIX) expect((await stat(target)).mode & 0o777).toBe(0o600);
  });

  test('an existing file is refused and left untouched', async () => {
    const target = join(dir, 'existing.pdf');
    await writeFile(target, 'original');

    await expect(writeOutputFile(target, Buffer.from('%PDF-new'))).rejects.toThrow(/already exists — refusing to overwrite it\. Choose a new file name/);
    expect(await readFile(target, 'utf8')).toBe('original');
  });

  test.skipIf(!POSIX)('a symlink is refused and its target left untouched (dangling ones too)', async () => {
    const victim = join(dir, 'victim.txt');
    await writeFile(victim, 'do not touch');
    await symlink(victim, join(dir, 'link.pdf'));
    await symlink(join(dir, 'not-created.txt'), join(dir, 'dangling.pdf'));

    await expect(writeOutputFile(join(dir, 'link.pdf'), Buffer.from('%PDF'))).rejects.toThrow(/already exists/);
    await expect(writeOutputFile(join(dir, 'dangling.pdf'), Buffer.from('%PDF'))).rejects.toThrow(/already exists/);
    expect(await readFile(victim, 'utf8')).toBe('do not touch');
    await expect(lstat(join(dir, 'not-created.txt'))).rejects.toThrow(/ENOENT/);
  });

  test('render/convert delivery with outputPath reports the refusal instead of overwriting', async () => {
    const target = join(dir, 'report.pdf');
    await writeFile(target, 'original');
    await expect(deliverDocument({
      buffer: Buffer.from('%PDF'), filename: 'report.pdf', format: 'pdf', outputPath: target, allowFileOutput: true,
    })).rejects.toThrow(/already exists/);
    expect(await readFile(target, 'utf8')).toBe('original');
  });
});

describe('default temp-file delivery (stdio, no outputPath)', () => {
  let savedTmp: Record<string, string | undefined>;
  beforeEach(() => {
    savedTmp = { TMPDIR: process.env['TMPDIR'], TMP: process.env['TMP'], TEMP: process.env['TEMP'] };
    process.env['TMPDIR'] = process.env['TMP'] = process.env['TEMP'] = dir; // os.tmpdir() → the scratch dir
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(savedTmp)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test('each document gets a fresh private directory; a planted file or symlink is never touched', async () => {
    const victim = join(dir, 'victim.txt');
    await writeFile(victim, 'do not touch');
    if (POSIX) await symlink(victim, join(dir, 'invoice.pdf')); // classic shared-/tmp symlink plant
    else await writeFile(join(dir, 'invoice.pdf'), 'do not touch');

    const paths: string[] = [];
    for (const body of ['%PDF-1', '%PDF-2']) {
      const r = await deliverDocument({ buffer: Buffer.from(body), filename: 'invoice.pdf', format: 'pdf', allowFileOutput: true });
      const text = (r.content[0] as { text: string }).text;
      const path = text.match(/saved to (.+?invoice\.pdf)\./)![1]!;
      paths.push(path);
      expect(basename(path)).toBe('invoice.pdf');
      expect(dirname(dirname(path))).toBe(dir);
      expect(basename(dirname(path))).toMatch(/^carbone-mcp-/);
      expect(await readFile(path, 'utf8')).toBe(body);
      if (POSIX) {
        expect((await stat(path)).mode & 0o777).toBe(0o600);
        expect((await stat(dirname(path))).mode & 0o777).toBe(0o700);
      }
    }
    expect(paths[0]).not.toBe(paths[1]);
    expect(await readFile(victim, 'utf8')).toBe('do not touch');
  });
});
