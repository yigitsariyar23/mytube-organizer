import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYouTubeLink, readPlaylist } from '../mobile/links.js';
import { youtubeMetadata, serveAsset } from '../mobile/server.js';
import { harness } from './harness.js';
const id = 'abcdefghijk';
const channelId = 'UC' + 'a'.repeat(22);

test('mobile links accept YouTube share formats and reject unrelated or invalid URLs', () => {
  for (const url of [`https://youtu.be/${id}?si=track`, `https://www.youtube.com/watch?v=${id}`, `https://m.youtube.com/shorts/${id}`, `https://www.youtube.com/live/${id}`]) assert.equal(parseYouTubeLink(url).videoId, id);
  assert.deepEqual(parseYouTubeLink(`https://www.youtube.com/watch?v=${id}&list=PLtest`), {videoId:id, playlistId:'PLtest'});
  assert.deepEqual(parseYouTubeLink('https://www.youtube.com/playlist?list=PLtest'), {videoId:null, playlistId:'PLtest'});
  assert.throws(()=>parseYouTubeLink('https://evil.example/watch?v='+id));
  assert.throws(()=>parseYouTubeLink('javascript:alert(1)'));
  assert.throws(()=>parseYouTubeLink('https://www.youtube.com/@creator'));
});
test('mobile playlist import follows pages and takes video owner metadata rather than playlist owner', async () => {
  const calls = [];
  const fetcher = async input => {
    const url = new URL(input); calls.push(url);
    if (url.pathname.endsWith('/playlists')) return Response.json({items:[{snippet:{title:'Learning'},contentDetails:{itemCount:3}}]});
    if (!url.searchParams.has('pageToken')) return Response.json({items:[{contentDetails:{videoId:id},snippet:{title:'Actual title',channelTitle:'Playlist owner',channelId:'wrong',videoOwnerChannelTitle:'Creator',videoOwnerChannelId:channelId}}],nextPageToken:'second'});
    return Response.json({items:[{contentDetails:{videoId:'12345678901'},snippet:{title:'Second'}},{contentDetails:{videoId:'12345678902'},snippet:{title:'Private video'}}]});
  };
  const result = await readPlaylist('PLtest','key',fetcher);
  assert.equal(result.videos.length,2);
  assert.equal(result.videos[0].author,'Creator');
  assert.equal(result.videos[0].channelId,channelId);
  assert.equal(result.statedCount,3);
  assert.equal(result.scrapedCount,2);
  assert.equal(calls.at(-1).searchParams.get('pageToken'),'second');
});
test('mobile playlist reads fail clearly without credentials or private/built-in playlist access', async () => {
  await assert.rejects(readPlaylist('PLtest',''),/API key/);
  await assert.rejects(readPlaylist('WL','key'),/built-in/);
  await assert.rejects(readPlaylist('PLtest','key',async()=>new Response('',{status:403})),/private/);
});
test('metadata bridge only fetches allowlisted public YouTube endpoints and forwards no credentials', async () => {
  const calls=[];
  const fetcher=async (url,options)=>{calls.push({url,options});return Response.json({title:'Title'});};
  const response=await youtubeMetadata(new Request('https://mytube.test/api/youtube?video='+id,{headers:{Authorization:'secret',Cookie:'secret'}}),fetcher);
  assert.equal(response.status,200);
  assert.equal(new URL(calls[0].url).hostname,'www.youtube.com');
  assert.deepEqual(calls[0].options.headers,{Accept:'application/json'});
  assert.equal((await youtubeMetadata(new Request('https://mytube.test/api/youtube?url=https://evil.example'),fetcher)).status,400);
  assert.equal((await youtubeMetadata(new Request('https://mytube.test/api/youtube?video='+id,{method:'POST'}),fetcher)).status,405);
  assert.equal(calls.length,1);
});
test('mobile saves persist offline and selecting another list preserves watched state', async () => {
  const h=harness({videoFolders:{unsorted:{name:'Unfiled',order:0},'later-1':{name:'Later',order:1}}}, async()=>{throw new Error('offline');});
  assert.equal((await h.send({type:'SAVE_VIDEO',videoId:id,folderId:'later-1'})).ok,true);
  assert.equal(h.db.videos[id].saved,true);
  assert.equal(h.db.videos[id].folderId,'later-1');
  h.db.videos[id].watched=true;
  const before=h.db.videos[id].userStateAt;
  assert.equal((await h.send({type:'SAVE_VIDEO',videoId:id,folderId:'unsorted'})).ok,true);
  assert.equal(h.db.videos[id].folderId,'unsorted');
  assert.equal(h.db.videos[id].watched,true);
  assert.ok(h.db.videos[id].userStateAt>before);
  assert.equal(Object.keys(h.db.videos).length,1);
  assert.equal((await h.send({type:'SAVE_VIDEO',videoId:'bad'})).ok,false);
  assert.equal((await h.send({type:'SAVE_VIDEO',videoId:id,folderId:'missing'})).ok,false);
});
test('web platform library operations use the cross-tab write lock', async () => {
  const h=harness(); let calls=0;
  h.ctx.chrome.runtime.withLibraryLock=async work=>{calls++;return work();};
  const result=await h.send({type:'SET_SETTINGS',values:{languages:['Turkish']}});
  assert.equal(result.ok,true); assert.equal(calls,1);
});
test('mobile asset server serves only generated public assets with a restrictive content policy', async () => {
  const assets={'/dashboard/dashboard.html':{type:'text/html',body:'<h1>MyTube</h1>'}};
  assert.equal((await serveAsset(new Request('https://mytube.test/'),assets).text()),'<h1>MyTube</h1>');
  assert.equal(serveAsset(new Request('https://mytube.test/.git/config'),assets).status,404);
  assert.match(serveAsset(new Request('https://mytube.test/'),assets).headers.get('Content-Security-Policy'),/script-src 'self'/);
});
