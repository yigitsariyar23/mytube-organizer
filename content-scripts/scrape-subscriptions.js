// content-scripts/scrape-subscriptions.js
// Runs only on https://www.youtube.com/feed/channels.
//
// NOTE: YouTube's DOM changes from time to time (ytd-channel-renderer was
// replaced by yt-lockup-view-model style components in some rollouts), so this
// script does NOT depend on renderer tag names. It injects a bottom-right bar
// with three controls: "⬇" jumps to the page bottom once (load the next lazy
// batch, wait, click again), "⏬" auto-scrolls until the list stops growing, and
// "📋 Scan channels" collects every link that points at a channel (/channel/UC...
// or /@handle) inside the main browse area. Scanning is always a manual click —
// the scroll helpers only load channels, they never trigger the scan.

(async function () {
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

  // Name-candidate quality tiers (higher wins): dedicated title element beats
  // img.alt / aria-label, which beat the whole-anchor text fallback.
  const SCORE_TITLE = 3;
  const SCORE_LABEL = 2;
  const SCORE_ANCHOR = 1;

  // Shared chrome for the fixed bottom-right overlays (scan button + banner);
  // per-element colors/padding/font-size are applied on top of this.
  const BASE_OVERLAY_STYLE = {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    borderRadius: "8px",
    fontFamily: "system-ui, sans-serif",
    zIndex: 999999,
    boxShadow: "0 4px 16px rgba(0,0,0,.4)",
  };

  // Show a persistent "Scan now" button so the user can scroll manually first,
  // then trigger the scrape whenever the full list is visible. Called after the
  // consts above so BASE_OVERLAY_STYLE is initialized when showScanButton reads it.
  showScanButton();

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
      if (titleEl) candidates.push([SCORE_TITLE, elementText(titleEl)]);
    }
    if (img && img.alt) candidates.push([SCORE_LABEL, img.alt]);
    if (anchor.getAttribute("aria-label")) candidates.push([SCORE_LABEL, anchor.getAttribute("aria-label")]);
    candidates.push([SCORE_ANCHOR, elementText(anchor)]);

    for (const [score, raw] of candidates) {
      const name = clean(raw);
      if (!name || name.startsWith("@")) continue;
      // Whole-card links concatenate name + handle + description; skip those.
      if (score === SCORE_ANCHOR && name.length > 60) continue;
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
    // NFC-normalize first so accented names (e.g. Vietnamese "Quỳnh", where "ỳ"
    // can arrive precomposed U+1EF3 or decomposed y+U+0300) canonicalize to one
    // form. Without this, YouTube's duplicated title copies can land in different
    // forms — breaking halfIfDoubled's length/equality checks and the descendant
    // guard below, which is what leaks a doubled "Quỳnh Quỳnh" through every scan.
    return (str || "").normalize("NFC").replace(/\s+/g, " ").trim();
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
    // A fixed bottom-right bar holding the scroll-to-bottom arrow and the scan
    // button side by side. YouTube lazy-loads channels as you near the page
    // bottom, so the arrow lets the user jump down, wait for the next batch to
    // load, and jump again — repeatedly — before triggering the manual scan.
    const bar = document.createElement("div");
    bar.id = "mytube-scan-bar";
    Object.assign(bar.style, {
      ...BASE_OVERLAY_STYLE,
      display: "flex",
      gap: "8px",
      background: "transparent",
      boxShadow: "none",
    });

    const secondaryStyle = {
      background: "#17161A",
      color: "#EDEAE4",
      border: "none",
      borderRadius: "8px",
      padding: "10px 14px",
      fontSize: "16px",
      fontWeight: "600",
      cursor: "pointer",
      boxShadow: "0 4px 16px rgba(0,0,0,.4)",
    };

    const scrollBtn = document.createElement("button");
    scrollBtn.id = "mytube-scroll-btn";
    scrollBtn.textContent = "⬇";
    Object.assign(scrollBtn.style, secondaryStyle);
    scrollBtn.addEventListener("click", scrollToBottom);
    const scrollWrap = withTooltip(
      scrollBtn,
      "Scroll to the bottom once — loads the next batch of channels."
    );

    const autoBtn = document.createElement("button");
    autoBtn.id = "mytube-autoscroll-btn";
    autoBtn.textContent = "⏬";
    Object.assign(autoBtn.style, secondaryStyle);
    autoBtn.addEventListener("click", () => toggleAutoScroll(autoBtn));
    const autoWrap = withTooltip(
      autoBtn,
      "Keep scrolling until every channel loads. Doesn't scan — click 📋 when done."
    );

    const btn = document.createElement("button");
    btn.id = "mytube-scan-btn";
    btn.textContent = "📋 Scan channels";
    Object.assign(btn.style, {
      background: "#FF8C00",
      color: "#000",
      border: "none",
      borderRadius: "8px",
      padding: "10px 18px",
      fontSize: "14px",
      fontWeight: "600",
      cursor: "pointer",
      boxShadow: "0 4px 16px rgba(0,0,0,.4)",
    });
    btn.addEventListener("click", () => {
      btn.textContent = "⏳ Scanning…";
      btn.style.opacity = "0.7";
      btn.style.pointerEvents = "none";
      runScan();
    });

    bar.appendChild(scrollWrap);
    bar.appendChild(autoWrap);
    bar.appendChild(btn);
    document.body.appendChild(bar);
  }

  // Wrap a button in a relative container carrying a styled tooltip that appears
  // instantly above it on hover — clearer and faster than the native `title`
  // delay. Returns the wrapper to append in the button's place.
  function withTooltip(button, text) {
    const wrap = document.createElement("div");
    wrap.style.position = "relative";
    wrap.style.display = "flex";

    const tip = document.createElement("span");
    tip.textContent = text;
    Object.assign(tip.style, {
      position: "absolute",
      bottom: "calc(100% + 8px)",
      right: "0",
      width: "max-content",
      maxWidth: "240px",
      background: "#17161A",
      color: "#EDEAE4",
      padding: "8px 10px",
      borderRadius: "8px",
      fontSize: "12px",
      fontWeight: "400",
      lineHeight: "1.35",
      fontFamily: "system-ui, sans-serif",
      boxShadow: "0 4px 16px rgba(0,0,0,.4)",
      pointerEvents: "none",
      opacity: "0",
      transition: "opacity .12s ease",
      whiteSpace: "normal",
    });

    wrap.appendChild(button);
    wrap.appendChild(tip);
    wrap.addEventListener("mouseenter", () => (tip.style.opacity = "1"));
    wrap.addEventListener("mouseleave", () => (tip.style.opacity = "0"));
    return wrap;
  }

  // Jump to the bottom of the scrolling container so YouTube requests the next
  // batch of channels. Kept as a single jump (not a loop) because full lists can
  // take a while to load — the user watches the count settle, then clicks again.
  function scrollToBottom() {
    const target = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight
    );
    window.scrollTo({ top: target, behavior: "smooth" });
  }

  // Auto-scroll loop: jump to the bottom on an interval and stop once the page
  // height has stayed flat for several ticks (YouTube ran out of channels to
  // lazy-load). Deliberately never triggers the scan — the user reviews the
  // loaded list and clicks "Scan channels" manually.
  let autoScrollTimer = null;
  function toggleAutoScroll(autoBtn) {
    if (autoScrollTimer) {
      stopAutoScroll(autoBtn);
      return;
    }
    autoBtn.textContent = "⏸";
    autoBtn.title = "Stop auto-scrolling";
    autoBtn.style.background = "#FF8C00";
    autoBtn.style.color = "#000";

    let lastHeight = 0;
    let stableTicks = 0;
    // ~6 flat ticks (≈6s) with no new content means the list is fully loaded.
    const STABLE_LIMIT = 6;
    autoScrollTimer = setInterval(() => {
      scrollToBottom();
      const height = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight
      );
      if (height > lastHeight) {
        lastHeight = height;
        stableTicks = 0;
      } else if (++stableTicks >= STABLE_LIMIT) {
        stopAutoScroll(autoBtn);
      }
    }, 1000);
  }

  function stopAutoScroll(autoBtn) {
    clearInterval(autoScrollTimer);
    autoScrollTimer = null;
    autoBtn.textContent = "⏬";
    autoBtn.title = "Auto-scroll until all channels load (does not scan)";
    autoBtn.style.background = "#17161A";
    autoBtn.style.color = "#EDEAE4";
  }

  function showBanner(total) {
    if (autoScrollTimer) {
      clearInterval(autoScrollTimer);
      autoScrollTimer = null;
    }
    document.getElementById("mytube-scan-bar")?.remove();
    document.getElementById("mytube-scan-btn")?.remove();
    const el = document.createElement("div");
    el.textContent = total
      ? `MyTube Organizer: scanned ${total} channels — review the changes in the dashboard.`
      : "MyTube Organizer: no channels found — YouTube's page layout may have changed.";
    Object.assign(el.style, {
      ...BASE_OVERLAY_STYLE,
      background: total ? "#17161A" : "#5A1E1E",
      color: "#EDEAE4",
      padding: "10px 16px",
      fontSize: "13px",
    });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 8000);
  }
})();
