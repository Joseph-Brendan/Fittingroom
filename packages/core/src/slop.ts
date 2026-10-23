import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import type { CapturedElement, CaptureResult, SlopEvidence } from "./capture";

export interface SlopRuleResult {
  evidence: string[];
  id: string;
  title: string;
  weight: number;
}

export interface SlopReport {
  rules: SlopRuleResult[];
  score: number;
  topRules: SlopRuleResult[];
}

export interface SlopRule {
  detect: (evidence: SlopEvidence) => string[];
  id: string;
  title: string;
  weight: number;
}

const emojiPattern = /\p{Extended_Pictographic}/u;
const genericHeadlinePatterns = [
  /\b(supercharge|unlock|elevate|transform|build|create|launch|empower)\b.*\b(future|potential|workflow|business|ideas|growth|experience|success)\b/i,
  /\bthe (all-in-one|ultimate|complete) (platform|solution|toolkit)\b/i,
  /\b(take|bring) .* to the next level\b/i,
  /\beverything you need\b/i,
  /\byour .*, (simplified|reimagined|amplified)\b/i,
];

function hueOf(value: string): number | null {
  const match = value.match(/rgba?\(([^)]+)\)/);

  if (match === null) {
    return null;
  }

  const [red = 0, green = 0, blue = 0] = (match[1] ?? "")
    .split(",")
    .map((part) => Number.parseFloat(part.trim()));
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  if (delta === 0) {
    return 0;
  }

  let hue: number;

  if (max === r) {
    hue = ((g - b) / delta) % 6;
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }

  hue *= 60;

  return hue < 0 ? hue + 360 : hue;
}

function gradientHasPurpleAndBlue(value: string): boolean {
  if (!value.includes("linear-gradient")) {
    return false;
  }

  const hues = [...value.matchAll(/rgba?\([^)]+\)/g)].flatMap((match) => {
    const hue = hueOf(match[0]);

    return hue === null ? [] : [hue];
  });
  const hasPurple = hues.some((hue) => hue > 250 && hue <= 305);
  const hasBlue = hues.some((hue) => hue >= 200 && hue < 250);

  return hasPurple && hasBlue;
}

function isButton(element: CapturedElement): boolean {
  return (
    element.tag === "button" ||
    element.attributes.role === "button" ||
    element.classes.some((name) => name.includes("button") || name.includes("btn"))
  );
}

function hasDecoratedButton(element: CapturedElement): boolean {
  return (
    element.styles.backgroundImage !== "none" ||
    (element.styles.boxShadow !== "none" && element.styles.boxShadow.trim() !== "")
  );
}

function isHeadline(element: CapturedElement): boolean {
  return element.tag === "h1" || element.tag === "h2" || element.tag === "h3";
}

function blobEvidence(element: CapturedElement): boolean {
  const attributes = Object.values(element.attributes).join(" ");
  const value = `${element.classes.join(" ")} ${attributes}`;

  return /\b(blob|orb|sphere|3d)\b/i.test(value);
}

export const SLOP_RULES: SlopRule[] = [
  {
    id: "gradient-hero",
    title: "Purple to blue gradient hero",
    weight: 20,
    detect: (evidence) =>
      evidence.elements.flatMap((element) => {
        const isHero =
          element.classes.some((name) => name.includes("hero")) ||
          element.attributes.id?.includes("hero") === true ||
          element.tag === "section";

        if (!isHero || !gradientHasPurpleAndBlue(element.styles.backgroundImage)) {
          return [];
        }

        return [`${element.selector}: ${element.styles.backgroundImage}`];
      }),
  },
  {
    id: "identical-cards",
    title: "Three identical feature cards",
    weight: 12,
    detect: (evidence) =>
      evidence.elements.flatMap((element) => {
        const groups = new Map<string, number>();

        for (const child of element.children) {
          const looksLikeCard =
            child.signature.startsWith("article") || /card|feature|tile/i.test(child.signature);

          if (!looksLikeCard || child.childCount < 2 || child.textLength === 0) {
            continue;
          }

          groups.set(child.signature, (groups.get(child.signature) ?? 0) + 1);
        }

        return [...groups.entries()]
          .filter(([, count]) => count >= 3)
          .map(
            ([signature, count]) => `${element.selector}: ${count} matching ${signature} children`,
          );
      }),
  },
  {
    id: "emoji-icons",
    title: "Emoji used as icons",
    weight: 10,
    detect: (evidence) =>
      evidence.elements.flatMap((element) => {
        if (!emojiPattern.test(element.directText)) {
          return [];
        }

        const withoutEmoji = element.directText.replace(new RegExp(emojiPattern, "gu"), "").trim();

        if (withoutEmoji.length > 8) {
          return [];
        }

        return [`${element.selector}: ${element.directText}`];
      }),
  },
  {
    id: "centered-sections",
    title: "Every section centered",
    weight: 12,
    detect: (evidence) => {
      const sections = evidence.elements.filter(
        (element) => element.tag === "section" && element.text.length > 0,
      );

      if (
        sections.length < 3 ||
        !sections.every((section) => section.styles.textAlign === "center")
      ) {
        return [];
      }

      return sections.map((section) => `${section.selector}: text-align center`);
    },
  },
  {
    id: "single-font-weight",
    title: "One font at one weight",
    weight: 8,
    detect: (evidence) => {
      const textElements = evidence.elements.filter(
        (element) => element.directText.length > 0 && element.styles.fontSize !== "0px",
      );

      if (textElements.length < 5) {
        return [];
      }

      const fonts = new Set(textElements.map((element) => element.styles.fontFamily));
      const weights = new Set(textElements.map((element) => element.styles.fontWeight));

      if (fonts.size !== 1 || weights.size !== 1) {
        return [];
      }

      return [
        `${textElements.length} text elements use ${[...fonts][0]} at weight ${[...weights][0]}`,
      ];
    },
  },
  {
    id: "button-effects",
    title: "Glow or gradient on most buttons",
    weight: 10,
    detect: (evidence) => {
      const buttons = evidence.elements.filter(isButton);

      if (buttons.length < 2) {
        return [];
      }

      const decorated = buttons.filter(hasDecoratedButton);

      if (decorated.length <= buttons.length / 2) {
        return [];
      }

      return decorated.map(
        (button) =>
          `${button.selector}: ${button.styles.backgroundImage !== "none" ? button.styles.backgroundImage : button.styles.boxShadow}`,
      );
    },
  },
  {
    id: "generic-headlines",
    title: "Generic headline phrases",
    weight: 14,
    detect: (evidence) =>
      evidence.elements.flatMap((element) => {
        if (!isHeadline(element) || element.text.length === 0) {
          return [];
        }

        if (!genericHeadlinePatterns.some((pattern) => pattern.test(element.text))) {
          return [];
        }

        return [`${element.selector}: ${element.text}`];
      }),
  },
  {
    id: "stock-blobs",
    title: "Stock 3D blobs",
    weight: 12,
    detect: (evidence) =>
      evidence.elements.flatMap((element) =>
        blobEvidence(element)
          ? [`${element.selector}: ${element.attributes["aria-label"] ?? "3D blob"}`]
          : [],
      ),
  },
];

export async function detectSlop(captures: CaptureResult): Promise<SlopReport> {
  const triggered = new Map<string, string[]>();

  for (const page of captures.pages) {
    const evidence = JSON.parse(await readFile(page.slopEvidencePath, "utf8")) as SlopEvidence;

    for (const rule of SLOP_RULES) {
      const findings = rule.detect({ ...evidence, path: page.path });

      if (findings.length === 0) {
        continue;
      }

      const existing = triggered.get(rule.id) ?? [];

      for (const finding of findings.slice(0, 5)) {
        existing.push(`${page.path}: ${finding}`);
      }

      triggered.set(rule.id, existing);
    }
  }

  const rules = SLOP_RULES.flatMap((rule) => {
    const evidence = triggered.get(rule.id);

    return evidence === undefined
      ? []
      : [{ evidence, id: rule.id, title: rule.title, weight: rule.weight }];
  }).sort((left, right) => right.weight - left.weight);
  const score = Math.min(
    100,
    rules.reduce((total, rule) => total + rule.weight, 0),
  );

  return {
    rules,
    score,
    topRules: rules.slice(0, 3),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function slopScoreCardHtml(report: SlopReport): string {
  const topRules = [...report.rules].sort((left, right) => right.weight - left.weight).slice(0, 3);
  const rules =
    topRules.length === 0
      ? '<p class="empty">No slop rules triggered.</p>'
      : topRules
          .map(
            (rule, index) => `
              <li>
                <span class="rank">${index + 1}</span>
                <span class="rule">${escapeHtml(rule.title)}</span>
                <span class="weight">+${rule.weight}</span>
              </li>`,
          )
          .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <style>
      * { box-sizing: border-box; }
      html, body { width: 1200px; height: 630px; margin: 0; overflow: hidden; }
      body {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 64px 72px 48px;
        background: #10131a;
        color: #f8fafc;
        font-family: Arial, sans-serif;
      }
      .eyebrow { color: #a5b4fc; font-size: 22px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
      .score-row { display: flex; align-items: flex-end; gap: 18px; margin-top: 18px; }
      .score { font-size: 168px; font-weight: 800; line-height: 0.85; letter-spacing: -0.06em; }
      .out-of { color: #94a3b8; font-size: 34px; padding-bottom: 10px; }
      .label { color: #cbd5e1; font-size: 26px; margin-top: 22px; }
      ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
      li { display: grid; grid-template-columns: 36px 1fr auto; align-items: center; gap: 16px; font-size: 24px; }
      .rank { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; background: #312e81; color: #c7d2fe; font-size: 17px; font-weight: 700; }
      .rule { color: #f1f5f9; }
      .weight { color: #a5b4fc; font-weight: 700; }
      .empty { color: #cbd5e1; font-size: 26px; margin: 0; }
      footer { display: flex; align-items: center; justify-content: space-between; border-top: 1px solid #273043; padding-top: 24px; color: #94a3b8; font-size: 22px; }
      .brand { color: #f8fafc; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">Slop score</div>
      <div class="score-row">
        <div class="score">${report.score}</div>
        <div class="out-of">/ 100</div>
      </div>
      <div class="label">The strongest signals in this capture:</div>
      <ol>${rules}</ol>
    </main>
    <footer>
      <span class="brand">Checked with Fitting Room</span>
      <span>Try your UI on before you ship it.</span>
    </footer>
  </body>
</html>`;
}

export async function renderSlopScoreCard(report: SlopReport, outputPath: string): Promise<string> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { height: 630, width: 1200 } });

    await page.setContent(slopScoreCardHtml(report), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ animations: "disabled", caret: "hide", path: outputPath });
  } finally {
    await browser.close();
  }

  return outputPath;
}
