import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * R-49, E-072: the worker builds from `Dockerfile.worker`, which is the website's `Dockerfile`
 * without `next build`. These checks keep the two files in step, so a change to the website's
 * image (base, packages, copied files) cannot silently miss the worker, and they pin what the
 * worker's image relies on: its commands need only tsx and prisma, and nothing it runs reads the
 * website's build output.
 */
function instructions(path: string): string[] {
  return readFileSync(path, 'utf8')
    .replace(/\\\n\s*/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|mjs|cjs)$/.test(name) ? [path] : [];
  });
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
};

describe('the worker image (Dockerfile.worker)', () => {
  test("is the website's Dockerfile without next build, .next, the port and the web health check", () => {
    const expected = instructions('Dockerfile')
      .filter((line) => !/^COPY .*\/app\/\.next /.test(line))
      .filter((line) => !/^(EXPOSE|HEALTHCHECK) /.test(line))
      .map((line) => line.replace(' && npm run build', ''))
      .map((line) => (line === 'ENV NODE_ENV=production PORT=3000' ? 'ENV NODE_ENV=production' : line))
      .map((line) => (line === 'CMD ["npm","start"]' ? 'CMD ["npm","run","worker:platform"]' : line));
    expect(instructions('Dockerfile.worker')).toEqual(expected);
  });

  test("the service record names it, with the worker's start and pre-deploy commands", () => {
    const record = JSON.parse(readFileSync('deploy/railway/worker.railway.json', 'utf8'));
    expect(record.build).toEqual({ builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile.worker' });
    expect(record.deploy.startCommand).toBe('npm run worker:platform');
    expect(record.deploy.preDeployCommand).toEqual(['npm run migrate:deploy']);
  });

  test('the start and pre-deploy commands need only tsx and prisma, which survive npm prune --omit=dev', () => {
    expect(pkg.scripts['worker:platform']).toBe('tsx scripts/worker.ts');
    expect(pkg.scripts['migrate:deploy']).toBe('tsx scripts/database-identity-check.ts && prisma migrate deploy');
    for (const name of ['tsx', 'prisma', '@prisma/client']) expect(pkg.dependencies).toHaveProperty(name);
  });

  test("no source or script reads the website's build output", () => {
    const readers = [...sourceFiles('src'), ...sourceFiles('scripts')].filter((path) =>
      /['"`/]\.next[/'"`]/.test(readFileSync(path, 'utf8')),
    );
    expect(readers).toEqual([]);
  });
});
