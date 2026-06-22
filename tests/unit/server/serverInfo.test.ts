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
});

describe('SERVER_INSTRUCTIONS', () => {
  test('points to get_capabilities and names the core tools', () => {
    expect(SERVER_INSTRUCTIONS).toContain('get_capabilities');
    expect(SERVER_INSTRUCTIONS).toContain('convert_document');
    expect(SERVER_INSTRUCTIONS).toContain('render_document');
  });
});
