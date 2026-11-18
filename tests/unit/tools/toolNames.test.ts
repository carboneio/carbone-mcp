import { describe, test, expect } from 'vitest';
import { NO_TOOLS, errorWithoutTools, toolOfResource, withoutTools } from '../../../src/tools/toolNames.js';

const without = (text: string, ...tools: Parameters<typeof withoutTools>[1] extends ReadonlySet<infer T> ? T[] : never) =>
  withoutTools(text, new Set(tools));

describe('withoutTools', () => {
  const text = '# Tools\n- list_tags lists tags.\n- `delete_template` deletes.\n- list_tags_extra is another word.\n- Docs.';

  test('returns the text unchanged when no tool is disabled', () => {
    expect(withoutTools(text, NO_TOOLS)).toBe(text);
  });

  test('drops each line naming a disabled tool, as a whole word only', () => {
    expect(without(text, 'list_tags', 'delete_template')).toBe('# Tools\n- list_tags_extra is another word.\n- Docs.');
  });

  test('a heading naming a disabled tool takes its section, up to the next heading of its level or above', () => {
    const doc = '# Doc\n## 1. Convert\nconvert text\n## 2. Render (render_document)\nintro\n### Detail\ndetail\n---\n## 3. Formats\npdf\n# End';
    expect(without(doc, 'render_document')).toBe('# Doc\n## 1. Convert\nconvert text\n## 2. Formats\npdf\n# End');
    expect(without('## A\na\n## B (list_tags)\nb\n# C\nc', 'list_tags')).toBe('## A\na\n# C\nc');
  });

  test('drops a sentence naming one and keeps the others as written, list marker included', () => {
    expect(without('Store a template, e.g. a DOCX. Render it with render_document. Use (a.b) as is. Done.', 'render_document'))
      .toBe('Store a template, e.g. a DOCX. Use (a.b) as is. Done.');
    expect(without('- A list_tags thing. B stays.', 'list_tags')).toBe('- B stays.');
  });

  test('in a list of tools, drops only the disabled ones', () => {
    const sentence = 'Pass it as templateId to render_document, download_template or delete_template.';
    expect(without(sentence, 'delete_template')).toBe('Pass it as templateId to render_document or download_template.');
    expect(without(sentence, 'download_template', 'delete_template')).toBe('Pass it as templateId to render_document.');
    expect(without('Filter of list_templates and upload_template.', 'upload_template')).toBe('Filter of list_templates.');
  });

  test('drops an aside in brackets, or a clause, rather than the whole sentence', () => {
    expect(without('Tags stay as written (use render_document to fill them). Next.', 'render_document')).toBe('Tags stay as written. Next.');
    expect(without('To change a format, use convert_document; unsure which data, call inspect_template first.', 'convert_document'))
      .toBe('Unsure which data, call inspect_template first.');
    expect(without('Store a template, then render it with render_document.', 'render_document')).toBe('Store a template.');
    expect(without('Deploy it with update_template_metadata (id = x; now), or render it by its Version ID.', 'update_template_metadata'))
      .toBe('Render it by its Version ID.');
    expect(without('Each has an id (Template ID; null if none), then pass it to delete_template.', 'delete_template'))
      .toBe('Each has an id (Template ID; null if none).');
  });

  test('a table row, or a line or sentence the tool is the subject of, goes whole', () => {
    expect(without('| update_template_metadata | Rename, deploy, or expire |\n| list_tags | Tags |', 'update_template_metadata'))
      .toBe('| list_tags | Tags |');
    expect(without('- `upload_template`: pass the file; give it a name.\n- Next.', 'upload_template')).toBe('- Next.');
    expect(without('- `update_template_metadata` patches one; with a Version ID, that one.\n- Next.', 'update_template_metadata')).toBe('- Next.');
    expect(without('- Deletion: `delete_template` is final. `expireAt` schedules one.', 'delete_template')).toBe('- `expireAt` schedules one.');
  });

  test('drops where a value comes from, and a follow-up sentence with the one it leans on', () => {
    expect(without('Template ID or Version ID, from list_templates. Exclusive.', 'list_templates')).toBe('Template ID or Version ID. Exclusive.');
    expect(without('A template, from list_templates or upload_template (never guess one): an ID.', 'list_templates', 'upload_template'))
      .toBe('A template (never guess one): an ID.');
    expect(without('Name, searched by list_templates (max 200).', 'list_templates')).toBe('Name, searched (max 200).');
    expect(without('Use convert_document to convert. That makes it a proof tool. Next.', 'convert_document')).toBe('Next.');
  });

  test('leaves a text naming no disabled tool untouched, an empty one included', () => {
    const text = '# Title\n\n> - A quote (with `code`; and {"a": 1}).\n| a | b |\n1. Step\n- Next: e.g. this.';
    expect(without(text, 'list_tags')).toBe(text);
    expect(without('', 'list_tags')).toBe('');
  });

  test('a list joined by "and" keeps "and"; a backticked name is a name', () => {
    expect(without('Use render_document, download_template and delete_template.', 'delete_template')).toBe('Use render_document and download_template.');
    expect(without('Use `render_document`, `download_template` or `delete_template`.', 'download_template'))
      .toBe('Use `render_document` or `delete_template`.');
  });

  test('keeps the blockquote and list marker of a line, and never splits inside brackets, braces or code', () => {
    expect(without('> - Use list_tags. Keep this.', 'list_tags')).toBe('> - Keep this.');
    expect(without('Pass { "a": 1; "b": 2 }, then call list_tags. Done.', 'list_tags')).toBe('Pass { "a": 1; "b": 2 }. Done.');
  });

  test('is idempotent: filtering twice is filtering once', () => {
    const text = '- Use render_document, download_template or delete_template; then list_tags (see carbone://tags). Next.';
    for (const tools of [['delete_template'], ['list_tags'], ['render_document', 'download_template']] as const) {
      const once = without(text, ...tools);
      expect(without(once, ...tools)).toBe(once);
    }
  });

  test('numbered headings are renumbered by level once one is gone; a heading above restarts the levels below', () => {
    const doc = '## 1. A\n### 1. A1\n### 2. Uses list_tags\n### 3. A3\n## 2. Uses list_tags\n## 3. C\n# Next\n## 4. D';
    expect(without(doc, 'list_tags')).toBe('## 1. A\n### 1. A1\n### 2. A3\n## 2. C\n# Next\n## 4. D');
  });

  test('what goes leaves no run of blank lines, and the text ends as it did', () => {
    expect(without('Not found.\n\nCheck the ID with list_templates.', 'list_templates')).toBe('Not found.');
    expect(without('A\n\nUse list_tags.\n\nB\n', 'list_tags')).toBe('A\n\nB\n');
  });

  test('drops what a value is for, when that names only disabled tools', () => {
    expect(without('List the categories in use, for the category filter of list_templates or upload_template.', 'list_templates', 'upload_template'))
      .toBe('List the categories in use.');
    expect(without('The categories, such as "a": the category filter of list_templates and upload_template.', 'list_templates', 'upload_template'))
      .toBe('The categories, such as "a".');
    expect(without('List the categories in use, for the category filter of list_templates or upload_template.', 'upload_template'))
      .toBe('List the categories in use, for the category filter of list_templates.');
  });

  test('a numbered list is renumbered once a step is gone, from its own first number', () => {
    expect(without('1. Design\n2. Upload with upload_template\n3. Render\n\n1. Other', 'upload_template')).toBe('1. Design\n2. Render\n\n1. Other');
    expect(without('**Mode B**\n1. Call render_document\n2. Done\n3. Next', 'render_document')).toBe('**Mode B**\n1. Done\n2. Next');
  });

  test('a line break inside a line (\\r, U+2028, U+2029) is text like any other', () => {
    for (const text of ['Bad gateway\r', 'Bad gateway\r\n<html>proxy</html>', 'a\u2028b', 'a\u2029b']) {
      expect(without(text, 'list_tags')).toBe(text);
    }
    expect(without('Use list_tags.\r\nKeep this.', 'list_tags')).toBe('Keep this.');
  });

  test('"e.g. " and "i.e. " end no sentence', () => {
    expect(without('Use render_document, e.g. for invoices. Next.', 'render_document')).toBe('Next.');
    expect(without('A file, i.e. a DOCX. Then list_tags.', 'list_tags')).toBe('A file, i.e. a DOCX.');
  });

  test('a sentence about a disabled tool takes its clauses with it, unless they name their own tool', () => {
    expect(without('- `expireAt` schedules one instead; 0 means never.\n- Next.', 'upload_template', 'update_template_metadata')).toBe('- Next.');
    expect(without('- convert_document changes a format; render_document merges data.', 'convert_document')).toBe('- render_document merges data.');
  });

  test('an alias goes once every tool it stands for is disabled', () => {
    const text = '## 2. Template-Based Generation\nfill it\n## 3. Formats\n- `expireAt` schedules a deletion.\n- Next.';
    expect(without(text, 'upload_template')).toBe(text);
    expect(without(text, 'upload_template', 'update_template_metadata')).toBe('## 2. Template-Based Generation\nfill it\n## 3. Formats\n- Next.');
    expect(without(text, 'render_document')).toBe('## 3. Formats\n- `expireAt` schedules a deletion.\n- Next.');
  });

  test('a disabled tool takes the mentions of its carbone:// resources with it', () => {
    expect(without('Not found. Check the ID with the list_templates tool (or the carbone://templates resource).', 'list_templates'))
      .toBe('Not found.');
    expect(without('| a | b |\n| carbone://templates/{id}| One template |\n| carbone://tags | Tags |', 'list_templates'))
      .toBe('| a | b |\n| carbone://tags | Tags |');
  });
});

test('toolOfResource: the tool a resource URI or URI template is read through', () => {
  expect(toolOfResource('carbone://templates')).toBe('list_templates');
  expect(toolOfResource('carbone://templates/{id}')).toBe('list_templates');
  expect(toolOfResource('carbone://status')).toBe('get_api_status');
  expect(toolOfResource('skill://carbone/SKILL.md')).toBeUndefined();
  expect(toolOfResource('carbone://other')).toBeUndefined();
});

describe('errorWithoutTools', () => {
  const off = new Set(['list_templates'] as const);

  test("filters the server's own wording, and never empties an error", () => {
    expect(errorWithoutTools('Not found.\n\nCheck the ID with the list_templates tool.', off)).toBe('Not found.');
    expect(errorWithoutTools('Unexpected error: cannot read list_templates.json', off)).toBe('Unexpected error: cannot read list_templates.json');
  });

  // An error echoing a huge input (an invalid URL of megabytes) must not cost CPU: it is passed through unfiltered.
  test('passes a long error text through at once, unfiltered', () => {
    const text = `Invalid input: Invalid URL: https://x/${'a'.repeat(8_000_000)} list_templates`;
    const start = performance.now();
    expect(errorWithoutTools(text, off)).toBe(text);
    expect(performance.now() - start).toBeLessThan(50);
  });
});
