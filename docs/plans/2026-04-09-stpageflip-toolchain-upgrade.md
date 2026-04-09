# StPageFlip Build Toolchain Upgrade

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the vendored StPageFlip library's build toolchain from legacy (Rollup 2, TS 4.9, deprecated plugins) to modern (Rollup 4, TS 6, current plugins) so it builds reliably on any machine with Node 22+.

**Architecture:** Replace deprecated rollup plugins with official `@rollup/plugin-*` equivalents. Upgrade TypeScript to 6.x and update tsconfig for TS 6 requirements. Remove unused webpack config. Output format stays identical: UMD (`St` global) + ESM, both minified.

**Tech Stack:** TypeScript 6.0.2, Rollup 4.x, @rollup/plugin-typescript, @rollup/plugin-terser, rollup-plugin-postcss 4.x, tslib 2.x

---

All work happens in `lib/st-page-flip/`.

### Task 1: Clean slate — remove old node_modules and lockfile

**Files:**
- Delete: `node_modules/` (if exists)
- Delete: `package-lock.json` (if exists)

**Step 1: Remove old artifacts**

```bash
cd lib/st-page-flip
rm -rf node_modules package-lock.json dist
```

**Step 2: Verify clean state**

```bash
ls -la
# Should see: src/, package.json, tsconfig.json, rollup.config.js, etc.
# Should NOT see: node_modules/, dist/, package-lock.json
```

---

### Task 2: Update package.json — modern dependencies

**Files:**
- Modify: `package.json`

**Step 1: Rewrite package.json with updated deps**

Replace the full `devDependencies` and `scripts` sections:

```json
{
  "name": "page-flip",
  "version": "2.0.7",
  "type": "module",
  "main": "dist/js/page-flip.browser.js",
  "browser": "dist/js/page-flip.browser.js",
  "module": "dist/js/page-flip.module.js",
  "types": "dist/types/PageFlip.d.ts",
  "author": "oleg.litovski9@gmail.com",
  "license": "MIT",
  "description": "Powerful, simple and flexible JS Library for creating realistic and beautiful page turning effect",
  "repository": {
    "type": "git",
    "url": "https://github.com/Nodlik/StPageFlip.git"
  },
  "homepage": "https://nodlik.github.io/StPageFlip/",
  "devDependencies": {
    "@rollup/plugin-terser": "^1.0.0",
    "@rollup/plugin-typescript": "^12.3.0",
    "rollup": "^4.60.0",
    "rollup-plugin-postcss": "^4.0.2",
    "tslib": "^2.8.0",
    "typescript": "^6.0.2"
  },
  "scripts": {
    "build": "rollup -c"
  },
  "keywords": [
    "typescript", "page", "flip", "canvas",
    "book", "reader", "fold", "frontend", "javascript"
  ]
}
```

Key changes:
- Added `"type": "module"` for native ESM support (rollup 4 requires this)
- Added `"module"` and `"types"` entry points
- Replaced `rollup-plugin-typescript2` with `@rollup/plugin-typescript` (official)
- Replaced `rollup-plugin-terser` with `@rollup/plugin-terser` (official)
- Added `rollup` and `tslib` as explicit devDependencies
- Removed: webpack, webpack-cli, ts-loader, css-loader, style-loader, eslint, @typescript-eslint/*, typedoc, prettier, eslint-plugin-typescript
- Removed: `build-global` and `eslint` scripts (webpack build unused)

---

### Task 3: Update tsconfig.json for TypeScript 6

**Files:**
- Modify: `tsconfig.json`

**Step 1: Rewrite tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "module": "ES2020",
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationDir": "dist/types",
    "rootDir": "./src",
    "noImplicitAny": true,
    "strict": false,
    "lib": ["ES2017", "DOM", "DOM.Iterable"],
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

Key changes:
- `module`: `ES2020` (supports dynamic import, needed by bundler resolution)
- `moduleResolution`: `"bundler"` (TS 5+ feature, ideal for Rollup)
- `declarationDir`: `dist/types` (cleaner separation from JS output)
- `include` instead of `files` (auto-discovers all .ts files)
- Removed `typedocOptions` (typedoc removed)
- Added `esModuleInterop` and `skipLibCheck` for modern compat

---

### Task 4: Update rollup.config.js for Rollup 4

**Files:**
- Modify: `rollup.config.js`

**Step 1: Rewrite rollup.config.js**

```js
import typescript from '@rollup/plugin-typescript';
import postcss from 'rollup-plugin-postcss';
import terser from '@rollup/plugin-terser';

export default [
    {
        input: 'src/PageFlip.ts',
        output: [
            { file: 'dist/js/page-flip.browser.js', format: 'umd', name: 'St' },
            { file: 'dist/js/page-flip.module.js', format: 'es' },
        ],
        plugins: [
            postcss(),
            typescript({ tsconfig: './tsconfig.json' }),
            terser(),
        ],
    },
];
```

Key changes:
- Import from `@rollup/plugin-typescript` (replaces `rollup-plugin-typescript2`)
- Import `terser` as default export (replaces named `{ terser }`)
- Merged two identical configs into one with multiple outputs (DRY)
- `useTsconfigDeclarationDir` removed (not needed with @rollup/plugin-typescript)

---

### Task 5: Delete obsolete config files

**Files:**
- Delete: `webpack.config.js`
- Delete: `.eslintrc`

These are no longer used. Webpack build was a secondary dev build that's unused. ESLint deps were removed.

---

### Task 6: Install dependencies and build

**Step 1: Install**

```bash
cd lib/st-page-flip
npm install
```

**Step 2: Build**

```bash
npm run build
```

Expected output: two files created:
- `dist/js/page-flip.browser.js` (UMD, minified)
- `dist/js/page-flip.module.js` (ESM, minified)
- `dist/types/` (declaration files)

**Step 3: Verify output**

```bash
ls -la dist/js/
# page-flip.browser.js and page-flip.module.js should exist

# Verify UMD wrapper contains 'St' global name
head -c 200 dist/js/page-flip.browser.js
```

---

### Task 7: Fix any TypeScript compilation errors

TS 6 is stricter than TS 4.9. Possible issues:
- `const enum` across files (TS 6 may flag these with isolatedDeclarations)
- Implicit `any` in event handlers
- Deprecated `moduleResolution: "node10"` (already fixed in new tsconfig)

If build errors occur, fix them one at a time in the source `.ts` files. The fixes should be minimal type annotations or casts — no logic changes.

---

### Task 8: Integration test — verify the app works

**Step 1: Start HTTP server from project root**

```bash
cd /c/Users/User/Desktop/pages
python -m http.server 8000
```

**Step 2: Open browser and test**

- Open `http://localhost:8000` — PDF mode should load with page flipping
- Open `http://localhost:8000/html-book.html` — HTML mode should work
- Verify: page flip animations, sound, navigation, RTL toggle

---

### Task 9: Commit

```bash
git add lib/st-page-flip/package.json lib/st-page-flip/tsconfig.json lib/st-page-flip/rollup.config.js lib/st-page-flip/dist/
git rm lib/st-page-flip/webpack.config.js lib/st-page-flip/.eslintrc
git commit -m "build: upgrade StPageFlip toolchain to Rollup 4 + TypeScript 6"
```
