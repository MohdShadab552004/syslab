import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * One Vitest run for the whole monorepo. Workspace packages resolve to their TypeScript sources
 * (not dist), so tests need no build and coverage maps to the real files.
 *
 *   pnpm test              run everything
 *   pnpm test:coverage     run with coverage; fails under 95%
 *   pnpm vitest --project web   one project
 */
const alias = {
  '@syslab/sim': r('./packages/sim/src/index.ts'),
  '@syslab/spec': r('./packages/spec/src/index.ts'),
  '@syslab/types': r('./packages/types/src/index.ts'),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      { resolve: { alias }, test: { name: 'sim', root: r('./packages/sim'), include: ['test/**/*.test.ts'] } },
      { resolve: { alias }, test: { name: 'spec', root: r('./packages/spec'), include: ['test/**/*.test.ts'] } },
      {
        resolve: { alias: { ...alias, '@': r('./apps/web/src') } },
        test: { name: 'web', root: r('./apps/web'), include: ['test/**/*.test.{ts,tsx}'], environment: 'node' },
      },
      { resolve: { alias }, test: { name: 'api', root: r('./apps/api'), include: ['test/**/*.test.ts'], setupFiles: ['test/setup.ts'] } },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text', 'html', 'json-summary'],
      reportsDirectory: r('./coverage'),
      // logic code; React components (*.tsx), React glue hooks, generated Prisma code and Nest
      // bootstrap / module wiring are covered by the browser checks, not unit tests
      include: [
        'packages/sim/src/**/*.ts',
        'packages/spec/src/**/*.ts',
        'apps/web/src/lib/**/*.ts',
        'apps/web/src/hooks/editor/editor.store.ts',
        'apps/web/src/hooks/editor/useInspector.ts',
        'apps/api/src/**/*.ts',
      ],
      exclude: [
        '**/index.ts',
        'apps/api/src/generated/**',
        'apps/api/src/main.ts',
        'apps/api/src/**/*.module.ts',
        'apps/api/src/prisma/prisma.service.ts',
      ],
      thresholds: { lines: 95, statements: 95, functions: 95, branches: 95 },
    },
  },
});
