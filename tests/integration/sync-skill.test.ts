import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * scripts/sync-skill.mjs against crafted releases, in a temporary repository with fetch stubbed (no network, this
 * repository untouched). Archives are built with the `zip` command.
 */

const SCRIPT = fileURLToPath(new URL('../../scripts/sync-skill.mjs', import.meta.url));
const RELEASE = 'https://github.com/carboneio/carbone-agent-plugin/releases/download';
const hasZip = process.platform !== 'win32' && ['zip', 'unzip'].every((tool) => spawnSync(tool, ['-v']).status === 0);
const skillMd = (version: string) => `---\nname: carbone\ndescription: Test skill\nmetadata:\n  version: "${version}"\n---\n\nBody.\n`;
const SECRET = 'TOKEN=do-not-copy';

describe.skipIf(!hasZip)('scripts/sync-skill.mjs', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'sync-skill-test-'));
  const repo = path.join(temp, 'repo');
  const target = path.join(repo, 'skills', 'carbone');
  const lockFile = path.join(repo, 'skills.lock.json');
  const fetchLog = path.join(temp, 'fetched.log');
  const secret = path.join(temp, 'secret.txt');
  const outside = path.join(temp, 'outside');
  let good: string;
  afterAll(() => rmSync(temp, { recursive: true, force: true }));

  beforeAll(() => {
    mkdirSync(path.join(repo, 'scripts'), { recursive: true });
    mkdirSync(outside);
    copyFileSync(SCRIPT, path.join(repo, 'scripts', 'sync-skill.mjs'));
    writeFileSync(secret, SECRET);
    writeFileSync(path.join(temp, 'stub-fetch.mjs'), [
      "import { appendFileSync, readFileSync } from 'node:fs';",
      'globalThis.fetch = async (url) => {',
      "  appendFileSync(process.env.FETCH_LOG, `${url}\\n`);",
      '  const status = Number(process.env.FETCH_STATUS ?? 200);',
      "  return status === 200 ? new Response(readFileSync(process.env.SKILL_ARCHIVE)) : new Response('', { status });",
      '};',
    ].join('\n'));
    good = archive({ 'carbone/SKILL.md': skillMd('9.0.0'), 'carbone/references/a.md': 'A', 'carbone/agents/openai.yaml': 'codex' });
  });

  let built = 0;
  /** A carbone.skill of `files` (path → content, or a symlink target), without folder entries like the release. */
  function archive(files: Record<string, string | { link: string }>, mode?: number): string {
    const dir = path.join(temp, `build-${++built}`);
    for (const [name, content] of Object.entries(files)) {
      const file = path.join(dir, name);
      mkdirSync(path.dirname(file), { recursive: true });
      if (typeof content === 'string') writeFileSync(file, content);
      else symlinkSync(content.link, file);
      if (mode !== undefined && typeof content === 'string') chmodSync(file, mode);
    }
    const zip = path.join(temp, `release-${built}.skill`);
    execFileSync('zip', ['-q', '-y', '-D', zip, ...Object.keys(files)], { cwd: dir });
    return zip;
  }

  /** Runs the script; the release URL serves `served`. */
  function run(args: string[], served = good, env: Record<string, string> = {}) {
    const result = spawnSync(process.execPath, ['--import', path.join(temp, 'stub-fetch.mjs'), 'scripts/sync-skill.mjs', ...args], {
      cwd: repo, encoding: 'utf8', env: { ...process.env, SKILL_ARCHIVE: served, FETCH_LOG: fetchLog, ...env },
    });
    return { code: result.status, output: `${result.stdout}${result.stderr}` };
  }
  const fetched = () => readFileSync(fetchLog, 'utf8').trim().split('\n');
  const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
  /** Every file under the synced folder holding the secret. */
  const leaks = (dir = path.join(repo, 'skills')): string[] => readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (lstatSync(file).isDirectory()) return leaks(file);
    return readFileSync(file, 'utf8').includes(SECRET) ? [file] : [];
  });

  test('syncs a release: its files without the Codex metadata, written 0644, pinned by version and SHA-256; --check passes', () => {
    const loose = archive({ 'carbone/SKILL.md': skillMd('9.0.0'), 'carbone/references/a.md': 'A' }, 0o777);
    expect(run(['9.0.0'], loose)).toMatchObject({ code: 0 });
    expect(fetched().at(-1)).toBe(`${RELEASE}/v9.0.0/carbone.skill`);
    expect(statSync(path.join(target, 'references/a.md')).mode & 0o777).toBe(0o644);

    expect(run(['9.0.0'])).toMatchObject({ code: 0 });
    expect(readdirSync(target).sort()).toEqual(['SKILL.md', 'references']);
    expect(JSON.parse(readFileSync(lockFile, 'utf8'))).toEqual({ version: '9.0.0', sha256: sha256(good) });
    expect(run(['--check'])).toMatchObject({ code: 0, output: expect.stringContaining('matches carbone-agent-plugin v9.0.0') });
  });

  test('--check names every file edited by hand, added or removed', () => {
    run(['9.0.0']);
    writeFileSync(path.join(target, 'references/a.md'), 'edited');
    writeFileSync(path.join(target, 'extra.md'), 'added');
    rmSync(path.join(target, 'SKILL.md'));
    const { code, output } = run(['--check']);
    expect(code).toBe(1);
    for (const problem of ['changed: references/a.md', 'not in the release: extra.md', 'missing: SKILL.md']) expect(output).toContain(problem);
  });

  test('--check fails when the release no longer has the pinned SHA-256', () => {
    run(['9.0.0']);
    const replaced = archive({ 'carbone/SKILL.md': skillMd('9.0.0'), 'carbone/references/a.md': 'replaced' });
    expect(run(['--check'], replaced)).toMatchObject({ code: 1, output: expect.stringContaining(`pinned ${sha256(good)}`) });
  });

  test('--check refuses a symlink committed in skills/carbone/', () => {
    run(['9.0.0']);
    symlinkSync(secret, path.join(target, 'references/leak.md'));
    expect(run(['--check'])).toMatchObject({ code: 1, output: expect.stringContaining('references/leak.md is not a regular file') });
  });

  test.each([
    ['absolute', () => secret],
    ['relative', () => '../../../secret.txt'],
  ])('refuses a release holding a symlink (%s): no file is copied', (_, link) => {
    run(['9.0.0']);
    const evil = archive({ 'carbone/SKILL.md': skillMd('9.0.0'), 'carbone/references/leak.md': { link: link() } });
    expect(run(['9.0.0'], evil)).toMatchObject({ code: 1, output: expect.stringContaining('not regular files: carbone/references/leak.md') });
    expect(leaks()).toEqual([]);
  });

  test('refuses a symlinked folder, and writes nothing through it', () => {
    const evil = archive({ 'carbone/SKILL.md': skillMd('9.0.0'), 'carbone/references': { link: outside } });
    const through = path.join(temp, 'through');
    mkdirSync(path.join(through, 'carbone/references'), { recursive: true });
    writeFileSync(path.join(through, 'carbone/references/x.md'), 'written through the link');
    execFileSync('zip', ['-q', '-D', evil, 'carbone/references/x.md'], { cwd: through });
    expect(run(['9.0.0'], evil)).toMatchObject({ code: 1, output: expect.stringContaining('not regular files: carbone/references') });
    expect(readdirSync(outside)).toEqual([]);
  });

  test('refuses entries outside carbone/ or hidden', () => {
    const evil = archive({ 'carbone/SKILL.md': skillMd('9.0.0'), 'other/x.md': 'x', 'carbone/.env': 'x' });
    const { code, output } = run(['9.0.0'], evil);
    expect(code).toBe(1);
    expect(output).toContain('unexpected entries');
    expect(output).toContain('other/x.md');
    expect(output).toContain('carbone/.env');
  });

  test('refuses a release past the per-skill limits (16 MiB), before extracting it', () => {
    const big = archive({ 'carbone/SKILL.md': skillMd('9.0.0'), 'carbone/references/big.md': '0'.repeat(16 * 1024 * 1024) });
    expect(run(['9.0.0'], big)).toMatchObject({ code: 1, output: expect.stringContaining('over 512 / 16777216') });
  });

  test('refuses a release whose SKILL.md is another version', () => {
    expect(run(['9.0.1'])).toMatchObject({ code: 1, output: expect.stringContaining('SKILL.md says version 9.0.0, expected 9.0.1') });
  });

  test.each([
    ['a version that could point the download elsewhere', { version: '9.0.0/../../../../../attacker/evil/releases/download/v1', sha256: 'a'.repeat(64) }],
    ['a malformed SHA-256', { version: '9.0.0', sha256: 'xyz' }],
    ['a URL field', { version: '9.0.0', sha256: 'a'.repeat(64), url: 'https://example.test/evil.skill' }],
  ])('--check refuses a lock with %s, without downloading anything', (_, lock) => {
    writeFileSync(fetchLog, '');
    writeFileSync(lockFile, JSON.stringify(lock));
    const { code, output } = run(['--check']);
    if ('url' in lock) {
      // Ignored: the URL is always built from the version
      expect(fetched()).toEqual([`${RELEASE}/v9.0.0/carbone.skill`]);
      expect(code).toBe(1);
    } else {
      expect({ code, output }).toMatchObject({ code: 1, output: expect.stringContaining('skills.lock.json: needs a version') });
      expect(readFileSync(fetchLog, 'utf8')).toBe('');
    }
  });

  test('a missing release fails at once, without retrying', () => {
    writeFileSync(fetchLog, '');
    expect(run(['9.9.9'], good, { FETCH_STATUS: '404' })).toMatchObject({ code: 1, output: expect.stringContaining('HTTP 404') });
    expect(fetched()).toHaveLength(1);
  });

  test.each([[[]], [['v9.0.0']], [['9.0.0/../x']]])('refuses arguments that are not a version or --check: %j', (args) => {
    expect(run(args)).toMatchObject({ code: 1, output: expect.stringContaining('usage:') });
  });
});
