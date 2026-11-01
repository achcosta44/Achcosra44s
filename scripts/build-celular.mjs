// Gera dist/consultorio.html: um único arquivo, sem dependência de internet,
// com telas + biblioteca de Excel + "servidor" local (IndexedDB).
// Uso: npm run build:celular
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (p) => readFileSync(join(raiz, p), "utf8");

// Torna o JS seguro para ficar dentro de <script>…</script>.
const seguro = (js) => js.replace(/<\/script/gi, "<\\/script").replace(/"<!--"/g, '"\\x3C!--"');

const css = ler("public/style.css");
const xlsx = ler("node_modules/xlsx/dist/xlsx.mini.min.js");
const backend = ler("celular/backend-local.js");
const app = ler("public/app.js");

const icone =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2f6f8f"/><path d="M27 14h10v13h13v10H37v13H27V37H14V27h13z" fill="#fff"/></svg>`,
  );

let html = ler("public/index.html");
const substituir = (de, para) => {
  if (!html.includes(de)) throw new Error(`Trecho não encontrado em index.html: ${de}`);
  html = html.replace(de, () => para);
};

substituir(
  '<link rel="stylesheet" href="/style.css">',
  `<meta name="theme-color" content="#2f6f8f">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="Consultório">
  <link rel="icon" href="${icone}">
  <link rel="apple-touch-icon" href="${icone}">
  <style>
${css}
  </style>`,
);
substituir(
  '<script src="/app.js" type="module"></script>',
  `<script>
${seguro(xlsx)}
  </script>
  <script>
${seguro(backend)}
  </script>
  <script type="module">
${seguro(app)}
  </script>`,
);

const saida = join(raiz, "dist", "consultorio.html");
mkdirSync(dirname(saida), { recursive: true });
writeFileSync(saida, html);
console.log(`Gerado ${saida} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
