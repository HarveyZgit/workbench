// 浏览器预览：评论变更先入队，按间隔 / 显式保存 / 关页 flush 到本地服务。
export interface SyncQueue<T> {
  enqueue: (item: T) => void;
  pending: () => T[];
  take: () => T[];
  size: () => number;
}

export function createSyncQueue<T>(): SyncQueue<T> {
  const items: T[] = [];
  return {
    enqueue(item) {
      items.push(item);
    },
    pending() {
      return items.slice();
    },
    take() {
      return items.splice(0, items.length);
    },
    size() {
      return items.length;
    },
  };
}

export function startInterval(callback: () => void, intervalMs: number): () => void {
  const id = setInterval(callback, intervalMs);
  return () => clearInterval(id);
}
