/**
 * One in-flight call per key, in this process.
 *
 * `claimResolutionSlot` already stops two *processes* paying twice for the
 * same resolution: the second one loses the Firestore transaction and gets a
 * 409. That is correct and stays. What it does not do is help the common
 * case, which is one process — an admin double-clicking "Resolve", or a
 * component mounting twice. There the second request does a Firestore
 * transaction, loses, and the admin sees a conflict error for something that
 * was about to succeed.
 *
 * So this sits in front: identical concurrent work shares one promise and
 * one answer. It is a de-duplicator, not a cache — the entry is deleted the
 * moment the promise settles, so a later request always does real work
 * against fresh state.
 *
 * Deliberately no TTL and no size cap. An entry lives exactly as long as the
 * promise it holds, and the promise is bounded by the provider timeout, so
 * the map cannot grow without a corresponding number of calls actually being
 * in flight.
 */
export interface InFlightMap<T> {
  /**
   * Runs `work` under `key`, or joins the run already under it. The shared
   * promise is returned to every caller, including the rejection — a joiner
   * is not insulated from the failure it would have had on its own.
   */
  run(key: string, work: () => Promise<T>): Promise<T>;
  /** How many calls are in flight. For tests and for a health view. */
  size(): number;
}

export function createInFlightMap<T>(): InFlightMap<T> {
  const running = new Map<string, Promise<T>>();

  return {
    run(key, work) {
      const existing = running.get(key);
      if (existing !== undefined) return existing;

      // Started before the entry is stored, so a synchronous throw inside
      // `work` cannot leave a key pointing at nothing.
      let promise: Promise<T>;
      try {
        promise = work();
      } catch (cause) {
        return Promise.reject(cause);
      }

      // `finally` on the stored promise, not on the returned one: the
      // cleanup must run whichever caller is listening, and must not change
      // what any of them receive.
      const tracked = promise.finally(() => {
        if (running.get(key) === tracked) running.delete(key);
      });
      running.set(key, tracked);
      return tracked;
    },
    size() {
      return running.size;
    },
  };
}
