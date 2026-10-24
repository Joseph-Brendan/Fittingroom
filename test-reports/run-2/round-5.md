# Round 5: install like a stranger

## Result

PASS

## What I tested

1. Build the package. PASS.
2. `npm pack --dry-run` in `packages/cli`. PASS. It listed only `dist`.
3. Pack and install the tarball in a new empty folder outside the repo. PASS.
4. Run the stranger binary from `fixtures/bad-ui` against port 3000. PASS.
5. Run the linked binary from `fixtures/bad-ui` against port 3000. PASS.
6. Compare the findings. PASS. They match ignoring `generatedAt`.

## Pack file list

```text
npm notice Tarball Contents
npm notice 9.0kB dist/board/assets/index-CMBZ724r.css
npm notice 292.2kB dist/board/assets/index-DxcBO1Hn.js
npm notice 480B dist/board/index.html
npm notice 20B dist/index.d.ts
npm notice 415.0kB dist/index.js
npm notice 796.3kB dist/index.js.map
npm notice 1.1kB package.json
npm notice Tarball Details
npm notice name: fitting-room
npm notice version: 0.0.0
npm notice filename: fitting-room-0.0.0.tgz
npm notice package size: 331.7 kB
npm notice unpacked size: 1.5 MB
npm notice shasum: ecd9de73a77021bc91d7bf1801826c67a850a788
npm notice integrity: sha512-ehQ6CXQlq/D6h[...]eCTC/rlLAMitg==
npm notice total files: 7
```

## Audit result

Both installs printed:

```text
Capturing: Marketing (2 pages): / /pricing, at 375, 768 and 1440 px.
Automated findings: 3.
- /: Elements must meet minimum color contrast ratio thresholds [wcag22-1.4.3], severity 3.
- /: Focused control is hidden by page content [wcag22-2.4.11], severity 3.
- /pricing: Images must have alternative text [wcag22-1.1.1], severity 4.
Checks that hit errors:
- None.
```

Findings comparison:

```text
Match ignoring generatedAt: true
Findings: 3
```

## Evidence

- `test-reports/run-2/logs/round-5/npm-pack-dry-run.log`
- `test-reports/run-2/logs/round-5/npm-pack.log`
- `test-reports/run-2/logs/round-5/npm-install.log`
- `test-reports/run-2/logs/round-5/stranger-audit.log`
- `test-reports/run-2/logs/round-5/linked-audit.log`
- `test-reports/run-2/logs/round-5/stranger-findings.json`
- `test-reports/run-2/logs/round-5/linked-findings.json`
- `test-reports/run-2/logs/round-5/findings-diff.log`
- `test-reports/run-2/logs/round-5/findings-comparison.txt`

## Failures found and fixed

None in this round.

## Needs Joseph

Publishing is still a release action. The package is ready for a trusted publish.
