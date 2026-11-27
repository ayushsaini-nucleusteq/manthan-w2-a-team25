# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

- `frontend/` — React 19 single-page app built with Vite 8 (plain JavaScript/JSX, no TypeScript). It's still close to the stock `create-vite` React template: the entry is `src/main.jsx`, which mounts `src/App.jsx`.
- There is no backend, shared package, or workspace tooling yet. Each app directory has its own `package.json`, so run commands from inside that directory.

## Commands (run from `frontend/`)

- `npm install` — install dependencies
- `npm run dev` — start the Vite dev server with HMR
- `npm run build` — production build into `frontend/dist/`
- `npm run preview` — serve the production build
- `npm run lint` — ESLint over all `*.js`/`*.jsx` files

No test runner is configured yet. If one is added (Vitest fits a Vite setup best), record the commands for running all tests and a single test here.

## Tooling notes

- ESLint uses the flat config (`frontend/eslint.config.js`) with `@eslint/js` recommended, `eslint-plugin-react-hooks` (flat recommended) and `eslint-plugin-react-refresh` (vite preset). The react-refresh rule warns when a module exports anything besides React components, so keep non-component exports in separate files to keep HMR working.
- `vite.config.js` turns on Vite DevTools (`@vitejs/devtools`) for the dev server only (`apply: 'serve'`).
- The React Compiler is not enabled.
