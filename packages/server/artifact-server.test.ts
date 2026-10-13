import { describe, expect, it } from 'bun:test';
import { publishToArtifactServer, readArtifactServerComments } from './artifact-server';

describe('Artifact Server CLI sharing', () => {
  it('publishes content through the CLI and returns its exact review link', async () => {
    const calls: string[][] = [];
    const result = await publishToArtifactServer('# Plan', 'Example plan', 'https://artifacts.orvex.ai', async (args) => {
      calls.push(args);
      return { stdout: JSON.stringify({ artifact: { id: 'art-1', projectId: 'proj-1' }, version: { id: 'ver-1' }, links: { review: 'https://artifacts.orvex.ai/review?artifact=art-1&project=proj-1&version=ver-1' } }), stderr: '' };
    });
    expect(calls[0]?.[0]).toBe('publish');
    expect(calls[0]).toContain('--server');
    expect(calls[0]).toContain('https://artifacts.orvex.ai');
    expect(calls[0]).not.toContain('--token-file');
    expect(result.reviewUrl).toContain('/review?');
    expect(result.artifactId).toBe('art-1');
  });

  it('reads comments for the exact configured Artifact Server review', async () => {
    let args: string[] = [];
    const result = await readArtifactServerComments('https://artifacts.orvex.ai/review?artifact=art-1&project=proj-1&version=ver-1', 'https://artifacts.orvex.ai', async (received) => {
      args = received;
      return { stdout: JSON.stringify({ items: [{ id: 'comment-1', body: 'Please revise', path: null, author: { displayName: 'Reviewer' }, createdAt: '2026-10-13T00:00:00Z', replies: [] }] }), stderr: '' };
    });
    expect(args.slice(0, 3)).toEqual(['comments', 'list', 'art-1']);
    expect(args).toContain('--include-replies');
    expect(args).toContain('ver-1');
    expect(result.comments[0]?.body).toBe('Please revise');
  });

  it('refuses Review URLs outside the configured server', async () => {
    await expect(readArtifactServerComments('https://public.example.test/review?artifact=art-1&project=p&version=v')).rejects.toThrow('Paste a Review link');
  });

  it('selects an explicitly configured user-local CLI profile for publish and comments', async () => {
    const original = process.env.PLANNOTATOR_ARTIFACT_SERVER_PROFILE;
    process.env.PLANNOTATOR_ARTIFACT_SERVER_PROFILE = 'team';
    const calls: string[][] = [];
    const runCli = async (args: string[]) => {
      calls.push(args);
      if (args[0] === 'publish') {
        return { stdout: JSON.stringify({ artifact: { id: 'a', projectId: 'p' }, version: { id: 'v' }, links: { review: 'https://artifacts.orvex.ai/review?artifact=a&project=p&version=v' } }), stderr: '' };
      }
      return { stdout: JSON.stringify({ items: [] }), stderr: '' };
    };
    try {
      await publishToArtifactServer('# Plan', 'Plan', undefined, runCli);
      await readArtifactServerComments('https://artifacts.orvex.ai/review?artifact=a&project=p&version=v', undefined, runCli);
    } finally {
      if (original === undefined) delete process.env.PLANNOTATOR_ARTIFACT_SERVER_PROFILE;
      else process.env.PLANNOTATOR_ARTIFACT_SERVER_PROFILE = original;
    }
    expect(calls[0]).toContain('--profile');
    expect(calls[0]).toContain('team');
    expect(calls[1]).toContain('--profile');
    expect(calls[1]).toContain('team');
  });
});
