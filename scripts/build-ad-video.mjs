import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const outDir = path.join(root, "artifacts", "ventra-ad-video");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const W = 1920;
const H = 1080;
const FONT = "DejaVu Sans";

const esc = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const text = (x, y, value, size, fill = "#f5f6f1", weight = 400, anchor = "start", extra = "") => `<text x="${x}" y="${y}" fill="${fill}" font-family="${FONT}" font-size="${size}px" font-weight="${weight}" text-anchor="${anchor}" ${extra}>${esc(value)}</text>`;
const rect = (x, y, w, h, fill, r = 0, stroke = "none", sw = 0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
const line = (x1, y1, x2, y2, stroke, sw = 2, dash = "") => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}" ${dash ? `stroke-dasharray="${dash}"` : ""}/>`;
const pill = (x, y, label, color = "#ffd400", bg = "#2c2a14") => `${rect(x, y, label.length * 9 + 36, 34, bg, 17, color, 1)}${text(x + 18, y + 23, label, 14, color, 700)}`;
const brand = () => `${rect(86, 62, 58, 58, "#ffd400", 16)}${text(115, 103, "V", 31, "#10120f", 900, "middle")}${text(162, 92, "VENTRA", 25, "#f5f6f1", 800)}${text(163, 116, "AI CONSTRUCTION INTELLIGENCE", 10, "#89938a", 700)}`;
const bg = () => `${rect(0, 0, W, H, "#080b09")}${rect(0, 0, W, 10, "#ffd400")}${rect(0, 10, W, 1070, "url(#bg)")}`;
const defs = `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#111713"/><stop offset=".58" stop-color="#070a08"/><stop offset="1" stop-color="#171a16"/></linearGradient><linearGradient id="gold" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#ffd400"/><stop offset="1" stop-color="#ffef9a"/></linearGradient><filter id="glow"><feGaussianBlur stdDeviation="15" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;

function shell(content, scene) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs}${bg()}${brand()}${text(1774, 91, `DEMO / ${String(scene).padStart(2, "0")}`, 13, "#768178", 700, "end", `letter-spacing="3"`)}${content}${text(86, 1012, "SAMPLE WORKSPACE · FOR DEMONSTRATION", 12, "#667269", 700, "start", `letter-spacing="2"`)}${text(1834, 1012, "VENTRA", 12, "#667269", 700, "end", `letter-spacing="2"`)}${line(86, 974, 1834, 974, "#2a302c", 1)}</svg>`;
}

function scene1() {
  return shell(`<g>${text(86, 285, "THE CONSTRUCTION WORKFLOW", 18, "#ffd400", 800, "start", `letter-spacing="4"`)}${text(86, 390, "One intelligent workspace", 86, "#f5f6f1", 800)}${text(86, 485, "for every project decision.", 86, "#f5f6f1", 800)}${text(86, 570, "From the first drawing to the final payment, Ventra connects", 25, "#a3ada4", 400)}${text(86, 612, "design, cost, programme and site evidence in one command center.", 25, "#a3ada4", 400)}${pill(86, 696, "AI-POWERED PROJECT CONTROL")}${rect(1170, 220, 560, 520, "#141a16", 28, "#39433b", 2)}${rect(1210, 260, 480, 54, "#202921", 13)}${text(1240, 294, "AL NOOR VILLA RENOVATION", 14, "#ccd4cb", 700)}${text(1640, 294, "LIVE", 13, "#8ef29e", 800, "end")}${text(1240, 392, "PROJECT HEALTH", 14, "#718076", 700, "start", `letter-spacing="3"`)}${text(1240, 490, "92", 110, "#ffd400", 800)}${text(1380, 490, "/ 100", 34, "#7f8a80", 500)}${line(1240, 550, 1640, 550, "#303c33", 7)}${line(1240, 550, 1610, 550, "#8ef29e", 7)}${text(1240, 620, "Budget", 15, "#7f8a80", 500)}${text(1425, 620, "AED 1.24M", 18, "#f5f6f1", 700)}${text(1240, 670, "Verified progress", 15, "#7f8a80", 500)}${text(1425, 670, "46%", 18, "#f5f6f1", 700)}${text(1240, 720, "Open actions", 15, "#7f8a80", 500)}${text(1425, 720, "04", 18, "#f5f6f1", 700)}</g>`, 1);
}

function planCard(x, y, w, h) {
  const sx = x + 28; const sy = y + 34; const iw = w - 56; const ih = h - 68;
  return `${rect(x, y, w, h, "#151c18", 22, "#354039", 2)}${text(x + 28, y + 27, "SOURCE DRAWING / FLOOR PLAN", 12, "#89978c", 700, "start", `letter-spacing="2"`)}${rect(sx, sy, iw, ih, "#dfe6db", 8)}${rect(sx + 42, sy + 35, iw - 84, 9, "#343c36", 2)}${rect(sx + 42, sy + 35, 9, ih - 70, "#343c36", 2)}${rect(sx + iw - 51, sy + 35, 9, ih - 70, "#343c36", 2)}${rect(sx + 42, sy + ih - 44, iw - 84, 9, "#343c36", 2)}${rect(sx + 65, sy + 55, 150, 145, "#c5d8c4", 3)}${rect(sx + 225, sy + 55, 175, 205, "#f3e9b7", 3)}${rect(sx + 412, sy + 55, 130, 145, "#c5d8c4", 3)}${rect(sx + 225, sy + 275, 175, 78, "#e2bf97", 3)}${text(sx + 104, sy + 132, "BED 01", 12, "#425047", 800, "middle")}${text(sx + 312, sy + 166, "LIVING", 12, "#425047", 800, "middle")}${text(sx + 477, sy + 132, "BED 02", 12, "#425047", 800, "middle")}${text(sx + 312, sy + 320, "KITCHEN", 12, "#425047", 800, "middle")}${rect(sx + 95, sy + 35, 70, 7, "#82b8c3")}${rect(sx + 273, sy + 35, 70, 7, "#82b8c3")}${rect(sx + 450, sy + 35, 60, 7, "#82b8c3")}${rect(x + w - 150, y + h - 58, 108, 28, "#2c2a14", 14, "#ffd400", 1)}${text(x + w - 96, y + h - 39, "AI TRACE", 11, "#ffd400", 800, "middle")}`;
}

function scene2() {
  return shell(`${text(86, 250, "01 / DRAWING INTELLIGENCE", 18, "#ffd400", 800, "start", `letter-spacing="4"`)}${text(86, 344, "Upload once. Understand instantly.", 58, "#f5f6f1", 800)}${text(86, 414, "JPG, PDF or DWG drawings become structured project data.", 23, "#9da99f", 400)}${text(86, 520, "Ventra detects rooms, walls, doors, windows, dimensions and", 22, "#cbd1ca", 500)}${text(86, 555, "measurable areas—while keeping every result linked to its source.", 22, "#cbd1ca", 500)}${rect(86, 650, 580, 104, "#151c18", 18, "#3c4a40", 2)}${rect(112, 678, 50, 50, "#ffd400", 11)}${text(137, 712, "↑", 30, "#111511", 900, "middle")}${text(188, 694, "2-bedroom-apartment.dwg", 17, "#f5f6f1", 700)}${text(188, 724, "12.4 MB · source drawing verified", 13, "#849187", 400)}${pill(86, 812, "7 ROOMS  ·  28 WALLS  ·  9 OPENINGS", "#8ef29e", "#17271c")}${planCard(1010, 175, 660, 610)}`, 2);
}

function scene3() {
  return shell(`${text(86, 250, "02 / DESIGN + 3D", 18, "#ffd400", 800, "start", `letter-spacing="4"`)}${text(86, 344, "See the space before you build it.", 58, "#f5f6f1", 800)}${text(86, 414, "A source-aligned interactive 3D model for design review and client confidence.", 23, "#9da99f", 400)}${text(86, 532, "Navigate rooms. Inspect openings. Compare finishes.", 23, "#cbd1ca", 600)}${text(86, 575, "Keep the geometry honest while making the presentation feel real.", 23, "#cbd1ca", 600)}${pill(86, 700, "ROOMS  /  FURNITURE  /  FINISHES")}${rect(960, 165, 730, 615, "#101612", 24, "#344239", 2)}${rect(1030, 285, 560, 320, "#e8e2d6", 8, "#4a554e", 8)}${rect(1062, 320, 140, 220, "#c7b38d", 3)}${rect(1202, 320, 220, 220, "#e8e3d9", 3)}${rect(1422, 320, 165, 220, "#c7b38d", 3)}${rect(1260, 373, 120, 35, "#d4cec4", 7)}${rect(1300, 452, 83, 45, "#b58d62", 4)}${rect(1090, 375, 95, 110, "#eae8df", 4, "#a78b66", 5)}${rect(1460, 375, 95, 110, "#eae8df", 4, "#a78b66", 5)}${text(1075, 260, "INTERACTIVE 3D PREVIEW", 13, "#89978c", 800, "start", `letter-spacing="2"`)}${pill(1030, 665, "ORBIT", "#ffd400", "#2c2a14")}${pill(1154, 665, "MEASURE", "#8ef29e", "#17271c")}${pill(1300, 665, "LAYERS", "#b7c4ff", "#1e2437")}`, 3);
}

function scene4() {
  const rows = [["Concrete & rebar", "184 m³", "AED 214,880", "92%"], ["Blockwork & plaster", "1,240 m²", "AED 148,800", "61%"], ["Electrical first fix", "168 pts", "AED 57,120", "38%"], ["Flooring & joinery", "710 m²", "AED 192,940", "24%"]];
  let table = `${rect(870, 170, 860, 650, "#151c18", 24, "#354039", 2)}${text(914, 224, "LIVE BOQ / SAMPLE DATA", 14, "#89978c", 800, "start", `letter-spacing="2"`)}${pill(1518, 192, "EDITABLE", "#ffd400", "#2c2a14")}${text(914, 280, "Scope item", 12, "#758178", 700)}${text(1270, 280, "Quantity", 12, "#758178", 700)}${text(1430, 280, "Value", 12, "#758178", 700)}${text(1636, 280, "Progress", 12, "#758178", 700)}`;
  rows.forEach((row, i) => { const y = 340 + i * 104; table += `${line(914, y - 37, 1680, y - 37, "#2d372f", 1)}${text(914, y, row[0], 17, "#f5f6f1", 700)}${text(914, y + 26, i === 0 ? "Structural" : i === 1 ? "Envelope" : i === 2 ? "MEP" : "Finishes", 12, "#829087", 400)}${text(1270, y, row[1], 16, "#d6ddd5", 600)}${text(1430, y, row[2], 16, "#d6ddd5", 700)}${rect(1636, y - 11, 70, 7, "#27342a", 4)}${rect(1636, y - 11, Math.round(parseInt(row[3]) * .7), 7, i === 0 ? "#8ef29e" : "#ffd400", 4)}${text(1710, y - 5, row[3], 11, i === 0 ? "#8ef29e" : "#ffd400", 700)}`; });
  return shell(`${text(86, 250, "03 / BOQ + ESTIMATE", 18, "#ffd400", 800, "start", `letter-spacing="4"`)}${text(86, 344, "From geometry to cost certainty.", 58, "#f5f6f1", 800)}${text(86, 414, "Measured quantities, unit rates and scope status stay together.", 23, "#9da99f", 400)}${text(86, 532, "Review assumptions. Edit line items. Build a defensible estimate.", 23, "#cbd1ca", 600)}${text(86, 588, "No more spreadsheet archaeology.", 23, "#cbd1ca", 600)}${text(86, 735, "MEASURED SCOPE", 13, "#7d897f", 700, "start", `letter-spacing="2"`)}${text(86, 785, "AED 613,740", 42, "#ffd400", 800)}${text(86, 835, "48 line items · 3 approvals waiting", 14, "#829087", 400)}${table}`, 4);
}

function scene5() {
  return shell(`${text(86, 250, "04 / QUOTATION + CONTRACT", 18, "#ffd400", 800, "start", `letter-spacing="4"`)}${text(86, 344, "Turn scope into a signed next step.", 58, "#f5f6f1", 800)}${text(86, 414, "Generate a branded quotation and connect it to contract milestones.", 23, "#9da99f", 400)}${text(86, 532, "30% mobilisation", 22, "#cbd1ca", 600)}${text(86, 574, "10% structure · 20% MEP · 40% handover", 22, "#cbd1ca", 600)}${pill(86, 700, "BRANDED · EDITABLE · CLIENT READY")}${rect(1030, 150, 620, 670, "#f2efe7", 18)}${rect(1030, 150, 620, 14, "#ffd400")}${text(1090, 225, "VENTRA", 26, "#222821", 900, "start", `letter-spacing="4"`)}${text(1090, 250, "CONSTRUCTION INTELLIGENCE", 10, "#758178", 700, "start", `letter-spacing="2"`)}${text(1090, 325, "QUOTATION", 34, "#222821", 800)}${text(1090, 370, "AL NOOR VILLA RENOVATION", 15, "#69736a", 700)}${line(1090, 405, 1588, 405, "#c8c9c0", 1)}${text(1090, 456, "Contract value", 14, "#788278", 500)}${text(1588, 456, "AED 1,240,000", 18, "#222821", 800, "end")}${text(1090, 508, "Mobilisation", 14, "#788278", 500)}${text(1588, 508, "30%", 18, "#222821", 800, "end")}${text(1090, 560, "Structure milestone", 14, "#788278", 500)}${text(1588, 560, "10%", 18, "#222821", 800, "end")}${text(1090, 612, "MEP rough-in", 14, "#788278", 500)}${text(1588, 612, "20%", 18, "#222821", 800, "end")}${rect(1090, 680, 498, 62, "#222821", 9)}${text(1340, 718, "SEND FOR APPROVAL  →", 14, "#ffd400", 800, "middle")}`, 5);
}

function scene6() {
  const ys = [350, 445, 540, 635];
  const labels = [["Mobilisation & setting out", "100%", "#8ef29e"], ["Structure / concrete", "72%", "#ffd400"], ["MEP rough-in", "38%", "#ffd400"], ["Finishes & handover", "8%", "#849187"]];
  let chart = `${rect(830, 170, 900, 650, "#151c18", 24, "#354039", 2)}${text(875, 224, "MASTER PROGRAMME", 14, "#89978c", 800, "start", `letter-spacing="2"`)}${pill(1500, 192, "WEEK 08", "#b7c4ff", "#1e2437")}`;
  ys.forEach((y, i) => { chart += `${line(1170, y - 55, 1660, y - 55, "#2d372f", 1)}${text(875, y - 14, labels[i][0], 15, "#f5f6f1", 700)}${text(875, y + 12, i === 0 ? "May 07 — May 11" : i === 1 ? "May 12 — Jun 08" : i === 2 ? "Jun 09 — Jun 23" : "Jun 24 — Jul 18", 11, "#849187", 400)}${rect(1170, y - 25, 490, 14, "#27332b", 7)}${rect(1170, y - 25, i === 0 ? 490 : i === 1 ? 360 : i === 2 ? 190 : 38, 14, labels[i][2], 7)}${text(1680, y - 13, labels[i][1], 13, labels[i][2], 800)}`; });
  return shell(`${text(86, 250, "05 / SMART SCHEDULE", 18, "#ffd400", 800, "start", `letter-spacing="4"`)}${text(86, 344, "See the critical path before it becomes a delay.", 53, "#f5f6f1", 800)}${text(86, 414, "Baseline dates, actual updates and crew capacity in one timeline.", 23, "#9da99f", 400)}${rect(86, 560, 590, 120, "#2b2114", 18, "#8c682b", 2)}${text(124, 603, "⚠  1 RISK DETECTED", 16, "#ffd18e", 800)}${text(124, 638, "MEP rough-in is 3 days behind baseline.", 15, "#d8c6a4", 500)}${pill(86, 735, "ACTIONABLE ALERTS", "#ffd18e", "#2b2114")}${chart}`, 6);
}

function scene7() {
  return shell(`${text(86, 250, "06 / PROJECT PROGRESS", 18, "#ffd400", 800, "start", `letter-spacing="4"`)}${text(86, 344, "Field evidence becomes accountable progress.", 54, "#f5f6f1", 800)}${text(86, 414, "Upload dated site photos, verify activities and keep a review trail.", 23, "#9da99f", 400)}${text(86, 540, "Progress", 14, "#7f8b81", 700)}${text(86, 640, "46%", 110, "#ffd400", 800)}${text(270, 620, "verified overall progress", 18, "#d3dad2", 600)}${text(270, 652, "+6.2% this week · 2 approvals waiting", 13, "#8ef29e", 500)}${pill(86, 760, "PHOTO EVIDENCE · APPROVALS · AUDIT TRAIL", "#8ef29e", "#17271c")}${rect(900, 175, 780, 620, "#151c18", 24, "#354039", 2)}${text(950, 225, "LATEST SITE EVIDENCE", 14, "#89978c", 800, "start", `letter-spacing="2"`)}${pill(1492, 192, "VERIFIED", "#8ef29e", "#17271c")}${rect(950, 275, 335, 420, "#687b6e", 12)}${rect(1310, 275, 335, 198, "#7d8d98", 12)}${rect(1310, 495, 335, 200, "#ae906f", 12)}${rect(950, 602, 335, 93, "#303a31", 0)}${text(980, 650, "STRUCTURE", 14, "#fff", 800)}${text(1245, 650, "72%", 25, "#ffd400", 800, "end")}${text(1340, 444, "MEP ROUGH-IN", 12, "#fff", 800)}${text(1608, 444, "38%", 21, "#ffd400", 800, "end")}${text(1340, 666, "FINISHES", 12, "#fff", 800)}${text(1608, 666, "24%", 21, "#ffd400", 800, "end")}${text(950, 750, "Reviewed by site supervisor · 2h ago", 12, "#839087", 500)}`, 7);
}

function scene8() {
  return shell(`${text(86, 250, "07 / COMMAND CENTER", 18, "#ffd400", 800, "start", `letter-spacing="4"`)}${text(86, 344, "Every project decision. One clear view.", 58, "#f5f6f1", 800)}${text(86, 414, "Share a confident, branded report with owners, consultants and your team.", 23, "#9da99f", 400)}${text(86, 545, "DRAWINGS", 15, "#8b978d", 700)}${text(86, 590, "3D", 40, "#ffd400", 800)}${text(270, 545, "COST", 15, "#8b978d", 700)}${text(270, 590, "AED 1.24M", 32, "#ffd400", 800)}${text(570, 545, "PROGRESS", 15, "#8b978d", 700)}${text(570, 590, "46%", 40, "#ffd400", 800)}${pill(86, 730, "START YOUR PROJECT WITH VENTRA")}${rect(1090, 205, 500, 450, "#f2efe7", 18)}${text(1140, 270, "VENTRA", 23, "#222821", 900, "start", `letter-spacing="3"`)}${text(1140, 314, "EXECUTIVE PROJECT SNAPSHOT", 12, "#788278", 700, "start", `letter-spacing="2"`)}${line(1140, 350, 1540, 350, "#cacbc2", 1)}${text(1140, 400, "Project health", 13, "#788278", 500)}${text(1540, 400, "92 / 100", 18, "#222821", 800, "end")}${text(1140, 452, "Verified progress", 13, "#788278", 500)}${text(1540, 452, "46%", 18, "#222821", 800, "end")}${text(1140, 504, "Next decision", 13, "#788278", 500)}${text(1540, 504, "MEP approval", 18, "#222821", 800, "end")}${rect(1140, 555, 400, 52, "#222821", 9)}${text(1340, 588, "DOWNLOAD REPORT  →", 13, "#ffd400", 800, "middle")}${text(86, 900, "Design smarter. Estimate faster. Deliver with confidence.", 32, "#f5f6f1", 700)}${text(86, 942, "VENTRA — AI CONSTRUCTION INTELLIGENCE", 15, "#ffd400", 800, "start", `letter-spacing="3"`)}`, 8);
}

const scenes = [scene1(), scene2(), scene3(), scene4(), scene5(), scene6(), scene7(), scene8()];
const srt = [
  ["One intelligent workspace for every project decision.", "From drawing to payment, Ventra connects the construction workflow."],
  ["Upload once. Understand instantly.", "JPG, PDF and DWG drawings become structured project data."],
  ["See the space before you build it.", "Review geometry, rooms, furniture and finishes in interactive 3D."],
  ["From geometry to a commercial answer.", "Generate measured quantities, BOQ line items and defensible estimates."],
  ["Turn scope into a signed next step.", "Create branded quotations and link payments to contract milestones."],
  ["See the critical path before it becomes a delay.", "Track baseline dates, actual updates and actionable risks."],
  ["Field evidence becomes accountable progress.", "Upload site photos, verify activities and keep an audit trail."],
  ["Every project decision. One clear view.", "Ventra helps teams design smarter, estimate faster and deliver with confidence."],
];

for (let i = 0; i < scenes.length; i += 1) {
  const svgPath = path.join(outDir, `scene-${i + 1}.svg`);
  const pngPath = path.join(outDir, `scene-${i + 1}.png`);
  const mp4Path = path.join(outDir, `scene-${i + 1}.mp4`);
  writeFileSync(svgPath, scenes[i]);
  const base = sharp(Buffer.from(scenes[i]));
  if (i === 2 && existsSync(path.join(root, "public", "marketing-villa-3d.webp"))) {
    const hero3d = await sharp(path.join(root, "public", "marketing-villa-3d.webp"))
      .resize(720, 490, { fit: "cover", position: "center" })
      .toBuffer();
    await base.composite([{ input: hero3d, left: 960, top: 165 }]).png().toFile(pngPath);
  } else {
    await base.png().toFile(pngPath);
  }
  execFileSync("ffmpeg", ["-y", "-loop", "1", "-i", pngPath, "-t", "6.5", "-vf", "zoompan=z='min(zoom+0.0008,1.07)':d=195:s=1920x1080:fps=30,fade=t=in:st=0:d=0.35,fade=t=out:st=6.1:d=0.4,format=yuv420p", "-an", "-r", "30", mp4Path], { stdio: "ignore" });
}

const listPath = path.join(outDir, "concat.txt");
writeFileSync(listPath, scenes.map((_, i) => `file 'scene-${i + 1}.mp4'`).join("\n"));
const videoPath = path.join(root, "artifacts", "Ventra-Product-Advertising-EN.mp4");
execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", videoPath], { stdio: "inherit" });

let srtText = "";
srt.forEach(([title, subtitle], i) => {
  const start = i * 6.5;
  const end = start + 6.5;
  const fmt = (seconds) => { const ms = Math.round((seconds % 1) * 1000); const total = Math.floor(seconds); const h = Math.floor(total / 3600); const m = Math.floor((total % 3600) / 60); const s = total % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`; };
  srtText += `${i + 1}\n${fmt(start)} --> ${fmt(end)}\n${title}\n${subtitle}\n\n`;
});
writeFileSync(path.join(root, "artifacts", "Ventra-Product-Advertising-EN.srt"), srtText);
console.log(`Created ${videoPath}`);
