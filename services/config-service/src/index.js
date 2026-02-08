import http from 'node:http';
const port = Number(process.env.PORT || 3007);

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'config-service' }));
    return;
  }
  if (req.url?.startsWith('/v1/config/bootstrap')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 0, message: 'OK', data: { version: 'v1', dailyChallenge: true, iapEnabled: true } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ code: 0, message: 'config placeholder' }));
});

server.listen(port, () => console.log('config-service listening on', port));
