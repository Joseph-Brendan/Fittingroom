# Round 3: the board in a real browser

## Result

PASS

## What I tested

1. Start shop-app on port 3100. PASS. `npm run dev` served `/login` from the real Next.js app.
2. Start the board inside shop-app. PASS. The board bound to `127.0.0.1:4173`.
3. Connected design system. PASS. The banner showed `Design system connected: Tailwind v4 @theme, shadcn/ui.`
4. Inspector tokens. PASS. The Color select listed the app tokens first: brand, brand-dark, ink, paper, card, line, and the rest of the shop-app tokens.
5. Off-system value. PASS. I applied `#ff00ff` to the selected heading. The edit was saved with `offSystem: true`.
6. Live board. PASS. Four registered variants appeared without a page reload.
7. Information design. PASS. The panel listed the login block and density changed to sparse.
8. Approval. PASS. The board approved Refined in slot 1.

## Evidence

Board request and cards:

```text
scope: Authentication
variants: 4
status: approved
banner: Design system connected: Tailwind v4 @theme, shadcn/ui.
```

Token options:

```text
Choose a token
brand (#0f766e)
brand-dark (#115e59)
ink (#0d2b28)
paper (#f4fbf9)
card (#ffffff)
line (#d7e3df)
...
Custom value
```

Off-system edit:

```text
op: set-token
id: fr-h1-1
property: color
token: #ff00ff
offSystem: true
```

Structure:

```text
scope: auth
page: /login
density: sparse
blocks: fr-section-1, hero
```

Screenshots:
- `test-reports/run-2/screenshots/round-3/shop-board-request.png`
- `test-reports/run-2/screenshots/round-3/shop-board-connected.png`
- `test-reports/run-2/screenshots/round-3/shop-inspector-tokens.png`
- `test-reports/run-2/screenshots/round-3/shop-offsystem-color.png`
- `test-reports/run-2/screenshots/round-3/shop-structure-density.png`

Logs:
- `test-reports/run-2/logs/round-3/shop-app-dev.log`
- `test-reports/run-2/logs/round-4/shop-token-options.json`
- `test-reports/run-2/logs/round-4/shop-edit-log-after-color.json`
- `test-reports/run-2/logs/round-4/shop-structure.json`

## Failures found and fixed

1. The connected banner disappeared after the Generate request. The board replaced its in-memory state with `board.json`, which does not store the detected design system. Test added: `keeps the connected design system after a board request`. Fix: the board server merges the in-memory design system and scopes after every file update.
2. The information design panel was empty for variants that return a fragment with a style tag. The block finder chose the style element as the root. Test added: `finds blocks inside a fragment with a style tag`. Fix: the block finder now prefers `main` and skips style and script elements.

## Needs Joseph

None.
