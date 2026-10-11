// Entwicklungsserver: Werkstatt und Font-Probe, dazu die Dateien, die `bun run web` neben die Seiten legt
import index from "../index.html";
import font from "../font.html";

const file = (p: string) => () => new Response(Bun.file(p));
const server = Bun.serve({
  port: Number(process.env.PORT ?? 3457),
  development: true,
  routes: {
    "/": index,
    "/font": font,
    "/Neustift-Regular.woff2": file("dist/Neustift-Regular.woff2"),
    "/Neustift-Regular.otf": file("dist/Neustift-Regular.otf"),
    "/OFL.txt": file("OFL.txt"),
    "/:name": async (req) => {
      const f = Bun.file(`public/${req.params.name}`);
      return (await f.exists()) ? new Response(f) : new Response("Nicht gefunden", { status: 404 });
    },
  },
});
console.log(`Werkstatt: ${server.url}  Font-Probe: ${server.url}font`);
