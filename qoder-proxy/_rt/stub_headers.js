/**
 * 回显型假上游：把收到的请求头原样作为助手回复吐回去。
 * 用来验证代理发给上游的请求到底带了哪些头。
 */
const http = require('http');

const PORT = Number(process.env.STUB_PORT || 3498);

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const headers = { ...req.headers };
    delete headers['content-length'];
    const text = 'HEADERS=' + JSON.stringify(headers);
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
    });
    const chunk = {
      id: 'stub-hdr',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'stub',
      choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
    };
    res.write('data: ' + JSON.stringify(chunk) + '\n\n');
    const done = {
      id: 'stub-hdr',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'stub',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    };
    res.write('data: ' + JSON.stringify(done) + '\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
    console.log('[stub] headers=' + JSON.stringify(headers));
  });
});

server.listen(PORT, '127.0.0.1', () => console.log('[stub] listening on ' + PORT));
