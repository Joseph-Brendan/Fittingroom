# Fixtures

Small static pages with known UI problems. They back the core capture and audit tests.

## bad-ui

The root page has four planted bugs. Each one must produce exactly one finding:
- The status text uses `#a9a9a9` on white. Expected citation: `wcag22-1.4.3`.
- The icon save button is 18 by 18 CSS pixels. Expected citation: `wcag22-2.5.8`.
- The fixed announcement covers the `#focus-target` button when it has focus. Expected citation: `wcag22-2.4.11`.
- The recent activity panel is 480 CSS pixels wide and overflows a 320 CSS pixel viewport. Expected citation: `wcag22-1.4.10`.

The `app/` folder is a Next.js App Router route tree for route discovery tests. It is not a running Next.js app. The capture and audit tests serve the static HTML pages with a small local HTTP server. The `login.html`, `signup.html`, and `pricing.html` pages support the scoped tool tests.

## scope-app

This fixture has 14 Next.js App Router pages across five groups. It backs the scope selection and
default capture tests. The four authentication pages are `/login`, `/signup`, `/forgot-password`,
and `/verify`. See `scope-app/README.md` for the full route list.

## good-ui

The control page. It must return zero findings.

Do not change a fixture without updating its expected findings and the tests that use it.

## slop

Nine pages, one clean control and one page for each slop rule. Every rule fixture must trigger only
its own rule. See `packages/core/test/slop.test.ts`.
