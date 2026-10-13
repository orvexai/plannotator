import { describe, expect, it } from 'bun:test';
import { artifactCommentsToAnnotations, composeArtifactShareDocument } from './sharing';
import { AnnotationType, type Annotation } from '../types';

describe('Artifact Server sharing payloads', () => {
  it('publishes the document with its existing feedback', () => {
    const annotation: Annotation = {
      id: 'a1', blockId: 'block', startOffset: 0, endOffset: 4,
      type: AnnotationType.COMMENT, originalText: 'Step one', text: 'Clarify this', createdA: 1,
      author: 'Daniel',
    };
    const content = composeArtifactShareDocument('# Plan', [annotation]);
    expect(content).toContain('# Plan');
    expect(content).toContain('> Step one');
    expect(content).toContain('Clarify this');
  });

  it('imports Artifact Server comment threads and their replies as annotations', () => {
    const items = artifactCommentsToAnnotations([{
      id: 'thread-1', body: 'Please revise', path: null,
      author: {
        displayName: 'MCP client artifact-server for Daniel',
        principalId: 'human-1', principalKind: 'human', authorizedByPrincipalId: null,
        actor: { kind: 'mcp-client', clientId: 'artifact-server' },
      },
      createdAt: '2026-10-13T00:00:00.000Z',
      replies: [{
        id: 'reply-1', body: 'Updated',
        author: {
          displayName: 'MCP client artifact-server for Daniel',
          principalId: 'human-1', principalKind: 'human', authorizedByPrincipalId: null,
          actor: { kind: 'mcp-client', clientId: 'artifact-server' },
        },
        createdAt: '2026-10-13T00:01:00.000Z',
      }],
    }]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: 'artifact-thread-1', type: AnnotationType.GLOBAL_COMMENT, text: 'Please revise', author: 'MCP client artifact-server for Daniel' });
    expect(items[1]).toMatchObject({ id: 'artifact-reply-1', text: 'Updated', author: 'MCP client artifact-server for Daniel', inReplyTo: 'artifact-thread-1' });
  });
});
