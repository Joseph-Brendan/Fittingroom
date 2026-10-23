# Fixtures

Small static pages with known UI problems. They back the core capture and audit tests.

## bad-ui

The fixture has 10 planted bugs across all seven page groups. The CLI finds the measured bugs. The
agent finds the judged bugs during heuristic review. Bug 3 is one finding. The primary citation is
`wcag22-3.3.2` and the related citation is `wcag22-4.1.2`.

| #   | Page          | Element                                                                     | Citation                          | Finder |
| --- | ------------- | --------------------------------------------------------------------------- | --------------------------------- | ------ |
| 1   | `/`           | `#helper` status text uses `#a9a9a9` on white                               | `wcag22-1.4.3`                    | CLI    |
| 2   | `/reports`    | `#icon-save` button is 18 by 18 CSS pixels                                  | `wcag22-2.5.8`                    | CLI    |
| 3   | `/signup`     | `#email` input has no label or accessible name                              | `wcag22-3.3.2` and `wcag22-4.1.2` | CLI    |
| 4   | `/onboarding` | `#no-focus` button removes the focus outline with no replacement            | `wcag22-2.4.7`                    | CLI    |
| 5   | `/`           | Fixed banner covers `#focus-target` when it has focus                       | `wcag22-2.4.11`                   | CLI    |
| 6   | `/pricing`    | Image has no alt text                                                       | `wcag22-1.1.1`                    | CLI    |
| 7   | `/checkout`   | `.wide-panel` is 480 CSS pixels wide and overflows a 320 CSS pixel viewport | `wcag22-1.4.10`                   | CLI    |
| 8   | `/settings`   | `#delete-project` button has no confirmation step                           | `nielsen-h5`                      | Agent  |
| 9   | `/settings`   | `#save-changes` button has no loading or saved state                        | `nielsen-h1`                      | Agent  |
| 10  | `/dashboard`  | Jargon copy: "Instantiate a new telemetry pipeline."                        | `nielsen-h2`                      | Agent  |

Bugs 2 and 7 moved from `/` to `/reports` and `/checkout` so every page group has at least one bug.
The original low contrast and hidden focus bugs stay on `/`.

The `app/` folder is a Next.js App Router route tree for route discovery tests. It is not a running
Next.js app. The pages are static HTML served by `serve`. Every page links to the other nine routes
so the URL crawler can discover the same route list without an app folder.

Three extra pages cover audit errors:
- `contrast-cases.html` has text on a gradient, an image, a transparent layer, a canvas and an svg. Each element must become a judged contrast finding, never a measured failure.
- `null-data.html` has no title or language. Axe returns null check data, and the audit must not crash.
- `check-error.html` has an axe violation with no citation and other checks after it. The audit must record the error, finish the other checks and list the error.

## scope-app

This fixture has 14 Next.js App Router pages across five groups. It backs the scope selection and
default capture tests. The four authentication pages are `/login`, `/signup`, `/forgot-password`,
and `/verify`. See `scope-app/README.md` for the full route list.

## good-ui

The mirror fixture. It uses the same folders, routes, layout and content as `bad-ui`, with all 10
bugs fixed. It must return zero findings in every group. It runs on port 3001.

Do not change a fixture without updating its expected findings and the tests that use it.

## slop

Nine pages, one clean control and one page for each slop rule. Every rule fixture must trigger only
its own rule. See `packages/core/test/slop.test.ts`.
