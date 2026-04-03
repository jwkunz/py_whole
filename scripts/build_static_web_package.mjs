import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(rootDir, "src");
const distDir = path.join(rootDir, "dist");
const outputDirName = process.env.PY_WHOLE_STATIC_DIR || "py_whole_web";
const outputDir = path.join(distDir, outputDirName);
const appVersion = process.env.PY_WHOLE_VERSION || loadAppVersion(rootDir);
const bundledPackageFilter = new Set(
  String(process.env.PY_WHOLE_BUNDLED_PACKAGES || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean),
);

const template = fs.readFileSync(path.join(srcDir, "index.html"), "utf8");
const workerTemplate = fs.readFileSync(path.join(srcDir, "pyodide_worker.js"), "utf8");

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

copyFile(path.join(srcDir, "app.js"), path.join(outputDir, "app.js"));
copyFile(path.join(srcDir, "styles.css"), path.join(outputDir, "styles.css"));
copyOptionalFile(path.join(rootDir, "py_whole_logo.png"), path.join(outputDir, "py_whole_logo.png"));
copyOptionalFile(path.join(rootDir, "py_whole_favicon.png"), path.join(outputDir, "py_whole_favicon.png"));
copyOptionalFile(path.join(rootDir, "py_whole_favicon.ico"), path.join(outputDir, "py_whole_favicon.ico"));
copyCodeMirrorAssets(rootDir, outputDir);
const runtimeManifest = copyPyodideRuntime(rootDir, outputDir, bundledPackageFilter);

const html = buildHtml(template, runtimeManifest, appVersion);
fs.writeFileSync(path.join(outputDir, "index.html"), html);

const workerSource = workerTemplate
  .replace(
    "__INLINE_RUNTIME_BOOTSTRAP_WORKER__",
    `self.__PYWHOLE_EMBEDDED_PYODIDE__ = ${JSON.stringify(runtimeManifest)};`,
  )
  .replace(
    "__INLINE_RUNTIME_LOADER__",
    `importScripts("./pyodide/pyodide.js");`,
  );
fs.writeFileSync(path.join(outputDir, "pyodide_worker.js"), workerSource);

process.stdout.write(`Built static web package at ${outputDir}\n`);

function buildHtml(input, runtimeManifestValue, version) {
  const editorScriptTags = [
    "./vendor/codemirror/lib/codemirror.min.js",
    "./vendor/codemirror/addon/edit/closebrackets.min.js",
    "./vendor/codemirror/addon/edit/matchbrackets.min.js",
    "./vendor/codemirror/mode/xml/xml.min.js",
    "./vendor/codemirror/mode/javascript/javascript.min.js",
    "./vendor/codemirror/mode/css/css.min.js",
    "./vendor/codemirror/mode/htmlmixed/htmlmixed.min.js",
    "./vendor/codemirror/mode/markdown/markdown.min.js",
    "./vendor/codemirror/mode/python/python.min.js",
  ]
    .map((src) => `    <script src="${src}"></script>`)
    .join("\n");

  return input
    .replaceAll("__APP_VERSION__", version)
    .replaceAll("__INLINE_LOGO_DATA__", "./py_whole_logo.png")
    .replace(`    <link rel="icon" type="image/svg+xml" href="__INLINE_FAVICON_SVG_DATA__" />`, `    <link rel="icon" type="image/png" href="./py_whole_favicon.png" />`)
    .replace(`    <link rel="shortcut icon" type="image/svg+xml" href="__INLINE_FAVICON_SVG_DATA__" />`, `    <link rel="shortcut icon" type="image/x-icon" href="./py_whole_favicon.ico" />`)
    .replace(`    <link rel="alternate icon" type="image/png" sizes="32x32" href="__INLINE_FAVICON_DATA__" />`, "")
    .replace(`    <link rel="apple-touch-icon" href="__INLINE_FAVICON_DATA__" />`, `    <link rel="apple-touch-icon" href="./py_whole_favicon.png" />`)
    .replace(
      `    <style>\n__INLINE_EDITOR_CSS__\n__INLINE_CSS__\n    </style>`,
      `    <link rel="stylesheet" href="./vendor/codemirror/lib/codemirror.min.css" />\n    <link rel="stylesheet" href="./styles.css" />`,
    )
    .replace(
      `    <script>\n__INLINE_RUNTIME_BOOTSTRAP__\n    </script>`,
      `    <script>\nwindow.__PYWHOLE_EMBEDDED_PYODIDE__ = ${JSON.stringify(runtimeManifestValue)};\nwindow.__PYWHOLE_RUNTIME_WORKER_URL__ = "./pyodide_worker.js";\n    </script>`,
    )
    .replace(
      `\n    <script>\nwindow.__PYWHOLE_RUNTIME_WORKER_SOURCE__ = __INLINE_RUNTIME_WORKER_SOURCE__;\n    </script>`,
      "",
    )
    .replace(
      `\n    <script>\n__INLINE_RUNTIME_LOADER__\n    </script>`,
      "",
    )
    .replace(
      `    <script>\n__INLINE_EDITOR_JS__\n    </script>`,
      editorScriptTags,
    )
    .replace(
      `    <script>\n__INLINE_JS__\n    </script>`,
      `    <script src="./app.js"></script>`,
    );
}

function loadAppVersion(projectRoot) {
  const versionPath = path.join(projectRoot, "VERSION");
  if (!fs.existsSync(versionPath)) {
    return "0.1.0";
  }
  return fs.readFileSync(versionPath, "utf8").trim() || "0.1.0";
}

function copyFile(fromPath, toPath) {
  fs.mkdirSync(path.dirname(toPath), { recursive: true });
  fs.copyFileSync(fromPath, toPath);
}

function copyOptionalFile(fromPath, toPath) {
  if (!fs.existsSync(fromPath)) {
    return;
  }
  copyFile(fromPath, toPath);
}

function copyCodeMirrorAssets(projectRoot, outDir) {
  const editorDir = path.join(projectRoot, "vendor", "codemirror");
  if (!fs.existsSync(editorDir)) {
    return;
  }
  const files = [
    ["lib", "codemirror.min.css"],
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
  for (const parts of files) {
    copyFile(path.join(editorDir, ...parts), path.join(outDir, "vendor", "codemirror", ...parts));
  }
}

function copyPyodideRuntime(projectRoot, outDir, packageFilter = new Set()) {
  const pyodideDir = path.join(projectRoot, "vendor", "pyodide", "core-0.28.2", "pyodide");
  if (!fs.existsSync(pyodideDir)) {
    return {
      available: false,
      version: "0.28.2",
      indexURL: "./pyodide/",
      lockFileURL: "./pyodide/pyodide-lock.json",
      bundledPackages: [],
      assets: null,
    };
  }

  const targetPyodideDir = path.join(outDir, "pyodide");
  const coreFiles = [
    "pyodide.js",
    "pyodide.asm.js",
    "pyodide.asm.wasm",
    "python_stdlib.zip",
    "pyodide-lock.json",
  ];
  for (const fileName of coreFiles) {
    copyFile(path.join(pyodideDir, fileName), path.join(targetPyodideDir, fileName));
  }

  const packagesDir = path.join(projectRoot, "vendor", "pyodide", "packages-0.28.2");
  const { names, files } = bundledPackageFiles(packageFilter);
  for (const fileName of files) {
    copyFile(path.join(packagesDir, fileName), path.join(targetPyodideDir, fileName));
  }

  return {
    available: true,
    version: "0.28.2",
    indexURL: "./pyodide/",
    lockFileURL: "./pyodide/pyodide-lock.json",
    bundledPackages: names,
    assets: null,
  };
}

function bundledPackageFiles(packageFilter = new Set()) {
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
  const files = [];
  for (const [fileName, packageName] of Object.entries(fileToPackageName)) {
    if (packageFilter.size && !packageFilter.has(packageName)) {
      continue;
    }
    names.push(packageName);
    files.push(fileName);
  }
  names.sort();
  return { names, files };
}
