/**
 * The tool names, without importing the tools: the configuration checks MCP_ENABLED_TOOLS against them at startup.
 * A test checks that this list is exactly what the server registers.
 */
export const TOOL_NAMES = [
  'convert_document', 'render_document', 'get_render_result', 'inspect_template', 'list_templates', 'list_categories',
  'list_tags', 'upload_template', 'update_template_metadata', 'delete_template', 'download_template', 'get_api_status',
  'find_template_examples', 'get_capabilities',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** What MCP_ENABLED_TOOLS may leave out: every tool but get_capabilities, the local overview the texts point to. */
export const DISABLEABLE_TOOLS: readonly ToolName[] = TOOL_NAMES.filter((tool) => tool !== 'get_capabilities');

/** No tool disabled. */
export const NO_TOOLS: ReadonlySet<ToolName> = new Set();

/** The carbone:// resources (URI prefix) read through a tool: a disabled tool takes them, and their mentions, with it. */
export const TOOL_RESOURCES: Partial<Record<ToolName, string>> = {
  list_templates: 'carbone://templates', list_categories: 'carbone://categories', list_tags: 'carbone://tags',
  get_api_status: 'carbone://status',
};

/** The tool a resource URI (or URI template) is read through, if any. */
export const toolOfResource = (uri: string): ToolName | undefined =>
  (Object.keys(TOOL_RESOURCES) as ToolName[]).find((tool) => uri.startsWith(TOOL_RESOURCES[tool]!));

/**
 * Phrases that stand for tools without naming them: one goes once every tool it stands for is disabled. Each must
 * appear in a text the server shows (a test checks it), so that a rewording is noticed.
 */
export const TOOL_ALIASES: Record<string, readonly ToolName[]> = {
  'Template-Based Generation': ['render_document'], // get_capabilities section 2
  'Design a template': ['upload_template'], // the first step of a stored template, useless without uploading it
  'Document Conversion': ['convert_document', 'render_document'], // get_capabilities section 1: formats and converters
  'Results:': ['convert_document', 'render_document'], // how a document comes back
  expireAt: ['upload_template', 'update_template_metadata'], // the field only these two set
};

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TOOL = `\`?\\b(?:${TOOL_NAMES.join('|')})\\b\`?`;
/** Two tool names or more in a row: "a, b or c". */
const TOOLS = `${TOOL}(?:(?:, |,? (?:or|and) )${TOOL})*`;
const TOOL_LIST = new RegExp(`${TOOL}(?:(?:, |,? (?:or|and) )${TOOL})+`, 'g');
/** Where a value comes from or what it is for: ", from list_templates", "searched by list_templates", ", for the filter of list_templates". */
const SOURCE = new RegExp(`(?:,? (?:from|by)|(?:,|:) (?:for |the )[^,;:()]*? (?:of|by|from)) ${TOOLS}`, 'g');
/** A clause opening on a tool name: it has its own subject. */
const OWN_SUBJECT = new RegExp(`^${TOOL}`);
/** A sentence, or a clause, leaning on the one before: it goes with it. */
const FOLLOW_UPS = [/^(?:It|That|This|They|These)\b/, /^(?:with|without|its?)\b/];
/** A text splits into sentences, then a sentence into clauses that read on their own. */
const BREAKS = [/^\. /, /^(?:; |, then |, or )/];

/** `text` cut before each `brk` outside brackets, as [separator, piece] pairs; "e.g. " and "i.e. " end no sentence. */
function split(text: string, brk: RegExp): Array<[string, string]> {
  const pieces: Array<[string, string]> = [['', '']];
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const sep = depth || /(?:^|\W)(?:e\.g|i\.e)$/.test(text.slice(Math.max(0, i - 4), i)) ? undefined : brk.exec(text.slice(i))?.[0];
    if (sep) { pieces.push([sep, '']); i += sep.length - 1; continue; }
    depth += '([{'.includes(text[i]!) ? 1 : ')]}'.includes(text[i]!) ? -1 : 0;
    pieces.at(-1)![1] += text[i];
  }
  return pieces;
}

/**
 * `text` without what names a disabled tool (its name, its carbone:// resources, or an alias), so that no text offers
 * what the model cannot call. The smallest unit naming one goes: a heading's section, a table row, a line headed "tool:", a sentence,
 * then within one a name in a list of tools, where a value comes from, an aside in brackets or a clause; a follow-up
 * leaning on what went goes too. Nothing disabled: `text` as is.
 */
export function withoutTools(text: string, disabled: ReadonlySet<ToolName>): string {
  if (!disabled.size) return text;
  const aliases = Object.entries(TOOL_ALIASES).filter(([, tools]) => tools.every((tool) => disabled.has(tool))).map(([alias]) => alias);
  const names = [...[...disabled].flatMap((tool) => [tool, TOOL_RESOURCES[tool] ?? []].flat()), ...aliases].map(escape).join('|');
  const named = new RegExp(`(?<!\\w)(?:${names})(?!\\w)`);
  const label = new RegExp(`^\`?(?:${names})\`?:`);
  const subject = new RegExp(`^\`?(?:${names})(?!\\w)`);

  const prune = (part: string, level = 0): string => {
    if (!named.test(part)) return part;
    // A sentence about what is disabled (its first word): its other clauses are about it too, unless they name their own tool.
    const about = level === 1 && subject.test(part);
    if (level === 1) {
      part = part.replace(TOOL_LIST, (list) => {
        const tools = list.match(new RegExp(TOOL, 'g'))!;
        const kept = tools.filter((tool) => !named.test(tool));
        if (!kept.length || kept.length === tools.length) return list;
        return kept.length === 1 ? kept[0]! : `${kept.slice(0, -1).join(', ')} ${/ and /.test(list) ? 'and' : 'or'} ${kept.at(-1)}`;
      }).replace(SOURCE, (source) => (named.test(source) ? '' : source))
        .replace(/ ?\([^()]*\)/g, (aside) => (named.test(aside) ? '' : aside));
      if (!named.test(part)) return part;
    }
    if (level === BREAKS.length) return '';
    const end = /[.?!]$/.exec(part)?.[0] ?? '';
    const pieces = split(part.slice(0, part.length - end.length), BREAKS[level]!);
    let gone = false; // the piece before was dropped: a follow-up sentence goes with it
    const kept = pieces.map(([sep, piece], i) => {
      const leans = gone && FOLLOW_UPS[level]!.test(piece) || about && i > 0 && !OWN_SUBJECT.test(piece);
      const left = leans ? '' : prune(piece, level + 1);
      gone = !left;
      return [sep, left] as const;
    }).filter(([, piece]) => piece);
    if (!kept.length) return '';
    // A first piece gone: the next one opens the text, without its separator.
    const [[sep, first], ...rest] = kept;
    const head = sep ? first.replace(/^[a-z]/, (c) => (/^[A-Z]/.test(part) ? c.toUpperCase() : c)) : first;
    return head + rest.map(([s, piece]) => s + piece).join('') + end;
  };

  // Each kept line, with the numbered list it was in (0 for none) and that list's first number, to renumber it.
  const lines: Array<[line: string, list: number, start: number]> = [];
  let list = 0, start = 0;
  let droppedLevel = 0; // the level of the heading whose section is being dropped
  for (const line of text.split('\n')) {
    const number = /^(\d+)\. /.exec(line)?.[1];
    if (number && !start) { list++; start = Number(number); } else if (!number) start = 0;
    const level = /^(#+) /.exec(line)?.[1]!.length ?? 0;
    if (droppedLevel && !(level && level <= droppedLevel)) continue;
    droppedLevel = 0;
    if (level && named.test(line)) { droppedLevel = level; continue; }
    const [, prefix, body] = /^((?:> )?(?:[-*] |\d+\. )?)([^]*)$/.exec(line)!;
    const kept = /^\|/.test(body!) || label.test(body!) ? (named.test(body!) ? '' : body!) : prune(body!);
    if (kept || !body) lines.push([prefix + kept, number ? list : 0, start]);
  }
  // A numbered list stays numbered in order, from its first number, once a step is gone; so do numbered headings.
  let step = 0;
  const headings: number[] = []; // the next number of the numbered headings, by level
  const out = lines.map(([line, inList, first], i) => {
    const heading = /^(#+) (?:(\d+)\. )?/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      headings.length = Math.min(headings.length, level + 1); // a heading closes the numbering of the levels below it
      if (!heading[2]) return line;
      headings[level] ??= Number(heading[2]);
      return line.replace(/\d+/, String(headings[level]!++));
    }
    if (!inList) return line;
    step = lines[i - 1]?.[1] === inList ? step + 1 : first;
    return line.replace(/^\d+/, String(step));
  });
  // What went may leave blank lines in a row, or at the end: one blank line at most, and the text ends as it did.
  const joined = out.join('\n').replace(/\n{3,}/g, '\n\n');
  return /\n$/.test(text) ? joined : joined.replace(/\n+$/, '');
}

/** Longer error texts echo what the caller sent: they are not filtered, so a huge input costs no CPU here. */
const MAX_FILTERED_ERROR = 8192;

/** An error text without what names a disabled tool; kept as is when that would leave nothing, or when it is long. */
export function errorWithoutTools(text: string, disabled: ReadonlySet<ToolName>): string {
  return text.length > MAX_FILTERED_ERROR ? text : withoutTools(text, disabled) || text;
}
