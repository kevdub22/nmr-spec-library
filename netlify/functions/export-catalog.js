import { getStore } from "@netlify/blobs";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// Fallback only — real page size is detected per-request from the library itself,
// since vendor spec sheets vary and shouldn't be assumed to be Letter or A4.
const FALLBACK_PAGE_W = 612;
const FALLBACK_PAGE_H = 792;

// nmrevents.com brand palette (same tokens as public/css/style.css).
const TEAL = rgb(71 / 255, 178 / 255, 204 / 255);
const CYAN = rgb(159 / 255, 225 / 255, 241 / 255);
const WHITE = rgb(1, 1, 1);
const DIM = rgb(183 / 255, 194 / 255, 214 / 255);
const FAINT = rgb(111 / 255, 122 / 255, 148 / 255);

const ROWS_PER_TOC_PAGE = 20;

function norm(str) {
  return String(str || "").trim().toLowerCase();
}

// Mimics the site's .eyebrow treatment (uppercase, wide letter-spacing) since
// pdf-lib text has no letter-spacing property to set directly.
function tracked(text) {
  return text.toUpperCase().split("").join(" ");
}

// Instrument Sans' "fi"/"fl"/"ff" ligatures come out with broken advance widths through
// pdf-lib's embedding (e.g. "Specification" renders with a stray gap), so every piece of
// text is drawn in runs split around those pairs — that keeps the shaper from ever seeing
// the letters adjacent in one call, which is what triggers the ligature substitution.
const LIGATURE_SPLIT = /(?<=f)(?=[fil])/g;

function measureText(font, text, size) {
  return text.split(LIGATURE_SPLIT).reduce((w, part) => w + font.widthOfTextAtSize(part, size), 0);
}

function drawText(page, text, x, y, font, size, color) {
  let cursor = x;
  for (const part of text.split(LIGATURE_SPLIT)) {
    page.drawText(part, { x: cursor, y, size, font, color });
    cursor += font.widthOfTextAtSize(part, size);
  }
}

function centerText(page, text, y, font, size, color, pageWidth) {
  const width = measureText(font, text, size);
  drawText(page, text, (pageWidth - width) / 2, y, font, size, color);
}

// Shrinks the font size until the text fits maxWidth, so long category names don't overrun the page.
function centerFitText(page, text, y, font, size, color, maxWidth, pageWidth) {
  let fitSize = size;
  while (fitSize > 20 && measureText(font, text, fitSize) > maxWidth) {
    fitSize -= 2;
  }
  centerText(page, text, y, font, fitSize, color, pageWidth);
}

function truncate(text, font, size, maxWidth) {
  if (measureText(font, text, size) <= maxWidth) return text;
  let clipped = text;
  while (clipped.length > 1 && measureText(font, clipped + "…", size) > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return clipped + "…";
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405, headers: CORS });

  try {
    const catalogStore = getStore({ name: "spec-catalog", consistency: "strong" });
    const filesStore = getStore("spec-files");
    const index = (await catalogStore.get("index.json", { type: "json" })) || [];

    if (index.length === 0) {
      return new Response(JSON.stringify({ error: "The library is empty" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    // Load every source PDF once, grouped by category, so real page counts are
    // known before laying out the TOC, and the same parsed docs get reused to copy pages.
    const groups = new Map();
    for (const item of [...index].sort((a, b) => a.title.localeCompare(b.title))) {
      const bytes = await filesStore.get(item.id, { type: "arrayBuffer" });
      if (!bytes) continue;
      const doc = await PDFDocument.load(bytes);
      const key = norm(item.category) || "uncategorized";
      const label = item.category?.trim() || "Uncategorized";
      if (!groups.has(key)) groups.set(key, { label, entries: [] });
      groups.get(key).entries.push({ title: item.title, doc, pageCount: doc.getPageCount() });
    }

    const categories = [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
    const totalSheets = categories.reduce((n, c) => n + c.entries.length, 0);
    const totalPages = categories.reduce((n, c) => n + c.entries.reduce((m, e) => m + e.pageCount, 0), 0);

    if (totalSheets === 0) {
      return new Response(JSON.stringify({ error: "No spec sheets could be loaded" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    // ---- Detect the real page size from the library itself (vendor sheets vary in
    // size — Letter, A4, custom template exports — so use whichever size is most common
    // rather than assuming one, otherwise the generated pages won't match the sheets). ----
    const sizeCounts = new Map();
    for (const cat of categories) {
      for (const entry of cat.entries) {
        const { width, height } = entry.doc.getPage(0).getSize();
        const key = `${Math.round(width)}x${Math.round(height)}`;
        sizeCounts.set(key, (sizeCounts.get(key) || 0) + 1);
      }
    }
    let PAGE_W = FALLBACK_PAGE_W;
    let PAGE_H = FALLBACK_PAGE_H;
    let bestCount = 0;
    for (const [key, count] of sizeCounts) {
      if (count > bestCount) {
        bestCount = count;
        const [w, h] = key.split("x").map(Number);
        PAGE_W = w;
        PAGE_H = h;
      }
    }

    // ---- Precompute page numbers so the TOC and the actual divider pages agree ----
    const tocPageCount = Math.max(1, Math.ceil(categories.length / ROWS_PER_TOC_PAGE));
    let cursor = 1 + tocPageCount; // cover + TOC pages
    const tocRows = categories.map((cat) => {
      const startPage = cursor + 1; // the divider page for this section
      cursor += 1 + cat.entries.reduce((m, e) => m + e.pageCount, 0);
      return { label: cat.label, count: cat.entries.length, startPage };
    });
    const grandTotalPages = cursor;

    // ---- Build the merged PDF ----
    const merged = await PDFDocument.create();
    merged.registerFontkit(fontkit);

    const assetPath = (name) => join(process.cwd(), "public/assets", name);
    const bold = await merged.embedFont(readFileSync(assetPath("fonts/InstrumentSans-Bold.ttf")));
    const semibold = await merged.embedFont(readFileSync(assetPath("fonts/InstrumentSans-SemiBold.ttf")));
    const medium = await merged.embedFont(readFileSync(assetPath("fonts/InstrumentSans-Medium.ttf")));

    const bgImage = await merged.embedPng(readFileSync(assetPath("background.png")));
    const logoImage = await merged.embedPng(readFileSync(assetPath("nmr-stacked.png")));
    const logoWidth = 136;
    const logoHeight = logoWidth / (logoImage.width / logoImage.height);

    // The source art's own aspect ratio rarely matches the detected page size exactly,
    // so scale it to cover the page like CSS `background-size: cover` rather than stretching it.
    const coverScale = Math.max(PAGE_W / bgImage.width, PAGE_H / bgImage.height);
    const bgDrawWidth = bgImage.width * coverScale;
    const bgDrawHeight = bgImage.height * coverScale;
    const bgX = (PAGE_W - bgDrawWidth) / 2;
    const bgY = (PAGE_H - bgDrawHeight) / 2;

    function drawBackground(page) {
      page.drawImage(bgImage, { x: bgX, y: bgY, width: bgDrawWidth, height: bgDrawHeight });
    }

    let pageNum = 0;
    function footer(page) {
      const text = `${pageNum} / ${grandTotalPages}`;
      const width = measureText(medium, text, 9);
      drawText(page, text, PAGE_W - 60 - width, 28, medium, 9, FAINT);
    }

    // ---- Cover page ----
    const cover = merged.addPage([PAGE_W, PAGE_H]);
    pageNum++;
    drawBackground(cover);

    cover.drawImage(logoImage, { x: (PAGE_W - logoWidth) / 2, y: PAGE_H * 0.6, width: logoWidth, height: logoHeight });
    centerFitText(cover, "SPECIFICATION CATALOG", PAGE_H * 0.51, bold, 44, WHITE, PAGE_W - 80, PAGE_W);

    const ruleWidth = 110;
    cover.drawLine({
      start: { x: (PAGE_W - ruleWidth) / 2, y: PAGE_H * 0.465 },
      end: { x: (PAGE_W + ruleWidth) / 2, y: PAGE_H * 0.465 },
      thickness: 1,
      color: TEAL,
      opacity: 0.7,
    });

    const generatedDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    centerText(cover, `${categories.length} categories  ·  ${totalSheets} spec sheets  ·  ${totalPages} pages`, PAGE_H * 0.43, medium, 13, DIM, PAGE_W);
    centerText(cover, `Generated ${generatedDate}`, PAGE_H * 0.4, medium, 11, FAINT, PAGE_W);

    // ---- Table of contents ----
    for (let p = 0; p < tocPageCount; p++) {
      const page = merged.addPage([PAGE_W, PAGE_H]);
      pageNum++;
      drawBackground(page);

      const heading = p === 0 ? "Contents" : "Contents (cont'd)";
      drawText(page, heading, 60, PAGE_H - 80, bold, 24, WHITE);
      page.drawLine({ start: { x: 60, y: PAGE_H - 96 }, end: { x: PAGE_W - 60, y: PAGE_H - 96 }, thickness: 1, color: TEAL, opacity: 0.6 });

      const rows = tocRows.slice(p * ROWS_PER_TOC_PAGE, (p + 1) * ROWS_PER_TOC_PAGE);
      let y = PAGE_H - 130;
      const rowHeight = 30;
      rows.forEach((row) => {
        const label = truncate(row.label, semibold, 13, 300);
        drawText(page, label, 60, y, semibold, 13, WHITE);
        const countText = `${row.count} sheet${row.count === 1 ? "" : "s"}`;
        drawText(page, countText, 380, y, medium, 10.5, DIM);
        const pageText = String(row.startPage);
        const pageTextWidth = measureText(semibold, pageText, 11);
        drawText(page, pageText, PAGE_W - 60 - pageTextWidth, y, semibold, 11, TEAL);
        page.drawLine({
          start: { x: 60, y: y - 10 },
          end: { x: PAGE_W - 60, y: y - 10 },
          thickness: 0.5,
          color: WHITE,
          opacity: 0.12,
        });
        y -= rowHeight;
      });

      footer(page);
    }

    // ---- Sections: divider page + the sheets themselves ----
    for (const cat of categories) {
      const divider = merged.addPage([PAGE_W, PAGE_H]);
      pageNum++;
      drawBackground(divider);

      const dividerLogoWidth = 70;
      const dividerLogoHeight = dividerLogoWidth / (logoImage.width / logoImage.height);
      divider.drawImage(logoImage, { x: 40, y: 30, width: dividerLogoWidth, height: dividerLogoHeight });

      centerText(divider, tracked("Section"), PAGE_H * 0.66, bold, 13, TEAL, PAGE_W);
      centerFitText(divider, cat.label.toUpperCase(), PAGE_H * 0.585, bold, 44, WHITE, PAGE_W - 80, PAGE_W);
      const sectionPages = cat.entries.reduce((m, e) => m + e.pageCount, 0);
      centerText(
        divider,
        `${cat.entries.length} spec sheet${cat.entries.length === 1 ? "" : "s"}  ·  ${sectionPages} pages`,
        PAGE_H * 0.535,
        medium,
        14,
        DIM,
        PAGE_W
      );
      footer(divider);

      for (const entry of cat.entries) {
        const pages = await merged.copyPages(entry.doc, entry.doc.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
        pageNum += pages.length;
      }
    }

    const outBytes = await merged.save();

    return new Response(outBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="nmr-spec-catalog-${Date.now()}.pdf"`,
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
