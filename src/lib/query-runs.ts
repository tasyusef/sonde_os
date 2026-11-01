/**
 * Per-key bookkeeping for the XRPL queries `useXrplQuery` shares through
 * SWR: who still wants a key, the abort controller of its current run,
 * and the partial result a long walk has published so far.
 *
 * - A run is aborted once no component wants its key. The abort waits a
 *   tick, so StrictMode's remount and a tab swap that remounts the same
 *   key in one commit don't cancel it.
 * - Starting a run aborts the key's previous one (a retry supersedes it).
 * - A run aborted for lack of users restarts if someone wants the key
 *   again before it stops: SWR hands its in-flight promise to that new
 *   mount, so the promise must not reject.
 */

interface Run {
  controller: AbortController;
  superseded: boolean;
}

interface Entry {
  users: number;
  run: Run | null;
  abortTimer: ReturnType<typeof setTimeout> | null;
  progress: unknown;
  /** The run that published `progress`. */
  progressRun: Run | null;
  listeners: Set<() => void>;
}

const entries = new Map<string, Entry>();
/** When each key's last run succeeded. */
const fetchedAt = new Map<string, number>();

function entryFor(id: string): Entry {
  let e = entries.get(id);
  if (!e) {
    e = { users: 0, run: null, abortTimer: null, progress: undefined, progressRun: null, listeners: new Set() };
    entries.set(id, e);
  }
  return e;
}

function prune(id: string, e: Entry): void {
  if (e.users === 0 && !e.run && !e.abortTimer && e.listeners.size === 0 && e.progress === undefined) {
    if (entries.get(id) === e) entries.delete(id);
  }
}

function setProgress(e: Entry, run: Run | null, value: unknown): void {
  e.progress = value;
  e.progressRun = run;
  for (const listener of e.listeners) listener();
}

/** Mark `id` as wanted by one more component. Call the returned
 *  function when it stops wanting it. */
export function retainQuery(id: string): () => void {
  const e = entryFor(id);
  e.users++;
  if (e.abortTimer) {
    clearTimeout(e.abortTimer);
    e.abortTimer = null;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    e.users--;
    if (e.users > 0) return;
    e.abortTimer = setTimeout(() => {
      e.abortTimer = null;
      if (e.users > 0) return;
      e.run?.controller.abort();
      prune(id, e);
    }, 0);
  };
}

export function isQueryWanted(id: string): boolean {
  return (entries.get(id)?.users ?? 0) > 0;
}

export function isQueryRunning(id: string): boolean {
  return !!entries.get(id)?.run;
}

/** Time of the key's last successful run, if any. */
export function queryFetchedAt(id: string): number | undefined {
  return fetchedAt.get(id);
}

/** Partial result published by the key's run in flight, if any. */
export function getQueryProgress(id: string): unknown {
  return entries.get(id)?.progress;
}

export function subscribeQueryProgress(id: string, listener: () => void): () => void {
  const e = entryFor(id);
  e.listeners.add(listener);
  return () => {
    e.listeners.delete(listener);
    prune(id, e);
  };
}

export interface RunContext {
  signal: AbortSignal;
  /** Publish a partial result. Ignored once the run is aborted. */
  publish: (value: unknown) => void;
}

/**
 * Run `task` as `id`'s current run (see the module comment for when it
 * is aborted or restarted). Rejects with the abort reason when the run
 * is superseded or nobody wants it anymore.
 */
export async function runQuery<T>(id: string, task: (ctx: RunContext) => Promise<T>): Promise<T> {
  for (;;) {
    const e = entryFor(id);
    if (e.run) {
      e.run.superseded = true;
      e.run.controller.abort();
    }
    const run: Run = { controller: new AbortController(), superseded: false };
    e.run = run;
    const { signal } = run.controller;
    const publish = (value: unknown) => {
      if (!signal.aborted && e.run === run) setProgress(e, run, value);
    };
    try {
      const value = await task({ signal, publish });
      if (!signal.aborted) {
        fetchedAt.set(id, Date.now());
        return value;
      }
    } catch (err) {
      if (!signal.aborted) throw err;
    } finally {
      if (e.run === run) e.run = null;
      // Cleared a tick later, once SWR holds the final data, so readers
      // never see neither. A newer run's progress is left alone.
      setTimeout(() => {
        if (e.progressRun !== run) return;
        setProgress(e, null, undefined);
        prune(id, e);
      }, 0);
    }
    if (run.superseded || !isQueryWanted(id)) throw signal.reason;
  }
}
