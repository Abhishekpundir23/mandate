import { Readable, Transform, type TransformCallback } from 'node:stream';

export function createBoundedInput(input: Readable, maxFrameBytes: number): Readable {
  let parts: Buffer[] = [];
  let size = 0;
  const output = new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      try {
        let start = 0;
        while (start < chunk.length) {
          const newline = chunk.indexOf(10, start);
          const end = newline === -1 ? chunk.length : newline;
          const segment = chunk.subarray(start, end);
          const total = size + segment.length;
          const last = segment.length > 0 ? segment.at(-1) : parts.at(-1)?.at(-1);
          const payloadBytes = total - (last === 13 ? 1 : 0);
          if (payloadBytes > maxFrameBytes) throw new Error('Frame too large');
          parts.push(Buffer.from(segment)); size = total;
          if (newline !== -1) {
            this.push(Buffer.concat([...parts, Buffer.from('\n')], size + 1));
            parts = []; size = 0;
          }
          start = end + 1;
        }
        callback();
      } catch { callback(new Error('Invalid frame')); }
    },
    flush(callback: TransformCallback) {
      callback(size === 0 ? undefined : new Error('Incomplete frame'));
    },
  });
  const forwardError = () => output.destroy(new Error('Input error'));
  input.on('error', forwardError);
  output.on('close', () => { input.unpipe(output); input.off('error', forwardError); });
  input.pipe(output);
  return output;
}
