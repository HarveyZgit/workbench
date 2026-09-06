declare const chrome: {
  runtime: {
    connectNative: (name: string) => {
      postMessage: (msg: unknown) => void;
      onMessage: { addListener: (fn: (msg: never) => void) => void };
      onDisconnect: { addListener: (fn: () => void) => void };
    };
    sendMessage: (msg: unknown, cb?: (res: never) => void) => unknown;
    onMessage: {
      addListener: (
        fn: (
          msg: never,
          sender: { tab?: { id?: number; windowId?: number } },
          sendResponse: (v: unknown) => void,
        ) => unknown,
      ) => void;
    };
    onInstalled: { addListener: (fn: () => void) => void };
    onStartup: { addListener: (fn: () => void) => void };
    lastError?: { message: string };
  };
  storage: {
    session: {
      get: (k: string | string[]) => Promise<Record<string, unknown>>;
      set: (v: Record<string, unknown>) => Promise<void>;
      onChanged: {
        addListener: (fn: (c: Record<string, { newValue?: unknown }>) => void) => void;
      };
    };
    local: {
      get: (k: string | string[]) => Promise<Record<string, unknown>>;
      set: (v: Record<string, unknown>) => Promise<void>;
    };
  };
  action: {
    setIcon: (d: { path: Record<number, string> }) => Promise<void>;
    setTitle: (d: { title: string }) => Promise<void>;
    onClicked: {
      addListener: (fn: (tab: { id?: number; url?: string; windowId?: number }) => void) => void;
    };
  };
  tabs: {
    query: (q: Record<string, unknown>) => Promise<{ id?: number; url?: string; windowId?: number }[]>;
    get: (id: number) => Promise<{ id?: number; windowId?: number }>;
    update: (id: number, o: { active?: boolean }) => Promise<unknown>;
    sendMessage: (id: number, msg: unknown, cb?: (res: never) => void) => unknown;
    captureVisibleTab: {
      (opts?: { format?: string }): Promise<string>;
      (windowId: number, opts?: { format?: string }): Promise<string>;
    };
    onUpdated: {
      addListener: (fn: (id: number, info: { status?: string; url?: string }) => void) => void;
    };
    onRemoved: { addListener: (fn: (id: number) => void) => void };
    onActivated: { addListener: (fn: (info: { tabId: number; windowId: number }) => void) => void };
    getCurrent: () => Promise<unknown>;
  };
  windows: {
    getCurrent: () => Promise<{ id?: number }>;
    update: (id: number, o: { focused?: boolean }) => Promise<unknown>;
  };
  commands: {
    onCommand: { addListener: (fn: (c: string) => void) => void };
  };
  sidePanel: {
    open: (o: { windowId: number }) => Promise<void>;
  };
  contextMenus: {
    removeAll: (cb?: () => void) => void;
    create: (createProperties: {
      id: string;
      title: string;
      contexts: string[];
      documentUrlPatterns?: string[];
    }) => void;
    onClicked: {
      addListener: (
        fn: (info: { menuItemId: string | number }, tab?: { id?: number; url?: string }) => void,
      ) => void;
    };
  };
  scripting: {
    executeScript: (injection: {
      target: { tabId: number };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      func: (...args: any[]) => unknown;
      args?: unknown[];
    }) => Promise<unknown>;
  };
};
