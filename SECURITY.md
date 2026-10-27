# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.0.x   | Yes       |

Fitroom is pre-1.0. Security fixes go to the latest release only.

## Reporting a vulnerability

Use the private vulnerability reporting form in the GitHub repository. Open the Security tab and
choose "Report a vulnerability".

If the private form is not available, contact the maintainer listed in `CITATION.cff` through the
repository's listed contact method. Do not open a public issue for a vulnerability.

Include:
- The version and package you tested.
- Steps to reproduce the issue.
- The impact you expect.
- Any proof of concept, log, or screenshot that helps.

Do not include real secrets, private source code, or personal data from another person.

## Our response

We aim to acknowledge a report within 3 business days. We will confirm the issue, agree on a fix
window, and credit you if you want credit. Please give us time to release a fix before you publish
details.

## Security design

Fitroom follows these rules:
- The board and WebSocket bind to `127.0.0.1`.
- The board requires a session token on every request.
- Source code, screenshots, and findings stay on the user's machine.
- User code runs only in the user's own dev server.
- Writes stay inside the project and `.fitroom/`.
- GitHub Actions are pinned to full commit SHAs.
- npm releases use OIDC trusted publishing.

These rules are part of the design. A report that these rules are not enforced is a security bug.

## Out of scope

- Vulnerabilities in a fixture app. Fixtures are intentionally simple test pages.
- Reports that require access to a machine that is already compromised.
- Social engineering of the maintainer.
