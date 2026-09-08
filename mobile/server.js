// Public metadata only. No user library, API key, or GitHub token reaches this bridge.
export async function youtubeMetadata(request, fetcher = fetch) {
  const url = new URL(request.url);
  if (request.method !== 'GET') return new Response('Method not allowed', { status:405 });
  const video = url.searchParams.get('video'), channel = url.searchParams.get('channel');
  let target;
  if (/^[A-Za-z0-9_-]{11}$/.test(video || '') && !channel) {
    target = 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + video);
  } else if (/^UC[A-Za-z0-9_-]{22}$/.test(channel || '') && !video) {
    target = 'https://www.youtube.com/feeds/videos.xml?channel_id=' + channel;
  } else return new Response('Invalid video or channel', { status:400 });
  try {
    const response = await fetcher(target, { signal:AbortSignal.timeout(15000), redirect:'error', headers:{ Accept: video ? 'application/json' : 'application/xml' } });
    if (!response.ok) return new Response('YouTube metadata unavailable', { status:response.status });
    const body = await response.text();
    if (body.length > 2_000_000) return new Response('Response too large', { status:502 });
    return new Response(body, { headers:{ 'Content-Type':video ? 'application/json' : 'application/xml', 'Cache-Control':'private, max-age=300', 'X-Content-Type-Options':'nosniff' } });
  } catch { return new Response('YouTube could not be reached', { status:502 }); }
}
export function serveAsset(request, assets) {
  const url = new URL(request.url);
  const key = url.pathname === '/' ? '/dashboard/dashboard.html' : url.pathname;
  const asset = assets[key];
  if (!asset || !['GET','HEAD'].includes(request.method)) return new Response('Not found', { status:404 });
  const body = asset.encoding === 'base64' ? Uint8Array.from(atob(asset.body), c=>c.charCodeAt(0)) : asset.body;
  return new Response(request.method === 'HEAD' ? null : body, { headers:{
    'Content-Type':asset.type, 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'strict-origin-when-cross-origin',
    'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https://api.github.com https://raw.githubusercontent.com https://www.googleapis.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  } });
}
