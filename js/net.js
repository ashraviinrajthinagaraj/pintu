// Small helpers for talking to other people's servers.

export const cancelled = () => new DOMException('The request was cancelled', 'AbortError');

// Runs a request with a limit on it. The limit holds even if the request
// ignores being cancelled, because nothing here may wait forever.
export async function within(ms, signal, run) {
  const ctrl = new AbortController();
  const stop = () => ctrl.abort();
  const timer = setTimeout(stop, ms);
  if (signal?.aborted) stop();
  signal?.addEventListener('abort', stop);
  const gaveUp = new Promise((_, reject) => {
    if (ctrl.signal.aborted) reject(cancelled());
    ctrl.signal.addEventListener('abort', () => reject(cancelled()));
  });
  try {
    return await Promise.race([run(ctrl.signal), gaveUp]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}
