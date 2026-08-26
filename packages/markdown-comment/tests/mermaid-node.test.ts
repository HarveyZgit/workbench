import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMermaidFlowchartNodeSources, resolveMermaidNodeId } from '../src/preview/mermaid-node.ts';

test('parses flowchart nodes including explicit shapes and edges', () => {
  const source = [
    '%%{init: {"theme": "dark"}}%%',
    '%% comment',
    'flowchart LR',
    '  Start[Start] --> End(End)',
    '  Mid{Mid}',
    '  classDef foo fill:#f9f',
    '  class Start foo',
    '  style End fill:#fff',
    '  direction LR',
  ].join('\n');
  const map = parseMermaidFlowchartNodeSources(source);
  assert.ok(map.has('Start'));
  assert.ok(map.has('End'));
  assert.ok(map.has('Mid'));
  assert.equal(map.get('Start')?.startLine, 3);
  assert.equal(map.get('Start')?.endLine, 4);
  assert.equal(map.get('Mid')?.startLine, 4);
});

test('sequenceDiagram yields an empty source map', () => {
  const map = parseMermaidFlowchartNodeSources('sequenceDiagram\nAlice->>Bob: hi');
  assert.equal(map.size, 0);
});

test('subgraph diagrams yield an empty source map', () => {
  const map = parseMermaidFlowchartNodeSources('flowchart LR\nsubgraph X\nA\nend');
  assert.equal(map.size, 0);
});

test('empty string yields an empty source map', () => {
  assert.equal(parseMermaidFlowchartNodeSources('').size, 0);
  assert.equal(parseMermaidFlowchartNodeSources('   \n%% only comments\n').size, 0);
});

test('resolveMermaidNodeId matches by id', () => {
  const map = parseMermaidFlowchartNodeSources('graph TB\nStart[Go] --> End');
  assert.equal(resolveMermaidNodeId({ id: 'Start' }, map), 'Start');
});

test('resolveMermaidNodeId matches flowchart-Start-0 domId', () => {
  const map = parseMermaidFlowchartNodeSources('flowchart LR\nStart[Go]');
  assert.equal(resolveMermaidNodeId({ domId: 'flowchart-Start-0' }, map), 'Start');
  assert.equal(resolveMermaidNodeId({ domId: 'foo-flowchart-Start-9' }, map), 'Start');
});

test('resolveMermaidNodeId returns null for unknown or empty spec', () => {
  const map = parseMermaidFlowchartNodeSources('flowchart LR\nStart');
  assert.equal(resolveMermaidNodeId({ id: 'Nope' }, map), null);
  assert.equal(resolveMermaidNodeId({}, map), null);
  assert.equal(resolveMermaidNodeId({ id: 'Start' }, parseMermaidFlowchartNodeSources('')), null);
  assert.equal(resolveMermaidNodeId({ id: null, domId: null }, map), null);
});

test('skips nodes with conflicting declarations and rejects multi-hop edges', () => {
  const conflict = parseMermaidFlowchartNodeSources('flowchart LR\nA[One]\nA[Two]\nB');
  assert.equal(conflict.has('A'), false);
  assert.ok(conflict.has('B'));
  const multiHop = parseMermaidFlowchartNodeSources('flowchart LR\nA --> B --> C');
  assert.equal(multiHop.size, 0);
});

test('unclosed directives and unsupported statements empty the map', () => {
  assert.equal(parseMermaidFlowchartNodeSources('flowchart LR\n%%{\nA[A]').size, 0);
  const withDirective = parseMermaidFlowchartNodeSources('%%{\ninit: {}\n}%%\nflowchart LR\nA');
  assert.ok(withDirective.has('A'));
  assert.equal(parseMermaidFlowchartNodeSources('not-a-diagram\nA').size, 0);
});

test('resolveMermaidNodeId is null when id and domId disagree', () => {
  const map = parseMermaidFlowchartNodeSources('flowchart LR\nStart --> End');
  assert.equal(resolveMermaidNodeId({ id: 'Start', domId: 'flowchart-End-0' }, map), null);
});
