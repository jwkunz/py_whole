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
  const packageAssets = loadBundledPackages(projectRoot);

  const manifest = {
    available: true,
    version: "0.28.2",
    indexURL: "https://pywhole.local/pyodide/",
    lockFileURL: "https://pywhole.local/pyodide/pyodide-lock.json",
    bundledPackages: packageAssets.names,
    assets: {
      wasmBase64,
      stdlibBase64,
      lockFileText,
      packages: packageAssets.files,
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

function loadBundledPackages(projectRoot) {
  const packagesDir = path.join(projectRoot, "vendor", "pyodide", "packages-0.28.2");
  if (!fs.existsSync(packagesDir)) {
    return {
      names: [],
      files: {},
    };
  }

  const fileToPackageName = {
    "contourpy-1.3.1-cp313-cp313-pyodide_2025_0_wasm32.whl": "contourpy",
    "cycler-0.12.1-py3-none-any.whl": "cycler",
    "fonttools-4.56.0-py3-none-any.whl": "fonttools",
    "libopenblas-0.3.26.zip": "libopenblas",
    "kiwisolver-1.4.8-cp313-cp313-pyodide_2025_0_wasm32.whl": "kiwisolver",
    "matplotlib-3.8.4-cp313-cp313-pyodide_2025_0_wasm32.whl": "matplotlib",
    "mpmath-1.3.0-py3-none-any.whl": "mpmath",
    "numpy-2.2.5-cp313-cp313-pyodide_2025_0_wasm32.whl": "numpy",
    "pandas-2.3.1-cp313-cp313-pyodide_2025_0_wasm32.whl": "pandas",
    "packaging-24.2-py3-none-any.whl": "packaging",
    "pillow-11.3.0-cp313-cp313-pyodide_2025_0_wasm32.whl": "pillow",
    "pyparsing-3.2.1-py3-none-any.whl": "pyparsing",
    "python_dateutil-2.9.0.post0-py2.py3-none-any.whl": "python-dateutil",
    "pytz-2025.2-py2.py3-none-any.whl": "pytz",
    "scipy-1.14.1-cp313-cp313-pyodide_2025_0_wasm32.whl": "scipy",
    "six-1.17.0-py2.py3-none-any.whl": "six",
    "sympy-1.13.3-py3-none-any.whl": "sympy",
  };

  const names = [];
  const files = {};

  for (const [fileName, packageName] of Object.entries(fileToPackageName)) {
    const assetPath = path.join(packagesDir, fileName);
    if (!fs.existsSync(assetPath)) {
      continue;
    }
    files[fileName] = fs.readFileSync(assetPath).toString("base64");
    names.push(packageName);
  }

  names.sort();
  return { names, files };
}
