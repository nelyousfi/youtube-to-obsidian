const DEFAULTS = {
  apiKey: "",
  baseUrl: "http://127.0.0.1:27123",
  talksFolder: "",
  vaultPath: "",
  template: "",
};

const $apiKey = document.getElementById("apiKey");
const $baseUrl = document.getElementById("baseUrl");
const $vaultPath = document.getElementById("vaultPath");
const $talksFolder = document.getElementById("talksFolder");
const $template = document.getElementById("template");
const $save = document.getElementById("save");
const $test = document.getElementById("test");
const $status = document.getElementById("status");

function setStatus(text, ok) {
  $status.textContent = text;
  $status.className = ok ? "ok" : "err";
}

async function load() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  $apiKey.value = settings.apiKey;
  $baseUrl.value = settings.baseUrl;
  $vaultPath.value = settings.vaultPath;
  $talksFolder.value = settings.talksFolder;
  $template.value = settings.template;
}

function readForm() {
  return {
    apiKey: $apiKey.value.trim(),
    baseUrl: $baseUrl.value.trim().replace(/\/+$/, ""),
    vaultPath: $vaultPath.value.trim().replace(/\/+$/, ""),
    talksFolder: $talksFolder.value.trim(),
    template: $template.value.trim(),
  };
}

$save.addEventListener("click", async () => {
  await chrome.storage.local.set(readForm());
  setStatus("Saved.", true);
});

$test.addEventListener("click", async () => {
  setStatus("Testing...", false);
  let res;
  try {
    res = await chrome.runtime.sendMessage({
      type: "TEST_CONFIG",
      settings: readForm(),
    });
  } catch (e) {
    res = { ok: false, message: "Could not reach the extension background." };
  }
  setStatus((res && res.message) || "Something went wrong.", Boolean(res && res.ok));
});

load();
