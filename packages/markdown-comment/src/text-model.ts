// Editor-neutral text document model for CLI / local web preview.
// Structural interface matches the subset of vscode.TextDocument that anchor.ts needs.

export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number,
  ) {}
}

export class Range {
  public readonly start: Position;
  public readonly end: Position;

  constructor(start: Position, end: Position);
  constructor(startLine: number, startChar: number, endLine: number, endChar: number);
  constructor(
    startOrLine: Position | number,
    endOrChar: Position | number,
    endLine?: number,
    endChar?: number,
  ) {
    if (typeof startOrLine === 'number') {
      this.start = new Position(startOrLine, endOrChar as number);
      this.end = new Position(endLine as number, endChar as number);
    } else {
      this.start = startOrLine;
      this.end = endOrChar as Position;
    }
  }
}

export interface TextLine {
  text: string;
  range: Range;
  lineNumber: number;
}

/** Minimal document surface used by anchor helpers (and satisfied by vscode.TextDocument). */
export interface TextModel {
  readonly lineCount: number;
  getText: (range?: Range) => string;
  offsetAt: (position: Position) => number;
  positionAt: (offset: number) => Position;
  lineAt: (line: number) => TextLine;
}

export class PlainTextDocument implements TextModel {
  private readonly text: string;
  private readonly lineStarts: number[];

  private constructor(text: string, lineStarts: number[]) {
    this.text = text;
    this.lineStarts = lineStarts;
  }

  static fromString(text: string): PlainTextDocument {
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      if (ch === 13 /* \r */) {
        if (i + 1 < text.length && text.charCodeAt(i + 1) === 10) {
          i++;
        }
        lineStarts.push(i + 1);
      } else if (ch === 10 /* \n */) {
        lineStarts.push(i + 1);
      }
    }
    return new PlainTextDocument(text, lineStarts);
  }

  get lineCount(): number {
    return this.lineStarts.length;
  }

  getText(range?: Range): string {
    if (!range) {
      return this.text;
    }
    return this.text.slice(this.offsetAt(range.start), this.offsetAt(range.end));
  }

  offsetAt(position: Position): number {
    const line = Math.min(Math.max(0, position.line), this.lineCount - 1);
    const lineStart = this.lineStarts[line];
    const lineEnd = line + 1 < this.lineStarts.length ? this.lineStarts[line + 1] : this.text.length;
    // Exclude trailing linebreak from the line's character span (like vscode).
    let contentEnd = lineEnd;
    if (contentEnd > lineStart) {
      if (this.text.charCodeAt(contentEnd - 1) === 10) {
        contentEnd--;
        if (contentEnd > lineStart && this.text.charCodeAt(contentEnd - 1) === 13) {
          contentEnd--;
        }
      } else if (this.text.charCodeAt(contentEnd - 1) === 13) {
        contentEnd--;
      }
    }
    const character = Math.min(Math.max(0, position.character), contentEnd - lineStart);
    return lineStart + character;
  }

  positionAt(offset: number): Position {
    const o = Math.min(Math.max(0, offset), this.text.length);
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      if (this.lineStarts[mid] <= o) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return new Position(low, o - this.lineStarts[low]);
  }

  lineAt(line: number): TextLine {
    const safe = Math.min(Math.max(0, line), this.lineCount - 1);
    const start = this.lineStarts[safe];
    const next = safe + 1 < this.lineStarts.length ? this.lineStarts[safe + 1] : this.text.length;
    let end = next;
    if (end > start) {
      if (this.text.charCodeAt(end - 1) === 10) {
        end--;
        if (end > start && this.text.charCodeAt(end - 1) === 13) {
          end--;
        }
      } else if (this.text.charCodeAt(end - 1) === 13) {
        end--;
      }
    }
    const text = this.text.slice(start, end);
    return {
      text,
      lineNumber: safe,
      range: new Range(new Position(safe, 0), new Position(safe, text.length)),
    };
  }
}
