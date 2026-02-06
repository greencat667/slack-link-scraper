"use strict";

const EXCLUDED_PROTOCOLS = ["javascript:", "mailto:", "tel:"];

function globToRegex(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regex = "^" + escaped.replace(/\*/g, ".*") + "$";
  return new RegExp(regex, "i");
}

function parseExcludePatterns(raw) {
  if (!raw) return [];
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(globToRegex);
}

function hostMatches(host, patterns) {
  return patterns.some((regex) => regex.test(host));
}

function shouldExclude(url, patterns) {
  try {
    const u = new URL(url);
    return hostMatches(u.host, patterns);
  } catch {
    return true;
  }
}

function isVisible(el) {
  const rect = el.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < window.innerHeight;
}

function getThreadRoot() {
  const candidates = [
    document.querySelector('div[aria-label="Thread"]'),
    document.querySelector('div[aria-label="Thread panel"]'),
    document.querySelector('section[aria-label="Thread"]'),
    document.querySelector('div[data-qa="thread_view"]')
  ];
  return candidates.find(Boolean) || null;
}

function getChannelRoot() {
  const candidates = [
    document.querySelector('div[role="main"]'),
    document.querySelector('div[data-qa="message_pane"]'),
    document.querySelector('section[aria-label="Messages"]')
  ];
  return candidates.find(Boolean) || document.body;
}

function getMessageContainers(root) {
  if (!root) return [];
  const containers = root.querySelectorAll(
    '[data-qa="message_container"], [data-qa="message-text"], [data-qa="virtual-list-item"]'
  );
  if (containers.length > 0) return Array.from(containers);
  return [root];
}

function extractLinksFromElements(elements, { visibleOnly, excludePatterns }) {
  const links = [];
  const excludeRegexes = parseExcludePatterns(excludePatterns);

  for (const el of elements) {
    if (visibleOnly && !isVisible(el)) continue;
    const anchors = el.querySelectorAll("a[href]");
    anchors.forEach((a) => {
      const href = a.getAttribute("href");
      if (!href) return;
      if (EXCLUDED_PROTOCOLS.some((p) => href.startsWith(p))) return;
      if (excludeRegexes.length && shouldExclude(href, excludeRegexes)) return;
      links.push({
        href,
        text: (a.textContent || "").trim()
      });
    });
  }

  return links;
}

function uniqueLinks(links) {
  const seen = new Map();
  for (const link of links) {
    const key = link.href;
    if (!seen.has(key)) {
      seen.set(key, link);
    }
  }
  return Array.from(seen.values());
}

function toMarkdown(links) {
  return links
    .map((link) => {
      const label = link.text || link.href;
      return `- [${label.replace(/\[/g, "\\[").replace(/\]/g, "\\]")}](${link.href})`;
    })
    .join("\n");
}

function toHtml(links) {
  const items = links
    .map((link) => {
      const label = link.text || link.href;
      return `<li><a href="${link.href}">${escapeHtml(label)}</a></li>`;
    })
    .join("");
  return `<ul>${items}</ul>`;
}

function toCsv(links) {
  const header = "url,text";
  const rows = links.map((link) => {
    return `${csvEscape(link.href)},${csvEscape(link.text || "")}`;
  });
  return [header, ...rows].join("\n");
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[,"\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getScrollCandidates(root) {
  const selectors = [
    ".c-virtual_list__scroll_container",
    ".c-scrollbar__hider",
    ".c-scrollbar__child",
    ".c-message_list",
    ".p-threads_flexpane",
    "[data-qa='slack_kit_scrollbar']",
    "[data-qa='message_pane']",
    "[data-qa='thread_view']",
    "[role='main']"
  ];

  const candidates = new Set();
  const scope = root && root instanceof Element ? root : document.body;
  selectors.forEach((selector) => {
    scope.querySelectorAll(selector).forEach((el) => candidates.add(el));
    document.querySelectorAll(selector).forEach((el) => candidates.add(el));
  });

  if (scope instanceof Element) candidates.add(scope);
  if (document.scrollingElement) candidates.add(document.scrollingElement);
  return Array.from(candidates);
}

function findScrollableRoot(root) {
  const candidates = getScrollCandidates(root);
  let best = null;
  let bestDelta = 0;

  for (const el of candidates) {
    if (!(el instanceof Element)) continue;
    const style = window.getComputedStyle(el);
    if (style.overflowY === "hidden") continue;
    const delta = el.scrollHeight - el.clientHeight;
    if (delta > bestDelta + 40) {
      best = el;
      bestDelta = delta;
    }
  }

  return best;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function collectAllLinksWithScroll(root, options, { maxIterations = 80 } = {}) {
  const scrollEl = findScrollableRoot(root);
  if (!scrollEl) {
    return uniqueLinks(extractLinksFromElements(getMessageContainers(root), options));
  }

  const seen = new Map();
  let previousHeight = -1;
  let stableAtTop = 0;
  let previousCount = -1;
  let stableCount = 0;

  for (let i = 0; i < maxIterations; i += 1) {
    const messageContainers = getMessageContainers(root);
    const chunk = extractLinksFromElements(messageContainers, options);
    for (const link of chunk) {
      if (!seen.has(link.href)) seen.set(link.href, link);
    }

    const messageCount = messageContainers.length;
    if (messageCount === previousCount) {
      stableCount += 1;
    } else {
      stableCount = 0;
      previousCount = messageCount;
    }

    if (stableCount >= 4 && stableAtTop >= 2) {
      break;
    }

    if (scrollEl.scrollTop === 0) {
      await sleep(700);
      const newHeight = scrollEl.scrollHeight;
      if (newHeight === previousHeight) {
        stableAtTop += 1;
        if (stableAtTop >= 3) break;
      } else {
        stableAtTop = 0;
        previousHeight = newHeight;
      }
      scrollEl.scrollTop = 0;
    } else {
      const step = Math.max(200, Math.floor(scrollEl.clientHeight * 0.85));
      scrollEl.scrollTop = Math.max(0, scrollEl.scrollTop - step);
    }

    await sleep(450);
  }

  return Array.from(seen.values());
}

async function scrapeLinks({ scope, visibleOnly, excludePatterns, format, loadAll }) {
  const threadRoot = getThreadRoot();
  let root;
  if (scope === "thread") {
    root = threadRoot;
  } else if (scope === "channel") {
    root = getChannelRoot();
  } else {
    root = threadRoot || getChannelRoot();
  }

  if (!root) {
    return { error: "Could not find Slack messages in this view." };
  }

  let links;
  if (loadAll) {
    links = await collectAllLinksWithScroll(root, { visibleOnly, excludePatterns });
  } else {
    const messageContainers = getMessageContainers(root);
    links = uniqueLinks(
      extractLinksFromElements(messageContainers, { visibleOnly, excludePatterns })
    );
  }

  let output;
  if (format === "html") output = toHtml(links);
  else if (format === "csv") output = toCsv(links);
  else output = toMarkdown(links);
  return { output, count: links.length };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SCRAPE_LINKS") {
    (async () => {
      try {
        const result = await scrapeLinks(message.payload || {});
        sendResponse(result);
      } catch (err) {
        sendResponse({ error: err?.message || "Unexpected error" });
      }
    })();
  }
  return true;
});
