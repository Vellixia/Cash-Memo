import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** False during SSR/hydration, true afterwards. For values only the browser knows (clock, theme). */
export function useMounted(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}
