/**
 * A focused YAML serializer + parser for the `yourstack.yaml` blueprint.
 *
 * The web app consumes @yourstack/shared as source and cannot pull in a heavy
 * YAML dependency without risking the (flaky) Windows pnpm+Next build, so this
 * hand-rolled implementation covers exactly the subset the blueprint uses:
 * nested maps, block sequences of scalars or maps, and scalar values
 * (string / number / boolean / null). The canvas remains the source of truth,
 * so a parse failure only affects the manual-edit path and is surfaced to the
 * user (and re-validated with the shared zod schema).
 */

type Json = unknown;

const NEEDS_QUOTE = /[:#{}[\],&*!|>'"%@`]|^\s|\s$|^$|^[-?]/;
const BARE_KEYWORD = /^(true|false|null|yes|no|on|off|~)$/i;

function formatScalar(value: Json): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  const s = String(value);
  if (s === '') return "''";
  if (NEEDS_QUOTE.test(s) || BARE_KEYWORD.test(s) || /^[\d.+-]/.test(s)) {
    return `'${s.replace(/'/g, "''")}'`;
  }
  return s;
}

function isPlainObject(v: Json): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function serialize(value: Json, indent: number, lines: string[]): void {
  const pad = '  '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return;
    for (const item of value) {
      if (isPlainObject(item)) {
        const keys = Object.keys(item);
        if (keys.length === 0) {
          lines.push(`${pad}- {}`);
          continue;
        }
        keys.forEach((key, i) => {
          const child = item[key];
          const prefix = i === 0 ? `${pad}- ` : `${'  '.repeat(indent + 1)}`;
          emitKeyed(prefix, key, child, indent + 1, lines);
        });
      } else if (Array.isArray(item)) {
        lines.push(`${pad}-`);
        serialize(item, indent + 1, lines);
      } else {
        lines.push(`${pad}- ${formatScalar(item)}`);
      }
    }
    return;
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      emitKeyed(pad, key, value[key], indent, lines);
    }
  }
}

function emitKeyed(
  prefix: string,
  key: string,
  child: Json,
  childIndent: number,
  lines: string[],
): void {
  const k = formatScalar(key);
  if (Array.isArray(child)) {
    if (child.length === 0) {
      lines.push(`${prefix}${k}: []`);
    } else {
      lines.push(`${prefix}${k}:`);
      serialize(child, childIndent, lines);
    }
  } else if (isPlainObject(child)) {
    if (Object.keys(child).length === 0) {
      lines.push(`${prefix}${k}: {}`);
    } else {
      lines.push(`${prefix}${k}:`);
      serialize(child, childIndent + 1, lines);
    }
  } else {
    lines.push(`${prefix}${k}: ${formatScalar(child)}`);
  }
}

/** Serialize a blueprint object to a clean, deterministic YAML string. */
export function toYaml(value: Json): string {
  const lines: string[] = [];
  serialize(value, 0, lines);
  return lines.join('\n') + '\n';
}

/* -------------------------------- Parsing ---------------------------------- */

function parseScalar(raw: string): Json {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === '[]') return [];
  if (s === '{}') return {};
  if (
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2) ||
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2)
  ) {
    const inner = s.slice(1, -1);
    return s[0] === "'" ? inner.replace(/''/g, "'") : inner.replace(/\\"/g, '"');
  }
  if (/^[+-]?\d+$/.test(s)) return parseInt(s, 10);
  if (/^[+-]?\d*\.\d+$/.test(s)) return parseFloat(s);
  return s;
}

interface Line {
  indent: number;
  content: string;
}

function tokenize(text: string): Line[] {
  const out: Line[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    // Strip full-line and trailing comments (only outside quotes — the blueprint
    // never uses `#` inside values, so a simple heuristic is safe here).
    let line = rawLine;
    const hashAt = findComment(line);
    if (hashAt !== -1) line = line.slice(0, hashAt);
    if (line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    out.push({ indent, content: line.trim() });
  }
  return out;
}

function findComment(line: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === '#' && !inSingle && !inDouble && (i === 0 || line[i - 1] === ' ')) return i;
  }
  return -1;
}

function splitKeyValue(content: string): { key: string; value: string } | null {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === ':' && !inSingle && !inDouble) {
      const after = content[i + 1];
      if (after === undefined || after === ' ') {
        return { key: content.slice(0, i).trim(), value: content.slice(i + 1).trim() };
      }
    }
  }
  return null;
}

function unquoteKey(key: string): string {
  const s = parseScalar(key);
  return typeof s === 'string' ? s : String(s);
}

/** Parse a block of lines [start, end) that all share `baseIndent` at minimum. */
function parseBlock(lines: Line[], start: number, end: number, baseIndent: number): Json {
  // Sequence?
  if (lines[start] && lines[start].content.startsWith('-')) {
    return parseSequence(lines, start, end, baseIndent);
  }
  return parseMap(lines, start, end, baseIndent);
}

function childRange(lines: Line[], start: number, end: number, minIndent: number): number {
  let j = start;
  while (j < end && lines[j]!.indent >= minIndent) j++;
  return j;
}

function parseMap(lines: Line[], start: number, end: number, baseIndent: number): Json {
  const obj: Record<string, Json> = {};
  let i = start;
  while (i < end) {
    const line = lines[i]!;
    if (line.indent < baseIndent) break;
    const kv = splitKeyValue(line.content);
    if (!kv) {
      i++;
      continue;
    }
    const key = unquoteKey(kv.key);
    if (kv.value === '') {
      // Nested block on the following deeper lines.
      const childStart = i + 1;
      const childEnd = childRange(lines, childStart, end, baseIndent + 1);
      obj[key] = childStart < childEnd ? parseBlock(lines, childStart, childEnd, lines[childStart]!.indent) : null;
      i = childEnd;
    } else {
      obj[key] = parseScalar(kv.value);
      i++;
    }
  }
  return obj;
}

function parseSequence(lines: Line[], start: number, end: number, baseIndent: number): Json {
  const arr: Json[] = [];
  let i = start;
  while (i < end) {
    const line = lines[i]!;
    if (line.indent < baseIndent || !line.content.startsWith('-')) break;
    const rest = line.content.slice(1).trim();
    // Gather this item's block (this line + deeper-indented following lines).
    const itemEnd = childRange(lines, i + 1, end, baseIndent + 1);
    if (rest === '') {
      arr.push(i + 1 < itemEnd ? parseBlock(lines, i + 1, itemEnd, lines[i + 1]!.indent) : null);
    } else {
      const kv = splitKeyValue(rest);
      if (kv) {
        // Inline "- key: value" starts a map; synthesize lines for it.
        const synthetic: Line[] = [{ indent: 0, content: rest }];
        for (let k = i + 1; k < itemEnd; k++) {
          synthetic.push({ indent: lines[k]!.indent - (baseIndent + 2), content: lines[k]!.content });
        }
        arr.push(parseMap(synthetic, 0, synthetic.length, 0));
      } else {
        arr.push(parseScalar(rest));
      }
    }
    i = itemEnd;
  }
  return arr;
}

export interface YamlParseResult {
  ok: boolean;
  value?: Json;
  error?: string;
}

/** Parse a YAML document (blueprint subset) into a plain JS value. */
export function fromYaml(text: string): YamlParseResult {
  try {
    const lines = tokenize(text);
    if (lines.length === 0) return { ok: true, value: {} };
    const value = parseBlock(lines, 0, lines.length, lines[0]!.indent);
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid YAML' };
  }
}
