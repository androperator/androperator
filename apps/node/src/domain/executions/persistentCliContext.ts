import { AsyncLocalStorage } from "node:async_hooks";

/** Request-local output, never a process-global stream or environment mutation. */
export const persistentCliContext = new AsyncLocalStorage<{ warn: (message: string) => void }>();
