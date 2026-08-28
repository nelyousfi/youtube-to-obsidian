const $state = document.getElementById("state");
const $preview = document.getElementById("preview");
const $title = document.getElementById("video-title");
const $channel = document.getElementById("video-channel");
const $url = document.getElementById("video-url");
const $addNote = document.getElementById("add-note");
const $status = document.getElementById("status");
const $settings = document.getElementById("settings");
const $openNote = document.getElementById("open-note");

let currentInfo = null;

function setStatus(text, ok) {
  $status.textContent = text;
  $status.className = ok ? "ok" : "err";
}

function buildDeeplink(path) {
  return `obsidian://open?path=${encodeURIComponent(path)}`;
}

function openScheme(url) {
  chrome.tabs.create({ url, active: false }, (tab) => {
    if (chrome.runtime.lastError || !tab || !tab.id) return;
  });
}

function showOpenLink(res) {
  if (res && res.path) {
    $openNote.href = buildDeeplink(res.path);
    $openNote.style.display = "block";
  } else {
    $openNote.style.display = "none";
  }
}

async function checkConfig() {
  let config;
  try {
    config = await chrome.runtime.sendMessage({ type: "CHECK_CONFIG" });
  } catch (e) {
    config = null;
  }

  if (!config || config.configured) {
    $addNote.disabled = false;
    return;
  }

  const missing = [];
  if (!config.apiKey) missing.push("API key");
  if (!config.vaultPath) missing.push("vault path");
  if (!config.talksFolder) missing.push("talks folder");
  if (!config.template) missing.push("template");

  $addNote.disabled = true;
  setStatus(`Set ${joinList(missing)} in Settings to add notes.`, false);
}

function joinList(items) {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

function showState(text) {
  $state.textContent = text;
  $state.style.display = "block";
  $preview.classList.remove("visible");
  $addNote.style.display = "none";
}

function showPreview(info) {
  currentInfo = info;
  $state.style.display = "none";
  $preview.classList.add("visible");
  $addNote.style.display = "block";
  $title.textContent = info.title || "(untitled)";
  $channel.textContent = info.channel || "Unknown channel";
  $url.textContent = info.url || "";
}

async function init() {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (e) {
    showState("Could not read the active tab.");
    return;
  }

  if (!tab || !tab.url) {
    showState("Could not read the active tab.");
    return;
  }

  setStatus("", false);

  let info;
  try {
    info = await chrome.runtime.sendMessage({
      type: "GET_VIDEO_INFO",
      url: tab.url,
    });
  } catch (e) {
    showState("Could not reach the extension background.");
    return;
  }

  if (!info || !info.ok || !info.title) {
    showState(
      info && info.message
        ? info.message
        : "Open a YouTube video to add a note.",
    );
    return;
  }

  showPreview(info);
  await checkConfig();
}

$addNote.addEventListener("click", async () => {
  if (!currentInfo) return;
  $addNote.disabled = true;
  $addNote.textContent = "Saving...";
  setStatus("", false);
  showOpenLink(null);

  let res;
  try {
    res = await chrome.runtime.sendMessage({
      type: "CREATE_NOTE",
      payload: currentInfo,
    });
  } catch (e) {
    res = {
      ok: false,
      status: "error",
      message: "Could not reach the extension background.",
    };
  }

  if (res && res.ok) {
    $addNote.textContent = "Saved \u2713";
    setStatus("Note created in Obsidian.", true);
    showOpenLink(res);
  } else if (res && res.status === "exists") {
    $addNote.textContent = "Already saved";
    setStatus("This note already exists in the vault.", true);
    showOpenLink(res);
  } else {
    $addNote.textContent = "Add note";
    setStatus((res && res.message) || "Something went wrong.", false);
  }

  $addNote.disabled = false;
});

$settings.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

$openNote.addEventListener("click", (e) => {
  e.preventDefault();
  const url = $openNote.href;
  if (!url || !url.startsWith("obsidian://")) return;
  openScheme(url);
});

init();
