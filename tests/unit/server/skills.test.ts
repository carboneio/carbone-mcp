import { describe, test, expect, afterAll } from 'vitest';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { SkillCatalog, memorySkillFiles } from '@modelcontextprotocol/server/ext/skills';
import { nodeSkillFiles } from '@modelcontextprotocol/server/ext/skills/node';
import { CARBONE_SKILL_URI, SKILLS_DIR, loadServedSkills, servedSkills, servesCarboneSkill } from '../../../src/server/skills.js';

const lock = JSON.parse(readFileSync(new URL('../../../skills.lock.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const noWarning = (message: string) => { throw new Error(`unexpected skills warning: ${message}`); };

/** Every entry under `dir`, as `/`-separated relative paths, folders ending with `/`; symlinks are not followed. */
function walk(dir: string, prefix = ''): string[] {
  return readdirSync(path.join(dir, prefix)).flatMap((name) => {
    const entry = `${prefix}${name}`;
    return lstatSync(path.join(dir, entry)).isDirectory() ? [`${entry}/`, ...walk(dir, `${entry}/`)] : [entry];
  });
}

describe('the shipped skills folder (skills/, written by scripts/sync-skill.mjs)', () => {
  test('serves the Carbone Skill pinned in skills.lock.json, without Codex metadata, and nothing the SDK warns about', async () => {
    // strict: any warning (a symlink, past the limits...) fails the load
    const catalog = await SkillCatalog.load(nodeSkillFiles(SKILLS_DIR), { strict: true });
    expect(catalog.entries.map((s) => s.uri)).toEqual([CARBONE_SKILL_URI]);
    const { frontmatter, resources } = catalog.entries[0]!;
    expect(frontmatter.name).toBe('carbone');
    expect((frontmatter.metadata as { version?: string } | undefined)?.version).toBe(lock.version);
    const uris = (resources as { uri: string }[]).map((r) => r.uri);
    expect(uris).toContain('skill://carbone/references/formatters.md');
    expect(uris.filter((uri) => uri.includes('/agents/'))).toEqual([]);
  });

  test('holds only regular files with plain names inside skills/carbone/: the SDK would skip anything else, npm would still publish it', () => {
    for (const entry of walk(SKILLS_DIR)) {
      const stat = lstatSync(path.join(SKILLS_DIR, entry));
      expect(stat.isFile() || stat.isDirectory(), entry).toBe(true);
      expect(entry.startsWith('carbone/'), entry).toBe(true);
      expect(entry.split('/').filter((segment) => segment.startsWith('.')), entry).toEqual([]);
    }
  });

  test('skills.lock.json pins a version and the archive SHA-256, nothing else (what sync-skill.mjs --check verifies)', () => {
    expect(Object.keys(lock).sort()).toEqual(['sha256', 'version']);
    expect(lock.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    expect(lock.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('loadServedSkills', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'carbone-skills-test-'));
  afterAll(() => rmSync(temp, { recursive: true, force: true }));

  const skill = (dir: string, name: string) => {
    mkdirSync(path.join(dir, name), { recursive: true });
    writeFileSync(path.join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: Test skill ${name}\n---\n\nBody.\n`);
  };

  test('without the folder: a warning and no skill, never an error', async () => {
    const warnings: string[] = [];
    expect(await loadServedSkills((m) => warnings.push(m), path.join(temp, 'missing'))).toBeUndefined();
    expect(warnings).toEqual([expect.stringContaining('no skill is served')]);
  });

  test.skipIf(process.platform === 'win32')('a skill the SDK refuses (it holds a symlink) is skipped with a warning; the others are served', async () => {
    const dir = path.join(temp, 'mixed');
    skill(dir, 'good');
    skill(dir, 'linked');
    symlinkSync(path.join(dir, 'good', 'SKILL.md'), path.join(dir, 'linked', 'other.md'));
    const warnings: string[] = [];
    const catalog = await loadServedSkills((m) => warnings.push(m), dir);
    expect(catalog?.entries.map((s) => s.uri)).toEqual(['skill://good/SKILL.md']);
    expect(warnings).toEqual([expect.stringContaining('linked/other.md')]);
  });

  test('requests are answered from memory: a file changed or removed after loading is served as loaded', async () => {
    const dir = path.join(temp, 'memory');
    skill(dir, 'kept');
    writeFileSync(path.join(dir, 'kept', 'notes.md'), 'as loaded');
    const catalog = (await loadServedSkills(noWarning, dir))!;
    writeFileSync(path.join(dir, 'kept', 'notes.md'), 'changed on disk');
    rmSync(path.join(dir, 'kept', 'SKILL.md'));

    const server = new McpServer({ name: 'skills-test', version: '0' });
    catalog.attach(server);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'skills-test', version: '0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const text = async (uri: string) => ((await client.readResource({ uri })).contents[0] as { text: string }).text;
      expect(await text('skill://kept/notes.md')).toBe('as loaded');
      expect(await text('skill://kept/SKILL.md')).toContain('Test skill kept');
    } finally {
      await client.close();
    }
  });
});

describe('servesCarboneSkill (what the instructions and get_capabilities may name)', () => {
  test('true for the shipped folder', async () => {
    expect(servesCarboneSkill(await loadServedSkills(noWarning))).toBe(true);
  });

  test('false without a catalog, with an empty one, or with other skills only', async () => {
    expect(servesCarboneSkill(undefined)).toBe(false);
    expect(servesCarboneSkill(await SkillCatalog.load(memorySkillFiles({}), { onWarning: () => {} }))).toBe(false);
    const other = await SkillCatalog.load(memorySkillFiles({ 'other/SKILL.md': '---\nname: other\ndescription: A\n---\n' }));
    expect(servesCarboneSkill(other)).toBe(false);
  });
});

describe('servedSkills (the startup log)', () => {
  test('names the shipped skill with its pinned version', async () => {
    expect(servedSkills(await loadServedSkills(noWarning))).toBe(`carbone@${lock.version}`);
  });

  test('name@version for each skill, the name alone without a metadata.version', async () => {
    const catalog = await SkillCatalog.load(memorySkillFiles({
      'versioned/SKILL.md': '---\nname: versioned\ndescription: A\nmetadata:\n  version: "1.2.3"\n---\n',
      'plain/SKILL.md': '---\nname: plain\ndescription: B\n---\n',
    }));
    expect(servedSkills(catalog)).toBe('plain,versioned@1.2.3');
  });

  test('none when no skill is served', async () => {
    expect(servedSkills(undefined)).toBe('none');
    expect(servedSkills(await SkillCatalog.load(memorySkillFiles({}), { onWarning: () => {} }))).toBe('none');
  });
});
