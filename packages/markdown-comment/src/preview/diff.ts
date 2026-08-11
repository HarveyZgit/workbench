import { diffLines } from 'diff';

export interface PreviewLineRange {
  startLine: number;
  endLine: number;
}

export interface PreviewLineDeletion {
  atLine: number;
  count: number;
}

export interface PreviewLineChanges {
  added: PreviewLineRange[];
  modified: PreviewLineRange[];
  deleted: PreviewLineDeletion[];
}

export function computePreviewLineChanges(baseline: string, current: string): PreviewLineChanges {
  const changes: PreviewLineChanges = {
    added: [],
    modified: [],
    deleted: [],
  };
  const chunks = diffLines(baseline, current, {
    stripTrailingCr: true,
    ignoreNewlineAtEof: true,
    timeout: 25,
    maxEditLength: 5_000,
  });
  if (!chunks) {
    return changes;
  }
  let currentLine = 0;

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];

    if (chunk.removed) {
      const addedChunk = chunks[index + 1];
      if (addedChunk?.added) {
        const modifiedCount = Math.min(chunk.count, addedChunk.count);
        if (modifiedCount > 0) {
          changes.modified.push({
            startLine: currentLine,
            endLine: currentLine + modifiedCount,
          });
        }
        if (addedChunk.count > modifiedCount) {
          changes.added.push({
            startLine: currentLine + modifiedCount,
            endLine: currentLine + addedChunk.count,
          });
        }
        if (chunk.count > modifiedCount) {
          changes.deleted.push({
            atLine: currentLine + modifiedCount,
            count: chunk.count - modifiedCount,
          });
        }
        currentLine += addedChunk.count;
        index += 1;
      } else {
        changes.deleted.push({ atLine: currentLine, count: chunk.count });
      }
      continue;
    }

    if (chunk.added) {
      changes.added.push({
        startLine: currentLine,
        endLine: currentLine + chunk.count,
      });
    }
    currentLine += chunk.count;
  }

  return changes;
}
