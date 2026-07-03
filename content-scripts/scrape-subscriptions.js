// content-scripts/scrape-subscriptions.js
// Runs only on https://www.youtube.com/feed/channels.
//
// NOTE: YouTube's DOM changes from time to time (ytd-channel-renderer was
// replaced by yt-lockup-view-model style components in some rollouts), so this
// script does NOT depend on renderer tag names. It scrolls until the page
// stops growing, then collects every link that points at a channel
// (/channel/UC... or /@handle) inside the main browse area.

(async function () {
  // Channel-name candidates inside a link, best first. Purely a quality
  // heuristic — if none match we still keep the channel with a fallback name.
  const TITLE_SELECTOR =
    "yt-formatted-string#text, #channel-title, [class*='title'] span, span[role='text'], [class*='title']";

  await autoScrollUntilStable();

  const channels = collectChannels();
  const resolved = channels.filter((c) => c.channelId);
  const needsResolve = channels.filter((c) => !c.channelId && c.handle);

  if (resolved.length) {
    chrome.runtime.sendMessage({ type: "SCRAPED_CHANNELS", channels: resolved });
  }
  if (needsResolve.length) {
    chrome.runtime.sendMessage({ type: "RESOLVE_HANDLES", channels: needsResolve });
  }

  showBanner(resolved.length, needsResolve.length);

  function channelAnchorRoot() {
    // ytd-browse is the main content container; the guide sidebar and masthead
    // (which also contain channel links) live outside it.
    return document.querySelector("ytd-browse") || document.body;
  }

  function parseChannelHref(href) {
    if (!href) return null;
    const idMatch = href.match(/\/channel\/(UC[0-9A-Za-z_-]{22})/);
    const handleMatch = href.match(/^(?:https?:\/\/(?:www|m)\.youtube\.com)?\/@([A-Za-z0-9._-]+)/);
    if (!idMatch && !handleMatch) return null;
    return {
      channelId: idMatch ? idMatch[1] : null,
      handle: handleMatch ? "@" + handleMatch[1] : null,
    };
  }

  function collectChannels() {
    const anchors = channelAnchorRoot().querySelectorAll("a[href]");
    const byKey = new Map();

    for (const a of anchors) {
      const parsed = parseChannelHref(a.getAttribute("href"));
      if (!parsed) continue;
      const key = parsed.channelId || parsed.handle.toLowerCase();

      let entry = byKey.get(key);
      if (!entry) {
        entry = { channelId: null, handle: null, name: "", nameScore: 0, thumbnail: null };
        byKey.set(key, entry);
      }
      if (parsed.channelId) entry.channelId = parsed.channelId;
      if (parsed.handle && !entry.handle) entry.handle = parsed.handle;

      const img = a.querySelector("img");
      if (img && img.src && !entry.thumbnail) entry.thumbnail = img.src;

      considerName(entry, a, img);
    }

    return Array.from(byKey.values()).map((e) => ({
      channelId: e.channelId,
      handle: e.handle,
      name: e.name || e.handle || "Unknown channel",
      thumbnail: e.thumbnail,
    }));
  }

  function considerName(entry, anchor, img) {
    const candidates = [];
    const titleEl = anchor.querySelector(TITLE_SELECTOR);
    if (titleEl) candidates.push([3, titleEl.textContent]);
    if (img && img.alt) candidates.push([2, img.alt]);
    if (anchor.getAttribute("aria-label")) candidates.push([2, anchor.getAttribute("aria-label")]);
    candidates.push([1, anchor.textContent]);

    for (const [score, raw] of candidates) {
      const name = clean(raw);
      if (!name || name.startsWith("@")) continue;
      // Whole-card links concatenate name + handle + description; skip those.
      if (score === 1 && name.length > 60) continue;
      if (score > entry.nameScore) {
        entry.name = name;
        entry.nameScore = score;
      }
    }
  }

  function clean(str) {
    return (str || "").replace(/\s+/g, " ").trim();
  }

  function autoScrollUntilStable() {
    return new Promise((resolve) => {
      let lastHeight = -1;
      let lastCount = -1;
      let stableTicks = 0;
      const interval = setInterval(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        const height = document.documentElement.scrollHeight;
        const count = collectChannels().length;
        if (height === lastHeight && count === lastCount) {
          stableTicks++;
        } else {
          stableTicks = 0;
          lastHeight = height;
          lastCount = count;
        }
        if (stableTicks >= 5) {
          clearInterval(interval);
          resolve();
        }
      }, 700);
      setTimeout(() => {
        clearInterval(interval);
        resolve();
      }, 45000);
    });
  }

  function showBanner(resolvedCount, pendingCount) {
    const total = resolvedCount + pendingCount;
    const el = document.createElement("div");
    el.textContent = total
      ? `MyTube Organizer: scanned ${total} channels${
          pendingCount ? ` (${pendingCount} resolving in the background…)` : ""
        }.`
      : "MyTube Organizer: no channels found — YouTube's page layout may have changed.";
    Object.assign(el.style, {
      position: "fixed",
      bottom: "20px",
      right: "20px",
      background: total ? "#17161A" : "#5A1E1E",
      color: "#EDEAE4",
      padding: "10px 16px",
      borderRadius: "8px",
      fontFamily: "system-ui, sans-serif",
      fontSize: "13px",
      zIndex: 999999,
      boxShadow: "0 4px 16px rgba(0,0,0,.4)",
    });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 8000);
  }
})();
