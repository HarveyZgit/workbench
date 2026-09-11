// Bounded awaits for host APIs that can hang (openTextDocument / workspace.fs
// after the preview replaces the only editor tab on Trae Remote×local).

function settle<T>(promise: Promise<T>): Promise<T | undefined> {
  return promise.then(
    (value) => value,
    () => undefined,
  );
}

/** Race a promise against a timeout; rejection or timeout → undefined. */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      settle(promise),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
