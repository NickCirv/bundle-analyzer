# bundle-analyzer
> Analyze JavaScript bundles. Find what's making your dist fat. No plugins required.

```bash
npx bundle-analyzer
npx bundle-analyzer --source-maps
```

```
bundle-analyzer · dist/ (8 files)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  main.js     ███████████████████░  842 KB  (gzip: 241 KB)  73%
  vendor.js   ████░░░░░░░░░░░░░░░░  198 KB  (gzip:  58 KB)  17%
  styles.css  ██░░░░░░░░░░░░░░░░░░   87 KB  (gzip:  21 KB)   8%

Source Map Attribution:
  react-dom         → 124 KB (28%)
  lodash            →  87 KB (19%)  ⚠ consider lodash-es

Total: 1.15 MB raw · 329 KB gzip
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Commands
| Command | Description |
|---------|-------------|
| `bundle-analyzer` | Analyze dist/ |
| `--dir <path>` | Custom directory |
| `--source-maps` | Package attribution |
| `--threshold 200KB` | Warn on large files |
| `--compare <prev.json>` | Compare builds |

## Install
```bash
npx bundle-analyzer
npm install -g bundle-analyzer
```

---
**Zero dependencies** · **Node 18+** · Made by [NickCirv](https://github.com/NickCirv) · MIT
