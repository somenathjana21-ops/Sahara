/**
 * lib/policy/yaml.ts — a deliberately small YAML reader for policy/v1.yaml.
 *
 * Owner: TM1.
 *
 * WHY THIS EXISTS INSTEAD OF A DEPENDENCY. CLAUDE.md, "Scope discipline": do
 * not install a dependency to solve a problem a short function solves. There
 * is exactly one YAML file in this repo, it is authored by hand from
 * docs/SCORING_AND_POLICY.md section 8, and it uses six constructs. A full
 * YAML implementation would bring anchors, merge keys, multi-document streams
 * and tag resolution into the one file that decides what counts as a crisis.
 *
 * SUPPORTED SUBSET, and nothing else:
 *   - block maps by indentation, `key: value` and `key:` + indented block
 *   - block sequences, `- ` items containing scalars or maps
 *   - inline flow maps on one line, `{ a: 1, b: true }`
 *   - scalars: double/single quoted strings, integers, decimals, true/false, null
 *   - `#` comments, whole-line and trailing, outside quotes
 *
 * Anything outside that throws with the line number. Failing loudly on an
 * unsupported construct is the point: a policy file that half-parses is worse
 * than one that does not load, because the half that vanished is a tier rule.
 *
 * The parser returns `unknown`. Shape is zod's job, in ./engine.ts.
 */

interface Line {
  /** 1-based, for error messages against the real file. */
  no: number;
  indent: number;
  text: string;
}

export class YamlParseError extends Error {
  readonly line: number;

  constructor(message: string, line: number) {
    super(`policy YAML, line ${line}: ${message}`);
    this.name = "YamlParseError";
    this.line = line;
  }
}

/** Drop a trailing `#` comment, but not a `#` inside a quoted scalar. */
function stripComment(raw: string): string {
  let quote: string | null = null;

  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote !== null) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "#" && (i === 0 || /\s/.test(raw[i - 1]))) {
      return raw.slice(0, i);
    }
  }

  return raw;
}

function scan(source: string): Line[] {
  const lines: Line[] = [];

  source.split(/\r?\n/).forEach((raw, i) => {
    const no = i + 1;
    if (raw.includes("\t")) {
      throw new YamlParseError("tabs are not valid YAML indentation", no);
    }
    const stripped = stripComment(raw);
    if (stripped.trim().length === 0) return;
    if (stripped.trim() === "---") return; // single-document files only

    lines.push({
      no,
      indent: stripped.length - stripped.trimStart().length,
      text: stripped.trim(),
    });
  });

  return lines;
}

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

function parseScalar(text: string, no: number): unknown {
  if (text.length >= 2) {
    const q = text[0];
    if ((q === '"' || q === "'") && text.endsWith(q)) {
      return text.slice(1, -1);
    }
  }
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null" || text === "~") return null;
  if (NUMBER.test(text)) return Number(text);
  if (text.startsWith("[")) {
    throw new YamlParseError("flow sequences are not supported", no);
  }
  return text;
}

/** `{ ack_required: true, sla_minutes: 0 }` — one level, no nesting. */
function parseFlowMap(text: string, no: number): Record<string, unknown> {
  const body = text.slice(1, -1).trim();
  const out: Record<string, unknown> = {};
  if (body.length === 0) return out;

  for (const part of body.split(",")) {
    const entry = part.trim();
    if (entry.length === 0) continue;
    const colon = entry.indexOf(":");
    if (colon === -1) {
      throw new YamlParseError(`expected "key: value" in flow map, got "${entry}"`, no);
    }
    const key = entry.slice(0, colon).trim();
    const value = entry.slice(colon + 1).trim();
    if (value.includes("{") || value.includes("}")) {
      throw new YamlParseError("nested flow maps are not supported", no);
    }
    out[key] = parseScalar(value, no);
  }

  return out;
}

function parseValue(text: string, no: number): unknown {
  if (text.startsWith("{")) {
    if (!text.endsWith("}")) {
      throw new YamlParseError("unterminated flow map", no);
    }
    return parseFlowMap(text, no);
  }
  return parseScalar(text, no);
}

const KEY = /^([A-Za-z0-9_.-]+):(?:\s+(.*))?$/;

/**
 * Parse the block starting at `start`, whose entries sit at column `indent`.
 * Returns the value and the index of the first line that is not part of it.
 */
function parseNode(lines: Line[], start: number, indent: number): [unknown, number] {
  if (lines[start].text.startsWith("- ")) {
    const items: unknown[] = [];
    let i = start;

    while (
      i < lines.length &&
      lines[i].indent === indent &&
      lines[i].text.startsWith("- ")
    ) {
      // "- " is two characters, so the item's body starts at indent + 2 and
      // any continuation lines are already indented to match.
      const body: Line[] = [
        { no: lines[i].no, indent: indent + 2, text: lines[i].text.slice(2).trim() },
      ];
      let j = i + 1;
      while (j < lines.length && lines[j].indent > indent) {
        body.push(lines[j]);
        j++;
      }
      items.push(parseNode(body, 0, indent + 2)[0]);
      i = j;
    }

    return [items, i];
  }

  const map: Record<string, unknown> = {};
  let i = start;

  while (i < lines.length && lines[i].indent === indent) {
    const line = lines[i];
    if (line.text.startsWith("- ")) break;

    const m = KEY.exec(line.text);
    if (m === null) {
      throw new YamlParseError(`expected "key: value", got "${line.text}"`, line.no);
    }

    const key = m[1];
    const rest = (m[2] ?? "").trim();

    if (rest.length > 0) {
      map[key] = parseValue(rest, line.no);
      i++;
      continue;
    }

    const child: Line[] = [];
    let j = i + 1;
    while (j < lines.length && lines[j].indent > line.indent) {
      child.push(lines[j]);
      j++;
    }
    if (child.length === 0) {
      throw new YamlParseError(`"${key}" has no value`, line.no);
    }
    map[key] = parseNode(child, 0, child[0].indent)[0];
    i = j;
  }

  return [map, i];
}

/** Parse the supported subset. Throws YamlParseError on anything else. */
export function parseYaml(source: string): unknown {
  const lines = scan(source);
  if (lines.length === 0) return {};

  const [value, consumed] = parseNode(lines, 0, lines[0].indent);
  if (consumed !== lines.length) {
    throw new YamlParseError(
      "inconsistent indentation: this line does not belong to any block",
      lines[consumed].no,
    );
  }
  return value;
}
