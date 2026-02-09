console.log("main.js loaded ✅");

/**
 * Put your IDs here (strings).
 * Folder ID should be EXACTLY what Catalyst shows (16/17 digits – keep as string).
 */
const FILESTORE_FOLDER_ID = "2664000000014747";
const UPLOADS_TABLE_ID     = "2664000000014004"; // optional, but you set it already
const FUNCTION_NAME        = "file_hub";         // your function name

const $ = (id) => document.getElementById(id);

function setPre(id, msg) {
  const el = $(id);
  if (!el) return;
  el.textContent = (typeof msg === "string") ? msg : JSON.stringify(msg, null, 2);
}

function showAuth() {
  $("authSection")?.classList.remove("hidden");
  $("appSection")?.classList.add("hidden");
  $("signOutBtn")?.classList.add("hidden");
  $("userLabel").textContent = "";
}

function showApp(user) {
  $("authSection")?.classList.add("hidden");
  $("appSection")?.classList.remove("hidden");
  $("signOutBtn")?.classList.remove("hidden");

  const email = user?.email_id || user?.email || "";
  $("userLabel").textContent = email ? `Signed in as ${email}` : "Signed in";
}

let loginRendered = false;
let pollStop = false;

/**
 * IMPORTANT:
 * Do NOT call catalyst.ready(), catalyst.initialize(), catalyst.initializeApp().
 * In your environment those functions do not exist.
 * Use the console-snippet API directly: catalyst.auth.signIn(...)
 */

async function getCurrentUserSafe() {
  try {
    return await catalyst.auth.getCurrentUser();
  } catch {
    return null;
  }
}

async function pollForLogin() {
  // Backoff polling: 1s, 2s, 4s, 6s, 8s, 10s... max ~60s
  pollStop = false;

  let waited = 0;
  const steps = [1000, 2000, 4000, 6000, 8000, 10000, 10000, 10000];

  for (const delay of steps) {
    if (pollStop) return;

    const user = await getCurrentUserSafe();
    if (user) {
      setPre("authStatus", "✅ Signed in. Loading app…");
      showApp(user);
      await refreshApiData(); // now safe
      return;
    }

    waited += delay;
    setPre("authStatus", `Not signed in yet. Waiting… (${Math.round(waited / 1000)}s)`);
    await new Promise((r) => setTimeout(r, delay));
  }

  setPre(
    "authStatus",
    "Still not signed in. If you completed login in the iframe, try hard refresh (Ctrl+F5) or allow third-party cookies for this domain."
  );
}

function renderEmbeddedLogin() {
  if (loginRendered) {
    setPre("authStatus", "Login already rendered. Complete sign-in in the box.");
    return;
  }

  loginRendered = true;
  setPre("authStatus", "Rendering embedded sign-in…");

  // Clear mount to avoid weird partial renders
  const mount = $("loginDivElementId");
  if (mount) mount.innerHTML = "";

  // Use the same config style as console snippet
  const config = {
    service_url: "/app/index.html"
  };

  try {
    catalyst.auth.signIn("loginDivElementId", config);
  } catch (e) {
    loginRendered = false;
    setPre("authStatus", "❌ signIn failed: " + String(e?.message || e));
    return;
  }

  // Give a quick “did iframe appear?” hint
  setTimeout(() => {
    const iframe = $("loginDivElementId")?.querySelector("iframe");
    if (iframe) setPre("authStatus", "✅ Login iframe rendered. Complete sign-in.");
    else setPre("authStatus", "Iframe did not render. Check cookie/iframe blocking.");
  }, 1200);

  // Start polling for the session after rendering
  pollForLogin();
}

function wireDropzone() {
  const dropzone = $("dropzone");
  const fileInput = $("fileInput");
  if (!dropzone || !fileInput) return;

  ["dragenter", "dragover"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
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

function extractUploaded(uploadResp) {
  // Different SDK responses sometimes wrap content
  return uploadResp?.content || uploadResp?.data || uploadResp?.file || uploadResp;
}
function extractFileId(uploaded, uploadResp) {
  return uploaded?.id || uploaded?.file_id || uploaded?.fileId || uploadResp?.id || null;
}

async function uploadFiles(files) {
  const user = await getCurrentUserSafe();
  if (!user) {
    setPre("uploadStatus", "Please sign in first.");
    showAuth();
    return;
  }

  setPre("uploadStatus", `Uploading ${files.length} file(s)…`);
  const results = [];

  try {
    const folder = catalyst.file.folderId(FILESTORE_FOLDER_ID);
    const table = UPLOADS_TABLE_ID ? catalyst.table.tableId(UPLOADS_TABLE_ID) : null;

    for (const f of files) {
      try {
        const uploadResp = await folder.uploadFile(f).start();
        const uploaded = extractUploaded(uploadResp);
        const fileId = extractFileId(uploaded, uploadResp);

        if (!fileId) {
          throw new Error("No file id returned. Raw: " + JSON.stringify(uploadResp));
        }

        // Optional: record to Data Store
        if (table) {
          await table.addRow([{
            file_name: uploaded?.file_name || f.name,
            file_id: fileId,
            file_size: Number(uploaded?.file_size || f.size),
          }]);
        }

        results.push({ ok: true, name: f.name, file_id: fileId });
      } catch (e) {
        results.push({ ok: false, name: f.name, error: String(e?.message || e) });
      }
    }

    setPre("uploadStatus", results);
    await refreshApiData();
  } catch (e) {
    setPre("uploadStatus", "FATAL: " + String(e?.message || e));
  }
}

async function refreshApiData() {
  const user = await getCurrentUserSafe();
  if (!user) {
    setPre("apiOutput", { ok: false, error: "Not signed in" });
    return;
  }

  try {
    setPre("apiOutput", "Loading…");
    const fn = catalyst.function.functionId(FUNCTION_NAME);
    const resp = await fn.execute({ method: "GET" });

    // Some environments return Response-like objects
    const data = await resp.json();
    setPre("apiOutput", data);
  } catch (e) {
    setPre("apiOutput", "API ERROR: " + String(e?.message || e));
  }
}

async function signOut() {
  pollStop = true;
  try {
    await catalyst.auth.signOut();
  } catch {}
  loginRendered = false;
  showAuth();
  setPre("authStatus", "Signed out. Click “Load Sign-in”.");
}

async function init() {
  // Wire buttons
  $("loadLoginBtn")?.addEventListener("click", renderEmbeddedLogin);
  $("signOutBtn")?.addEventListener("click", signOut);
  $("refreshBtn")?.addEventListener("click", refreshApiData);

  // Wire upload UI
  wireDropzone();

  // On load, check if session already exists
  const user = await getCurrentUserSafe();
  if (user) {
    showApp(user);
    setPre("uploadStatus", "Ready ✅");
    await refreshApiData();
  } else {
    showAuth();
    setPre("authStatus", "Not signed in. Click “Load Sign-in”.");
  }
}

init();
