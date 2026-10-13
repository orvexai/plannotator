import { publishToArtifactServer, type ArtifactCliRunner, DEFAULT_ARTIFACT_SERVER_URL } from './artifact-server';

export interface RemoteShareOptions {
  rawHtml?: string;
  runCli?: ArtifactCliRunner;
}

/** Publish a remote-session plan or review through the user's saved Artifact Server CLI login. */
export async function generateRemoteShareUrl(
  content: string,
  artifactServerUrl = process.env.PLANNOTATOR_ARTIFACT_SERVER_URL || DEFAULT_ARTIFACT_SERVER_URL,
  options: RemoteShareOptions = {},
): Promise<string> {
  const publishContent = options.rawHtml
    ? `${content}\n\n## HTML source\n\n\`\`\`html\n${options.rawHtml}\n\`\`\``
    : content;
  const title = content.trim().split('\n').find((line) => line.startsWith('#'))?.replace(/^#+\s*/, '').trim()
    || 'Plannotator review';
  const published = await publishToArtifactServer(publishContent, title, artifactServerUrl, options.runCli);
  return published.reviewUrl;
}

/** Publish and print the Artifact Server Review link to the remote session's stderr. */
export async function writeRemoteShareLink(
  content: string,
  artifactServerUrl: string | undefined,
  verb: string,
  noun: string,
  options: RemoteShareOptions = {},
): Promise<void> {
  try {
    const shareUrl = await generateRemoteShareUrl(content, artifactServerUrl, options);
    process.stderr.write(`\n  Saved to Artifact Server. Open this Review link to ${verb}:\n  ${shareUrl}\n\n  (${noun})\n\n`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`\n  Warning: could not save ${noun} to Artifact Server.\n  ${reason}\n\n`);
  }
}
