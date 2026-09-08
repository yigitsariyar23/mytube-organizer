import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..');
const assets = {};
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.webmanifest':'application/manifest+json', '.png':'image/png' };
async function add(source, destination = source) {
  const data = await fs.readFile(path.join(root, source));
  const binary = source.endsWith('.png');
  assets['/' + destination] = { type:types[path.extname(destination)], body:data.toString(binary ? 'base64':'utf8'), encoding:binary ? 'base64':'utf8' };
}
for (const dir of ['dashboard','shared','mobile','icons']) {
  for (const file of await fs.readdir(path.join(root, dir))) {
    if (/\.(js|html|css|png)$/.test(file) && file !== 'server.js') await add(`${dir}/${file}`);
  }
}
await add('background.js'); await add('version.json');
const html = assets['/dashboard/dashboard.html'];
html.body = html.body.replace('<head>', `<head><base href="/dashboard/"><meta name="theme-color" content="#18191c"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="MyTube"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icons/icon128.png">`)
  .replace(/width=device-width, initial-scale=1(?:\.0)?(?=")/,'width=device-width, initial-scale=1, viewport-fit=cover')
  .replace('</head>','<link rel="stylesheet" href="/mobile/mobile.css"></head>')
  .replace('<body>', `<body><div id="mobileLoading" role="status">Opening your library…</div><header class="mobile-top"><button id="mobileFolders" type="button" aria-expanded="false" aria-label="Folders and lists">Folders</button><strong>MyTube</strong><button id="mobileSaveOpen" type="button">+ Save</button><button id="mobileSettings" type="button">Settings</button></header><div id="mobileConnection" role="status"></div><button id="mobileShade" type="button" aria-label="Close folders"></button>`)
  .replace('<div class="sidebar-footer">','<button id="mobileInstall" class="btn btn-text" type="button">Install on Home Screen</button><div class="sidebar-footer">')
  .replace('<script type="module" src="dashboard.js"></script>', `<div id="mobileSaveModal" class="modal" hidden><section class="modal-box" role="dialog" aria-modal="true" aria-labelledby="mobileSaveTitle"><h2 id="mobileSaveTitle">Save from YouTube</h2><div class="mobile-save-fields"><p class="mobile-save-hint">Copy a video or playlist link from YouTube, then paste it here.</p><label class="field-label" for="mobileUrl">YouTube link</label><input id="mobileUrl" class="field-input" type="url" enterkeyhint="done" autocapitalize="off" autocorrect="off" placeholder="https://youtu.be/…" autocomplete="off"><label class="field-label" for="mobileList">Save video to</label><select id="mobileList" class="field-input"></select><p class="mobile-save-hint">Playlist imports create a new list after review. Public/unlisted playlists need your YouTube API key.</p><p id="mobileSaveStatus" role="status"></p></div><div class="mobile-save-actions"><button id="mobileSaveVideo" class="btn btn-primary" type="button">Save video</button><button id="mobileImportPlaylist" class="btn btn-ghost" type="button">Import playlist</button><button id="mobileSaveCancel" class="btn btn-text" type="button">Cancel</button></div></section></div><script type="module" src="/mobile/bootstrap.js"></script>`);
assets['/manifest.webmanifest'] = { type:types['.webmanifest'], body:JSON.stringify({ name:'MyTube Mobile', short_name:'MyTube', start_url:'/dashboard/dashboard.html', scope:'/', display:'standalone', background_color:'#18191c', theme_color:'#18191c', icons:[{ src:'/icons/icon128.png', sizes:'128x128', type:'image/png' }] }) };
const revision = createHash('sha256').update(JSON.stringify(assets)).digest('hex').slice(0,12);
const shell = Object.keys(assets);
assets['/service-worker.js'] = { type:types['.js'], body:`const CACHE='mytube-${revision}';const SHELL=${JSON.stringify(shell)};
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);for(const url of SHELL){const response=await fetch(url);if(!response.ok||response.redirected)throw new Error('Sign in before installing MyTube');await cache.put(url,response);}})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('mytube-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==location.origin||!SHELL.includes(url.pathname))return;event.respondWith(fetch(event.request).catch(()=>caches.match(url.pathname)));});` };
await fs.mkdir(path.join(root,'dist/server'),{recursive:true});
const server = await fs.readFile(path.join(root,'mobile/server.js'),'utf8');
await fs.writeFile(path.join(root,'dist/server/index.js'), server + `\nconst ASSETS=${JSON.stringify(assets)};\nexport default {fetch(request){return new URL(request.url).pathname==='/api/youtube'?youtubeMetadata(request):serveAsset(request,ASSETS);}};\n`);
// Local builds do not include cloud hosting configuration.
await fs.rm(path.join(root,'dist/.openai'), { recursive:true, force:true });
console.log(`Built MyTube Mobile: ${shell.length} assets, version ${revision}`);

// The iOS app bundles these assets; no hosted origin is used at runtime.
await fs.rm(path.join(root, 'dist/native-web'), { recursive:true, force:true });
for (const [url, asset] of Object.entries(assets)) {
  const target = path.join(root, 'dist/native-web', url.slice(1));
  await fs.mkdir(path.dirname(target), { recursive:true });
  await fs.writeFile(target, asset.body, asset.encoding === 'base64' ? 'base64' : 'utf8');
}
