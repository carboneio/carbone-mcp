import { describe, test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** What ships the vendored Carbone Skill (npm, Docker), and the CI checks that guard it. */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

/** Every file under `dir`, as `/`-separated paths relative to the repository. */
function files(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir)).flatMap((name) => {
    const entry = `${dir}/${name}`;
    return statSync(path.join(ROOT, entry)).isDirectory() ? files(entry) : [entry];
  });
}

describe('npm package', () => {
  test('ships every file of skills/, which src/server/skills.ts serves next to dist/', () => {
    const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32',
    })) as [{ files: { path: string }[] }];
    const shipped = pack.files.map((f) => f.path.replaceAll('\\', '/'));
    expect(shipped.filter((f) => f.startsWith('skills/')).sort()).toEqual(files('skills').sort());
    expect(shipped).toContain('skills/carbone/SKILL.md');
    // Maintainer tooling stays out
    expect(shipped.filter((f) => f.startsWith('scripts/') || f === 'skills.lock.json')).toEqual([]);
  }, 30_000);
});

describe('Docker image', () => {
  const [builder, runtime] = read('Dockerfile').split(/^FROM /m).slice(1) as [string, string];

  test('the builder copies the skill and resets its modes, whatever the build host umask', () => {
    expect(builder).toMatch(/^COPY skills\/ \.\/skills\/$/m);
    expect(builder).toMatch(/^RUN chmod -R u=rwX,go=rX skills$/m);
  });

  test('the runtime ships the skill and the code owned by root: the node user can read them, not change them', () => {
    expect(runtime.split('\n').filter((line) => /^COPY\b.*\b(dist|skills)\b/.test(line))).toEqual([
      'COPY --from=builder /app/skills ./skills',
      'COPY --from=builder /app/dist ./dist',
    ]);
    expect(runtime).toMatch(/^USER node$/m);
  });
});

describe('CI checks skills/ against its pinned release (scripts/sync-skill.mjs --check) before using it', () => {
  const CHECK = /^ +- run: (?:npm run skill:check|node scripts\/sync-skill\.mjs --check)$/m;

  test.each([
    ['test.yml', /^ +- run: npm test$/m],
    ['publish.yml', /npm publish --provenance/],
    ['docker.yml', /uses: docker\/build-push-action@/],
  ])('%s', (file, step) => {
    const workflow = read(`.github/workflows/${file}`);
    const check = CHECK.exec(workflow);
    expect(check, 'no skill check').not.toBeNull();
    expect(check!.index).toBeLessThan(step.exec(workflow)?.index ?? -1);
  });

  test('package.json runs the same script', () => {
    expect(JSON.parse(read('package.json')).scripts['skill:check']).toBe('node scripts/sync-skill.mjs --check');
  });
});
