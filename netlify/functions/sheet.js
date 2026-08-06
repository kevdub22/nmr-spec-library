import { getStore } from "@netlify/blobs";
import { PDFDocument } from "pdf-lib";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405, headers: CORS });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return new Response(JSON.stringify({ error: "id query param is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  const catalogStore = getStore({ name: "spec-catalog", consistency: "strong" });
  const filesStore = getStore("spec-files");
  const index = (await catalogStore.get("index.json", { type: "json" })) || [];
  const entry = index.find((item) => item.id === id);
  const bytes = entry && (await filesStore.get(id, { type: "arrayBuffer" }));

  if (!entry || !bytes) {
    return new Response(JSON.stringify({ error: "Spec sheet not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  // Browser tabs show a PDF's own /Title metadata for inline previews, not the
  // Content-Disposition filename or the URL — so stamp the catalog title onto it.
  const doc = await PDFDocument.load(bytes);
  doc.setTitle(entry.title);
  const outBytes = await doc.save();

  return new Response(outBytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      // inline (not attachment) so the link opens/previews in the browser rather than forcing a download.
      "Content-Disposition": `inline; filename="${entry.filename || `${entry.title}.pdf`}"`,
      ...CORS,
    },
  });
};
