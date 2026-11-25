"use client";

import * as React from "react";

const TICK_MS = 30_000;

function subscribe(onTick: () => void) {
  const timer = window.setInterval(onTick, TICK_MS);
  return () => window.clearInterval(timer);
}

/**
 * The current time, refreshed every half minute so "5 min ago" keeps counting.
 * Null on the server and during the browser's first draw, so the two agree and
 * nothing mismatches, then the time once the page is live.
 */
export function useNow(): number | null {
  const tick = React.useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / TICK_MS),
    () => null,
  );
  return tick === null ? null : tick * TICK_MS;
}
