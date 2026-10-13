import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_ARTIFACT_SERVER_URL = 'https://artifacts.orvex.ai';

export interface ArtifactCliResult {
  stdout: string;
}

export type ArtifactCliRunner = (args: string[]) => Promise<ArtifactCliResult>;

const CLI_NOT_FOUND = 'Artifact Server CLI not found.';

class ArtifactServerCliError extends Error {}

// Covers the Artifact Server CLI's own profile and credential failures, such as
// "No Artifact Server profile matches <origin>." before anyone has logged in.
function isAuthenticationFailure(stderr: string): boolean {
  return /not logged in|not authenticated|authentication required|please log in|no artifact server profile matches|credential is invalid or no longer active|credential for this artifact server profile is missing|run artifactserver auth login/i.test(stderr);
}

// Built from the validated --server argument only, never from CLI output.
function notLoggedIn(args: string[]): string {
  const server = args[args.indexOf('--server') + 1];
  const origin = args.includes('--server') && server ? ` ${server}` : '';
  return `Not logged in; run \`artifactserver auth login${origin}\` in a terminal.`;
}

const PROJECT_REQUIRED = 'Artifact Server has several projects; set PLANNOTATOR_ARTIFACT_SERVER_PROJECT to the project ID to share into.';

function cliFailure(args: string[], stderr: string, exitCode: number | null): Error {
  const operation = args[0] === 'comments' ? 'comments' : 'publish';
  if (isAuthenticationFailure(stderr)) return new ArtifactServerCliError(notLoggedIn(args));
  if (/PROJECT_SELECTION_REQUIRED/.test(stderr)) return new ArtifactServerCliError(PROJECT_REQUIRED);
  const action = operation === 'publish' ? 'publish' : 'read comments';
  return new ArtifactServerCliError(`Artifact Server ${action} failed (exit ${exitCode ?? 'unknown'}).`);
}

async function invokeArtifactServerCli(args: string[], runner: ArtifactCliRunner): Promise<ArtifactCliResult> {
  try {
    return await runner(args);
  } catch (error) {
    // A custom runner or process-launch failure must not expose arbitrary error
    // text. The default runner classifies ENOENT before it reaches this point.
    if (error instanceof ArtifactServerCliError) throw error;
    throw new Error('Artifact Server CLI could not be started.');
  }
}

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
    // Comments read their project from the Review URL; publishing must name one
    // whenever the server has more than one active project.
    const project = process.env.PLANNOTATOR_ARTIFACT_SERVER_PROJECT?.trim();
    if (project) args.push('--project', project);
    appendConfiguredProfile(args);
    const result = await invokeArtifactServerCli(args, runCli);
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
  const result = await invokeArtifactServerCli(args, runCli);
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

export async function runArtifactServerCli(args: string[]): Promise<ArtifactCliResult> {
  let proc: ReturnType<typeof spawn>;
  try {
    proc = spawn(process.env.PLANNOTATOR_ARTIFACTSERVER_CLI || 'artifactserver', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new ArtifactServerCliError(CLI_NOT_FOUND);
    }
    throw new ArtifactServerCliError('Artifact Server CLI could not be started.');
  }
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  proc.stdout!.setEncoding('utf8').on('data', (chunk: string) => stdoutChunks.push(chunk));
  proc.stderr!.setEncoding('utf8').on('data', (chunk: string) => stderrChunks.push(chunk));
  const timeout = setTimeout(() => proc.kill(), 120_000);
  try {
    const { exitCode, error } = await new Promise<{ exitCode: number | null; error?: NodeJS.ErrnoException }>((resolve) => {
      proc.once('error', (error: NodeJS.ErrnoException) => resolve({ exitCode: null, error }));
      proc.once('close', (code) => resolve({ exitCode: code }));
    });
    if (error?.code === 'ENOENT') throw new ArtifactServerCliError(CLI_NOT_FOUND);
    if (error) throw new ArtifactServerCliError('Artifact Server CLI could not be started.');
    const stderr = stderrChunks.join('');
    if (exitCode !== 0) throw cliFailure(args, stderr, exitCode);
    return { stdout: stdoutChunks.join('') };
  } finally {
    clearTimeout(timeout);
  }
}

function appendConfiguredProfile(args: string[]): void {
  const profile = process.env.PLANNOTATOR_ARTIFACT_SERVER_PROFILE?.trim();
  if (profile) args.push('--profile', profile);
}
