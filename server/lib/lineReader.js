import fs from 'node:fs';

/**
 * Async-iterate complete lines of a file starting at byte offset `start`.
 * Yields { text, endOffset } where endOffset is the byte offset just past the
 * line's terminating '\n'. A trailing partial line (no '\n' yet — Claude Code
 * may still be writing it) is never yielded, so callers can persist endOffset
 * and resume safely as the file grows. Operates on Buffers so multi-byte UTF-8
 * sequences split across chunks are handled correctly.
 */
export async function* readLines(filePath, start = 0) {
  const stream = fs.createReadStream(filePath, { start });
  let carry = Buffer.alloc(0);
  let offset = start;
  for await (const chunk of stream) {
    const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    let lineStart = 0;
    let nl;
    while ((nl = buf.indexOf(0x0a, lineStart)) !== -1) {
      let lineEnd = nl;
      if (lineEnd > lineStart && buf[lineEnd - 1] === 0x0d) lineEnd -= 1; // strip \r
      const text = buf.toString('utf8', lineStart, lineEnd);
      offset += nl - lineStart + 1; // full byte length of the line incl. '\n'
      yield { text, endOffset: offset };
      lineStart = nl + 1;
    }
    carry = buf.subarray(lineStart);
  }
  // Any remaining carry is a partial trailing line — intentionally not yielded.
}
