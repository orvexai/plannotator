import { describe, expect, it, mock } from 'bun:test';
import { generateRemoteShareUrl, writeRemoteShareLink } from './share-url';

describe('Artifact Server share links', () => {
  it('publishes through the CLI and returns its Review link', async () => {
    const url = await generateRemoteShareUrl('# Plan', 'https://artifacts.example.test', {
      runCli: async () => ({ stdout: JSON.stringify({
        artifact: { id: 'art-1', projectId: 'proj-1' },
        version: { id: 'ver-1' },
        links: { review: 'https://artifacts.example.test/review?artifact=art-1&project=proj-1&version=ver-1' },
      }), stderr: '' }),
    });
    expect(url).toContain('https://artifacts.example.test/review?');
  });

  it('includes standalone HTML content in the published artifact', async () => {
    let args: string[] = [];
    await generateRemoteShareUrl('', 'https://artifacts.example.test', {
      rawHtml: '<h1>Review</h1>',
      runCli: async (received) => {
        args = received;
        const file = Bun.file(received[1]!);
        expect(await file.text()).toContain('<h1>Review</h1>');
        return { stdout: JSON.stringify({
          artifact: { id: 'art-1', projectId: 'proj-1' }, version: { id: 'ver-1' },
          links: { review: 'https://artifacts.example.test/review?artifact=art-1&project=proj-1&version=ver-1' },
        }), stderr: '' };
      },
    });
    expect(args[0]).toBe('publish');
  });

  it('reports the Artifact Server Review URL to stderr', async () => {
    const originalWrite = process.stderr.write;
    let output = '';
    process.stderr.write = ((chunk: string | Uint8Array) => { output += String(chunk); return true; }) as typeof process.stderr.write;
    try {
      await writeRemoteShareLink('# Plan', 'https://artifacts.example.test', 'review the plan', 'plan only', {
        runCli: async () => ({ stdout: JSON.stringify({
          artifact: { id: 'art-1', projectId: 'proj-1' }, version: { id: 'ver-1' },
          links: { review: 'https://artifacts.example.test/review?artifact=art-1&project=proj-1&version=ver-1' },
        }), stderr: '' }),
      });
    } finally {
      process.stderr.write = originalWrite;
    }
    expect(output).toContain('Saved to Artifact Server');
    expect(output).toContain('/review?');
  });
});
