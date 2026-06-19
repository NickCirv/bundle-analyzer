<div align="center">

# bundle-analyzer

**Scan your dist folder, see exactly what's making it fat — no plugins, no config.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue?labelColor=0B0A09)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?labelColor=0B0A09)](package.json)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen?labelColor=0B0A09)](package.json)

</div>

## Install

```bash
npx github:NickCirv/bundle-analyzer
```

## Usage

```bash
# Analyze dist/ (default)
npx github:NickCirv/bundle-analyzer

# Custom directory, with source-map attribution
npx github:NickCirv/bundle-analyzer --dir build/ --source-maps
```

| Flag | Description |
|------|-------------|
| `--dir <path>` | Directory to analyze (default: `dist/`) |
| `--source-maps` | Attribute bytes to packages via source maps |
| `--threshold <size>` | Warn on files over size (e.g. `200KB`, `1MB`) |
| `--format <fmt>` | Output format: `table` (default), `json`, `html` |
| `--compare <file>` | Compare with a previous JSON report |

## What it does

Walks a build directory, measures raw and gzip sizes for every asset, and renders a colour-coded terminal table grouped by type (JS, CSS, images, fonts). With `--source-maps` it parses `.js.map` files to attribute bytes back to individual `node_modules` packages — handy for spotting accidental lodash or moment inclusions. Pass `--format json` to pipe results into CI or `--format html` for a shareable standalone report.

---
<sub>Zero dependencies · Node 18+ · MIT · by <a href="https://github.com/NickCirv">NickCirv</a></sub>
