import { describe, test, expect } from 'vitest';
import { NO_TOOLS, withoutTools } from '../../../src/tools/toolNames.js';

describe('withoutTools', () => {
  const text = '# Tools\n- list_tags lists tags.\n- `delete_template` deletes.\n- list_tags_extra is another word.\n- Docs.';

  test('returns the text unchanged when no tool is disabled', () => {
    expect(withoutTools(text, NO_TOOLS)).toBe(text);
  });

  test('drops each line naming a disabled tool, as a whole word only', () => {
    expect(withoutTools(text, new Set(['list_tags', 'delete_template'])))
      .toBe('# Tools\n- list_tags_extra is another word.\n- Docs.');
  });

  test('a heading naming a disabled tool takes its section, up to the next heading of its level or above', () => {
    const doc = '# Doc\n## 1. Convert\nconvert text\n## 2. Render (render_document)\nintro\n### Detail\ndetail\n---\n## 3. Formats\npdf\n# End';
    expect(withoutTools(doc, new Set(['render_document']))).toBe('# Doc\n## 1. Convert\nconvert text\n## 3. Formats\npdf\n# End');
    expect(withoutTools('## A\na\n## B (list_tags)\nb\n# C\nc', new Set(['list_tags']))).toBe('## A\na\n# C\nc');
  });

  test('sentence mode drops each sentence naming one, and rejoins the rest as written', () => {
    const description = 'Store a template, e.g. a DOCX. Render it with render_document. Use (a.b) as is. Done.';
    expect(withoutTools(description, new Set(['render_document']), 'sentence')).toBe('Store a template, e.g. a DOCX. Use (a.b) as is. Done.');
    expect(withoutTools(description, new Set(['list_tags']), 'sentence')).toBe(description);
  });
});
