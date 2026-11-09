/**
 * The tool names, without importing the tools: the configuration checks MCP_DISABLED_TOOLS against them at startup.
 * A test checks that this list is exactly what the server registers.
 */
export const TOOL_NAMES = [
  'convert_document', 'render_document', 'get_render_result', 'inspect_template', 'list_templates', 'list_categories',
  'list_tags', 'upload_template', 'update_template_metadata', 'delete_template', 'download_template', 'get_api_status',
  'get_capabilities',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** What MCP_DISABLED_TOOLS may turn off: every tool but get_capabilities, the local overview the texts point to. */
export const DISABLEABLE_TOOLS: readonly ToolName[] = TOOL_NAMES.filter((tool) => tool !== 'get_capabilities');

/** No tool disabled. */
export const NO_TOOLS: ReadonlySet<ToolName> = new Set();

/**
 * `text` without what names a disabled tool, so that the instructions, get_capabilities and the tool descriptions
 * never offer a tool the model cannot call. Line by line, a Markdown heading naming one takes its section with it (up
 * to the next heading of its level or above); sentence by sentence, sentences end with ". ", so one naming a tool must
 * not hold "e.g. " before the name. The texts are written for it: a line or sentence naming a tool is about that tool.
 */
export function withoutTools(text: string, disabled: ReadonlySet<ToolName>, unit: 'line' | 'sentence' = 'line'): string {
  if (!disabled.size) return text;
  const named = new RegExp(`\\b(?:${[...disabled].join('|')})\\b`);
  if (unit === 'sentence') return text.split(/(?<=\.) /).filter((sentence) => !named.test(sentence)).join(' ');
  const kept: string[] = [];
  let droppedLevel = 0; // the level of the heading whose section is being dropped
  for (const line of text.split('\n')) {
    const level = /^(#+) /.exec(line)?.[1]!.length ?? 0;
    if (droppedLevel && !(level && level <= droppedLevel)) continue;
    droppedLevel = 0;
    if (!named.test(line)) kept.push(line);
    else if (level) droppedLevel = level;
  }
  return kept.join('\n');
}
