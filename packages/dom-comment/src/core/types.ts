export const CONTEXT_LEN = 40;
export const QUOTE_MAX = 500;
export const OUTER_HTML_MAX = 2048;
export const SNAPSHOT_TEXT_MAX = 500;
export const LIST_QUOTE_CLIP = 30;
export const DRAG_THRESHOLD_PX = 8;
export const MIN_AREA_PX = 8;
export const RELOCATE_THRESHOLD = 1_000;

export interface AreaRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CapturedElement {
  kind: 'element';
  css: string;
  xpath: string;
  tagName: string;
  id?: string;
  hints?: { testId?: string; ariaLabel?: string };
  quote: string;
  before: string;
  after: string;
  outerHTML: string;
  textContent: string;
}

export interface CapturedArea {
  kind: 'area';
  rect: AreaRect;
  quote: string;
  before: string;
  after: string;
  outerHTML: string;
  textContent: string;
}

export type CapturedTarget = CapturedElement | CapturedArea;

export interface Snapshot {
  pageTitle: string;
  outerHTML: string;
  textContent: string;
}

export interface StoredElementAnchor {
  kind: 'element';
  css: string;
  xpath: string;
  tagName: string;
  id?: string;
  hints?: { testId?: string; ariaLabel?: string };
  quote: string;
  before: string;
  after: string;
  snapshot: Snapshot;
}

export interface StoredAreaAnchor {
  kind: 'area';
  rect: AreaRect;
  quote: string;
  before: string;
  after: string;
  snapshot: Snapshot;
}

export type StoredAnchor = StoredElementAnchor | StoredAreaAnchor;

export interface RelocateStatus {
  state: 'located' | 'orphaned';
  checkedAt: string;
}

export interface StoredComment {
  id: string;
  author: 'user' | 'agent' | string;
  body: string;
  createdAt: string;
}

export interface StoredThread {
  id: string;
  anchor: StoredAnchor;
  status: 'open' | 'resolved';
  comments: StoredComment[];
  relocateStatus?: RelocateStatus;
  screenshot: string;
}

export interface StoredPage {
  url: string;
  title?: string;
  updatedAt: string;
  threads: StoredThread[];
}

export interface StoredTabFile {
  version: 1;
  tabId: number;
  sessionId: string;
  updatedAt: string;
  pages: Record<string, StoredPage>;
}

export interface RelocateCandidate {
  cssMatched: boolean;
  xpathMatched: boolean;
  idMatched: boolean;
  testIdMatched: boolean;
  rectMatched: boolean;
  tagName: string;
  text: string;
  before: string;
  after: string;
}
