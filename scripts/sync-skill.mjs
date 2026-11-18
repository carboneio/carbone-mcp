#!/usr/bin/env node
// Vendors the Carbone Skill from a carbone-agent-plugin release into skills/carbone/ (committed, served by
// src/server/skills.ts). Never edit that folder by hand: release the skill upstream, then sync.
//
//   node scripts/sync-skill.mjs <version>   copy v<version>'s carbone.skill, pin its SHA-256 in skills.lock.json
//   node scripts/sync-skill.mjs --check     fail if skills/carbone/ differs from the pinned release (CI)
//
// The archive is untrusted: only regular files inside carbone/ are accepted. Needs the `unzip` command.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LOCK = path.join(ROOT, 'skills.lock.json');
const SKILL = 'carbone';
const TARGET = path.join(ROOT, 'skills', SKILL);
/** No `/`: the release URL is built from it. */
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[0-9a-f]{64}$/;
/** The MCP Skills per-skill limits (the SDK's SKILL_LIMITS). */
const MAX_FILES = 512;
const MAX_BYTES = 16 * 1024 * 1024;
/** Codex display metadata, of no use to MCP hosts. */
const EXCLUDED = ['agents/'];
/** An archive entry: inside carbone/, no empty, hidden, `.` or `..` segment. */
const ENTRY = new RegExp(`^${SKILL}/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$`);

const releaseUrl = (version) => `https://github.com/carboneio/carbone-agent-plugin/releases/download/v${version}/carbone.skill`;

/** Reported without a stack; thrown so the temporary folder is still removed. */
class Failure extends Error {}

try {
  const arg = process.argv[2];
  if (arg === '--check') await check();
  else if (VERSION.test(arg ?? '')) await sync(arg);
  else fail('usage: node scripts/sync-skill.mjs <version> | --check');
} catch (error) {
  console.error(`sync-skill: ${error instanceof Failure ? error.message : error.stack}`);
  process.exitCode = 1;
}

async function sync(version) {
  const url = releaseUrl(version);
  const archive = await download(url);
  await withExtracted(archive, (dir, files) => {
    const found = skillVersion(path.join(dir, 'SKILL.md'));
    if (found !== version) fail(`${url}: SKILL.md says version ${found}, expected ${version}`);
    rmSync(TARGET, { recursive: true, force: true });
    for (const file of files) {
      mkdirSync(path.dirname(path.join(TARGET, file)), { recursive: true });
      writeFileSync(path.join(TARGET, file), readFileSync(path.join(dir, file)), { mode: 0o644 });
    }
    writeFileSync(LOCK, `${JSON.stringify({ version, sha256: sha256(archive) }, null, 2)}\n`);
    console.log(`skills/${SKILL}: carbone-agent-plugin v${version}, ${files.length} files`);
    for (const file of files) console.log(`  ${file}`);
  });
}

async function check() {
  const { version, sha256: pinned } = JSON.parse(readFileSync(LOCK, 'utf8'));
  // The URL is built from the version: a malformed one could redirect the download.
  if (!VERSION.test(String(version)) || !SHA256.test(String(pinned))) {
    fail('skills.lock.json: needs a version (x.y.z) and a SHA-256 (64 hex characters); run node scripts/sync-skill.mjs <version>');
  }
  const archive = await download(releaseUrl(version));
  if (sha256(archive) !== pinned) fail(`${releaseUrl(version)}: SHA-256 ${sha256(archive)}, pinned ${pinned}`);
  await withExtracted(archive, (dir, files) => {
    const committed = listFiles(TARGET);
    const problems = [
      ...files.filter((f) => !committed.includes(f)).map((f) => `missing: ${f}`),
      ...committed.filter((f) => !files.includes(f)).map((f) => `not in the release: ${f}`),
      ...files.filter((f) => committed.includes(f) && !readFileSync(path.join(dir, f)).equals(readFileSync(path.join(TARGET, f))))
        .map((f) => `changed: ${f}`),
    ];
    if (problems.length) {
      fail(`skills/${SKILL} differs from carbone-agent-plugin v${version}:\n  ${problems.join('\n  ')}\n` +
        `Run node scripts/sync-skill.mjs ${version} (never edit skills/${SKILL} by hand).`);
    }
    console.log(`skills/${SKILL} matches carbone-agent-plugin v${version} (${files.length} files)`);
  });
}

/**
 * Extracts the archive into a temporary folder for `use`, after refusing anything but regular files: a symlink could
 * leak or overwrite files outside it.
 */
async function withExtracted(archive, use) {
  const temp = mkdtempSync(path.join(tmpdir(), 'carbone-skill-'));
  try {
    const zip = path.join(temp, 'carbone.skill');
    writeFileSync(zip, archive);
    const entries = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n').filter(Boolean);
    const bad = entries.filter((e) => !ENTRY.test(e));
    if (bad.length) fail(`carbone.skill has unexpected entries: ${bad.join(', ')}`);
    if (!entries.includes(`${SKILL}/SKILL.md`)) fail(`carbone.skill has no ${SKILL}/SKILL.md`);
    // zipinfo: two header lines, one line per entry starting with its type (`-` a regular file), then the totals.
    const listing = execFileSync('unzip', ['-Z', zip], { encoding: 'utf8' }).trimEnd().split('\n');
    const rows = listing.slice(2, -1);
    const notFiles = entries.filter((e, i) => !rows[i]?.startsWith('-') || !rows[i].endsWith(` ${e}`));
    if (rows.length !== entries.length || notFiles.length) fail(`carbone.skill has entries that are not regular files: ${notFiles.join(', ')}`);
    const bytes = Number(/(\d+) bytes uncompressed/.exec(listing.at(-1))?.[1] ?? Infinity);
    if (entries.length > MAX_FILES || bytes > MAX_BYTES) fail(`carbone.skill: ${entries.length} files / ${bytes} bytes, over ${MAX_FILES} / ${MAX_BYTES}`);
    execFileSync('unzip', ['-q', zip, '-d', path.join(temp, 'x')]);
    const files = entries.map((e) => e.slice(SKILL.length + 1)).filter((f) => !EXCLUDED.some((x) => f.startsWith(x))).sort();
    const dir = path.join(temp, 'x', SKILL);
    for (const f of files) if (!lstatSync(path.join(dir, f)).isFile()) fail(`carbone.skill: ${f} is not a regular file`);
    await use(dir, files);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

/** Sorted relative paths of the files under `dir` ([] if missing); fails on anything but a regular file. */
function listFiles(dir, prefix = '') {
  let entries;
  try {
    entries = readdirSync(path.join(dir, prefix), { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT' && prefix === '') return [];
    throw error;
  }
  return entries.flatMap((e) => {
    if (e.isDirectory()) return listFiles(dir, `${prefix}${e.name}/`);
    if (!e.isFile()) fail(`skills/${SKILL}/${prefix}${e.name} is not a regular file`);
    return [`${prefix}${e.name}`];
  }).sort();
}

/** metadata.version in a SKILL.md frontmatter. */
function skillVersion(file) {
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(file, 'utf8'))?.[1] ?? '';
  return /^metadata:\n(?:[ \t]+.*\n)*?[ \t]+version:[ \t]*"?([^"\s]+)"?[ \t]*$/m.exec(frontmatter)?.[1];
}

/** Downloads `url` (at most MAX_BYTES); retries twice on a network error or 5xx, never on a 4xx. */
async function download(url) {
  for (let attempt = 1; ; attempt++) {
    let problem;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) {
        const bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.length > MAX_BYTES) fail(`${url}: ${bytes.length} bytes, over ${MAX_BYTES}`);
        return bytes;
      }
      problem = `HTTP ${res.status}`;
      if (res.status < 500) attempt = 3;
    } catch (error) {
      if (error instanceof Failure) throw error;
      problem = error.message;
    }
    if (attempt === 3) fail(`${url}: ${problem}`);
    await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function fail(message) {
  throw new Failure(message);
}
