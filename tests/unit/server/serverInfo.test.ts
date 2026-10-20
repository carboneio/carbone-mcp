import { describe, test, expect } from 'vitest';
import { serverInfo, SERVER_INSTRUCTIONS } from '../../../src/server/serverInfo.js';

describe('serverInfo', () => {
  test('returns the server identity with the given version', () => {
    const info = serverInfo('9.9.9');
    expect(info.name).toBe('carbone-mcp');
    expect(info.version).toBe('9.9.9');
    expect(info.title).toBe('Carbone');
    expect(info.websiteUrl).toBe('https://carbone.io');
    expect(info.description).toContain('Carbone API');
  });

  test('advertises an SVG icon and a PNG fallback, both as self-contained data URIs', () => {
    const { icons } = serverInfo('1.0.0');
    expect(icons).toHaveLength(2);
    const svg = icons.find((i) => i.mimeType === 'image/svg+xml');
    const png = icons.find((i) => i.mimeType === 'image/png');
    expect(svg?.src.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(png?.src.startsWith('data:image/png;base64,')).toBe(true);
  });

  test('the PNG declares its real dimensions', () => {
    const png = serverInfo('1.0.0').icons.find((i) => i.mimeType === 'image/png')!;
    const bytes = Buffer.from(png.src.split(',')[1], 'base64');
    // PNG header: width and height are the two 32-bit integers right after "IHDR" (bytes 16-23).
    expect(png.sizes).toEqual([`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`]);
  });
});

describe('SERVER_INSTRUCTIONS', () => {
  test('points to get_capabilities and names the core tools', () => {
    expect(SERVER_INSTRUCTIONS).toContain('get_capabilities');
    expect(SERVER_INSTRUCTIONS).toContain('convert_document');
    expect(SERVER_INSTRUCTIONS).toContain('render_document');
    expect(SERVER_INSTRUCTIONS).toContain('inspect_template');
  });

  test('presents the Carbone Skill and the docs as references, without asking to load them', () => {
    expect(SERVER_INSTRUCTIONS).toContain('developer/ai/skills.md');
    expect(SERVER_INSTRUCTIONS).toContain('llms.txt');
    expect(SERVER_INSTRUCTIONS).not.toMatch(/\bload(s|ed|ing)?\b/i);
  });
});
