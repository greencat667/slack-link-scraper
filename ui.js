"use strict";

const scrapeBtn = document.getElementById("scrapeBtn");
const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");
const outputEl = document.getElementById("output");
const statusEl = document.getElementById("status");
const excludePatternsEl = document.getElementById("excludePatterns");
const visibleOnlyEl = document.getElementById("visibleOnly");
const loadAllEl = document.getElementById("loadAll");

const DEFAULT_STATE = {
  scope: "auto",
  format: "md",
  excludePatterns: "",
  visibleOnly: false,
  loadAll: false
};

function setStatus(message) {
  statusEl.textContent = message || "";
}

function getSelected(name) {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : null;
}

function setSelected(name, value) {
  const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (el) el.checked = true;
}

function sanitizePatterns(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

async function saveState() {
  const state = {
    scope: getSelected("scope") || DEFAULT_STATE.scope,
    format: getSelected("format") || DEFAULT_STATE.format,
    excludePatterns: sanitizePatterns(excludePatternsEl.value),
    visibleOnly: visibleOnlyEl.checked,
    loadAll: loadAllEl.checked
  };
  await chrome.storage.sync.set({ settings: state });
  return state;
}

async function loadState() {
  const { settings } = await chrome.storage.sync.get("settings");
  const state = settings || DEFAULT_STATE;
  setSelected("scope", state.scope || DEFAULT_STATE.scope);
  setSelected("format", state.format || DEFAULT_STATE.format);
  excludePatternsEl.value = state.excludePatterns || "";
  visibleOnlyEl.checked = !!state.visibleOnly;
  loadAllEl.checked = !!state.loadAll;
}

async function getActiveSlackTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return null;
  if (!tab.url.includes("slack.com")) return null;
  return tab;
}

function buildFilename(format) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const ext = format === "html" ? "html" : format === "csv" ? "csv" : "md";
  return `slack-links-${stamp}.${ext}`;
}

function getMimeType(format) {
  if (format === "html") return "text/html";
  if (format === "csv") return "text/csv";
  return "text/markdown";
}

async function downloadText(text, format) {
  const blob = new Blob([text], { type: getMimeType(format) });
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({
    url,
    filename: buildFilename(format),
    saveAs: true
  });
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyToClipboard(text) {
  await navigator.clipboard.writeText(text);
}

async function scrape() {
  setStatus("Scraping...");
  const state = await saveState();
  const tab = await getActiveSlackTab();
  if (!tab) {
    setStatus("Open Slack in the browser first.");
    return;
  }

  const response = await chrome.tabs.sendMessage(tab.id, {
    type: "SCRAPE_LINKS",
    payload: state
  });

  if (!response || response.error) {
    setStatus(response?.error || "Could not scrape. Try reloading Slack.");
    return;
  }

  outputEl.value = response.output || "";
  setStatus(`Found ${response.count} links.`);
}

async function init() {
  await loadState();
  scrapeBtn.addEventListener("click", scrape);
  copyBtn.addEventListener("click", async () => {
    if (!outputEl.value) return;
    await copyToClipboard(outputEl.value);
    setStatus("Copied to clipboard.");
  });
  downloadBtn.addEventListener("click", async () => {
    if (!outputEl.value) return;
    const format = getSelected("format") || "md";
    await downloadText(outputEl.value, format);
    setStatus("Download started.");
  });
}

init();
