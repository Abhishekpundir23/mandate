import { Readable } from 'node:stream';
import { expect, test } from 'vitest';
import { createBoundedInput } from './bounded-input';

async function collect(chunks: Buffer[], limit = 64 * 1024): Promise<Buffer[]> {
  const stream = createBoundedInput(Readable.from(chunks), limit);
  const result: Buffer[] = [];
  for await (const chunk of stream) result.push(Buffer.from(chunk as Buffer));
  return result;
}

test('preserves split UTF-8, CRLF, and multiple frames', async () => {
  const bytes = Buffer.from('{"text":"é"}\r\n{}\n');
  const split = bytes.indexOf(0xc3) + 1;
  expect(Buffer.concat(await collect([bytes.subarray(0, split), bytes.subarray(split, bytes.length - 4), bytes.subarray(bytes.length - 4)])).toString()).toBe(bytes.toString());
});

test('accepts exactly 64 KiB payload plus framing', async () => {
  const bytes = Buffer.from('x'.repeat(65_536) + '\r\n');
  expect(Buffer.concat(await collect([bytes])).length).toBe(65_538);
});

test.each([false, true])('rejects oversized frame before emission, newline=%s', async (newline) => {
  const input = Readable.from([Buffer.from('x'.repeat(65_537) + (newline ? '\n' : ''))]);
  const bounded = createBoundedInput(input, 65_536);
  const emitted: unknown[] = [];
  bounded.on('data', (data) => emitted.push(data));
  await expect(new Promise((resolve, reject) => { bounded.on('end', resolve); bounded.on('error', reject); })).rejects.toThrow();
  expect(emitted).toEqual([]);
});

test('does not aggregate several valid messages into the frame limit', async () => {
  const bytes = Buffer.from(('x'.repeat(100) + '\n').repeat(1000));
  expect(Buffer.concat(await collect([bytes], 100))).toEqual(bytes);
});
