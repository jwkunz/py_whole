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
const editorAssets = loadEmbeddedEditorAssets(rootDir);
const logoDataUri = loadInlineLogo(rootDir);
const faviconSvgDataUri = loadInlineSvgFavicon();
const faviconDataUri = loadInlineFavicon(rootDir);
const faviconIcoDataUri = loadInlineFaviconIco(rootDir);

const html = template
  .replaceAll("__INLINE_LOGO_DATA__", logoDataUri)
  .replaceAll("__INLINE_FAVICON_SVG_DATA__", faviconSvgDataUri)
  .replaceAll("__INLINE_FAVICON_DATA__", faviconDataUri)
  .replaceAll("__INLINE_FAVICON_ICO_DATA__", faviconIcoDataUri)
  .replace("__INLINE_EDITOR_CSS__", editorAssets.css)
  .replace("__INLINE_CSS__", css)
  .replace("__INLINE_RUNTIME_BOOTSTRAP__", runtime.bootstrap)
  .replace("__INLINE_RUNTIME_LOADER__", runtime.loader)
  .replace("__INLINE_EDITOR_JS__", editorAssets.js)
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

function loadInlineLogo(projectRoot) {
  const logoPath = path.join(projectRoot, "py_whole_logo.png");
  if (!fs.existsSync(logoPath)) {
    return "";
  }
  const base64 = fs.readFileSync(logoPath).toString("base64");
  return `data:image/png;base64,${base64}`;
}

function loadInlineFavicon(projectRoot) {
  const faviconPath = path.join(projectRoot, "py_whole_favicon.png");
  if (!fs.existsSync(faviconPath)) {
    return loadInlineLogo(projectRoot);
  }
  const base64 = fs.readFileSync(faviconPath).toString("base64");
  return `data:image/png;base64,${base64}`;
}

function loadInlineSvgFavicon() {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="pywhole-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2f6fed" />
      <stop offset="100%" stop-color="#15326f" />
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#pywhole-grad)" />
  <path d="M20 16h17c7.2 0 12 4.4 12 11.2 0 5.2-2.9 9-7.9 10.3L49 49H39.6l-6.6-10.3h-4.4V49H20V16zm8.6 7.2v8.5h7c3.1 0 5-1.6 5-4.3 0-2.7-1.9-4.2-5-4.2h-7z" fill="#ffffff"/>
  <circle cx="47.5" cy="47.5" r="5.5" fill="#f4b400" />
</svg>`.trim();
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function loadInlineFaviconIco(projectRoot) {
  const faviconPath = path.join(projectRoot, "py_whole_favicon.ico");
  if (!fs.existsSync(faviconPath)) {
    return loadInlineFavicon(projectRoot);
  }
  const base64 = fs.readFileSync(faviconPath).toString("base64");
  return `data:image/x-icon;base64,${base64}`;
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
    "bokeh-3.6.3-py3-none-any.whl": "bokeh",
    "contourpy-1.3.1-cp313-cp313-pyodide_2025_0_wasm32.whl": "contourpy",
    "cycler-0.12.1-py3-none-any.whl": "cycler",
    "decorator-5.2.1-py3-none-any.whl": "decorator",
    "fonttools-4.56.0-py3-none-any.whl": "fonttools",
    "imageio-2.37.0-py3-none-any.whl": "imageio",
    "jinja2-3.1.6-py3-none-any.whl": "jinja2",
    "libopenblas-0.3.26.zip": "libopenblas",
    "kiwisolver-1.4.8-cp313-cp313-pyodide_2025_0_wasm32.whl": "kiwisolver",
    "matplotlib-3.8.4-cp313-cp313-pyodide_2025_0_wasm32.whl": "matplotlib",
    "markupsafe-3.0.2-cp313-cp313-pyodide_2025_0_wasm32.whl": "markupsafe",
    "mpmath-1.3.0-py3-none-any.whl": "mpmath",
    "networkx-3.4.2-py3-none-any.whl": "networkx",
    "numpy-2.2.5-cp313-cp313-pyodide_2025_0_wasm32.whl": "numpy",
    "opencv_python-4.11.0.86-cp313-cp313-pyodide_2025_0_wasm32.whl": "opencv",
    "pandas-2.3.1-cp313-cp313-pyodide_2025_0_wasm32.whl": "pandas",
    "packaging-24.2-py3-none-any.whl": "packaging",
    "patsy-1.0.1-py2.py3-none-any.whl": "patsy",
    "pillow-11.3.0-cp313-cp313-pyodide_2025_0_wasm32.whl": "pillow",
    "pyparsing-3.2.1-py3-none-any.whl": "pyparsing",
    "python_dateutil-2.9.0.post0-py2.py3-none-any.whl": "python-dateutil",
    "pytz-2025.2-py2.py3-none-any.whl": "pytz",
    "pywavelets-1.8.0-cp313-cp313-pyodide_2025_0_wasm32.whl": "pywavelets",
    "pyyaml-6.0.2-cp313-cp313-pyodide_2025_0_wasm32.whl": "pyyaml",
    "scikit_image-0.25.2-cp313-cp313-pyodide_2025_0_wasm32.whl": "scikit-image",
    "scipy-1.14.1-cp313-cp313-pyodide_2025_0_wasm32.whl": "scipy",
    "setuptools-76.0.0-py3-none-any.whl": "setuptools",
    "six-1.17.0-py2.py3-none-any.whl": "six",
    "statsmodels-0.14.4-cp313-cp313-pyodide_2025_0_wasm32.whl": "statsmodels",
    "sympy-1.13.3-py3-none-any.whl": "sympy",
    "tqdm-4.67.1-py3-none-any.whl": "tqdm",
    "typing_extensions-4.14.1-py3-none-any.whl": "typing-extensions",
    "xarray-2025.1.2-py3-none-any.whl": "xarray",
    "xyzservices-2025.1.0-py3-none-any.whl": "xyzservices",
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

function loadEmbeddedEditorAssets(projectRoot) {
  const editorDir = path.join(projectRoot, "vendor", "codemirror");
  if (!fs.existsSync(editorDir)) {
    return {
      css: "",
      js: "",
    };
  }

  const css = fs.readFileSync(path.join(editorDir, "lib", "codemirror.min.css"), "utf8");
  const jsFiles = [
    ["lib", "codemirror.min.js"],
    ["addon", "edit", "closebrackets.min.js"],
    ["addon", "edit", "matchbrackets.min.js"],
    ["mode", "xml", "xml.min.js"],
    ["mode", "javascript", "javascript.min.js"],
    ["mode", "css", "css.min.js"],
    ["mode", "htmlmixed", "htmlmixed.min.js"],
    ["mode", "markdown", "markdown.min.js"],
    ["mode", "python", "python.min.js"],
  ];

  const js = jsFiles
    .map((parts) => fs.readFileSync(path.join(editorDir, ...parts), "utf8"))
    .map(escapeInlineScript)
    .join("\n");

  return { css, js };
}
