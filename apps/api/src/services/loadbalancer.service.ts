/**
 * Load-balancer helpers. Backend targets come from two sources: YourStack apps
 * (resolved to their internal container address `yourstack-<appId>:<port>`) and
 * explicit `host:port` targets the caller supplies. Keeping this mapping pure
 * makes it unit-testable and reusable by both the REST route and the blueprint
 * engine.
 */

export interface AppAddress {
  appId: string;
  port: number;
}

export interface ResolvedTarget {
  address: string;
  weight: number;
  /** Set when the target was derived from a managed app; null for explicit hosts. */
  appId: string | null;
}

/** Internal container address the LB routes to for a given app. */
export function appContainerAddress(appId: string, port: number): string {
  return `yourstack-${appId}:${port}`;
}

/**
 * Build the LB target set from resolved apps and explicit `host:port` strings.
 * App-derived targets come first (stable ordering), then explicit hosts. Blank
 * explicit entries are ignored and duplicate addresses are de-duplicated.
 */
export function resolveLbTargets(apps: AppAddress[], explicit: string[]): ResolvedTarget[] {
  const seen = new Set<string>();
  const targets: ResolvedTarget[] = [];

  for (const app of apps) {
    const address = appContainerAddress(app.appId, app.port);
    if (seen.has(address)) continue;
    seen.add(address);
    targets.push({ address, weight: 1, appId: app.appId });
  }

  for (const raw of explicit) {
    const address = raw.trim();
    if (!address || seen.has(address)) continue;
    seen.add(address);
    targets.push({ address, weight: 1, appId: null });
  }

  return targets;
}
