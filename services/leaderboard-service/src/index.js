import http from 'node:http';
const port = Number(process.env.PORT || 3006);

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'leaderboard-service' }));
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ code: 0, message: 'leaderboard placeholder' }));
});

server.listen(port, () => console.log('leaderboard-service listening on', port));
