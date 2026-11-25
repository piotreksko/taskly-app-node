# SOLUTION – Unit Test Agent and Agentic PR Workflow

> Work in progress. Sections marked _TODO_ are filled in as the implementation lands.

## 0. Precautions: supply-chain review before running anything

The base repository was third-party code, so I reviewed it **before** installing dependencies or running anything. No `node_modules` were installed and no scripts were executed until this review was finished.

| Check | Result |
| --- | --- |
| Package sources (`package-lock.json`) | All 377 (backend) and 348 (frontend) entries resolve to `https://registry.npmjs.org` and carry `integrity` hashes. There are no git, URL or tarball dependencies. |
| Suspicious or typosquatted names | None. Every package is a well-known dependency of Express, Prisma, Vite, Vitest, Storybook, React or Testing Library. Versions are pinned exactly (`save-exact=true`). |
| Install-time scripts | `esbuild` and `prisma`/`@prisma/engines` download native binaries, and `fsevents` is macOS-only. `@scarf/scarf` (pulled in by `swagger-ui-express`) sends an install-time telemetry ping. It is not malicious, but it is avoidable: install with `SCARF_ANALYTICS=false`, and in CI use `npm ci --ignore-scripts` followed by an explicit `prisma generate`. |
| Application and config source | No `eval`, `new Function`, `child_process`, encoded payloads or unexpected network calls. The only external URLs are Google Fonts in `frontend/index.html`. `prisma.config.ts`, `vite.config.ts`, `vitest.config.ts` and `.storybook/*` contain only plain configuration. |
| Known vulnerabilities (`npm audit --package-lock-only`) | 21 advisories. Backend: 7 high and 5 moderate (Prisma transitive deps, `zod`, `body-parser`, `qs`, `fast-uri`, `vitest`). Frontend: 1 critical (Storybook dev server), 1 high (Vite dev server) and 7 moderate. These are published CVEs in legitimate packages, mostly in dev servers or DoS-class, and none of them is malware. I left them **unchanged** because dependency upgrades are out of scope for this task (see *Limitations*). |

**Verdict:** the code was safe to install and run locally.

## 1. Technical decisions and rationale
_TODO_

## 2. Prerequisites and how to run the PR workflow
_TODO_

## 3. Where the custom agent and skills live, and how they are used
_TODO_

## 4. Example run
_TODO_

## 5. Assumptions
_TODO_

## 6. Limitations
- The `npm audit` advisories listed in section 0 are not fixed.

_TODO_

## 7. What I would change for production
- Dependabot or Renovate, plus patch upgrades for the advisories in section 0.

_TODO_
