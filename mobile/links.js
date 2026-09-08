export function parseYouTubeLink(text) {
  const match = String(text || '').trim().match(/https?:\/\/[^\s<>]+/i);
  if (!match) throw new Error('Paste a YouTube video or playlist link.');
  const url = new URL(match[0]);
  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname)) throw new Error('Use a youtube.com or youtu.be link.');
  let videoId = url.hostname === 'youtu.be' ? url.pathname.slice(1).split('/')[0]
    : url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/)?.[1];
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId || '')) videoId = null;
  const playlistId = url.searchParams.get('list');
  const list = /^[A-Za-z0-9_-]{2,150}$/.test(playlistId || '') ? playlistId : null;
  if (!videoId && !list) throw new Error('This link does not contain a video or playlist.');
  return { videoId, playlistId: list };
}

// Bounded public/unlisted playlist read. Nothing is saved until the normal review.
export async function readPlaylist(playlistId, apiKey, fetcher = fetch) {
  if (!apiKey) throw new Error('Add a YouTube API key in Settings to import a playlist on mobile.');
  if (['WL', 'LL'].includes(playlistId)) throw new Error('YouTube does not expose this built-in playlist through its API. Import it on desktop, then sync.');
  const request = async (resource, params) => {
    const url = new URL('https://www.googleapis.com/youtube/v3/' + resource);
    for (const [key, value] of Object.entries({ ...params, key: apiKey })) url.searchParams.set(key, value);
    const response = await fetcher(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(response.status === 403 || response.status === 404
      ? 'This playlist is private, unavailable, or your API key has no access. Use a public/unlisted playlist, or import on desktop.'
      : 'YouTube could not read the playlist. Try again later.');
    return response.json();
  };
  const info = await request('playlists', { part: 'snippet,contentDetails', id: playlistId });
  const playlist = info.items?.[0];
  if (!playlist) throw new Error('This playlist is private or unavailable.');
  const videos = new Map();
  let pageToken = '';
  const tokens = new Set();
  do {
    if (tokens.has(pageToken)) throw new Error('YouTube returned a repeated playlist page. Nothing was imported.');
    tokens.add(pageToken);
    const page = await request('playlistItems', { part: 'snippet,contentDetails', playlistId, maxResults: '50', ...(pageToken ? { pageToken } : {}) });
    for (const item of page.items || []) {
      const snippet = item.snippet || {};
      const id = item.contentDetails?.videoId || snippet.resourceId?.videoId;
      if (!/^[A-Za-z0-9_-]{11}$/.test(id || '') || ['Deleted video', 'Private video'].includes(snippet.title)) continue;
      videos.set(id, { videoId: id, title: snippet.title || `Video ${id}`,
        channelId: snippet.videoOwnerChannelId || null, author: snippet.videoOwnerChannelTitle || null });
    }
    pageToken = page.nextPageToken || '';
    if (tokens.size >= 200 && pageToken) throw new Error('This playlist is too large for one mobile import. Import it on desktop, then sync.');
  } while (pageToken);
  return { playlistId, title: playlist.snippet?.title || 'Imported playlist', videos: [...videos.values()],
    statedCount: playlist.contentDetails?.itemCount ?? videos.size, scrapedCount: videos.size };
}
