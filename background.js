const DEFAULTS = {
  apiKey: "",
  baseUrl: "http://127.0.0.1:27123",
  talksFolder: "",
  vaultPath: "",
  template: "",
};

async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

function sanitizeName(name) {
  return String(name || "")
    .replace(/[/\\:]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/, "")
    .trim();
}

function joinRelative(...parts) {
  return parts
    .map((p) => String(p || "").trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

function vaultUrl(baseUrl, relPath) {
  const encoded = relPath.split("/").map(encodeURIComponent).join("/");
  return `${baseUrl.replace(/\/+$/, "")}/vault/${encoded}`;
}

function getVideoIdFromUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      const parts = u.pathname.split("/").filter(Boolean);
      return parts[0] || null;
    }

    const v = u.searchParams.get("v");
    if (v) return v;

    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "live" || parts[0] === "shorts") {
      return parts[1] || null;
    }

    return null;
  } catch (e) {
    return null;
  }
}

async function fetchVideoInfo(url) {
  const videoId = getVideoIdFromUrl(url);
  if (!videoId) {
    return { ok: false, message: "This is not a YouTube video." };
  }

  const canonical = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonical)}&format=json`;
    const res = await fetch(oembedUrl);
    if (res.ok) {
      const data = await res.json();
      return {
        ok: true,
        title: data.title || "",
        channel: data.author_name || "",
        url: canonical,
      };
    }
    return {
      ok: false,
      message: `Could not load video info (HTTP ${res.status}). Embedding may be disabled.`,
    };
  } catch (err) {
    return { ok: false, message: "Could not reach YouTube. Check your connection." };
  }
}

function injectVideo(template, url) {
  const match = template.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return {
      ok: false,
      message: 'Template must have frontmatter with a "video" property.',
    };
  }

  const frontmatter = match[1];
  const videoLine = /^[ \t]*video[ \t]*:.*$/m;
  if (!videoLine.test(frontmatter)) {
    return {
      ok: false,
      message: 'Template must contain a "video" property in its frontmatter.',
    };
  }

  const updated = frontmatter.replace(videoLine, () => `video: ${url}`);
  return { ok: true, content: template.replace(frontmatter, () => updated) };
}

async function createNote({ title, channel, url }) {
  const settings = await getSettings();

  if (!settings.apiKey) {
    return {
      ok: false,
      status: "unconfigured",
      message: "API key not set. Open Settings.",
    };
  }

  if (!settings.vaultPath) {
    return {
      ok: false,
      status: "unconfigured",
      message: "Vault path not set. Open Settings.",
    };
  }

  if (!settings.vaultPath.startsWith("/")) {
    return {
      ok: false,
      status: "invalid-vault",
      message: "Vault path is not valid. Open Settings and enter the full path to your vault.",
    };
  }

  if (!settings.talksFolder) {
    return {
      ok: false,
      status: "unconfigured",
      message: "Talks folder not set. Open Settings.",
    };
  }

  if (!settings.template) {
    return {
      ok: false,
      status: "unconfigured",
      message: "Template not set. Open Settings.",
    };
  }

  const folder = sanitizeName(channel);
  const filename = sanitizeName(title);
  if (!folder || !filename) {
    return { ok: false, status: "invalid", message: "Could not read video title or channel name." };
  }

  const relPath = joinRelative(settings.talksFolder, folder, `${filename}.md`);
  const fullPath = `${settings.vaultPath.replace(/\/+$/, "")}/${relPath}`;
  const urlPath = vaultUrl(settings.baseUrl, relPath);
  const headers = {
    Authorization: `Bearer ${settings.apiKey}`,
  };

  try {
    const existing = await fetch(urlPath, { headers });
    if (existing.ok) {
      return {
        ok: false,
        status: "exists",
        message: "Note already exists in the vault.",
        path: fullPath,
      };
    }
    if (existing.status !== 404) {
      const message =
        existing.status === 401
          ? "Invalid API key. Check it in the extension options."
          : `Obsidian API check failed (HTTP ${existing.status}). Is Obsidian running?`;
      return { ok: false, status: "error", message };
    }
  } catch (err) {
    return {
      ok: false,
      status: "unreachable",
      message: "Could not reach Obsidian. Make sure Obsidian is open and the Local REST API plugin is enabled.",
    };
  }

  try {
    const folderUrl = `${vaultUrl(settings.baseUrl, joinRelative(settings.talksFolder))}/`;
    const folderRes = await fetch(folderUrl, { headers });
    if (folderRes.status === 404) {
      return {
        ok: false,
        status: "invalid-folder",
        message: "Talks folder not found in the vault. Check it in Settings.",
      };
    }
    if (!folderRes.ok) {
      return {
        ok: false,
        status: "error",
        message: `Could not check the talks folder (HTTP ${folderRes.status}).`,
      };
    }
  } catch (err) {
    return {
      ok: false,
      status: "unreachable",
      message: "Could not reach Obsidian. Make sure Obsidian is open and the Local REST API plugin is enabled.",
    };
  }

  let content;
  try {
    const templatePath = vaultUrl(settings.baseUrl, joinRelative(settings.template));
    const tpl = await fetch(templatePath, { headers });
    if (tpl.status === 404) {
      return {
        ok: false,
        status: "invalid-template",
        message: "Template not found in the vault. Check the path in Settings.",
      };
    }
    if (!tpl.ok) {
      return {
        ok: false,
        status: "error",
        message: `Could not load template (HTTP ${tpl.status}).`,
      };
    }
    const templateText = await tpl.text();
    const injected = injectVideo(templateText, url);
    if (!injected.ok) {
      return { ok: false, status: "invalid-template", message: injected.message };
    }
    content = injected.content;
  } catch (err) {
    return {
      ok: false,
      status: "unreachable",
      message: "Could not reach Obsidian. Make sure Obsidian is open and the Local REST API plugin is enabled.",
    };
  }

  try {
    const res = await fetch(urlPath, {
      method: "PUT",
      headers: {
        ...headers,
        "Content-Type": "text/markdown",
      },
      body: content,
    });

    if (!res.ok) {
      const message =
        res.status === 401
          ? "Invalid API key. Check it in the extension options."
          : `Obsidian API error (HTTP ${res.status}).`;
      return { ok: false, status: "error", message };
    }

    return {
      ok: true,
      status: "created",
      message: "Saved to Obsidian.",
      path: fullPath,
    };
  } catch (err) {
    return {
      ok: false,
      status: "unreachable",
      message: "Could not reach Obsidian. Make sure Obsidian is open and the Local REST API plugin is enabled.",
    };
  }
}

async function testConfig(settings) {
  settings = { ...DEFAULTS, ...settings };

  if (!settings.apiKey) {
    return { ok: false, message: "Enter an API key first." };
  }
  if (!settings.vaultPath) {
    return { ok: false, message: "Enter your vault's full path." };
  }
  if (!settings.vaultPath.startsWith("/")) {
    return { ok: false, message: "Vault path must be an absolute path (e.g. /Users/you/Documents/Vault)." };
  }
  if (!settings.talksFolder) {
    return { ok: false, message: "Enter a talks folder." };
  }
  if (!settings.template) {
    return { ok: false, message: "Enter a template path." };
  }

  const headers = { Authorization: `Bearer ${settings.apiKey}` };

  try {
    const res = await fetch(`${settings.baseUrl}/`, { headers });
    if (res.status === 401) {
      return { ok: false, message: "Invalid API key." };
    }
    if (!res.ok) {
      return { ok: false, message: `Unexpected response (HTTP ${res.status}).` };
    }
  } catch (e) {
    return {
      ok: false,
      message: "Could not reach the server. Is Obsidian running with the plugin enabled?",
    };
  }

  try {
    const folderUrl = `${vaultUrl(settings.baseUrl, joinRelative(settings.talksFolder))}/`;
    const folderRes = await fetch(folderUrl, { headers });
    if (folderRes.status === 404) {
      return { ok: false, message: "Talks folder not found in the vault. Check the talks folder." };
    }
    if (!folderRes.ok) {
      return { ok: false, message: `Could not check the talks folder (HTTP ${folderRes.status}).` };
    }
  } catch (e) {
    return { ok: false, message: "Could not check the talks folder." };
  }

  try {
    const templatePath = vaultUrl(settings.baseUrl, joinRelative(settings.template));
    const tpl = await fetch(templatePath, { headers });
    if (tpl.status === 404) {
      return { ok: false, message: "Template not found in the vault. Check the template path." };
    }
    if (!tpl.ok) {
      return { ok: false, message: `Could not load template (HTTP ${tpl.status}).` };
    }
    const text = await tpl.text();
    const injected = injectVideo(text, "https://example.com");
    if (!injected.ok) {
      return { ok: false, message: injected.message };
    }
  } catch (e) {
    return { ok: false, message: "Could not load the template." };
  }

  return { ok: true, message: "Connected to Obsidian." };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "CREATE_NOTE") {
    createNote(message.payload).then(sendResponse);
    return true;
  }
  if (message && message.type === "GET_VIDEO_INFO") {
    fetchVideoInfo(message.url).then(sendResponse);
    return true;
  }
  if (message && message.type === "CHECK_CONFIG") {
    getSettings().then((s) =>
      sendResponse({
        configured: Boolean(s.apiKey && s.vaultPath && s.talksFolder && s.template),
        apiKey: Boolean(s.apiKey),
        vaultPath: Boolean(s.vaultPath),
        talksFolder: Boolean(s.talksFolder),
        template: Boolean(s.template),
      })
    );
    return true;
  }
  if (message && message.type === "TEST_CONFIG") {
    testConfig(message.settings).then(sendResponse);
    return true;
  }
});
