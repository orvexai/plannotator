/**
 * Portable sharing utilities for Plannotator
 *
 * Enables sharing plan + annotations via URL hash using:
 * - Native CompressionStream/DecompressionStream (deflate-raw)
 * - Base64url encoding for URL safety
 *
 * Inspired by textarea.my's approach.
 */

import { AnnotationType, type Annotation, type DocumentRenderAs, type ImageAttachment } from '../types';
import { isDiagramRenderKind } from '@plannotator/core/annotatable';
import { compress, decompress } from '@plannotator/core/compress';

// Image in shareable format: plain string (old) or [path, name] tuple (new)
type ShareableImage = string | [string, string];

// Minimal shareable annotation format: [type, originalText, text?, author?, images?, quickLabel?]
export type ShareableAnnotation =
  | ['D', string, string | null, ShareableImage[]?]                    // Deletion: type, original, author, images
  | ['C', string, string, string | null, ShareableImage[]?, (1)?]      // Comment: type, original, comment, author, images, isQuickLabel
  | ['G', string, string | null, ShareableImage[]?];                   // Global Comment: type, comment, author, images

export interface ArtifactServerComment {
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
  replies?: Array<{ id: string; body: string; author: ArtifactServerComment['author']; createdAt: string }>;
}

export function artifactCommentsToAnnotations(comments: ArtifactServerComment[]): Annotation[] {
  return comments.flatMap(comment => [
    { id: `artifact-${comment.id}`, blockId: '', startOffset: 0, endOffset: 0, type: comment.path ? AnnotationType.COMMENT : AnnotationType.GLOBAL_COMMENT, text: comment.body, originalText: comment.path || '', createdA: Date.parse(comment.createdAt) || Date.now(), author: comment.author.displayName },
    ...(comment.replies || []).map(reply => ({ id: `artifact-${reply.id}`, blockId: '', startOffset: 0, endOffset: 0, type: AnnotationType.GLOBAL_COMMENT, text: reply.body, originalText: '', createdA: Date.parse(reply.createdAt) || Date.now(), author: reply.author.displayName, inReplyTo: `artifact-${comment.id}` })),
  ] as Annotation[]);
}

export function composeArtifactShareDocument(markdown: string, annotations: Annotation[], rawHtml?: string): string {
  const feedback = annotations.map(annotation => {
    const anchor = annotation.originalText ? `> ${annotation.originalText.replace(/\n/g, '\n> ')}\n\n` : '';
    return `### ${annotation.author || 'Reviewer'}\n\n${anchor}${annotation.text || 'Suggested deletion'}`;
  }).join('\n\n');
  return [markdown, rawHtml ? `\n\n## HTML source\n\n\`\`\`html\n${rawHtml}\n\`\`\`` : '', feedback ? `\n\n## Existing feedback\n\n${feedback}` : ''].join('');
}

export interface SharePayload {
  p: string;  // plan markdown
  a: ShareableAnnotation[];
  g?: ShareableImage[];  // global attachments (path strings or [path, name] tuples)
  d?: (string | null)[];  // diffContext per annotation, parallel to `a`
  s?: (string | undefined)[];  // source per annotation (external tool identifier), parallel to `a`
  h?: string;  // raw HTML content (direct HTML rendering mode)
  r?: 'html';  // render mode flag (omitted = markdown)
}

/**
 * The markdown a document ships as in a share payload's `p`.
 *
 * A whole-file diagram source (.mmd/.dot) has no fence of its own — the
 * annotate session renders it as one diagram because the SERVER said so in
 * `renderAs`, and a share link carries no server. So it travels as the fenced
 * form, which the portal's ordinary markdown parse turns back into the same
 * diagram block. This is deliberately smaller than adding a render-mode flag
 * (`r: 'html'`'s sibling): the portal needs no change at all.
 *
 * Diagram comments themselves still degrade to text comments in a share link,
 * exactly as they do today — `diagramAnchor` is dropped like `htmlAnchor`
 * (see sharing.multiTarget.test.ts).
 */
export function shareableDocumentMarkdown(
  markdown: string,
  renderAs: DocumentRenderAs | undefined,
): string {
  if (!isDiagramRenderKind(renderAs) || markdown === '') return markdown;
  const language = renderAs === 'graphviz' ? 'dot' : 'mermaid';
  // A diagram source can itself contain a ``` run only in a comment/label;
  // a four-backtick fence keeps such a body intact.
  const fence = markdown.includes('```') ? '````' : '```';
  return `${fence}${language}\n${markdown.replace(/\n+$/, '')}\n${fence}`;
}

/**
 * Convert ShareableImage[] to ImageAttachment[] (handles old plain-string format)
 */
export function parseShareableImages(raw: ShareableImage[] | undefined): ImageAttachment[] | undefined {
  if (!raw?.length) return undefined;
  return raw.map(img => {
    if (typeof img === 'string') {
      // Old format: plain path string — derive name from filename
      const name = img.split('/').pop()?.replace(/\.[^.]+$/, '') || 'image';
      return { path: img, name };
    }
    return { path: img[0], name: img[1] };
  });
}

/**
 * Convert ImageAttachment[] to ShareableImage[] for compact serialization
 */
export function toShareableImages(images: ImageAttachment[] | undefined): ShareableImage[] | undefined {
  if (!images?.length) return undefined;
  return images.map(img => [img.path, img.name]);
}

// Re-export compress/decompress from shared package (single source of truth)
export { compress, decompress };

/**
 * Convert full Annotation objects to minimal shareable format
 */
export function toShareable(annotations: Annotation[]): ShareableAnnotation[] {
  return annotations.map(ann => {
    const author = ann.author || null;
    const images = toShareableImages(ann.images);

    // Handle GLOBAL_COMMENT specially - it starts with 'G' (from GLOBAL_COMMENT)
    if (ann.type === AnnotationType.GLOBAL_COMMENT) {
      return ['G', ann.text || '', author, images] as ShareableAnnotation;
    }

    if (ann.type === AnnotationType.DELETION) {
      return ['D', ann.originalText, author, images] as ShareableAnnotation;
    }

    // COMMENT
    if (ann.isQuickLabel) {
      return ['C', ann.originalText, ann.text || '', author, images ?? undefined, 1] as ShareableAnnotation;
    }
    return ['C', ann.originalText, ann.text || '', author, images] as ShareableAnnotation;
  });
}

/**
 * Convert shareable format back to full Annotation objects
 * Note: blockId, offsets, and meta will need to be populated separately
 * by finding the text in the rendered document.
 */
export function fromShareable(data: ShareableAnnotation[], diffContexts?: (string | null)[] | null, sources?: (string | undefined)[] | null): Annotation[] {
  const typeMap: Record<string, AnnotationType> = {
    'D': AnnotationType.DELETION,
    'C': AnnotationType.COMMENT,
    'G': AnnotationType.GLOBAL_COMMENT,
  };

  return data.map((item, index) => {
    const type = item[0];

    // Handle global comments specially: ['G', text, author, images?]
    if (type === 'G') {
      const text = item[1] as string;
      const author = item[2] as string | null;
      const rawImages = item[3] as ShareableImage[] | undefined;

      return {
        id: `shared-${index}-${Date.now()}`,
        blockId: '',
        startOffset: 0,
        endOffset: 0,
        type: AnnotationType.GLOBAL_COMMENT,
        text: text || undefined,
        originalText: '',
        createdA: Date.now() + index,
        author: author || undefined,
        images: parseShareableImages(rawImages),
        ...(sources?.[index] ? { source: sources[index] } : {}),
      };
    }

    const originalText = item[1];
    // For deletion: [type, original, author, images?]
    // For others: [type, original, text, author, images?]
    const text = type === 'D' ? undefined : item[2] as string;
    const author = type === 'D' ? item[2] as string | null : item[3] as string | null;
    const rawImages = type === 'D' ? item[3] as ShareableImage[] | undefined : item[4] as ShareableImage[] | undefined;
    // Comment annotations may have isQuickLabel flag at index 5
    const isQuickLabel = type === 'C' && item.length > 5 && item[5] === 1 ? true : undefined;

    return {
      id: `shared-${index}-${Date.now()}`,
      blockId: '',  // Will be populated during highlight restoration
      startOffset: 0,
      endOffset: 0,
      type: typeMap[type],
      text: text || undefined,
      originalText,
      createdA: Date.now() + index,  // Preserve order
      author: author || undefined,
      images: parseShareableImages(rawImages),
      ...(isQuickLabel ? { isQuickLabel } : {}),
      ...(diffContexts?.[index] ? { diffContext: diffContexts[index] as Annotation['diffContext'] } : {}),
      ...(sources?.[index] ? { source: sources[index] } : {}),
      // startMeta/endMeta will be set by web-highlighter
    };
  });
}

function buildDiffContextArray(annotations: Annotation[]): (string | null)[] | null {
  const arr = annotations.map(a => a.diffContext || null);
  return arr.some(v => v !== null) ? arr : null;
}

function buildSourceArray(annotations: Annotation[]): (string | undefined)[] | null {
  const arr = annotations.map(a => a.source || undefined);
  return arr.some(v => v !== undefined) ? arr : null;
}

/**
 * Parse a share URL hash and return the payload
 * Returns null if no valid hash or parsing fails
 */
export async function parseShareHash(): Promise<SharePayload | null> {
  const raw = window.location.hash.slice(1); // Remove leading #
  const hash = raw.split('?')[0]; // Strip callback params (?cb=...&ct=...)

  if (!hash) {
    return null;
  }

  try {
    return (await decompress(hash)) as SharePayload;
  } catch (e) {
    console.warn('Failed to parse share hash:', e);
    return null;
  }
}

/**
 * Get the size of a URL in a human-readable format
 */
export function formatUrlSize(url: string): string {
  const bytes = new Blob([url]).size;
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
}
