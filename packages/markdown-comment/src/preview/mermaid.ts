import mermaid from 'mermaid';
import { parseMermaidFlowchartNodeSources, resolveMermaidNodeId } from './mermaid-node';

const CONTAINER_SELECTOR = '.mdc-mermaid';
const CANVAS_SELECTOR = '.mdc-mermaid-canvas';
const SOURCE_SELECTOR = '.mdc-mermaid-source';
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const ZOOM_FACTOR = 1.2;

export interface MermaidViewState {
  scale: number;
  translateX: number;
  translateY: number;
  height?: number;
  sourceHash?: string;
  line?: number;
}

export type MermaidViewStates = Record<string, MermaidViewState>;

export interface MermaidDiagramCommentIntent {
  diagramKey: string;
  startLine: number;
  endLine: number;
  label: 'Mermaid 图';
  target: 'mermaid-diagram';
}

export interface MermaidNodeCommentIntent {
  diagramKey: string;
  startLine: number;
  endLine: number;
  label: string;
  target: 'mermaid-node';
  nodeId: string;
}

export type MermaidCommentIntent = MermaidDiagramCommentIntent | MermaidNodeCommentIntent;

export interface MermaidRuntimeOptions {
  onComment?: (intent: MermaidCommentIntent) => void;
  onCopyError?: (error: unknown) => void;
}

export interface MermaidRenderOptions {
  signal?: AbortSignal;
  viewStates?: MermaidViewStates;
  nodeCommentsEnabled?: boolean;
}

export interface MermaidRuntime {
  captureViewState: (root?: ParentNode) => MermaidViewStates;
  render: (root: ParentNode, options?: MermaidRenderOptions) => Promise<void>;
  abort: () => void;
}

export const MERMAID_COMMENT_EVENT = 'markdown-comment:mermaid-comment';

interface DiagramElements {
  container: HTMLElement;
  canvas: HTMLElement;
  source: HTMLTemplateElement;
}

interface DiagramController {
  signal: AbortSignal;
  capture: () => MermaidViewState;
  dispose: () => void;
}

interface Transform {
  scale: number;
  translateX: number;
  translateY: number;
}

type MermaidTheme = 'default' | 'dark';

function currentTheme(): MermaidTheme {
  const { body } = document;
  if (body.classList.contains('vscode-dark') || body.classList.contains('vscode-high-contrast')) {
    return 'dark';
  }
  if (body.classList.contains('vscode-light') || body.classList.contains('vscode-high-contrast-light')) {
    return 'default';
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default';
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function abortError(): DOMException {
  return new DOMException('Mermaid render aborted', 'AbortError');
}

function throwIfAborted(signal: AbortSignal): void {
  if (isAborted(signal)) {
    throw abortError();
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function finiteNumber(value: string | null | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeViewState(state: MermaidViewState | undefined): MermaidViewState | undefined {
  if (
    !state ||
    !Number.isFinite(state.scale) ||
    !Number.isFinite(state.translateX) ||
    !Number.isFinite(state.translateY)
  ) {
    return undefined;
  }
  return {
    scale: clamp(state.scale, MIN_SCALE, MAX_SCALE),
    translateX: state.translateX,
    translateY: state.translateY,
    height: state.height && Number.isFinite(state.height) ? Math.max(0, state.height) : undefined,
  };
}

function viewStateFor(
  states: MermaidViewStates | undefined,
  key: string,
  source: string,
  line: number,
  usedKeys: Set<string>,
): MermaidViewState | undefined {
  if (!states) {
    return undefined;
  }
  const sourceHash = hashSource(source);
  const exact = states[key];
  if (!usedKeys.has(key) && exact && (!exact.sourceHash || exact.sourceHash === sourceHash)) {
    usedKeys.add(key);
    return normalizeViewState(exact);
  }
  const candidate = Object.entries(states)
    .filter(
      ([candidateKey, state]) =>
        !usedKeys.has(candidateKey) && state.sourceHash === sourceHash && normalizeViewState(state),
    )
    .sort(([, left], [, right]) => {
      const leftLine = Number.isFinite(left.line) ? (left.line as number) : line;
      const rightLine = Number.isFinite(right.line) ? (right.line as number) : line;
      return Math.abs(leftLine - line) - Math.abs(rightLine - line);
    })[0];
  if (!candidate) {
    return undefined;
  }
  usedKeys.add(candidate[0]);
  return normalizeViewState(candidate[1]);
}

function diagramElements(container: HTMLElement): DiagramElements | null {
  const canvas = container.querySelector<HTMLElement>(CANVAS_SELECTOR);
  const source = container.querySelector<HTMLTemplateElement>(SOURCE_SELECTOR);
  return canvas && source ? { container, canvas, source } : null;
}

function diagramSource(source: HTMLTemplateElement): string {
  return source.content.textContent ?? '';
}

function diagramKey(container: HTMLElement, source: string): string {
  const provided = container.dataset.diagramKey?.trim();
  if (provided) {
    return provided;
  }
  return `${finiteNumber(container.dataset.line, 0)}:${hashSource(source)}`;
}

function hashSource(source: string): string {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function renderId(generation: number, index: number, key: string): string {
  return `mdc-mermaid-${generation}-${index}-${hashSource(key)}`;
}

function actionButton(action: string, label: string, text: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mdc-mermaid-action';
  button.dataset.mermaidAction = action;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.textContent = text;
  return button;
}

function buildToolbar(): HTMLElement {
  const toolbar = document.createElement('div');
  toolbar.className = 'mdc-mermaid-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Mermaid 图操作');
  toolbar.append(
    actionButton('zoom-out', '缩小', '−'),
    actionButton('zoom-in', '放大', '+'),
    actionButton('reset', '重置视图', '重置'),
    actionButton('copy', '复制 Mermaid 源码', '复制源码'),
    actionButton('comment', '评论此图', '评论此图'),
  );
  return toolbar;
}

function ensureStructure(elements: DiagramElements): HTMLElement {
  elements.container
    .querySelectorAll<HTMLElement>(':scope > .mdc-mermaid-toolbar, :scope > .mdc-mermaid-error')
    .forEach((element) => element.remove());
  const toolbar = buildToolbar();
  elements.container.insertBefore(toolbar, elements.canvas);
  return toolbar;
}

function showRenderError(elements: DiagramElements, error: unknown): void {
  elements.canvas.replaceChildren();
  elements.canvas.classList.remove('mdc-mermaid-ready');
  const fallback = document.createElement('div');
  fallback.className = 'mdc-mermaid-error';
  fallback.setAttribute('role', 'alert');

  const title = document.createElement('strong');
  title.textContent = 'Mermaid 图渲染失败';
  const message = document.createElement('pre');
  message.className = 'mdc-mermaid-error-message';
  message.textContent = errorMessage(error);
  const source = document.createElement('pre');
  source.className = 'mdc-mermaid-error-source';
  const code = document.createElement('code');
  code.textContent = diagramSource(elements.source);
  source.append(code);
  fallback.append(title, message, source);
  elements.container.append(fallback);
}

function setTransform(viewport: SVGGElement, transform: Transform): void {
  viewport.setAttribute(
    'transform',
    `matrix(${transform.scale} 0 0 ${transform.scale} ${transform.translateX} ${transform.translateY})`,
  );
}

function installViewport(
  svg: SVGSVGElement,
  initialState?: MermaidViewState,
): { viewport: SVGGElement; transform: Transform } {
  const viewport = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  viewport.classList.add('mdc-mermaid-viewport');
  const stationaryElements = new Set(['defs', 'style', 'title', 'desc']);
  const movable = Array.from(svg.childNodes).filter(
    (node) => !stationaryElements.has(node.nodeName.toLowerCase()),
  );
  viewport.append(...movable);
  svg.append(viewport);

  const transform: Transform = {
    scale: initialState?.scale ?? 1,
    translateX: initialState?.translateX ?? 0,
    translateY: initialState?.translateY ?? 0,
  };
  setTransform(viewport, transform);
  return { viewport, transform };
}

function zoomAt(
  svg: SVGSVGElement,
  viewport: SVGGElement,
  transform: Transform,
  clientX: number,
  clientY: number,
  requestedScale: number,
): boolean {
  const nextScale = clamp(requestedScale, MIN_SCALE, MAX_SCALE);
  if (nextScale === transform.scale) {
    return false;
  }
  const point = new DOMPoint(clientX, clientY).matrixTransform(svg.getScreenCTM()?.inverse());
  const contentX = (point.x - transform.translateX) / transform.scale;
  const contentY = (point.y - transform.translateY) / transform.scale;
  transform.translateX = point.x - contentX * nextScale;
  transform.translateY = point.y - contentY * nextScale;
  transform.scale = nextScale;
  setTransform(viewport, transform);
  return true;
}

function diagramCenter(svg: SVGSVGElement): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function copySource(source: string, onError?: (error: unknown) => void): void {
  if (!navigator.clipboard) {
    onError?.(new Error('Clipboard API is unavailable'));
    return;
  }
  void navigator.clipboard.writeText(source).catch((error: unknown) => onError?.(error));
}

function commentIntent(container: HTMLElement, key: string): MermaidCommentIntent {
  return {
    diagramKey: key,
    startLine: finiteNumber(container.dataset.line, 0),
    endLine: finiteNumber(container.dataset.endLine, finiteNumber(container.dataset.line, 0) + 1),
    label: 'Mermaid 图',
    target: 'mermaid-diagram',
  };
}

function emitComment(
  container: HTMLElement,
  key: string,
  onComment: MermaidRuntimeOptions['onComment'],
): void {
  const intent = commentIntent(container, key);
  if (onComment) {
    onComment(intent);
    return;
  }
  container.dispatchEvent(
    new CustomEvent<MermaidCommentIntent>(MERMAID_COMMENT_EVENT, {
      bubbles: true,
      composed: true,
      detail: intent,
    }),
  );
}

function isFlowchartDiagramType(diagramType: string | undefined): boolean {
  return diagramType === 'flowchart' || diagramType === 'flowchart-v2' || diagramType === 'flowchart-elk';
}

function installNodeComments(
  elements: DiagramElements,
  diagramType: string | undefined,
  key: string,
  source: string,
  options: MermaidRuntimeOptions,
  signal: AbortSignal,
): void {
  if (!isFlowchartDiagramType(diagramType)) {
    return;
  }
  const sourceMap = parseMermaidFlowchartNodeSources(source);
  if (sourceMap.size === 0) {
    return;
  }
  const fenceStartLine = finiteNumber(elements.container.dataset.line, 0);
  elements.canvas.querySelectorAll<SVGGElement>('g.node[id]').forEach((node) => {
    const nodeId = resolveMermaidNodeId({ id: node.id, domId: node.getAttribute('data-id') }, sourceMap);
    const location = nodeId ? sourceMap.get(nodeId) : undefined;
    if (!nodeId || !location) {
      return;
    }
    const labelText =
      node.querySelector<HTMLElement>('.nodeLabel, .label')?.textContent?.replace(/\s+/g, ' ').trim() ||
      nodeId;
    node.classList.add('mdc-mermaid-commentable-node');
    node.dataset.mdcNodeId = nodeId;
    node.setAttribute('tabindex', '0');
    node.setAttribute('role', 'button');
    node.setAttribute('aria-label', `评论 Mermaid 节点 ${nodeId}`);
    if (!node.querySelector(':scope > title')) {
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `评论节点 ${nodeId}`;
      node.prepend(title);
    }
    let pointerStart: { x: number; y: number } | undefined;
    const emit = (): void => {
      options.onComment?.({
        diagramKey: key,
        startLine: fenceStartLine + 1 + location.startLine,
        endLine: fenceStartLine + 1 + location.endLine,
        label: labelText || nodeId,
        target: 'mermaid-node',
        nodeId,
      });
    };
    node.addEventListener(
      'pointerdown',
      (event) => {
        pointerStart = { x: event.clientX, y: event.clientY };
      },
      { signal },
    );
    node.addEventListener(
      'click',
      (event) => {
        const moved =
          pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 4;
        pointerStart = undefined;
        if (moved) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        emit();
      },
      { signal },
    );
    node.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          emit();
        }
      },
      { signal },
    );
  });
}

function installToolbarActions(
  elements: DiagramElements,
  toolbar: HTMLElement,
  key: string,
  options: MermaidRuntimeOptions,
  signal: AbortSignal,
  onViewAction?: (action: string) => void,
): void {
  toolbar.addEventListener(
    'click',
    (event) => {
      const action = (event.target as HTMLElement).closest<HTMLElement>('[data-mermaid-action]')?.dataset
        .mermaidAction;
      if (!action) {
        return;
      }
      if (action === 'copy') {
        copySource(diagramSource(elements.source), options.onCopyError);
      } else if (action === 'comment') {
        emitComment(elements.container, key, options.onComment);
      } else {
        onViewAction?.(action);
      }
    },
    { signal },
  );
}

function installFallbackInteractions(
  elements: DiagramElements,
  toolbar: HTMLElement,
  key: string,
  options: MermaidRuntimeOptions,
): DiagramController {
  const controller = new AbortController();
  installToolbarActions(elements, toolbar, key, options, controller.signal);
  return {
    signal: controller.signal,
    capture: () => ({ scale: 1, translateX: 0, translateY: 0 }),
    dispose: () => controller.abort(),
  };
}

function installInteractions(
  elements: DiagramElements,
  toolbar: HTMLElement,
  key: string,
  state: MermaidViewState | undefined,
  options: MermaidRuntimeOptions,
): DiagramController | null {
  const svg = elements.canvas.querySelector<SVGSVGElement>('svg');
  if (!svg) {
    return null;
  }
  svg.classList.add('mdc-mermaid-svg');
  svg.setAttribute('tabindex', '0');
  svg.setAttribute('role', 'img');
  const { viewport, transform } = installViewport(svg, state);
  if (state?.height) {
    elements.canvas.style.height = `${state.height}px`;
  } else {
    elements.canvas.style.removeProperty('height');
  }
  elements.canvas.style.resize = 'vertical';
  elements.canvas.style.overflow = 'auto';

  const controller = new AbortController();
  const { signal } = controller;
  let pointerId: number | null = null;
  let lastPoint: DOMPoint | null = null;

  svg.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0) {
        return;
      }
      pointerId = event.pointerId;
      lastPoint = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM()?.inverse());
      svg.setPointerCapture(pointerId);
      svg.classList.add('mdc-mermaid-panning');
      event.preventDefault();
    },
    { signal },
  );
  svg.addEventListener(
    'pointermove',
    (event) => {
      if (pointerId !== event.pointerId || !lastPoint) {
        return;
      }
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM()?.inverse());
      transform.translateX += point.x - lastPoint.x;
      transform.translateY += point.y - lastPoint.y;
      lastPoint = point;
      setTransform(viewport, transform);
    },
    { signal },
  );
  const stopPanning = (event: PointerEvent): void => {
    if (pointerId !== event.pointerId) {
      return;
    }
    if (svg.hasPointerCapture(pointerId)) {
      svg.releasePointerCapture(pointerId);
    }
    pointerId = null;
    lastPoint = null;
    svg.classList.remove('mdc-mermaid-panning');
  };
  svg.addEventListener('pointerup', stopPanning, { signal });
  svg.addEventListener('pointercancel', stopPanning, { signal });
  svg.addEventListener(
    'wheel',
    (event) => {
      const factor = event.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      if (zoomAt(svg, viewport, transform, event.clientX, event.clientY, transform.scale * factor)) {
        event.preventDefault();
      }
    },
    { passive: false, signal },
  );

  installToolbarActions(elements, toolbar, key, options, signal, (action) => {
    if (action === 'zoom-in' || action === 'zoom-out') {
      const center = diagramCenter(svg);
      const factor = action === 'zoom-in' ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      zoomAt(svg, viewport, transform, center.x, center.y, transform.scale * factor);
    } else if (action === 'reset') {
      transform.scale = 1;
      transform.translateX = 0;
      transform.translateY = 0;
      elements.canvas.style.removeProperty('height');
      setTransform(viewport, transform);
    }
  });

  return {
    signal,
    capture: () => ({
      ...transform,
      height: elements.canvas.style.height ? elements.canvas.getBoundingClientRect().height : undefined,
    }),
    dispose: () => controller.abort(),
  };
}

export function createMermaidRuntime(options: MermaidRuntimeOptions = {}): MermaidRuntime {
  let generation = 0;
  let activeRender: AbortController | undefined;
  const controllers = new WeakMap<HTMLElement, DiagramController>();
  let lastViewStates: MermaidViewStates = {};

  const captureViewState = (root: ParentNode = document): MermaidViewStates => {
    const states: MermaidViewStates = {};
    root.querySelectorAll<HTMLElement>(CONTAINER_SELECTOR).forEach((container) => {
      const key = container.dataset.diagramKey;
      const controller = controllers.get(container);
      if (key && controller) {
        const template = container.querySelector<HTMLTemplateElement>(SOURCE_SELECTOR);
        if (template) {
          states[key] = {
            ...controller.capture(),
            sourceHash: hashSource(diagramSource(template)),
            line: finiteNumber(container.dataset.line, 0),
          };
        }
      }
    });
    return states;
  };

  const abort = (): void => {
    generation += 1;
    activeRender?.abort();
    activeRender = undefined;
  };

  const render = async (root: ParentNode, renderOptions: MermaidRenderOptions = {}): Promise<void> => {
    const capturedStates = captureViewState(root);
    lastViewStates = { ...lastViewStates, ...capturedStates };
    const savedStates = { ...lastViewStates, ...(renderOptions.viewStates ?? capturedStates) };
    abort();
    const thisGeneration = generation;
    const renderController = new AbortController();
    activeRender = renderController;
    const onExternalAbort = (): void => renderController.abort();
    renderOptions.signal?.addEventListener('abort', onExternalAbort, { once: true });
    if (renderOptions.signal?.aborted) {
      renderController.abort();
    }
    const { signal } = renderController;
    const usedStateKeys = new Set<string>();

    try {
      throwIfAborted(signal);
      mermaid.initialize({
        securityLevel: 'strict',
        startOnLoad: false,
        suppressErrorRendering: true,
        theme: currentTheme(),
      });

      const diagrams = Array.from(root.querySelectorAll<HTMLElement>(CONTAINER_SELECTOR));
      for (const [index, container] of diagrams.entries()) {
        const elements = diagramElements(container);
        if (!elements) {
          continue;
        }
        const previousController = controllers.get(container);
        const source = diagramSource(elements.source);
        const key = diagramKey(container, source);
        const line = finiteNumber(container.dataset.line, 0);
        container.dataset.diagramKey = key;
        container.dataset.mermaidGeneration = String(thisGeneration);
        elements.canvas.setAttribute('aria-busy', 'true');

        try {
          throwIfAborted(signal);
          const result = await mermaid.render(renderId(thisGeneration, index, key), source);
          throwIfAborted(signal);
          if (generation !== thisGeneration || !(root instanceof Node) || !root.contains(container)) {
            continue;
          }
          previousController?.dispose();
          controllers.delete(container);
          const toolbar = ensureStructure(elements);
          elements.canvas.innerHTML = result.svg;
          result.bindFunctions?.(elements.canvas);
          const controller = installInteractions(
            elements,
            toolbar,
            key,
            viewStateFor(savedStates, key, source, line, usedStateKeys),
            options,
          );
          if (controller) {
            controllers.set(container, controller);
            if (renderOptions.nodeCommentsEnabled) {
              installNodeComments(elements, result.diagramType, key, source, options, controller.signal);
            }
          }
          elements.canvas.classList.add('mdc-mermaid-ready');
        } catch (error) {
          if (isAborted(signal) || generation !== thisGeneration) {
            continue;
          }
          previousController?.dispose();
          controllers.delete(container);
          const toolbar = ensureStructure(elements);
          showRenderError(elements, error);
          controllers.set(container, installFallbackInteractions(elements, toolbar, key, options));
        } finally {
          if (container.dataset.mermaidGeneration === String(thisGeneration)) {
            elements.canvas.removeAttribute('aria-busy');
            delete container.dataset.mermaidGeneration;
          }
        }
      }
    } finally {
      renderOptions.signal?.removeEventListener('abort', onExternalAbort);
      if (activeRender === renderController) {
        activeRender = undefined;
      }
      if (generation === thisGeneration) {
        lastViewStates = { ...lastViewStates, ...captureViewState(root) };
      }
    }
  };

  return { captureViewState, render, abort };
}
