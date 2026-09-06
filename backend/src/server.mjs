import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export function createApi() {
  return createServer((req, res) => {
    const requestId = randomUUID();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Request-Id', requestId);
    let status = 404, body = {error: {code: 'not_found', requestId}};
    if (req.method === 'GET' && req.url === '/healthz') {
      status = 200; body = {status: 'ok', service: 'wikshi-api'};
    } else if (req.method === 'GET' && req.url === '/v1/services') {
      status = 200; body = {services: [], status: 'configuration_required'};
    }
    res.writeHead(status); res.end(JSON.stringify(body));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8080);
  const server = createApi();
  server.listen(port, '127.0.0.1', () => console.log(`Wikshi API listening on loopback:${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
}
