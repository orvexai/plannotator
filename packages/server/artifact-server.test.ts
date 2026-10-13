import { afterEach, describe, expect, it } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishToArtifactServer, readArtifactServerComments, runArtifactServerCli } from './artifact-server';
import { writeRemoteShareLink } from './share-url';
import { startPlannotatorServer } from './index';
import { startReviewServer } from './review';

const originalCli = process.env.PLANNOTATOR_ARTIFACTSERVER_CLI;
const originalDataDir = process.env.PLANNOTATOR_DATA_DIR;
const originalRemote = process.env.PLANNOTATOR_REMOTE;
const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'plannotator-artifact-cli-'));
  tempDirs.push(dir);
  return dir;
}

function fakeCli(stderr: string, exitCode: number, stdout = ''): string {
  const path = join(tempDir(), 'artifactserver');
  writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(stdout)}\nprintf '%s\\n' ${JSON.stringify(stderr)} >&2\nexit ${exitCode}\n`);
  chmodSync(path, 0o755);
  process.env.PLANNOTATOR_ARTIFACTSERVER_CLI = path;
  return path;
}

afterEach(() => {
  if (originalCli === undefined) delete process.env.PLANNOTATOR_ARTIFACTSERVER_CLI;
  else process.env.PLANNOTATOR_ARTIFACTSERVER_CLI = originalCli;
  if (originalDataDir === undefined) delete process.env.PLANNOTATOR_DATA_DIR;
  else process.env.PLANNOTATOR_DATA_DIR = originalDataDir;
  if (originalRemote === undefined) delete process.env.PLANNOTATOR_REMOTE;
  else process.env.PLANNOTATOR_REMOTE = originalRemote;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Artifact Server CLI sharing', () => {
  it('publishes content through the CLI and returns its exact review link', async () => {
    const calls: string[][] = [];
    const result = await publishToArtifactServer('# Plan', 'Example plan', 'https://artifacts.orvex.ai', async (args) => {
      calls.push(args);
      return { stdout: JSON.stringify({ artifact: { id: 'art-1', projectId: 'proj-1' }, version: { id: 'ver-1' }, links: { review: 'https://artifacts.orvex.ai/review?artifact=art-1&project=proj-1&version=ver-1' } }) };
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
      return { stdout: JSON.stringify({ items: [{ id: 'comment-1', body: 'Please revise', path: null, author: { displayName: 'Reviewer' }, createdAt: '2026-10-13T00:00:00Z', replies: [] }] }) };
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
        return { stdout: JSON.stringify({ artifact: { id: 'a', projectId: 'p' }, version: { id: 'v' }, links: { review: 'https://artifacts.orvex.ai/review?artifact=a&project=p&version=v' } }) };
      }
      return { stdout: JSON.stringify({ items: [] }) };
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

  it('maps a missing CLI to a fixed safe error', async () => {
    process.env.PLANNOTATOR_ARTIFACTSERVER_CLI = join(tempDir(), 'missing-artifactserver');
    await expect(publishToArtifactServer('# Plan', 'Plan')).rejects.toThrow('Artifact Server CLI not found.');
  });

  it('maps logged-out CLI diagnostics to a safe login hint', async () => {
    fakeCli('not logged in; Bearer fake-secret-token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.fake-signature', 1);
    let message = '';
    try {
      await publishToArtifactServer('# Plan', 'Plan');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe('Not logged in; run `artifactserver auth login https://artifacts.orvex.ai` in a terminal.');
    expect(message).not.toContain('fake-secret-token');
    expect(message).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('shares into the configured project and explains when one must be chosen', async () => {
    const original = process.env.PLANNOTATOR_ARTIFACT_SERVER_PROJECT;
    const calls: string[][] = [];
    const runCli = async (args: string[]) => {
      calls.push(args);
      return { stdout: JSON.stringify({ artifact: { id: 'a', projectId: 'prj_team' }, version: { id: 'v' }, links: { review: 'https://artifacts.orvex.ai/review?artifact=a&project=prj_team&version=v' } }) };
    };
    try {
      process.env.PLANNOTATOR_ARTIFACT_SERVER_PROJECT = 'prj_team';
      await publishToArtifactServer('# Plan', 'Plan', 'https://artifacts.orvex.ai', runCli);
      delete process.env.PLANNOTATOR_ARTIFACT_SERVER_PROJECT;
      await publishToArtifactServer('# Plan', 'Plan', 'https://artifacts.orvex.ai', runCli);
      // The exact stderr the CLI prints when the server has several projects.
      fakeCli('Artifact Server: PROJECT_SELECTION_REQUIRED (HTTP 409): Choose a project before continuing: Default (prj_default), Team (prj_team).', 1);
      await expect(publishToArtifactServer('# Plan', 'Plan', 'https://artifacts.orvex.ai')).rejects.toThrow(
        'Artifact Server has several projects; set PLANNOTATOR_ARTIFACT_SERVER_PROJECT to the project ID to share into.',
      );
    } finally {
      if (original === undefined) delete process.env.PLANNOTATOR_ARTIFACT_SERVER_PROJECT;
      else process.env.PLANNOTATOR_ARTIFACT_SERVER_PROJECT = original;
    }
    expect(calls[0]).toContain('--project');
    expect(calls[0]?.[calls[0].indexOf('--project') + 1]).toBe('prj_team');
    expect(calls[1]).not.toContain('--project');
  });

  it('treats a missing Artifact Server CLI profile as logged out for publish and comments', async () => {
    // The exact stderr the Artifact Server CLI prints before the first login.
    fakeCli('Artifact Server: CliProfileError: No Artifact Server profile matches https://artifacts.orvex.ai.', 1);
    const hint = 'Not logged in; run `artifactserver auth login https://artifacts.orvex.ai` in a terminal.';
    await expect(publishToArtifactServer('# Plan', 'Plan', 'https://artifacts.orvex.ai')).rejects.toThrow(hint);
    await expect(readArtifactServerComments(
      'https://artifacts.orvex.ai/review?artifact=a&project=p&version=v',
      'https://artifacts.orvex.ai',
    )).rejects.toThrow(hint);
  });

  it('drops token-shaped CLI stderr after a successful CLI exit', async () => {
    const bearer = 'Bearer fake-secret-token';
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.fake-signature';
    fakeCli(`${bearer} ${jwt}`, 0, '{"ok":true}');
    const result = await runArtifactServerCli(['publish']);
    expect(result).toEqual({ stdout: '{"ok":true}\n' });
    expect(JSON.stringify(result)).not.toContain(bearer);
    expect(JSON.stringify(result)).not.toContain(jwt);
  });

  it('keeps bearer tokens and JWTs out of plan/review API errors and Pi stderr logs', async () => {
    const bearer = 'Bearer fake-secret-token';
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.fake-signature';
    fakeCli(`${bearer} ${jwt}`, 7);
    process.env.PLANNOTATOR_REMOTE = '0';
    process.env.PLANNOTATOR_DATA_DIR = tempDir();
    const planServer = await startPlannotatorServer({ plan: '# Plan', origin: 'claude-code', htmlContent: '<html></html>' });
    const reviewServer = await startReviewServer({ rawPatch: '', gitRef: 'HEAD', origin: 'claude-code', htmlContent: '<html></html>' });
    const outputs: string[] = [];
    const originalWrite = process.stderr.write;
    try {
      const planResponse = await fetch(`${planServer.url}/api/artifact-share`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: '# Plan', title: 'Plan' }),
      });
      const reviewResponse = await fetch(`${reviewServer.url}/api/artifact-share`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: '# Review', title: 'Review' }),
      });
      const planBody = await planResponse.text();
      const reviewBody = await reviewResponse.text();
      expect(planResponse.status).toBe(502);
      expect(reviewResponse.status).toBe(502);
      expect(planBody).toContain('Artifact Server publish failed (exit 7).');
      expect(reviewBody).toContain('Artifact Server publish failed (exit 7).');
      expect(`${planBody}${reviewBody}`).not.toContain(bearer);
      expect(`${planBody}${reviewBody}`).not.toContain(jwt);

      (process.stderr as { write: unknown }).write = ((chunk: unknown) => {
        outputs.push(String(chunk));
        return true;
      }) as typeof process.stderr.write;
      await writeRemoteShareLink('# Plan', undefined, 'review', 'plan');
      expect(outputs.join('')).toContain('Artifact Server publish failed (exit 7).');
      expect(outputs.join('')).not.toContain(bearer);
      expect(outputs.join('')).not.toContain(jwt);
    } finally {
      (process.stderr as { write: unknown }).write = originalWrite;
      planServer.stop();
      reviewServer.stop();
    }
  });
});
