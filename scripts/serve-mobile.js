import http from 'node:http';
const { default: app } = await import('../dist/server/index.js');
const server = http.createServer(async (request, response) => {
  try {
    const result = await app.fetch(new Request('http://127.0.0.1:8770' + request.url, { method:request.method }));
    response.writeHead(result.status,Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch { response.writeHead(500); response.end('Could not serve MyTube.'); }
});
server.listen(8770,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:8770'));
