/**
 * 超大单行 chunk 上游：在一条 SSE data 里塞 8MB 内容。
 * 目的：验证代理在"单行极大"时不会崩、不会 OOM、能正确转发。
 */
const http = require('http');
const PORT = 3499;
const SIZE_MB = Number(process.env.STUBSIZE || 8);
const CHUNK = (delta, finish) => ({
  id: 'x', object: 'chat.completion.chunk', model: 'stub',
  choices: [{ index: 0, delta, finish_reason: finish === undefined ? null : finish }],
});

http.createServer((req, res) => {
  const bufs = [];
  req.on('data', (c) => bufs.push(c));
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.write(`data: ${JSON.stringify(CHUNK({ role: 'assistant', content: '' }))}\n\n`);

    // 一条 data 行装 8MB 内容
    const big = 'X'.repeat(SIZE_MB * 1024 * 1024);
    const payload = `data: ${JSON.stringify(CHUNK({ content: big }))}\n\n`;
    console.log(`sending single line of ${(payload.length / 1048576).toFixed(1)} MB`);
    res.write(payload);

    res.write(`data: ${JSON.stringify(CHUNK({}, 'stop'))}\n\ndata: [DONE]\n\n`);
    res.end();
  });
}).listen(PORT, '127.0.0.1', () => console.log('huge-chunk upstream on ' + PORT + ' size=' + SIZE_MB + 'MB'));
