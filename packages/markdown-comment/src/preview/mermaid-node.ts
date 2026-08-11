const SAFE_NODE_ID_SOURCE = '[A-Za-z_][A-Za-z0-9_-]*';
const SAFE_NODE_ID = new RegExp(`^${SAFE_NODE_ID_SOURCE}$`);
const SIMPLE_ENDPOINT = new RegExp(
  `^(${SAFE_NODE_ID_SOURCE})(?:\\s*(?:\\[[^\\[\\]<>\\r\\n&]*\\]|\\([^()<>\\r\\n&]*\\)|\\{[^{}<>\\r\\n&]*\\}))?$`,
);
const FLOWCHART_DECLARATION = /^(?:flowchart|graph)(?:\s+(?:TB|BT|RL|LR|TD))?$/i;
const NON_NODE_STATEMENT =
  /^(?:direction\b|classDef\b|class\b|style\b|linkStyle\b|click\b|accTitle\s*:|accDescr\s*:|end\s*$)/i;

export interface MermaidNodeSourceLocation {
  readonly startLine: number;
  readonly endLine: number;
}

export type MermaidNodeSourceMap = ReadonlyMap<string, MermaidNodeSourceLocation>;

export interface MermaidNodeDomIdentifiers {
  readonly id?: string | null;
  readonly domId?: string | null;
}

function isDirectiveStart(line: string): boolean {
  return line.startsWith('%%{');
}

function isDirectiveEnd(line: string): boolean {
  return line.endsWith('}%%');
}

function firstDeclarationLine(lines: readonly string[]): number {
  let inDirective = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex].trim();
    if (inDirective) {
      if (isDirectiveEnd(line)) {
        inDirective = false;
      }
      continue;
    }
    if (!line || line.startsWith('%%')) {
      if (isDirectiveStart(line) && !isDirectiveEnd(line)) {
        inDirective = true;
      }
      continue;
    }
    return lineIndex;
  }

  return -1;
}

function endpointNodeId(source: string): string | null {
  return SIMPLE_ENDPOINT.exec(source.trim())?.[1] ?? null;
}

function lineNodeIds(line: string): string[] | null {
  const edgeParts = line.split('-->');
  if (edgeParts.length === 2) {
    const from = endpointNodeId(edgeParts[0]);
    const to = endpointNodeId(edgeParts[1]);
    return from && to ? [from, to] : null;
  }
  if (edgeParts.length > 2) {
    return null;
  }

  const nodeId = endpointNodeId(line);
  return nodeId ? [nodeId] : null;
}

export function parseMermaidFlowchartNodeSources(source: string): MermaidNodeSourceMap {
  const lines = source.split(/\r?\n/);
  const declarationLine = firstDeclarationLine(lines);
  if (declarationLine < 0 || !FLOWCHART_DECLARATION.test(lines[declarationLine].trim())) {
    return new Map();
  }

  const sourceLines = new Map<string, number[]>();
  let inDirective = false;

  for (let lineIndex = declarationLine + 1; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex].trim();
    if (inDirective) {
      if (isDirectiveEnd(line)) {
        inDirective = false;
      }
      continue;
    }
    if (!line || line.startsWith('%%')) {
      if (isDirectiveStart(line) && !isDirectiveEnd(line)) {
        inDirective = true;
      }
      continue;
    }
    if (/^subgraph\b/i.test(line)) {
      return new Map();
    }
    if (NON_NODE_STATEMENT.test(line)) {
      continue;
    }

    const nodeIds = lineNodeIds(line);
    if (!nodeIds) {
      return new Map();
    }
    for (const nodeId of nodeIds) {
      const locations = sourceLines.get(nodeId) ?? [];
      locations.push(lineIndex);
      sourceLines.set(nodeId, locations);
    }
  }

  if (inDirective) {
    return new Map();
  }

  const result = new Map<string, MermaidNodeSourceLocation>();
  for (const [nodeId, locations] of sourceLines) {
    if (locations.length !== 1) {
      continue;
    }
    const [startLine] = locations;
    result.set(nodeId, { startLine, endLine: startLine + 1 });
  }
  return result;
}

function candidatesForIdentifier(identifier: string, sourceMap: MermaidNodeSourceMap): Set<string> {
  const candidates = new Set<string>();
  const flowchartMatch = /(?:^|-)flowchart-(.+)-\d+$/.exec(identifier);

  for (const nodeId of sourceMap.keys()) {
    if (!SAFE_NODE_ID.test(nodeId)) {
      continue;
    }
    if (
      identifier === nodeId ||
      flowchartMatch?.[1] === nodeId
    ) {
      candidates.add(nodeId);
    }
  }

  return candidates;
}

export function resolveMermaidNodeId(
  identifiers: MermaidNodeDomIdentifiers,
  sourceMap: MermaidNodeSourceMap,
): string | null {
  const candidates = new Set<string>();

  for (const identifier of [identifiers.id, identifiers.domId]) {
    if (!identifier) {
      continue;
    }
    for (const candidate of candidatesForIdentifier(identifier, sourceMap)) {
      candidates.add(candidate);
    }
  }

  return candidates.size === 1 ? [...candidates][0] : null;
}
