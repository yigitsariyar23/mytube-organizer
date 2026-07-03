// content-scripts/scrape-subscriptions.js
// Runs only on https://www.youtube.com/feed/channels.
//
// NOTE: YouTube's DOM changes from time to time (ytd-channel-renderer was
// replaced by yt-lockup-view-model style components in some rollouts), so this
// script does NOT depend on renderer tag names. It injects a "Scan channels"
// button — scroll the page manually until all channels are loaded, then click
// it to collect every link that points at a channel (/channel/UC... or /@handle)
// inside the main browse area.

(async function () {
  // Show a persistent "Scan now" button so the user can scroll manually first,
  // then trigger the scrape whenever the full list is visible.
  showScanButton();
  // Channel-name candidates inside a link, best first. Purely a quality
  // heuristic — if none match we still keep the channel with a fallback name.
  // Queried one by one (a single comma-list querySelector would return the
  // first match in DOCUMENT order, i.e. an outer [class*='title'] container
  // whose textContent holds the name twice — visible copy + duplicated span).
  const TITLE_SELECTORS = [
    "yt-formatted-string#text",
    "#channel-title",
    "span[role='text']",
    "[class*='title'] span",
    "[class*='title']",
  ];

  function runScan() {
    const channels = collectChannels();
    const scanned = channels.filter((c) => c.channelId || c.handle);
    if (scanned.length) {
      chrome.runtime.sendMessage({ type: "SCAN_RESULT", channels: scanned });
    }
    showBanner(scanned.length);
  }

  function channelAnchorRoot() {
    // ytd-browse is the main content container; the guide sidebar and masthead
    // (which also contain channel links) live outside it.
    return document.querySelector("ytd-browse") || document.body;
  }

  function parseChannelHref(href) {
    if (!href) return null;
    const idMatch = href.match(/\/channel\/(UC[0-9A-Za-z_-]{22})/);
    // Handles can contain non-ASCII letters (e.g. @DeğişikYollarda). Capture
    // everything up to the next path/query delimiter rather than an ASCII-only
    // allowlist (which would truncate at the first Turkish/Unicode char), then
    // decode any percent-encoding YouTube put in the href.
    const handleMatch = href.match(/^(?:https?:\/\/(?:www|m)\.youtube\.com)?\/@([^/?#\s]+)/);
    if (!idMatch && !handleMatch) return null;
    return {
      channelId: idMatch ? idMatch[1] : null,
      handle: handleMatch ? "@" + safeDecode(handleMatch[1]) : null,
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
      if (img && img.naturalWidth > 0 && img.src && !entry.thumbnail) entry.thumbnail = img.src;

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
    for (const sel of TITLE_SELECTORS) {
      const titleEl = anchor.querySelector(sel);
      if (titleEl) candidates.push([3, elementText(titleEl)]);
    }
    if (img && img.alt) candidates.push([2, img.alt]);
    if (anchor.getAttribute("aria-label")) candidates.push([2, anchor.getAttribute("aria-label")]);
    candidates.push([1, elementText(anchor)]);

    for (const [score, raw] of candidates) {
      const name = clean(raw);
      if (!name || name.startsWith("@")) continue;
      // Whole-card links concatenate name + handle + description; skip those.
      if (score === 1 && name.length > 60) continue;
      // ">" keeps the first (best-selector) hit among equal-score candidates.
      if (score > entry.nameScore) {
        entry.name = name;
        entry.nameScore = score;
      }
    }
  }

  // textContent of el, halved when el renders the same text twice via two
  // descendant copies (YouTube duplicates the title span in some layouts).
  // A name that merely reads doubled ("Duran Duran") has no descendant equal
  // to one half, so it is left alone.
  function elementText(el) {
    const text = clean(el.textContent);
    const half = halfIfDoubled(text);
    if (
      half &&
      Array.from(el.querySelectorAll("*")).some((d) => clean(d.textContent) === half)
    ) {
      return half;
    }
    return text;
  }

  function halfIfDoubled(text) {
    if (text.length < 3) return null;
    if (text.length % 2 === 1) {
      const mid = (text.length - 1) / 2;
      if (text[mid] === " " && text.slice(0, mid) === text.slice(mid + 1)) return text.slice(0, mid);
    } else {
      const mid = text.length / 2;
      if (text.slice(0, mid) === text.slice(mid)) return text.slice(0, mid);
    }
    return null;
  }

  function clean(str) {
    return (str || "").replace(/\s+/g, " ").trim();
  }

  // Handles in an href may be percent-encoded (e.g. /@De%C4%9Fi%C5%9FikYollarda);
  // decode them, but fall back to the raw string on malformed sequences.
  function safeDecode(str) {
    try {
      return decodeURIComponent(str);
    } catch (e) {
      return str;
    }
  }

  function showScanButton() {
    const btn = document.createElement("button");
    btn.id = "mytube-scan-btn";
    btn.textContent = "📋 Scan channels";
    Object.assign(btn.style, {
      position: "fixed",
      bottom: "24px",
      right: "24px",
      background: "#FF8C00",
      color: "#000",
      border: "none",
      borderRadius: "8px",
      padding: "10px 18px",
      fontFamily: "system-ui, sans-serif",
      fontSize: "14px",
      fontWeight: "600",
      cursor: "pointer",
      zIndex: 999999,
      boxShadow: "0 4px 16px rgba(0,0,0,.4)",
    });
    btn.addEventListener("click", () => {
      btn.textContent = "⏳ Scanning…";
      btn.style.opacity = "0.7";
      btn.style.pointerEvents = "none";
      runScan();
    });
    document.body.appendChild(btn);
  }

  function showBanner(total) {
    document.getElementById("mytube-scan-btn")?.remove();
    const el = document.createElement("div");
    el.textContent = total
      ? `MyTube Organizer: scanned ${total} channels — review the changes in the dashboard.`
      : "MyTube Organizer: no channels found — YouTube's page layout may have changed.";
    Object.assign(el.style, {
      position: "fixed",
      bottom: "24px",
      right: "24px",
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
