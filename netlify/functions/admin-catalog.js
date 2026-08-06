import { getStore } from "@netlify/blobs";
import { PDFDocument } from "pdf-lib";
import { randomUUID } from "node:crypto";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-key",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

function checkAuth(req) {
  const key = req.headers.get("x-admin-key");
  return key && key === process.env.ADMIN_PASSWORD;
}

async function readIndex(store) {
  return (await store.get("index.json", { type: "json" })) || [];
}

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (!checkAuth(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  const catalogStore = getStore({ name: "spec-catalog", consistency: "strong" });
  const filesStore = getStore("spec-files");

  try {
    if (req.method === "GET") {
      const index = await readIndex(catalogStore);
      return new Response(JSON.stringify({ items: index }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const { title, category, tags, filename, fileBase64 } = body;

      if (!title || !fileBase64) {
        return new Response(JSON.stringify({ error: "title and fileBase64 are required" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS },
        });
      }

      const bytes = Buffer.from(fileBase64, "base64");

      // Validate it's a real PDF and grab page count.
      let pageCount = null;
      try {
        const pdf = await PDFDocument.load(bytes);
        pageCount = pdf.getPageCount();
      } catch {
        return new Response(JSON.stringify({ error: "File does not appear to be a valid PDF" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS },
        });
      }

      const id = randomUUID();
      await filesStore.set(id, bytes);

      const index = await readIndex(catalogStore);
      index.push({
        id,
        title,
        category: category || "Uncategorized",
        tags: Array.isArray(tags) ? tags : [],
        filename: filename || `${title}.pdf`,
        sizeBytes: bytes.length,
        pageCount,
        uploadedAt: new Date().toISOString(),
      });
      await catalogStore.setJSON("index.json", index);

      return new Response(JSON.stringify({ ok: true, id }), {
        status: 201,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    if (req.method === "PUT") {
      const body = await req.json();
      const { id, title, category, tags, filename, fileBase64 } = body;
      if (!id) {
        return new Response(JSON.stringify({ error: "id is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS },
        });
      }
      const index = await readIndex(catalogStore);
      const entry = index.find((item) => item.id === id);
      if (!entry) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json", ...CORS },
        });
      }
      if (title !== undefined) entry.title = title;
      if (category !== undefined) entry.category = category;
      if (tags !== undefined) entry.tags = tags;

      // Replacing the PDF overwrites the blob at the same id, so every existing
      // link (preview, cart export, full catalog) keeps pointing at the same URL.
      if (fileBase64) {
        const bytes = Buffer.from(fileBase64, "base64");
        let pageCount = null;
        try {
          const pdf = await PDFDocument.load(bytes);
          pageCount = pdf.getPageCount();
        } catch {
          return new Response(JSON.stringify({ error: "File does not appear to be a valid PDF" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        }
        await filesStore.set(id, bytes);
        entry.sizeBytes = bytes.length;
        entry.pageCount = pageCount;
        if (filename) entry.filename = filename;
        entry.updatedAt = new Date().toISOString();
      }

      await catalogStore.setJSON("index.json", index);

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    if (req.method === "DELETE") {
      const body = await req.json();
      const { id } = body;
      if (!id) {
        return new Response(JSON.stringify({ error: "id is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS },
        });
      }
      const index = await readIndex(catalogStore);
      const next = index.filter((item) => item.id !== id);
      await catalogStore.setJSON("index.json", next);
      await filesStore.delete(id);

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    return new Response("Method not allowed", { status: 405, headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }
};
