import http from 'node:http';
const port = Number(process.env.PORT || 3008);

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'risk-service' }));
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ code: 0, message: 'risk placeholder' }));
});

server.listen(port, () => console.log('risk-service listening on', port));
