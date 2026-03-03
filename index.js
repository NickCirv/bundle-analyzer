#!/usr/bin/env node

import { readdirSync, statSync, readFileSync, writeFileSync } from 'fs'
import { gzipSync } from 'zlib'
import { join, extname, relative } from 'path'

// ─── Argument Parsing ─────────────────────────────────────────────────────────

const args = process.argv.slice(2)

function getArg(flag, defaultVal = null) {
  const idx = args.indexOf(flag)
  if (idx === -1) return defaultVal
  return args[idx + 1] ?? true
}

function hasFlag(flag) {
  return args.includes(flag)
}

if (hasFlag('--help') || hasFlag('-h')) {
  console.log(`
bundle-analyzer · Analyze JavaScript bundles. Find what's making your dist fat.

Usage:
  npx bundle-analyzer [options]

Options:
  --dir <path>          Directory to analyze (default: dist/)
  --source-maps         Attribute bytes to packages via source maps
  --threshold <size>    Warn on files over size (e.g. 200KB, 1MB)
  --format <fmt>        Output format: table (default), json, html
  --compare <file>      Compare with a previous JSON report
  --help, -h            Show this help

Examples:
  npx bundle-analyzer
  npx bundle-analyzer --dir build/
  npx bundle-analyzer --source-maps
  npx bundle-analyzer --threshold 200KB
  npx bundle-analyzer --format json > report.json
  npx bundle-analyzer --compare prev-report.json
`)
  process.exit(0)
}

const DIR = getArg('--dir') || 'dist'
const SOURCE_MAPS = hasFlag('--source-maps')
const THRESHOLD_RAW = getArg('--threshold')
const FORMAT = getArg('--format') || 'table'
const COMPARE_FILE = getArg('--compare')

// ─── Size Parsing ─────────────────────────────────────────────────────────────

function parseSize(str) {
  if (!str) return null
  const m = String(str).trim().match(/^([\d.]+)\s*(B|KB|MB|GB)?$/i)
  if (!m) return null
  const n = parseFloat(m[1])
  const unit = (m[2] || 'B').toUpperCase()
  const units = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }
  return Math.round(n * (units[unit] || 1))
}

function formatSize(bytes) {
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

function padStart(str, len) {
  return String(str).padStart(len)
}

function padEnd(str, len) {
  return String(str).padEnd(len)
}

const THRESHOLD = parseSize(THRESHOLD_RAW)

// ─── File Walking ─────────────────────────────────────────────────────────────

function walkDir(dir) {
  const results = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return results
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...walkDir(full))
    } else if (entry.isFile()) {
      results.push(full)
    }
  }
  return results
}

// ─── Asset Categorization ─────────────────────────────────────────────────────

function categorize(file) {
  const ext = extname(file).toLowerCase()
  if (['.js', '.mjs', '.cjs'].includes(ext)) return 'js'
  if (['.css'].includes(ext)) return 'css'
  if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif', '.ico'].includes(ext)) return 'image'
  if (['.woff', '.woff2', '.ttf', '.otf', '.eot'].includes(ext)) return 'font'
  if (['.map'].includes(ext)) return 'sourcemap'
  return 'other'
}

// ─── Node Modules Detection ───────────────────────────────────────────────────

function detectNodeModules(content) {
  const found = new Set()
  const re = /node_modules\/((?:@[^/]+\/)?[^/\s"']+)/g
  let m
  while ((m = re.exec(content)) !== null) {
    found.add(m[1])
  }
  return [...found]
}

// ─── Bar Chart ────────────────────────────────────────────────────────────────

function bar(fraction, width = 20) {
  const filled = Math.round(fraction * width)
  const empty = width - filled
  return '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, empty))
}

// ─── Source Map Analysis ──────────────────────────────────────────────────────

function analyzeSourceMap(mapPath) {
  let raw
  try {
    raw = readFileSync(mapPath, 'utf8')
  } catch {
    return null
  }
  let map
  try {
    map = JSON.parse(raw)
  } catch {
    return null
  }

  const sources = map.sources || []
  const sourcesContent = map.sourcesContent || []
  const attribution = {}

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i] || ''
    const content = sourcesContent[i] || ''
    const bytes = Buffer.byteLength(content, 'utf8')

    let key
    const nm = src.match(/node_modules\/((?:@[^/]+\/)?[^/?\s]+)/)
    if (nm) {
      key = nm[1]
    } else {
      key = 'src'
    }

    attribution[key] = (attribution[key] || 0) + bytes
  }

  return attribution
}

// ─── Progress Output ──────────────────────────────────────────────────────────

function renderProgress(label, current, total) {
  const pct = total ? current / total : 0
  process.stdout.write(`\r  ${padEnd(label, 30)} ${bar(pct)} ${Math.round(pct * 100)}%`)
}

// ─── HTML Report ──────────────────────────────────────────────────────────────

function buildHtmlReport(files, stats, sourceMaps) {
  const rows = files.map(f => `
    <tr class="${f.warn ? 'warn' : ''}">
      <td>${f.rel}</td>
      <td>${f.cat}</td>
      <td>${formatSize(f.size)}</td>
      <td>${formatSize(f.gzip)}</td>
      <td>${f.pct}%</td>
      <td>${f.warn ? '⚠ Exceeds threshold' : ''}</td>
    </tr>`).join('')

  const smRows = sourceMaps
    ? Object.entries(sourceMaps)
        .sort(([, a], [, b]) => b - a)
        .map(([pkg, bytes]) => `<tr><td>${pkg}</td><td>${formatSize(bytes)}</td></tr>`)
        .join('')
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>bundle-analyzer report</title>
<style>
  body{font-family:monospace;background:#0d1117;color:#c9d1d9;padding:2rem;max-width:900px;margin:auto}
  h1{color:#58a6ff}h2{color:#79c0ff;margin-top:2rem}
  table{width:100%;border-collapse:collapse;margin-top:1rem}
  th{text-align:left;border-bottom:1px solid #30363d;padding:.5rem}
  td{padding:.4rem .5rem;border-bottom:1px solid #21262d}
  tr:hover td{background:#161b22}
  .warn td{color:#f85149}
  .summary{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:1rem;margin-top:1rem}
</style>
</head>
<body>
<h1>bundle-analyzer</h1>
<div class="summary">
  <strong>Directory:</strong> ${DIR}<br>
  <strong>Total raw:</strong> ${formatSize(stats.totalRaw)}<br>
  <strong>Total gzip:</strong> ${formatSize(stats.totalGzip)}<br>
  <strong>Files:</strong> ${files.length}
</div>
<h2>Files</h2>
<table>
  <thead><tr><th>File</th><th>Type</th><th>Raw</th><th>Gzip</th><th>%</th><th>Notes</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
${sourceMaps ? `<h2>Source Map Attribution</h2><table><thead><tr><th>Package</th><th>Size</th></tr></thead><tbody>${smRows}</tbody></table>` : ''}
</body>
</html>`
}

// ─── Compare Reports ──────────────────────────────────────────────────────────

function compareReports(current, prevPath) {
  let prev
  try {
    prev = JSON.parse(readFileSync(prevPath, 'utf8'))
  } catch {
    console.error(`Cannot read compare file: ${prevPath}`)
    return
  }

  const prevMap = {}
  for (const f of prev.files || []) prevMap[f.rel] = f

  console.log('\n── Comparison ──────────────────────────────────────────────────────────')
  let any = false
  for (const f of current.files) {
    const p = prevMap[f.rel]
    if (!p) {
      console.log(`  + ${padEnd(f.rel, 40)} NEW  (${formatSize(f.size)})`)
      any = true
    } else {
      const delta = f.size - p.size
      if (Math.abs(delta) > 100) {
        const sign = delta > 0 ? '+' : ''
        console.log(`  ~ ${padEnd(f.rel, 40)} ${sign}${formatSize(Math.abs(delta))} ${delta > 0 ? '▲' : '▼'}`)
        any = true
      }
    }
  }
  for (const rel of Object.keys(prevMap)) {
    if (!current.files.find(f => f.rel === rel)) {
      console.log(`  - ${padEnd(rel, 40)} REMOVED`)
      any = true
    }
  }
  if (!any) console.log('  No significant changes.')
  const rawDelta = current.stats.totalRaw - (prev.stats?.totalRaw || 0)
  const sign = rawDelta > 0 ? '+' : ''
  console.log(`\n  Total raw delta: ${sign}${formatSize(Math.abs(rawDelta))} ${rawDelta > 0 ? '▲' : rawDelta < 0 ? '▼' : '─'}`)
  console.log('────────────────────────────────────────────────────────────────────────\n')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  try {
    statSync(DIR)
  } catch {
    console.error(`\nError: Directory "${DIR}" not found.\n`)
    console.error('Usage: bundle-analyzer --dir <path>\n')
    process.exit(1)
  }

  const allFiles = walkDir(DIR)
  const mainFiles = allFiles.filter(f => extname(f).toLowerCase() !== '.map')

  if (mainFiles.length === 0) {
    console.error(`\nNo files found in "${DIR}".\n`)
    process.exit(1)
  }

  console.log(`\nbundle-analyzer · ${DIR}/ (${mainFiles.length} files)`)
  console.log('━'.repeat(56))

  console.log('\nAnalyzing files...')
  const analyzed = []
  let totalRaw = 0
  let totalGzip = 0

  for (let i = 0; i < mainFiles.length; i++) {
    const fp = mainFiles[i]
    renderProgress(relative(DIR, fp), i + 1, mainFiles.length)
    let content
    try {
      content = readFileSync(fp)
    } catch {
      continue
    }
    const size = content.length
    let gzip = size
    try {
      gzip = gzipSync(content).length
    } catch { /* skip */ }
    const cat = categorize(fp)
    const mods = cat === 'js'
      ? detectNodeModules(content.toString('utf8', 0, Math.min(content.length, 500000)))
      : []
    analyzed.push({ fp, rel: relative(DIR, fp), size, gzip, cat, mods })
    totalRaw += size
    totalGzip += gzip
  }
  process.stdout.write('\r' + ' '.repeat(60) + '\r')

  const files = analyzed.map(f => ({
    ...f,
    pct: totalRaw ? Math.round((f.size / totalRaw) * 100) : 0,
    warn: THRESHOLD !== null && f.size > THRESHOLD
  }))

  const stats = { totalRaw, totalGzip }

  // Source map analysis
  let sourceMaps = null
  if (SOURCE_MAPS) {
    const mapFiles = allFiles.filter(f => f.endsWith('.js.map') || f.endsWith('.mjs.map'))
    if (mapFiles.length === 0) {
      console.log('  No source maps found.')
    } else {
      const combined = {}
      for (const mp of mapFiles) {
        const attr = analyzeSourceMap(mp)
        if (attr) {
          for (const [k, v] of Object.entries(attr)) {
            combined[k] = (combined[k] || 0) + v
          }
        }
      }
      sourceMaps = combined
    }
  }

  // ─── JSON output ──────────────────────────────────────────────────────────
  if (FORMAT === 'json') {
    const out = { dir: DIR, stats, files, sourceMaps }
    console.log(JSON.stringify(out, null, 2))
    return
  }

  // ─── HTML output ──────────────────────────────────────────────────────────
  if (FORMAT === 'html') {
    const html = buildHtmlReport(files, stats, sourceMaps)
    const outPath = `bundle-report-${Date.now()}.html`
    writeFileSync(outPath, html)
    console.log(`HTML report written to: ${outPath}`)
    return
  }

  // ─── Table output (default) ───────────────────────────────────────────────
  console.log('')

  const sorted = [...files].sort((a, b) => b.size - a.size)

  const maxName = Math.min(50, Math.max(...sorted.map(f => f.rel.length), 8))
  const maxRaw = Math.max(...sorted.map(f => formatSize(f.size).length), 7)
  const maxGzip = Math.max(...sorted.map(f => formatSize(f.gzip).length), 9)

  const cats = { js: [], css: [], image: [], font: [], other: [] }
  for (const f of sorted) {
    const c = cats[f.cat] !== undefined ? f.cat : 'other'
    cats[c].push(f)
  }

  const RESET = '\x1b[0m'
  const DIM = '\x1b[2m'
  const YELLOW = '\x1b[33m'
  const RED = '\x1b[31m'
  const CYAN = '\x1b[36m'
  const BOLD = '\x1b[1m'

  const catLabels = { js: 'JavaScript', css: 'CSS', image: 'Images', font: 'Fonts', other: 'Other' }

  for (const [cat, catFiles] of Object.entries(cats)) {
    if (catFiles.length === 0) continue
    console.log(`\n${BOLD}${catLabels[cat]}${RESET}`)
    for (const f of catFiles) {
      const fraction = totalRaw ? f.size / totalRaw : 0
      const b = bar(fraction)
      const rawStr = formatSize(f.size)
      const gzipStr = formatSize(f.gzip)
      const pctStr = `${f.pct}%`
      const warn = f.warn ? ` ${YELLOW}⚠ >${THRESHOLD_RAW}${RESET}` : ''
      const nameStr = f.rel.length > maxName ? '…' + f.rel.slice(-(maxName - 1)) : f.rel
      console.log(
        `  ${padEnd(nameStr, maxName)}  ${CYAN}${b}${RESET}  ${padStart(rawStr, maxRaw)}  ${DIM}(gzip: ${padStart(gzipStr, maxGzip)})${RESET}  ${padStart(pctStr, 4)}${warn}`
      )
    }
  }

  // Top 10
  console.log(`\n${BOLD}Largest Files (top 10)${RESET}`)
  const top10 = sorted.slice(0, 10)
  for (let i = 0; i < top10.length; i++) {
    const f = top10[i]
    console.log(`  ${padStart(i + 1, 2)}.  ${padEnd(f.rel, maxName)}  ${padStart(formatSize(f.size), maxRaw)}`)
  }

  // Node modules
  const allMods = new Set()
  for (const f of files) {
    if (f.cat === 'js') for (const m of f.mods) allMods.add(m)
  }
  if (allMods.size > 0) {
    console.log(`\n${BOLD}Node Modules Detected in Bundle${RESET}`)
    const modList = [...allMods].sort()
    for (const m of modList) {
      console.log(`  ${DIM}node_modules/${RESET}${m}`)
    }
  }

  // Source map attribution
  if (sourceMaps && Object.keys(sourceMaps).length > 0) {
    const smTotal = Object.values(sourceMaps).reduce((a, b) => a + b, 0)
    const smSorted = Object.entries(sourceMaps).sort(([, a], [, b]) => b - a)
    console.log(`\n${BOLD}Source Map Attribution${RESET}`)
    for (const [pkg, bytes] of smSorted.slice(0, 15)) {
      const pct = smTotal ? Math.round((bytes / smTotal) * 100) : 0
      const b = bar(smTotal ? bytes / smTotal : 0, 15)
      const lodashWarn = pkg === 'lodash' ? `  ${YELLOW}⚠ consider lodash-es${RESET}` : ''
      const momentWarn = pkg === 'moment' ? `  ${YELLOW}⚠ consider date-fns or dayjs${RESET}` : ''
      console.log(
        `  ${padEnd(pkg, 30)}  ${CYAN}${b}${RESET}  ${padStart(formatSize(bytes), 8)} (${pct}%)${lodashWarn}${momentWarn}`
      )
    }
  }

  // Asset breakdown
  console.log(`\n${BOLD}Asset Breakdown${RESET}`)
  for (const [cat, catFiles] of Object.entries(cats)) {
    if (catFiles.length === 0) continue
    const catTotal = catFiles.reduce((a, f) => a + f.size, 0)
    const pct = totalRaw ? Math.round((catTotal / totalRaw) * 100) : 0
    const b = bar(totalRaw ? catTotal / totalRaw : 0, 12)
    console.log(
      `  ${padEnd(catLabels[cat], 12)}  ${CYAN}${b}${RESET}  ${padStart(formatSize(catTotal), 8)}  ${pct}%  (${catFiles.length} file${catFiles.length !== 1 ? 's' : ''})`
    )
  }

  // Threshold warnings
  const warned = files.filter(f => f.warn)
  if (warned.length > 0) {
    console.log(`\n${RED}${BOLD}Threshold Warnings (>${THRESHOLD_RAW})${RESET}`)
    for (const f of warned) {
      console.log(`  ${RED}⚠${RESET}  ${f.rel}  (${formatSize(f.size)})`)
    }
  }

  // Total
  console.log(`\n${'━'.repeat(56)}`)
  console.log(`${BOLD}Total: ${formatSize(totalRaw)} raw · ${formatSize(totalGzip)} gzip${RESET}`)
  console.log(`${'━'.repeat(56)}\n`)

  // Compare
  if (COMPARE_FILE) {
    compareReports(
      { files: files.map(f => ({ rel: f.rel, size: f.size, gzip: f.gzip })), stats },
      COMPARE_FILE
    )
  }
}

main().catch(err => {
  console.error('\nFatal error:', err.message)
  process.exit(1)
})
