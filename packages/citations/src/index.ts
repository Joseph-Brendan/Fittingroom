import registryData from "../registry.json";

export const approvedSources = [
  "WCAG 2.2",
  "Nielsen's 10 Usability Heuristics",
  "NN/g 0 to 4 severity scale",
  "Apple Human Interface Guidelines",
  "Material Design 3",
  "WAI-ARIA Authoring Practices Guide",
  "Laws of UX",
] as const;

export const citationLevels = ["A", "AA", "AAA", "N/A"] as const;

export type ApprovedSource = (typeof approvedSources)[number];
export type CitationLevel = (typeof citationLevels)[number];

export interface Citation {
  id: string;
  source: ApprovedSource;
  criterion: string;
  title: string;
  url: string;
  version: string;
  level: CitationLevel;
}

export interface CitationRegistry {
  version: number;
  citations: Citation[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export type FindingConfidence = "measured" | "judged";

export interface FindingEvidence {
  selector: string;
  screenshotPath: string;
  measuredValue: string;
}

export interface Finding {
  id: string;
  title: string;
  citation: string;
  severity: number;
  confidence: FindingConfidence;
  evidence: string | FindingEvidence;
  fix: string;
}

export const citationRegistry = registryData as CitationRegistry;

const approvedHosts = ["w3.org", "nngroup.com", "developer.apple.com", "m3.material.io"] as const;

const citationIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

const citationIds = new Set(citationRegistry.citations.map((citation) => citation.id));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isApprovedSource(value: string): value is ApprovedSource {
  return approvedSources.some((source) => source === value);
}

function isCitationLevel(value: string): value is CitationLevel {
  return citationLevels.some((level) => level === value);
}

function isApprovedUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return (
      url.protocol === "https:" &&
      approvedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
    );
  } catch {
    return false;
  }
}

function validateCitation(value: unknown, index: number): string[] {
  const label = `Citation ${index + 1}`;

  if (!isRecord(value)) {
    return [`${label} must be an object.`];
  }

  const errors: string[] = [];
  const { id, source, criterion, title, url, version, level } = value;

  if (typeof id !== "string" || !citationIdPattern.test(id)) {
    errors.push(`${label} needs a lowercase hyphenated id.`);
  }

  if (typeof source !== "string" || !isApprovedSource(source)) {
    errors.push(`${label} has a source that is not approved.`);
  }

  if (typeof criterion !== "string" || criterion.trim().length === 0) {
    errors.push(`${label} needs a criterion.`);
  }

  if (typeof title !== "string" || title.trim().length === 0) {
    errors.push(`${label} needs a title.`);
  }

  if (typeof url !== "string" || !isApprovedUrl(url)) {
    errors.push(`${label} has a URL that is not on the approved source list.`);
  }

  if (typeof version !== "string" || version.trim().length === 0) {
    errors.push(`${label} needs a version.`);
  }

  if (typeof level !== "string" || !isCitationLevel(level)) {
    errors.push(`${label} needs a level of A, AA, AAA, or N/A.`);
  }

  return errors;
}

export function validateCitationRegistry(value: unknown): ValidationResult {
  if (!isRecord(value)) {
    return { valid: false, errors: ["Registry must be an object."] };
  }

  const errors: string[] = [];

  if (value.version !== 1) {
    errors.push("Registry version must be 1.");
  }

  if (!Array.isArray(value.citations)) {
    errors.push("Registry citations must be an array.");

    return { valid: false, errors };
  }

  if (value.citations.length === 0) {
    errors.push("Registry must include at least one citation.");
  }

  const ids = new Set<string>();

  value.citations.forEach((citation, index) => {
    errors.push(...validateCitation(citation, index));

    if (!isRecord(citation) || typeof citation.id !== "string") {
      return;
    }

    if (ids.has(citation.id)) {
      errors.push(`Citation ${index + 1} repeats the id ${citation.id}.`);
    }

    ids.add(citation.id);
  });

  return { valid: errors.length === 0, errors };
}

function validateEvidence(evidence: string | FindingEvidence): string[] {
  if (typeof evidence === "string") {
    return evidence.trim().length === 0 ? ["Evidence must not be empty."] : [];
  }

  if (!isRecord(evidence)) {
    return [
      "Evidence must be text or an object with a selector, screenshot path, and measured value.",
    ];
  }

  const errors: string[] = [];

  if (typeof evidence.selector !== "string" || evidence.selector.trim().length === 0) {
    errors.push("Evidence needs a selector.");
  }

  if (typeof evidence.screenshotPath !== "string" || evidence.screenshotPath.trim().length === 0) {
    errors.push("Evidence needs a screenshot path.");
  }

  if (typeof evidence.measuredValue !== "string" || evidence.measuredValue.trim().length === 0) {
    errors.push("Evidence needs a measured value.");
  }

  return errors;
}

export function validate(finding: Finding): ValidationResult {
  const errors: string[] = [];

  if (!citationIds.has(finding.citation)) {
    errors.push(`Citation ${finding.citation} is not in the registry.`);
  }

  errors.push(...validateEvidence(finding.evidence));

  return { valid: errors.length === 0, errors };
}
