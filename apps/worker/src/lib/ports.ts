/** Deterministic host-port allocation in a safe range for managed resources. */
export function allocatePort(seed: string, base = 20000, span = 20000): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return base + (h % span);
}
