import { getStore } from "@netlify/blobs";
import { PDFDocument } from "pdf-lib";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS });
  }

  try {
    const { ids } = await req.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return new Response(JSON.stringify({ error: "ids array is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    const catalogStore = getStore({ name: "spec-catalog", consistency: "strong" });
    const filesStore = getStore("spec-files");
    const index = (await catalogStore.get("index.json", { type: "json" })) || [];
    const byId = new Map(index.map((item) => [item.id, item]));

    const merged = await PDFDocument.create();

    // Preserve the order the client sent (their cart order).
    for (const id of ids) {
      const entry = byId.get(id);
      if (!entry) continue; // skip unknown/removed items rather than failing the whole export
      const bytes = await filesStore.get(id, { type: "arrayBuffer" });
      if (!bytes) continue;
      const src = await PDFDocument.load(bytes);
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    }

    if (merged.getPageCount() === 0) {
      return new Response(JSON.stringify({ error: "None of the requested sheets could be found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    const outBytes = await merged.save();

    return new Response(outBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="spec-sheets-${Date.now()}.pdf"`,
        ...CORS,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }
};
