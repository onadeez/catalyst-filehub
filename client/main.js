console.log("main.js loaded ✅");

const FUNCTION_NAME = "file_hub"; // your Advanced I/O function name (same as console)
const FILESTORE_FOLDER_ID = "2664000000014747";
const UPLOADS_TABLE_ID    = "2664000000014004";
const qs = (id) => document.getElementById(id);

function setText(id, msg) {
  const el = qs(id);
  if (!el) return;
  el.textContent = typeof msg === "string" ? msg : JSON.stringify(msg, null, 2);
}

function showAuth() {
  qs("authSection")?.classList.remove("hidden");
  qs("appSection")?.classList.add("hidden");
  qs("signOutBtn")?.classList.add("hidden");
  qs("userLabel").textContent = "";
}

function showApp() {
  qs("authSection")?.classList.add("hidden");
  qs("appSection")?.classList.remove("hidden");
  qs("signOutBtn")?.classList.remove("hidden");
}

function getCatalyst() {
  return window.catalyst || null;
}

/**
 * Call function using SDK if present, else fallback to fetch.
 * We use this for:
 *  - auth/session check (GET)
 *  - listing rows (GET)
 *  - upload (POST multipart)
 */
const ROOT = window.location.origin;

async function callFileHubGET() {
  const c = window.catalyst;

  // Prefer SDK if available
  try {
    const fnSvc = c?.function || c?.functions;
    if (fnSvc?.functionName) {
      const fn = fnSvc.functionName(FUNCTION_NAME);
      const resp = await fn.execute({ method: "GET" });
      return await resp.json();
    }
  } catch (e) {
    console.warn("SDK GET failed, fallback to fetch:", e);
  }

  // Fallback: absolute root URL (IMPORTANT)
  const resp = await fetch(`${ROOT}/server/${FUNCTION_NAME}`, {
    method: "GET",
    credentials: "include",
  });
  return await resp.json();
}

async function callFileHubPOST(file) {
  const c = window.catalyst;

  const fd = new FormData();
  fd.append("file", file, file.name);

  // Prefer fetch for multipart (more reliable)
  const resp = await fetch(`${ROOT}/server/${FUNCTION_NAME}`, {
    method: "POST",
    body: fd,
    credentials: "include",
  });
  return await resp.json();
}


let loginRendered = false;
let checkingSession = false;

async function renderEmbeddedLogin() {
  const c = getCatalyst();
  if (!c) {
    setText("authStatus", "ERROR: window.catalyst is undefined. SDK not loaded.");
    return;
  }
  if (!c.auth || typeof c.auth.signIn !== "function") {
    setText("authStatus", "ERROR: catalyst.auth.signIn not available. Check /__catalyst/sdk/init.js");
    return;
  }
  if (loginRendered) {
    setText("authStatus", "Login already rendered. If blank, hard refresh (Ctrl+F5).");
    return;
  }

  loginRendered = true;
  qs("loadLoginBtn").disabled = true;

  const mount = qs("loginDivElementId");
  mount.innerHTML = "";

  setText("authStatus", "Rendering embedded sign-in…");

  try {
    c.auth.signIn("loginDivElementId", { service_url: "/app/index.html" });
  } catch (e) {
    setText("authStatus", "signIn() failed: " + String(e?.message || e));
    qs("loadLoginBtn").disabled = false;
    loginRendered = false;
    return;
  }

  // Start session detection loop
  startSessionCheckLoop();
}

async function startSessionCheckLoop() {
  if (checkingSession) return;
  checkingSession = true;

  // Check up to ~45s without hammering (prevents throttling)
  const maxAttempts = 15;
  const delayMs = 3000;

  for (let i = 1; i <= maxAttempts; i++) {
    setText("authStatus", `Waiting for login… (check ${i}/${maxAttempts})`);

    try {
      const data = await callFileHubGET();

      // If your function returns ok:true, session is valid
      if (data && data.ok === true) {
        setText("authStatus", "✅ Signed in. Loading app…");
        qs("userLabel").textContent = "Signed in";
        showApp();
        setText("apiOutput", data);
        checkingSession = false;
        return;
      }

      // ok:false typically means not logged in
      setText("authStatus", `Not signed in yet. Complete login in the iframe. (${i}/${maxAttempts})`);
    } catch (e) {
      // If the function is protected, unauth often throws or returns error
      console.warn("Session check error:", e);
      setText("authStatus", `Checking session… (${i}/${maxAttempts})`);
    }

    await new Promise((r) => setTimeout(r, delayMs));
  }

  checkingSession = false;
  setText("authStatus", "Still not signed in. Finish login in iframe, then click Load Sign-in once more.");
  qs("loadLoginBtn").disabled = false;
  loginRendered = false;
}

function wireDropzone() {
  const dropzone = qs("dropzone");
  const fileInput = qs("fileInput");
  if (!dropzone || !fileInput) return;

  ["dragenter", "dragover"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.remove("dragover");
    });
  });

  dropzone.addEventListener("drop", async (e) => {
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) await uploadFiles(files);
  });

  fileInput.addEventListener("change", async () => {
    const files = Array.from(fileInput.files || []);
    fileInput.value = "";
    if (files.length) await uploadFiles(files);
  });
}

async function uploadFiles(files) {
  setText("uploadStatus", `Uploading ${files.length} file(s)…`);

  const results = [];
  for (const f of files) {
    try {
      const resp = await callFileHubPOST(f);
      results.push(resp);
    } catch (e) {
      results.push({ ok: false, file_name: f.name, error: String(e?.message || e) });
    }
  }

  setText("uploadStatus", results);
  await refreshList();
}

async function refreshList() {
  try {
    setText("apiOutput", "Loading…");
    const data = await callFileHubGET();
    setText("apiOutput", data);
  } catch (e) {
    setText("apiOutput", "API ERROR: " + String(e?.message || e));
  }
}

async function init() {
  showAuth();
  wireDropzone();

  qs("loadLoginBtn")?.addEventListener("click", renderEmbeddedLogin);
  qs("refreshBtn")?.addEventListener("click", refreshList);

  qs("signOutBtn")?.addEventListener("click", async () => {
    try {
      const c = getCatalyst();
      await c?.auth?.signOut?.();
    } catch {}
    loginRendered = false;
    checkingSession = false;
    qs("loadLoginBtn").disabled = false;
    setText("authStatus", "Signed out.");
    showAuth();
  });

  setText("authStatus", "SDK loaded. Click “Load Sign-in”.");
}

init();
