(() => {
  const API = "/.netlify/functions";
  const state = {
    items: [],
    filtered: [],
    query: "",
    category: "ALL",
    tags: new Set(), // selected tags — item must have all of these to match
    view: localStorage.getItem("specView") === "list" ? "list" : "grid",
    cart: JSON.parse(sessionStorage.getItem("specCart") || "[]"), // array of ids, in add order
  };

  const grid = document.getElementById("grid");
  const searchInput = document.getElementById("searchInput");
  const categoryChips = document.getElementById("categoryChips");
  const tagChips = document.getElementById("tagChips");
  const viewGridBtn = document.getElementById("viewGridBtn");
  const viewListBtn = document.getElementById("viewListBtn");
  const cartCountEl = document.getElementById("cartCount");
  const cartToggle = document.getElementById("cartToggle");
  const manifest = document.getElementById("manifest");
  const manifestOverlay = document.getElementById("manifestOverlay");
  const manifestClose = document.getElementById("manifestClose");
  const manifestList = document.getElementById("manifestList");
  const totalSheets = document.getElementById("totalSheets");
  const totalPages = document.getElementById("totalPages");
  const exportBtn = document.getElementById("exportBtn");
  const exportStatus = document.getElementById("exportStatus");
  const fullCatalogBtn = document.getElementById("fullCatalogBtn");
  const fullCatalogStatus = document.getElementById("fullCatalogStatus");

  function saveCart() {
    sessionStorage.setItem("specCart", JSON.stringify(state.cart));
  }

  // Category/tag text is free-typed in the admin form, so "Computers" and "computers"
  // (or trailing whitespace) are common near-duplicates — compare on this normalized form
  // rather than the raw string so those variants are treated as the same value.
  function norm(str) {
    return str.trim().toLowerCase();
  }

  function setView(view) {
    state.view = view;
    localStorage.setItem("specView", view);
    grid.classList.toggle("list-view", view === "list");
    viewGridBtn.setAttribute("aria-pressed", String(view === "grid"));
    viewListBtn.setAttribute("aria-pressed", String(view === "list"));
  }
  viewGridBtn.addEventListener("click", () => setView("grid"));
  viewListBtn.addEventListener("click", () => setView("list"));
  setView(state.view);

  async function loadCatalog() {
    try {
      const res = await fetch(`${API}/catalog`);
      const data = await res.json();
      state.items = data.items || [];
      renderCategoryChips();
      renderTagChips();
      applyFilters();
    } catch (err) {
      grid.innerHTML = `<p class="empty-state">Couldn't load the spec sheet library. Try refreshing.</p>`;
    }
  }

  // Dedupe by normalized value but display the first-seen casing/spacing as the label.
  function uniqueByNorm(values) {
    const byKey = new Map();
    values.forEach((v) => {
      const key = norm(v);
      if (!byKey.has(key)) byKey.set(key, v);
    });
    return byKey;
  }

  function renderCategoryChips() {
    const byKey = uniqueByNorm(state.items.map((i) => i.category).filter(Boolean));
    const counts = new Map();
    state.items.forEach((i) => {
      if (!i.category) return;
      const key = norm(i.category);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    // Most-populated category first; ties broken alphabetically for a stable order.
    const sortedKeys = [...byKey.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b));

    categoryChips.innerHTML = "";
    const allBtn = document.createElement("button");
    allBtn.className = "chip";
    allBtn.textContent = "ALL";
    allBtn.setAttribute("aria-pressed", String(state.category === "ALL"));
    allBtn.addEventListener("click", () => {
      state.category = "ALL";
      renderCategoryChips();
      applyFilters();
    });
    categoryChips.appendChild(allBtn);

    sortedKeys.forEach((key) => {
      const label = byKey.get(key);
      const btn = document.createElement("button");
      btn.className = "chip";
      btn.textContent = label;
      btn.setAttribute("aria-pressed", String(key === state.category));
      btn.addEventListener("click", () => {
        state.category = key;
        renderCategoryChips();
        applyFilters();
      });
      categoryChips.appendChild(btn);
    });
  }

  function renderTagChips() {
    const byKey = uniqueByNorm(state.items.flatMap((i) => i.tags || []));
    const sortedKeys = [...byKey.keys()].sort((a, b) => a.localeCompare(b));
    tagChips.innerHTML = "";
    sortedKeys.forEach((key) => {
      const label = byKey.get(key);
      const btn = document.createElement("button");
      btn.className = "chip";
      btn.textContent = label;
      btn.setAttribute("aria-pressed", String(state.tags.has(key)));
      btn.addEventListener("click", () => {
        if (state.tags.has(key)) {
          state.tags.delete(key);
        } else {
          state.tags.add(key);
        }
        renderTagChips();
        applyFilters();
      });
      tagChips.appendChild(btn);
    });
  }

  function applyFilters() {
    const q = state.query.trim().toLowerCase();
    state.filtered = state.items.filter((item) => {
      const matchesCategory = state.category === "ALL" || (item.category && norm(item.category) === state.category);
      const itemTagKeys = (item.tags || []).map(norm);
      const matchesTags = state.tags.size === 0 || [...state.tags].every((key) => itemTagKeys.includes(key));
      const haystack = [item.title, item.category, ...(item.tags || [])].join(" ").toLowerCase();
      const matchesQuery = !q || haystack.includes(q);
      return matchesCategory && matchesTags && matchesQuery;
    });
    renderGrid();
  }

  function renderGrid() {
    if (state.filtered.length === 0) {
      const message =
        state.items.length === 0
          ? "The library is empty. Ask your team to add spec sheets from the admin page."
          : "No spec sheets match your search.";
      grid.innerHTML = `<p class="empty-state">${message}</p>`;
      return;
    }
    grid.innerHTML = "";
    state.filtered.forEach((item) => {
      const inCart = state.cart.includes(item.id);
      const card = document.createElement("article");
      card.className = "card" + (inCart ? " in-cart" : "");
      card.innerHTML = `
        <div class="card-info">
          <div class="card-eyebrow"><span>${escapeHtml(item.category || "")}</span></div>
          <h3 class="card-title">${escapeHtml(item.title)}</h3>
          <div class="card-tags">${(item.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
        </div>
        <div class="card-actions">
          <a class="btn ghost" href="${API}/sheet?id=${encodeURIComponent(item.id)}" target="_blank" rel="noopener">Preview</a>
          <button class="btn ${inCart ? "added" : "primary"}" data-action="toggle" data-id="${item.id}">${inCart ? "Added ✓" : "Add to Cart"}</button>
        </div>
      `;
      grid.appendChild(card);
    });
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  grid.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "toggle") {
      toggleCart(btn.dataset.id);
    }
  });

  function toggleCart(id) {
    const idx = state.cart.indexOf(id);
    if (idx === -1) {
      state.cart.push(id);
    } else {
      state.cart.splice(idx, 1);
    }
    saveCart();
    renderGrid();
    renderManifest();
  }

  function renderManifest() {
    cartCountEl.textContent = state.cart.length;
    exportBtn.disabled = state.cart.length === 0;

    if (state.cart.length === 0) {
      manifestList.innerHTML = `<p class="manifest-empty">No spec sheets added yet. Browse the library and add sheets to build your export.</p>`;
      totalSheets.textContent = "0";
      totalPages.textContent = "0";
      return;
    }

    const byId = new Map(state.items.map((i) => [i.id, i]));
    let pages = 0;
    manifestList.innerHTML = state.cart
      .map((id, i) => {
        const item = byId.get(id);
        if (!item) return "";
        pages += item.pageCount || 0;
        return `
          <div class="manifest-item">
            <span class="num">${String(i + 1).padStart(2, "0")}</span>
            <div class="info">
              <div class="title">${escapeHtml(item.title)}</div>
              <div class="sub">${escapeHtml(item.category || "")} · ${item.pageCount || "?"} pg</div>
            </div>
            <button class="remove" data-id="${item.id}" aria-label="Remove ${escapeHtml(item.title)}">✕</button>
          </div>
        `;
      })
      .join("");
    totalSheets.textContent = state.cart.length;
    totalPages.textContent = pages;
  }

  manifestList.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-id]");
    if (btn) toggleCart(btn.dataset.id);
  });

  function openManifest() {
    manifest.classList.add("open");
    manifestOverlay.classList.add("open");
    manifest.setAttribute("aria-hidden", "false");
  }
  function closeManifest() {
    manifest.classList.remove("open");
    manifestOverlay.classList.remove("open");
  }
  cartToggle.addEventListener("click", openManifest);
  manifestClose.addEventListener("click", closeManifest);
  manifestOverlay.addEventListener("click", closeManifest);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeManifest();
  });

  exportBtn.addEventListener("click", async () => {
    exportBtn.disabled = true;
    exportStatus.className = "export-status";
    exportStatus.textContent = "Building combined PDF…";
    try {
      const res = await fetch(`${API}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: state.cart }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `spec-sheets-${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      exportStatus.className = "export-status success";
      exportStatus.textContent = "Download started.";

      state.cart = [];
      saveCart();
      renderGrid();
      renderManifest();
    } catch (err) {
      exportStatus.className = "export-status error";
      exportStatus.textContent = err.message || "Something went wrong.";
    } finally {
      exportBtn.disabled = state.cart.length === 0;
    }
  });

  fullCatalogBtn.addEventListener("click", async () => {
    fullCatalogBtn.disabled = true;
    fullCatalogStatus.className = "export-status";
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
      fullCatalogStatus.className = "export-status success";
      fullCatalogStatus.textContent = "Download started.";
    } catch (err) {
      fullCatalogStatus.className = "export-status error";
      fullCatalogStatus.textContent = err.message || "Something went wrong.";
    } finally {
      fullCatalogBtn.disabled = false;
    }
  });

  searchInput.addEventListener("input", (e) => {
    state.query = e.target.value;
    applyFilters();
  });

  loadCatalog().then(renderManifest);
})();
