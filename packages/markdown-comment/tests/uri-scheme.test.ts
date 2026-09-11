import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isCommentableScheme,
  isLocalPathScheme,
  isSavedDocumentScheme,
  isUntitledScheme,
} from '../src/uri-scheme.ts';

test('scheme classifiers treat vscode-local as a first-class saved local path', () => {
  assert.equal(isLocalPathScheme('file'), true);
  assert.equal(isLocalPathScheme('vscode-local'), true);
  assert.equal(isLocalPathScheme('vscode-remote'), false);
  assert.equal(isLocalPathScheme('untitled'), false);

  assert.equal(isSavedDocumentScheme('file'), true);
  assert.equal(isSavedDocumentScheme('vscode-local'), true);
  assert.equal(isSavedDocumentScheme('vscode-remote'), true);
  assert.equal(isSavedDocumentScheme('untitled'), false);
  assert.equal(isSavedDocumentScheme('http'), false);

  assert.equal(isUntitledScheme('untitled'), true);
  assert.equal(isCommentableScheme('file'), true);
  assert.equal(isCommentableScheme('vscode-local'), true);
  assert.equal(isCommentableScheme('vscode-remote'), true);
  assert.equal(isCommentableScheme('untitled'), true);
  assert.equal(isCommentableScheme('http'), false);
});

test('unsupported schemes are not commentable', () => {
  assert.equal(isCommentableScheme('http'), false);
  assert.equal(isCommentableScheme('git'), false);
  assert.equal(isCommentableScheme('output'), false);
  assert.equal(isSavedDocumentScheme('vscode-remote'), true);
  assert.equal(isLocalPathScheme('vscode-remote'), false);
});
