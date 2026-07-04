/**
 * Deterministic JSON canonicalization used as the signing payload for node
 * commands. Both the API (signer) and the agent (verifier) must produce byte
 * identical output, so keys are sorted recursively and there is no whitespace.
 * The Rust agent implements the same algorithm.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortValue(obj[key]);
    }
    return sorted;
  }
  return value;
}
