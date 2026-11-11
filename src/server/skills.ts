// The Carbone Skill over MCP (io.modelcontextprotocol/skills, SEP-2640), on both transports.

import { fileURLToPath } from 'node:url';
import { SkillCatalog } from '@modelcontextprotocol/server/ext/skills';
import { nodeSkillFiles } from '@modelcontextprotocol/server/ext/skills/node';
import { withOutcome } from './log.js';

/** skills/ next to dist/ (or src/): a pinned carbone-agent-plugin release, vendored by scripts/sync-skill.mjs. */
export const SKILLS_DIR = fileURLToPath(new URL('../../skills/', import.meta.url));

/** The Carbone Skill's SKILL.md, as the server serves it. */
export const CARBONE_SKILL_URI = 'skill://carbone/SKILL.md';

/**
 * Loads the skills once per process, to attach to every McpServer before it connects. Never throws: problems go to
 * `warn`, and the server runs with what loaded, possibly nothing.
 */
export async function loadServedSkills(warn: (message: string) => void, dir = SKILLS_DIR): Promise<SkillCatalog | undefined> {
  const disk = nodeSkillFiles(dir);
  // The catalog reads every file once to hash it: keeping the bytes means requests never touch the disk.
  const loaded = new Map<string, Promise<Uint8Array>>();
  const read = (path: string) => {
    let bytes = loaded.get(path);
    if (!bytes) loaded.set(path, (bytes = disk.read(path)));
    return bytes;
  };
  try {
    return await SkillCatalog.load(
      // withOutcome: a read records outcome=ok on the HTTP access line, like the other resources.
      { list: (path) => disk.list(path), read: withOutcome(read) },
      { onWarning: (warning) => warn(`${warning.path}: ${warning.message}`) },
    );
  } catch (error) {
    warn(`no skill is served: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/** Whether `catalog` serves the Carbone Skill (only then do the instructions name it). */
export function servesCarboneSkill(catalog: SkillCatalog | undefined): boolean {
  return catalog?.entries.some((skill) => skill.uri === CARBONE_SKILL_URI) ?? false;
}

/** `name@version` of each served skill, for the startup log, or `none`. */
export function servedSkills(catalog: SkillCatalog | undefined): string {
  return (catalog?.entries ?? []).map(({ frontmatter: { name, metadata } }) => {
    const version = (metadata as { version?: unknown } | undefined)?.version;
    return typeof version === 'string' ? `${name}@${version}` : name;
  }).join(',') || 'none';
}
