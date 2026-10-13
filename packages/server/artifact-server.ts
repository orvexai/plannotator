import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_ARTIFACT_SERVER_URL = 'https://artifacts.orvex.ai';

export interface ArtifactCliResult {
  stdout: string;
  stderr: string;
}

export type ArtifactCliRunner = (args: string[]) => Promise<ArtifactCliResult>;

export async function publishToArtifactServer(
  content: string,
  title: string,
  serverUrl = process.env.PLANNOTATOR_ARTIFACT_SERVER_URL || DEFAULT_ARTIFACT_SERVER_URL,
  runCli: ArtifactCliRunner = runArtifactServerCli,
): Promise<{ reviewUrl: string; artifactId: string; projectId: string; versionId: string }> {
  if (!content.trim()) throw new Error('Nothing to share.');
  const origin = normalizeArtifactServerUrl(serverUrl);
  const dir = await mkdtemp(join(tmpdir(), 'plannotator-share-'));
  try {
    const path = join(dir, 'review.md');
    await writeFile(path, content, 'utf8');
    const args = ['publish', path, '--server', origin, '--name', title];
    appendConfiguredProfile(args);
    const result = await runCli(args);
    const publication = JSON.parse(result.stdout) as {
      artifact?: { id?: unknown; projectId?: unknown };
      version?: { id?: unknown };
      links?: { review?: unknown };
    };
    if (typeof publication.links?.review !== 'string'
      || typeof publication.artifact?.id !== 'string'
      || typeof publication.artifact.projectId !== 'string'
      || typeof publication.version?.id !== 'string') {
      throw new Error('Artifact Server CLI returned an incomplete publish response.');
    }
    const review = new URL(publication.links.review);
    if (review.origin !== origin || review.pathname !== '/review') {
      throw new Error('Artifact Server CLI returned a review link outside the configured server.');
    }
    return {
      reviewUrl: review.toString(),
      artifactId: publication.artifact.id,
      projectId: publication.artifact.projectId,
      versionId: publication.version.id,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function readArtifactServerComments(
  reviewUrl: string,
  serverUrl = process.env.PLANNOTATOR_ARTIFACT_SERVER_URL || DEFAULT_ARTIFACT_SERVER_URL,
  runCli: ArtifactCliRunner = runArtifactServerCli,
): Promise<{ title: string; comments: ArtifactComment[] }> {
  const origin = normalizeArtifactServerUrl(serverUrl);
  const review = new URL(reviewUrl);
  if (review.origin !== origin || review.pathname !== '/review') {
    throw new Error(`Paste a Review link from ${origin}.`);
  }
  const artifactId = review.searchParams.get('artifact');
  const projectId = review.searchParams.get('project');
  const versionId = review.searchParams.get('version');
  if (!artifactId || !projectId || !versionId) throw new Error('Review link is missing artifact details.');
  const args = [
    'comments', 'list', artifactId,
    '--server', origin,
    '--project', projectId,
    '--version', versionId,
    '--include-replies',
    '--dispatched', 'include',
    '--limit', '5000',
  ];
  appendConfiguredProfile(args);
  const result = await runCli(args);
  const parsed = JSON.parse(result.stdout) as { items?: unknown };
  if (!Array.isArray(parsed.items)) throw new Error('Artifact Server CLI returned an invalid comments response.');
  return { title: `Artifact ${artifactId}`, comments: parsed.items as ArtifactComment[] };
}

export interface ArtifactComment {
  id: string;
  body: string;
  path: string | null;
  author: {
    displayName: string;
    principalId?: string;
    principalKind?: 'human' | 'service';
    authorizedByPrincipalId?: string | null;
    actor?: { kind: 'mcp-client'; clientId: string } | null;
  };
  createdAt: string;
  replies?: Array<{ id: string; body: string; author: ArtifactComment['author']; createdAt: string }>;
}

export function normalizeArtifactServerUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('Artifact Server URL must use HTTPS (or localhost for development).');
  }
  return url.origin;
}

async function runArtifactServerCli(args: string[]): Promise<ArtifactCliResult> {
  const proc = Bun.spawn([process.env.PLANNOTATOR_ARTIFACTSERVER_CLI || 'artifactserver', ...args], {
    stdout: 'pipe', stderr: 'pipe', stdin: 'ignore',
  });
  const timeout = setTimeout(() => proc.kill(), 120_000);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    if (exitCode !== 0) throw new Error(stderr.trim() || `Artifact Server CLI exited with status ${exitCode}.`);
    return { stdout, stderr };
  } finally {
    clearTimeout(timeout);
  }
}

function appendConfiguredProfile(args: string[]): void {
  const profile = process.env.PLANNOTATOR_ARTIFACT_SERVER_PROFILE?.trim();
  if (profile) args.push('--profile', profile);
}
