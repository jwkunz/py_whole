import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(rootDir, "src");
const distDir = path.join(rootDir, "dist");
const outFile = path.join(distDir, "py_whole.html");

fs.mkdirSync(distDir, { recursive: true });

const template = fs.readFileSync(path.join(srcDir, "index.html"), "utf8");
const css = fs.readFileSync(path.join(srcDir, "styles.css"), "utf8");
const appJs = fs.readFileSync(path.join(srcDir, "app.js"), "utf8");
const runtime = loadEmbeddedRuntime(rootDir);

const html = template
  .replace("__INLINE_CSS__", css)
  .replace("__INLINE_RUNTIME_BOOTSTRAP__", runtime.bootstrap)
  .replace("__INLINE_RUNTIME_LOADER__", runtime.loader)
  .replace("__INLINE_JS__", escapeInlineScript(appJs));

fs.writeFileSync(outFile, html);
process.stdout.write(`Built ${outFile}\n`);

function loadEmbeddedRuntime(projectRoot) {
  const pyodideDir = path.join(projectRoot, "vendor", "pyodide", "core-0.28.2", "pyodide");
  if (!fs.existsSync(pyodideDir)) {
    return {
      bootstrap: "window.__PYWHOLE_EMBEDDED_PYODIDE__ = { available: false };",
      loader: "",
    };
  }

  const pyodideJs = fs.readFileSync(path.join(pyodideDir, "pyodide.js"), "utf8");
  const pyodideAsmJs = fs.readFileSync(path.join(pyodideDir, "pyodide.asm.js"), "utf8");
  const lockFileText = fs.readFileSync(path.join(pyodideDir, "pyodide-lock.json"), "utf8");
  const wasmBase64 = fs.readFileSync(path.join(pyodideDir, "pyodide.asm.wasm")).toString("base64");
  const stdlibBase64 = fs.readFileSync(path.join(pyodideDir, "python_stdlib.zip")).toString("base64");

  const manifest = {
    available: true,
    version: "0.28.2",
    indexURL: "https://pywhole.local/pyodide/",
    lockFileURL: "https://pywhole.local/pyodide/pyodide-lock.json",
    assets: {
      wasmBase64,
      stdlibBase64,
      lockFileText,
    },
  };

  return {
    bootstrap: `window.__PYWHOLE_EMBEDDED_PYODIDE__ = ${JSON.stringify(manifest)};`,
    loader: [escapeInlineScript(pyodideJs), escapeInlineScript(pyodideAsmJs)].join("\n"),
  };
}

function escapeInlineScript(text) {
  return text.replaceAll("</script", "<\\/script");
}
