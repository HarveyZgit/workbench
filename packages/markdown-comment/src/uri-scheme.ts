/** URI schemes Markdown Comment treats as first-class documents. */

export const UNTITLED_SCHEME = 'untitled';
export const FILE_SCHEME = 'file';
export const VSCODE_LOCAL_SCHEME = 'vscode-local';
export const VSCODE_REMOTE_SCHEME = 'vscode-remote';

/** Saved files on a filesystem VS Code can address (local, remote, or local-in-remote). */
export function isSavedDocumentScheme(scheme: string): boolean {
  return scheme === FILE_SCHEME || scheme === VSCODE_LOCAL_SCHEME || scheme === VSCODE_REMOTE_SCHEME;
}

/**
 * Local-machine path identity: ordinary `file:` or `vscode-local:`
 * (a local file opened inside a Remote / SSH window).
 */
export function isLocalPathScheme(scheme: string): boolean {
  return scheme === FILE_SCHEME || scheme === VSCODE_LOCAL_SCHEME;
}

export function isUntitledScheme(scheme: string): boolean {
  return scheme === UNTITLED_SCHEME;
}

export function isCommentableScheme(scheme: string): boolean {
  return isUntitledScheme(scheme) || isSavedDocumentScheme(scheme);
}
