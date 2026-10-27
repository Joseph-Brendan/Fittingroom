# Fitting Room: Product Decisions v1

Approved by Joseph Brendan on 24 October 2026. These decisions answer every "Needs Joseph" item from the full test run. Build exactly what this file says. If something here is unclear, ask before guessing.

Build order: D1, D2, D3, D4, D5, D6, D7. Each decision ends with "Done when". A decision is not done until every line of "Done when" passes with tests.

---

## D1. Packaging: one bundled package

**Decision:** Publish one npm package, `fitroom`, from `packages/cli`. Do not publish `@fittingroom/core`, `@fittingroom/citations`, `@fittingroom/directions` or `@fittingroom/board`.

The package install and MCP client commands are `npx fitroom`, `npx -y fitroom mcp` and `claude mcp add fitting-room -- npx -y fitroom mcp`. Antigravity and Cursor use `"command": "npx"` with `"args": ["-y", "fitroom", "mcp"]`.

**Why:** Users install one thing and remember one name. We do not own the `@fittingroom` scope on npm, and four extra packages mean four times the release work.

**How:**

1. tsup in `packages/cli` bundles every workspace package into `dist`. Use `noExternal: [/^@fittingroom\//]`.
2. `registry.json` and every `directions/*.json` file are imported as JSON so they end up inside the bundle. No code may read them from a path in another package at runtime.
3. Build the board with Vite into `packages/board/dist`. Copy that folder into `packages/cli/dist/board` as part of the CLI build. The CLI serves the board from `dist/board`.
4. Third-party runtime libraries (for example playwright, axe-core, ts-morph, ws, the MCP SDK) stay as normal `dependencies` in `packages/cli/package.json`.
5. Every other workspace package gets `"private": true`.
6. One binary: `fitroom`. The MCP server starts with `fitroom mcp`.
7. `"files": ["dist"]` in `packages/cli/package.json`.

**Done when:**

- `npm pack` in `packages/cli` makes one `.tgz` file.
- Installing that file in a new empty folder outside the repo works, and `npx fitroom --help`, `npx fitroom audit`, `npx fitroom board` and `npx fitroom mcp` all run with no "Cannot find module" error.
- `npm pack --dry-run` lists no fixtures, tests, test-reports, `.env` files or source files outside `dist`.

---

## D2. The board bridge and approval flow

**Decision:** The agent and the board talk through files in `.fittingroom`, watched in real time. The board never runs a model. The agent never needs to know the board's port.

**Why:** The MCP server is started by the agent over stdio. The board is a separate process. Files are the simplest link that survives restarts, works on every operating system, and leaves a record we can debug.

**How:**

1. **One state file:** `.fittingroom/board.json`. It holds the current scope, the current round number, the four slots, pins, the selected variant, and a `status`.
2. **Status values, in order:** `empty`, `generating`, `directions_ready`, `approved`, `handoff_created`, `verifying`, `verified`, `verify_failed`.
3. **Requests from the board:** when the user clicks Generate, Regenerate, Regenerate one slot, or Approve, the board appends a request to `.fittingroom/requests.json` with an id, type, slot (if any), and time. The board shows "Waiting for your agent" and the exact sentence to give the agent.
4. **Lock file:** when the board starts, it writes `.fittingroom/board.lock` with its process id, port and session token. It deletes the file on exit. A stale lock (process no longer running) is ignored and replaced.
5. **New MCP tools:**
    - `fr_open_board()`: starts the board if no live lock exists, then returns its URL.
    - `fr_board_status()`: returns `board.json` plus any open requests.
    - `fr_wait_for_user(timeoutSeconds)`: waits until there is an open request or the status becomes `approved`, then returns it. The default timeout is 600 seconds. On timeout, it returns `{ timedOut: true }`.
    - `fr_complete_request(id)`: marks a request done.
6. **Live updates:** the board server watches `.fittingroom` and pushes changes to the browser over its WebSocket. When the agent registers a new variant, the card appears without a page reload.
7. **Approve:** the Approve button sets `status: "approved"` and `approved: { slot, slug, round }`. It is disabled until the user picks a card.

**Done when:**

- An end-to-end test runs the MCP server and the board together. It clicks Generate on the board, the test agent picks up the request with `fr_wait_for_user`, registers 4 variants, the cards appear live, the test clicks a card and Approve, and `fr_wait_for_user` returns the approval.
- Killing the board and starting it again restores the same state from `board.json`.

---

## D3. The editor and undo

**Decision:** Build the editor exactly as the roadmap describes: edits are operations, applied to real code, recorded in a log.

**How:**

1. A compiler step stamps every JSX element in each variant file with a stable `data-fr-id`.
2. When a variant is registered, save an untouched copy as `.fittingroom/variants/<slug>.orig.tsx`.
3. **Operations:** `set-text`, `set-token`, `move`, `delete`, `duplicate`, `insert`, `swap-section`. Each one targets a `data-fr-id`.
4. Apply operations with ts-morph. The output is formatted with the project's formatter, or Prettier defaults if there is none.
5. Each variant has its own log: `.fittingroom/edits/<slug>.json`.
6. **Undo:** rebuild the variant from `<slug>.orig.tsx` by replaying the log minus the last operation. **Redo:** replay the undone operation. A new edit after an undo clears the redo stack.
7. **Inspector:** text, color, font size, spacing, radius, font weight, visibility. When a design system is connected, the token options come first. An off-system value is allowed but saved with `offSystem: true`.
8. **Move:** drag with dnd-kit, only among siblings inside the same parent.
9. **Insert:** the project's own components first, then the basic set: heading, text, button, input, image, card, list.
10. Keyboard: Cmd or Ctrl + Z to undo, Cmd or Ctrl + Shift + Z to redo, Delete to remove the selected element, Escape to deselect.

**Done when:**

- For each operation there is a test with a before file, the operation, and the expected after file.
- In a real browser, each operation changes the variant file, the card reloads in under 2 seconds, and undo then redo returns the exact same file both times.

---

## D4. Restoring an earlier round

**Decision:** Every generate and regenerate makes a new numbered round. Nothing is ever deleted. Restoring copies an old variant back into a slot.

**How:**

1. Each round is saved in `.fittingroom/rounds/<n>/`, with the variant files, their edit logs, screenshots, the direction slug of each slot, and the rationale lines.
2. `history.json` lists every round with its time, scope, and the 4 direction slugs.
3. The "Previous" strip on the board shows each round as a row of 4 thumbnails.
4. **Restore:** the user clicks an old variant, then clicks Restore. It goes back into the slot of the same role (Refined into slot 1, Native into slot 2, and so on), with its edit log. The variant it replaces moves into the current round's history, so it can be restored later.
5. A restored variant counts as seen for the no-repeats rule.
6. Slot 1 can only receive a Refined variant from an earlier round. Slots 2 to 4 can receive any variant of the same role.

**Done when:**

- A browser test generates 3 rounds, restores a variant from round 1 into its slot, checks that its code and edits come back exactly, then restores the replaced variant again.

---

## D5. The information design panel and structure.json

**Decision:** The panel lists the content blocks of the main page in the scope. The user can reorder, hide, promote, group, collapse, and set density. Changes are applied to the selected variant as normal edit operations and saved in `structure.json`.

**How:**

1. **Finding blocks:** read the accessibility tree and the variant source. Each top-level landmark or section is a block. Give each block a kind from this list: `nav`, `hero`, `headline`, `value`, `cta`, `social-proof`, `features`, `pricing`, `form`, `table`, `chart`, `list`, `media`, `faq`, `footer`, `other`.
2. **`structure.json` schema:**

    ```json
    {
      "scope": "authentication",
      "page": "/signup",
      "density": "balanced",
      "blocks": [
        {
          "id": "fr-12",
          "label": "Signup form",
          "kind": "form",
          "order": 1,
          "visible": true,
          "priority": "hero",
          "group": null,
          "collapse": "none"
        }
      ]
    }
    ```

    `density` is `sparse`, `balanced` or `dense`. `priority` is `hero`, `normal` or `secondary`. `collapse` is `none`, `tab` or `accordion`.
3. **Applying changes:** reorder uses `move`. Hide uses `delete` and is marked reversible, so unhiding brings it back from the original. Promote to hero moves the block to the top and applies the direction's hero styles. Group wraps two blocks in a shared container. Collapse wraps a block in an accessible tab or accordion that follows the WAI-ARIA Authoring Practices.
4. **Density** changes the spacing scale: sparse uses the next step up, dense uses the next step down, and balanced keeps the direction's default.
5. The handoff includes `structure.json`. `fr_verify` checks the built page's block order and visibility against it.

**Done when:**

- Each action has a test that checks both the new variant code and the new `structure.json`.
- `fr_verify` fails when the built page shows blocks in the wrong order, and passes when the order is right.

---

## D6. Design memory and what counts as breaking it

**Decision:** When a design is approved, save it as design memory. Later audits flag any measured difference from it, with a citation to the project's own design memory.

**How:**

1. On `fr_handoff`, write two files:
    - `.fittingroom/DESIGN.md`, for people. It lists the direction name, type pair and type scale, color tokens, spacing scale, radius scale, density, the approved button and input styles, and the direction's do and don't lists.
    - `.fittingroom/design-memory.json`, for code. It holds the same values in machine form.
2. If design memory already exists, a new approval updates it and keeps the old version as `DESIGN.<date>.md`.
3. **A page breaks design memory when any of these is measured on a visible element:**

    | Rule | Breaks when | Severity |
    | --- | --- | --- |
    | Color | Text, background or border color is not a saved token and is more than 3 Delta E (2000) from the nearest token | 2, or 3 on a primary button |
    | Font family | The font is not in the saved type pair | 2 |
    | Font size | The size is not on the type scale, with 1 px tolerance | 2 |
    | Spacing | Padding or gap is not on the spacing scale, with 2 px tolerance | 1 |
    | Radius | The radius is not on the radius scale, with 1 px tolerance | 1 |
    | Primary button | The computed styles differ from the approved primary button | 3 |

4. **Citation:** add a new kind of registry entry, `project`, with the ID `project-design-memory`. Its URL is the local path to `DESIGN.md`. Every design memory finding cites it as primary, with `nielsen-h4` (Consistency and Standards) as related. The confidence is `measured`.
5. Elements inside third-party embeds (iframes, maps, video players) are skipped.

**Done when:**

- A test approves a design, then audits a new page with one break of each kind from the table. Each break is found exactly once, with the right severity and both citations.
- A page that follows the design memory gives zero design memory findings.

---

## D7. The states check

**Decision:** Reach each state from outside the app first, so no app code changes are needed. Score each state as pass, fail or not reachable.

**How:**

1. **How each state is reached, with Playwright:**

    | State | How we reach it |
    | --- | --- |
    | Empty | Intercept same-origin JSON API responses and return an empty array or empty object |
    | Loading | Delay same-origin API responses by 10 seconds and capture at 1.5 seconds |
    | Error | Return status 500 from same-origin API responses |
    | Long text | Make every string in JSON responses 3 times longer, and repeat visible headings and labels 3 times in the page |
    | Dark mode | Emulate `prefers-color-scheme: dark`, and also add the class `dark` to the html element |

2. **Optional app hook:** if the app reads `?fr-state=empty`, `loading`, `error` or `long` from the URL, use that instead of interception. Never add this hook to the user's app unless they ask.
3. **Not reachable:** if a page makes no same-origin API calls, mark Empty, Loading and Error as "not reachable" with a short plain-English reason. This is not a failure.
4. **How each state is scored:**

    | State | Passes when | Citation when it fails |
    | --- | --- | --- |
    | Empty | A visible message explains the empty state and gives a next step (a button or a link) | nielsen-h1, related nielsen-h10 |
    | Loading | A loading indicator shows within 1 second: `aria-busy`, `role="progressbar"`, `role="status"`, or a skeleton or spinner element | nielsen-h1 |
    | Error | A visible error message names the problem and offers a way to recover (retry, go back, or contact) | nielsen-h9 |
    | Long text | No text is clipped or overflows its container, and the page has no horizontal scroll at 320 px | wcag22-1.4.10, related wcag22-1.4.12 |
    | Dark mode | The full contrast audit passes in dark mode | wcag22-1.4.3 and wcag22-1.4.11 |

5. Save the screenshots in `.fittingroom/states/<page>/<state>-<width>.png`. Save the results in `.fittingroom/states/report.json`.

**Done when:**

- New pages in `fixtures/bad-ui` that call a small local API are used to test each state. Each state has one failing case and one passing case, and each is scored correctly.
- A page with no API calls marks Empty, Loading and Error as not reachable.