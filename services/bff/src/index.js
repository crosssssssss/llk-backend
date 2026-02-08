import http from 'node:http';
const port = Number(process.env.PORT || 3005);

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'bff' }));
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ code: 0, message: 'bff placeholder' }));
});

server.listen(port, () => console.log('bff listening on', port));
