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

interface ParsedEndpoint {
  nodeId: string;
  explicit: boolean;
  declaration?: string;
}

function parseEndpoint(source: string): ParsedEndpoint | null {
  const trimmed = source.trim();
  const match = SIMPLE_ENDPOINT.exec(trimmed);
  if (!match) {
    return null;
  }
  const declaration = trimmed.slice(match[1].length).replace(/\s+/g, ' ');
  return {
    nodeId: match[1],
    explicit: declaration.length > 0,
    declaration: declaration || undefined,
  };
}

function lineEndpoints(line: string): ParsedEndpoint[] | null {
  const edgeParts = line.split('-->');
  if (edgeParts.length === 2) {
    const from = parseEndpoint(edgeParts[0]);
    const to = parseEndpoint(edgeParts[1]);
    return from && to ? [from, to] : null;
  }
  if (edgeParts.length > 2) {
    return null;
  }

  const endpoint = parseEndpoint(line);
  return endpoint ? [endpoint] : null;
}

export function parseMermaidFlowchartNodeSources(source: string): MermaidNodeSourceMap {
  const lines = source.split(/\r?\n/);
  const declarationLine = firstDeclarationLine(lines);
  if (declarationLine < 0 || !FLOWCHART_DECLARATION.test(lines[declarationLine].trim())) {
    return new Map();
  }

  const sourceLines = new Map<string, { references: number[]; declarations: Map<string, number[]> }>();
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

    const endpoints = lineEndpoints(line);
    if (!endpoints) {
      return new Map();
    }
    for (const endpoint of endpoints) {
      const locations = sourceLines.get(endpoint.nodeId) ?? {
        references: [],
        declarations: new Map<string, number[]>(),
      };
      locations.references.push(lineIndex);
      if (endpoint.explicit && endpoint.declaration) {
        const declarationLines = locations.declarations.get(endpoint.declaration) ?? [];
        declarationLines.push(lineIndex);
        locations.declarations.set(endpoint.declaration, declarationLines);
      }
      sourceLines.set(endpoint.nodeId, locations);
    }
  }

  if (inDirective) {
    return new Map();
  }

  const result = new Map<string, MermaidNodeSourceLocation>();
  for (const [nodeId, locations] of sourceLines) {
    if (locations.declarations.size > 1) {
      continue;
    }
    const declarationLines = locations.declarations.values().next().value as number[] | undefined;
    const startLine = declarationLines?.[0] ?? locations.references[0];
    if (startLine === undefined) {
      continue;
    }
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
    if (identifier === nodeId || flowchartMatch?.[1] === nodeId) {
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
