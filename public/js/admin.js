(() => {
  const API = "/.netlify/functions";
  let adminKey = sessionStorage.getItem("specAdminKey") || "";

  const gate = document.getElementById("gate");
  const app = document.getElementById("app");
  const adminKeyInput = document.getElementById("adminKeyInput");
  const unlockBtn = document.getElementById("unlockBtn");
  const gateError = document.getElementById("gateError");

  async function tryUnlock(key) {
    const res = await fetch(`${API}/admin-catalog`, { headers: { "x-admin-key": key } });
    if (res.ok) {
      adminKey = key;
      sessionStorage.setItem("specAdminKey", key);
      gate.style.display = "none";
      app.style.display = "block";
      loadItems();
      return true;
    }
    return false;
  }

  unlockBtn.addEventListener("click", async () => {
    const ok = await tryUnlock(adminKeyInput.value);
    if (!ok) gateError.textContent = "Incorrect key.";
  });
  adminKeyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") unlockBtn.click();
  });

  if (adminKey) tryUnlock(adminKey);

  // ---- Upload ----
  const uploadForm = document.getElementById("uploadForm");
  const uploadStatus = document.getElementById("uploadStatus");

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function filenameToTitle(filename) {
    return filename
      .replace(/\.pdf$/i, "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
  }

  const dropzone = document.getElementById("dropzone");
  const dropzoneFiles = document.getElementById("dropzoneFiles");
  const fileInputEl = document.getElementById("file");

  function renderSelectedFiles() {
    const files = Array.from(fileInputEl.files || []);
    if (files.length === 0) {
      dropzoneFiles.innerHTML = "";
      return;
    }
    dropzoneFiles.innerHTML = files
      .map((f) => `<div class="file-row"><span>${escapeHtmlAdmin(f.name)}</span><span>${(f.size / 1024).toFixed(0)} KB</span></div>`)
      .join("");
  }

  function escapeHtmlAdmin(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  dropzone.addEventListener("click", () => fileInputEl.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInputEl.click();
    }
  });
  fileInputEl.addEventListener("change", renderSelectedFiles);

  ["dragenter", "dragover"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add("dragover");
    });
  });
  ["dragleave", "dragend"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove("dragover");
    });
  });
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove("dragover");
    const dropped = Array.from(e.dataTransfer.files || []).filter(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );
    if (dropped.length === 0) return;
    const dt = new DataTransfer();
    dropped.forEach((f) => dt.items.add(f));
    fileInputEl.files = dt.files;
    renderSelectedFiles();
  });

  uploadForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const titleField = document.getElementById("title").value.trim();
    const category = document.getElementById("category").value.trim();
    const tags = document.getElementById("tags").value.split(",").map((t) => t.trim()).filter(Boolean);
    const files = Array.from(fileInputEl.files || []);

    if (files.length === 0) return;

    const submitBtn = uploadForm.querySelector("button[type=submit]");
    submitBtn.disabled = true;

    const failures = [];
    let succeeded = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const title = files.length === 1 && titleField ? titleField : filenameToTitle(file.name);

      uploadStatus.className = "status";
      uploadStatus.textContent = `Uploading ${i + 1} of ${files.length}: "${title}"…`;

      try {
        const fileBase64 = await fileToBase64(file);
        const res = await fetch(`${API}/admin-catalog`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
          body: JSON.stringify({ title, category, tags, filename: file.name, fileBase64 }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Upload failed");
        succeeded++;
      } catch (err) {
        failures.push(`${file.name}: ${err.message}`);
      }
    }

    if (failures.length === 0) {
      uploadStatus.className = "status success";
      uploadStatus.textContent = `Uploaded ${succeeded} spec sheet${succeeded === 1 ? "" : "s"}.`;
    } else {
      uploadStatus.className = "status error";
      uploadStatus.textContent = `Uploaded ${succeeded} of ${files.length}. Failed: ${failures.join("; ")}`;
    }

    uploadForm.reset();
    dropzoneFiles.innerHTML = "";
    submitBtn.disabled = false;
    loadItems();
  });

  // ---- Full catalog export ----
  const fullCatalogBtn = document.getElementById("fullCatalogBtn");
  const fullCatalogStatus = document.getElementById("fullCatalogStatus");

  fullCatalogBtn.addEventListener("click", async () => {
    fullCatalogBtn.disabled = true;
    fullCatalogStatus.className = "status";
    fullCatalogStatus.textContent = "Building full catalog…";
    try {
      const res = await fetch(`${API}/export-catalog`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nmr-spec-catalog-${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      fullCatalogStatus.className = "status success";
      fullCatalogStatus.textContent = "Download started.";
    } catch (err) {
      fullCatalogStatus.className = "status error";
      fullCatalogStatus.textContent = err.message || "Something went wrong.";
    } finally {
      fullCatalogBtn.disabled = false;
    }
  });

  // ---- List / edit / delete ----
  const itemRows = document.getElementById("itemRows");
  const itemCount = document.getElementById("itemCount");
  let currentItems = [];
  let editingId = null;
  const openCategories = new Set();
  const seenCategories = new Set();

  // Capture phase catches the non-bubbling "toggle" event from <details> regardless of browser support for bubbling.
  itemRows.addEventListener(
    "toggle",
    (e) => {
      const details = e.target;
      if (details.tagName !== "DETAILS") return;
      const cat = details.dataset.category;
      if (details.open) openCategories.add(cat);
      else openCategories.delete(cat);
    },
    true
  );

  function fmtSize(bytes) {
    if (!bytes) return "";
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
  }

  async function loadItems() {
    const res = await fetch(`${API}/admin-catalog`, { headers: { "x-admin-key": adminKey } });
    const data = await res.json();
    currentItems = (data.items || []).sort((a, b) => a.title.localeCompare(b.title));
    itemCount.textContent = currentItems.length;
    // Newly-seen categories default to open; previously toggled state is preserved across re-renders.
    currentItems.forEach((item) => {
      const cat = item.category || "Uncategorized";
      if (!seenCategories.has(cat)) {
        seenCategories.add(cat);
        openCategories.add(cat);
      }
    });
    renderRows();
  }

  function renderRows() {
    const groups = new Map();
    currentItems.forEach((item) => {
      const cat = item.category || "Uncategorized";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(item);
    });

    const sortedCats = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));

    itemRows.innerHTML = sortedCats
      .map((cat) => {
        const items = groups.get(cat);
        const isOpen = openCategories.has(cat);
        const rows = items
          .map((item) => {
            if (item.id === editingId) {
              return `
            <tr data-id="${item.id}">
              <td><input type="text" class="edit-title" value="${escapeHtml(item.title)}" /></td>
              <td><input type="text" class="edit-category" value="${escapeHtml(item.category || "")}" /></td>
              <td><input type="text" class="edit-tags" value="${escapeHtml((item.tags || []).join(", "))}" placeholder="tags, comma separated" /></td>
              <td>${fmtSize(item.sizeBytes)}</td>
              <td style="white-space:nowrap">
                <button class="btn primary small-btn" data-id="${item.id}" data-action="save">Save</button>
                <button class="btn ghost small-btn" data-id="${item.id}" data-action="cancel">Cancel</button>
              </td>
            </tr>
            <tr data-id="${item.id}">
              <td colspan="5" style="padding-top:0">
                <label style="margin:8px 0 4px">Replace PDF <span style="text-transform:none; color:var(--text-faint)">(optional — keeps the same link, just swaps the file)</span></label>
                <input type="file" class="edit-file" accept="application/pdf" />
              </td>
            </tr>`;
            }
            return `
          <tr data-id="${item.id}">
            <td>${escapeHtml(item.title)}</td>
            <td>${escapeHtml(item.category || "")}</td>
            <td>${(item.tags || []).map((t) => escapeHtml(t)).join(", ")}</td>
            <td>${fmtSize(item.sizeBytes)}</td>
            <td style="white-space:nowrap">
              <button class="btn ghost small-btn" data-id="${item.id}" data-action="edit">Edit</button>
              <button class="btn ghost small-btn" data-id="${item.id}" data-action="delete">Delete</button>
            </td>
          </tr>`;
          })
          .join("");

        return `
      <details class="category-group" data-category="${escapeHtml(cat)}" ${isOpen ? "open" : ""}>
        <summary><span>${escapeHtml(cat)}<span class="count-badge">${items.length}</span></span><span class="chevron">▶</span></summary>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Title</th><th>Category</th><th>Tags</th><th>Size</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </details>`;
      })
      .join("");
  }

  itemRows.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const { id } = btn.dataset;
    const action = btn.dataset.action;

    if (action === "edit") {
      editingId = id;
      renderRows();
      return;
    }

    if (action === "cancel") {
      editingId = null;
      renderRows();
      return;
    }

    if (action === "delete") {
      if (!confirm("Remove this spec sheet from the library?")) return;
      await fetch(`${API}/admin-catalog`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
        body: JSON.stringify({ id }),
      });
      loadItems();
      return;
    }

    if (action === "save") {
      const row = btn.closest("tr");
      const title = row.querySelector(".edit-title").value.trim();
      const category = row.querySelector(".edit-category").value.trim();
      const tags = row.querySelector(".edit-tags").value.split(",").map((t) => t.trim()).filter(Boolean);
      const fileInput = itemRows.querySelector(".edit-file");
      const replacementFile = fileInput?.files?.[0];

      if (!title) {
        alert("Title can't be empty.");
        return;
      }

      btn.disabled = true;
      try {
        const body = { id, title, category, tags };
        if (replacementFile) {
          body.fileBase64 = await fileToBase64(replacementFile);
          body.filename = replacementFile.name;
        }
        const res = await fetch(`${API}/admin-catalog`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Save failed");
        editingId = null;
        loadItems();
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    }
  });

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
})();
