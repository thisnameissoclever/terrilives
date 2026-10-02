/** A timed-out acquisition still disposes of a resource that resolves later. */
export async function acquireWithTimeout<T>(
  acquisition: Promise<T>, milliseconds: number, dispose: (value: T) => void, label: string,
): Promise<T> {
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observed = acquisition.then(value => {
    if (expired) dispose(value);
    return value;
  });
  try {
    return await Promise.race([observed, new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        reject(new Error(`Timed out: ${label}`));
      }, milliseconds);
    })]);
  } finally {
    clearTimeout(timer);
  }
}
