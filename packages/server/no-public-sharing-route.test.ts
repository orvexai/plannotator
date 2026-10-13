import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';

const runtimeFiles = [
  'packages/server/share-url.ts',
  'packages/server/artifact-server.ts',
  'packages/server/index.ts',
  'packages/server/review.ts',
  'packages/ui/hooks/useSharing.ts',
  'packages/ui/utils/sharing.ts',
  'packages/ui/components/Landing.tsx',
  'packages/ui/components/ImportModal.tsx',
  'apps/hook/server/index.ts',
  'apps/opencode-plugin/index.ts',
  'apps/opencode-plugin/server.ts',
  'apps/opencode-plugin/cli-bridge.ts',
  'apps/pi-extension/server/serverAnnotate.ts',
  'apps/pi-extension/server/serverPlan.ts',
  'apps/pi-extension/server/serverReview.ts',
];
const builtFiles = [
  'apps/hook/dist/index.html',
  'apps/review/dist/index.html',
  'apps/opencode-plugin/dist/embedded.js',
  'apps/opencode-plugin/dist/index.js',
  'apps/opencode-plugin/dist/server.js',
];

describe('shipped sharing routes', () => {
  it('uses Artifact Server without public share or hosted Workspaces routes', async () => {
    const contents = await Promise.all(runtimeFiles.map((path) => readFile(path, 'utf8')));
    const runtime = contents.join('\n');
    expect(runtime).not.toContain(['share', 'plannotator.ai'].join('.'));
    expect(runtime).not.toContain(['plannotator-paste', 'plannotator.workers.dev'].join('.'));
    expect(runtime).not.toContain('/workspaces/');
    expect(runtime).not.toContain("href=\"/workspaces");
    expect(runtime).not.toContain('/api/paste');
    expect(runtime).not.toContain("'/p/");
    expect(runtime).not.toContain('"/p/');
    expect(runtime).toContain('/api/artifact-share');
    expect(runtime).toContain('/api/artifact-comments');
    expect(runtime).toContain('https://artifacts.orvex.ai');
  });

  it('keeps generated program bundles free of the public share and Workspaces routes', async () => {
    const outputs = await Promise.all(builtFiles.map(async (path) => {
      try { return await readFile(path, 'utf8'); }
      catch { return ''; }
    }));
    const bundle = outputs.join('\n');
    if (!bundle) return; // Source check above still runs when tests precede a build.
    expect(bundle).not.toContain(['share', 'plannotator.ai'].join('.'));
    expect(bundle).not.toContain(['plannotator-paste', 'plannotator.workers.dev'].join('.'));
    expect(bundle).not.toContain('/api/paste');
    expect(bundle).not.toContain('/workspaces/');
  });
});
