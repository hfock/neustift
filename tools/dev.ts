// Entwicklungsserver: Werkstatt und Font-Probe, dazu die Dateien, die `bun run web` neben die Seiten legt
import index from "../index.html";
import font from "../font.html";

import { readdirSync } from "node:fs";

const PUBLIC = new Set(readdirSync("public")); // nur echte Dateinamen, kein ../
const file = (p: string) => () => new Response(Bun.file(p));
const server = Bun.serve({
  port: Number(process.env.PORT ?? 3457),
  hostname: "localhost", // nur dieser Rechner
  development: true,
  routes: {
    "/": index,
    "/font": font,
    "/Neustift-Regular.woff2": file("dist/Neustift-Regular.woff2"),
    "/Neustift-Regular.otf": file("dist/Neustift-Regular.otf"),
    "/OFL.txt": file("OFL.txt"),
    "/:name": (req) =>
      PUBLIC.has(req.params.name) ? new Response(Bun.file(`public/${req.params.name}`)) : new Response("Nicht gefunden", { status: 404 }),
  },
});
console.log(`Werkstatt: ${server.url}  Font-Probe: ${server.url}font`);
