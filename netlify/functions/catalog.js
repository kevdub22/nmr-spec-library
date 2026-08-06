import { getStore } from "@netlify/blobs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-key",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: CORS });
  }

  const store = getStore({ name: "spec-catalog", consistency: "strong" });
  const index = (await store.get("index.json", { type: "json" })) || [];

  // Only expose public-facing fields, sorted alphabetically by title.
  const items = index
    .map(({ id, title, category, tags, pageCount, sizeBytes, uploadedAt }) => ({
      id,
      title,
      category,
      tags,
      pageCount,
      sizeBytes,
      uploadedAt,
    }))
    .sort((a, b) => a.title.localeCompare(b.title));

  return new Response(JSON.stringify({ items }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...CORS },
  });
};
