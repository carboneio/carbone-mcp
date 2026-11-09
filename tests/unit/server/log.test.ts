import { describe, expect, test, vi } from 'vitest';
import { errorSummary, exitWhenFlushed, log, requestLog, withOutcome, type RequestLog } from '../../../src/server/log.js';

/** The lines log() writes while `run` runs. */
function captured(run: () => void): string[] {
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    run();
    return stderr.mock.calls.map(([chunk]) => String(chunk));
  } finally {
    stderr.mockRestore();
  }
}

describe('log', () => {
  test('one logfmt line, level first, undefined fields left out', () => {
    expect(captured(() => log('info', { msg: 'request', method: 'POST', status: 200, ms: 0, user: undefined })))
      .toEqual(['level=info msg=request method=POST status=200 ms=0\n']);
  });

  test('a value with a space, =, ", \\ or nothing is quoted, with " and \\ escaped', () => {
    expect(captured(() => log('warn', { a: 'two words', b: 'x=y', c: 'say "hi"', d: 'C:\\dir', e: '' })))
      .toEqual(['level=warn a="two words" b="x=y" c="say \\"hi\\"" d="C:\\\\dir" e=""\n']);
  });

  test('printable ASCII only: CR/LF cannot forge a line, and other characters are dropped', () => {
    const lines = captured(() => log('error', { error: 'boom\r\nlevel=info msg=forged\u0000 caf\u00e9 \u2014 end' }));
    expect(lines).toEqual(['level=error error="boomlevel=info msg=forged caf  end"\n']);
  });

  test('every value is cut to 300 characters', () => {
    expect(captured(() => log('info', { path: `/${'a'.repeat(20_000)}`, error: 'b'.repeat(8_000) })))
      .toEqual([`level=info path=/${'a'.repeat(299)} error=${'b'.repeat(300)}\n`]);
  });

  test('inside a request, its rid is added; outside, none', () => {
    expect(captured(() => requestLog.run({ rid: '0a1b2c3d' }, () => log('info', { msg: 'inside' }))))
      .toEqual(['level=info msg=inside rid=0a1b2c3d\n']);
    expect(captured(() => log('info', { msg: 'outside' }))).toEqual(['level=info msg=outside\n']);
  });
});

describe('errorSummary', () => {
  const SIG = 'a3f1'.repeat(16); // 64 hex characters, as an X-Amz-Signature

  test('a URL is reduced to its scheme and host: no credentials, path, query or fragment', () => {
    expect(errorSummary(`Could not fetch https://bucket.example.test/t.docx?X-Amz-Signature=${SIG} (403), ` +
      'nor HTTP://user:p@ss@files.example.test/render/abc#frag, nor s3://example-bucket/key.'))
      .toBe('Could not fetch https://bucket.example.test (403), nor HTTP://files.example.test nor s3://example-bucket');
  });

  test('a line break, NBSP or U+2028 becomes a space: nothing is glued to a scrubbed URL', () => {
    for (const separator of ['\n', '\u00a0', '\u2028', '\r\n']) {
      expect(errorSummary(`https://h.example.test/p?a=1${separator}sig=${SIG}`)).toMatch(/^https:\/\/h\.example\.test +\[redacted\]$/);
    }
    expect(errorSummary('https://h.example.test/p?a=1 sig=short')).toBe('https://h.example.test sig=short');
  });

  test('what is left of a query or fragment without a scheme is dropped', () => {
    expect(errorSummary('Cannot read bucket.s3.example.test/k?X-Amz-Signature=abc&X-Amz-Date=1 (denied)'))
      .toBe('Cannot read bucket.s3.example.test/k (denied)');
  });

  test('data: URIs and runs of 40+ base64, base64url or hex characters are redacted', () => {
    expect(errorSummary('Bad image data:image/png;base64,iVBORw0KGgo= in the data')).toBe('Bad image data:... in the data');
    expect(errorSummary(`job ${'eyJhbGciOi_-'.repeat(4)} key ${'A1b2+/'.repeat(7)}= hex ${SIG} ok ${'x'.repeat(39)}`))
      .toBe(`job [redacted] key [redacted] hex [redacted] ok ${'x'.repeat(39)}`);
  });

  test('keeps plain text, at most 200 characters', () => {
    expect(errorSummary('Template not found')).toBe('Template not found');
    expect(errorSummary('Template #3 not found? Check the ID.')).toBe('Template #3 not found? Check the ID.');
    expect(errorSummary('word '.repeat(1000))).toHaveLength(200);
  });
});

describe('withOutcome', () => {
  const inRequest = async (callbacks: (() => unknown)[], record: RequestLog = { rid: '0a1b2c3d' }) => {
    const settled = await requestLog.run(record, async () => {
      let last: unknown;
      for (const callback of callbacks) last = await withOutcome(callback)().then((value) => ({ value }), (error) => ({ error }));
      return last;
    });
    return { record, settled };
  };

  test('a result is ok, and is returned as is', async () => {
    const result = { content: [{ type: 'text', text: 'done' }] };
    expect(await inRequest([() => result])).toEqual({ record: { rid: '0a1b2c3d', outcome: 'ok' }, settled: { value: result } });
    expect((await inRequest([() => undefined])).record.outcome).toBe('ok');
  });

  test('an isError result is an error, with its first text, summarized', async () => {
    const { record } = await inRequest([async () => ({
      isError: true,
      content: [{ type: 'image', data: '' }, { type: 'text', text: 'Could not fetch https://example.test/a?sig=secret' }, { type: 'text', text: 'second' }],
    })]);
    expect(record).toEqual({ rid: '0a1b2c3d', outcome: 'error', error: 'Could not fetch https://example.test' });
    expect((await inRequest([() => ({ isError: true, content: [null] })])).record).toEqual({ rid: '0a1b2c3d', outcome: 'error', error: undefined });
  });

  test('a thrown handler is an error with its message, and is thrown on', async () => {
    const failure = new Error('Unexpected https://example.test/x?token=secret');
    const { record, settled } = await inRequest([() => { throw failure; }]);
    expect(record).toEqual({ rid: '0a1b2c3d', outcome: 'error', error: 'Unexpected https://example.test' });
    expect(settled).toEqual({ error: failure });
    expect((await inRequest([() => Promise.reject('plain')])).record.error).toBe('plain');
  });

  test('an error stays: a later success does not overwrite it, nor a later error its text', async () => {
    const { record } = await inRequest([
      () => ({ isError: true, content: [{ type: 'text', text: 'first' }] }),
      () => ({ content: [] }),
      () => { throw new Error('second'); },
    ]);
    expect(record).toEqual({ rid: '0a1b2c3d', outcome: 'error', error: 'first' });
  });

  test('outside a request (stdio), it only calls through', async () => {
    const result = { isError: true, content: [{ type: 'text', text: 'no' }] };
    await expect(withOutcome((a: number, b: number) => ({ ...result, sum: a + b }))(1, 2)).resolves.toEqual({ ...result, sum: 3 });
    await expect(withOutcome(() => { throw new Error('thrown'); })()).rejects.toThrow('thrown');
  });
});

describe('exitWhenFlushed', () => {
  test('exits with the code once stderr has written what came before', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    let flushed: (() => void) | undefined;
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(((_: string, done: () => void) => { flushed = done; return false; }) as never);
    const exitCode = process.exitCode;
    try {
      exitWhenFlushed(3);
      expect(process.exitCode).toBe(3);
      expect(exit).not.toHaveBeenCalled();
      flushed!();
      expect(exit).toHaveBeenCalledWith(3);
    } finally {
      process.exitCode = exitCode;
      stderr.mockRestore();
      exit.mockRestore();
    }
  });

  test('a stuck stderr does not keep the process alive: it exits after 1 s', () => {
    vi.useFakeTimers();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((() => false) as never);
    const exitCode = process.exitCode;
    try {
      exitWhenFlushed(1);
      vi.advanceTimersByTime(999);
      expect(exit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      process.exitCode = exitCode;
      stderr.mockRestore();
      exit.mockRestore();
      vi.useRealTimers();
    }
  });
});
