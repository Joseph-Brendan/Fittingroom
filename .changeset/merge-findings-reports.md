---
"@fittingroom/core": minor
"fitting-room": minor
"@fittingroom/mcp": minor
"@fittingroom/citations": minor
---

Merge findings that describe the same root problem on the same element. The merged finding keeps the primary citation, lists the other citation IDs in `related`, and uses the higher severity. Validate related citation IDs against the registry. Save `findings.json` and `report.html` at the end of every audit and print both full paths.
