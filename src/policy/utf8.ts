/** Encode strict Unicode scalar values without browser or Node capabilities. */
export function utf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    let point = text.charCodeAt(index);
    if (point >= 0xd800 && point <= 0xdbff) {
      const low = text.charCodeAt(index + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) throw new TypeError('Invalid Unicode');
      point = 0x10000 + ((point - 0xd800) << 10) + low - 0xdc00;
      index += 1;
    } else if (point >= 0xdc00 && point <= 0xdfff) {
      throw new TypeError('Invalid Unicode');
    }
    if (point < 0x80) bytes.push(point);
    else if (point < 0x800) bytes.push(0xc0 | (point >>> 6), 0x80 | (point & 63));
    else if (point < 0x10000)
      bytes.push(0xe0 | (point >>> 12), 0x80 | ((point >>> 6) & 63), 0x80 | (point & 63));
    else
      bytes.push(
        0xf0 | (point >>> 18),
        0x80 | ((point >>> 12) & 63),
        0x80 | ((point >>> 6) & 63),
        0x80 | (point & 63),
      );
  }
  return bytes;
}

export function utf8Length(text: string): number {
  let length = 0;
  for (let index = 0; index < text.length; index += 1) {
    const point = text.charCodeAt(index);
    if (point >= 0xd800 && point <= 0xdbff) {
      const low = text.charCodeAt(index + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) throw new TypeError('Invalid Unicode');
      length += 4;
      index += 1;
    } else if (point >= 0xdc00 && point <= 0xdfff) {
      throw new TypeError('Invalid Unicode');
    } else length += point < 0x80 ? 1 : point < 0x800 ? 2 : 3;
  }
  return length;
}
