import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import type { Finding } from "./audit";
import { fitroomFilePath, writeFileAtomic, writeJsonAtomic } from "./fitroom-store";

export interface DesignMemoryButton {
  backgroundColor: string;
  borderRadius: string;
  color: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  padding: string;
}

export interface DesignMemoryInput {
  backgroundColor: string;
  borderColor: string;
  borderRadius: string;
  color: string;
  fontFamily: string;
  fontSize: string;
  padding: string;
}

export interface DesignMemory {
  version: 1;
  direction: {
    slug: string;
    name: string;
    description: string;
  };
  type: {
    pair: string[];
    scale: number[];
  };
  colors: Record<string, string>;
  spacing: Record<string, string>;
  radii: Record<string, string>;
  density: "sparse" | "balanced" | "dense";
  button: DesignMemoryButton;
  input: DesignMemoryInput;
  do: string[];
  dont: string[];
}

export interface SaveDesignMemoryResult {
  files: string[];
}

export interface AuditDesignMemoryInput {
  outputDir?: string;
  projectRoot: string;
  url: string;
}

interface MeasuredElement {
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  borderRadius: string;
  color: string;
  columnGap: string;
  directText: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  isPrimary: boolean;
  padding: [string, string, string, string];
  rowGap: string;
  selector: string;
  tag: string;
}

const rgbPattern = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/i;

interface Rgb {
  b: number;
  g: number;
  r: number;
}

function parseColor(value: string): Rgb | null {
  const trimmed = value.trim();

  if (trimmed === "" || trimmed === "transparent") {
    return null;
  }

  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) {
    const hex = trimmed.slice(1);

    if (hex.length === 3) {
      return {
        r: Number.parseInt(`${hex[0]}${hex[0]}`, 16),
        g: Number.parseInt(`${hex[1]}${hex[1]}`, 16),
        b: Number.parseInt(`${hex[2]}${hex[2]}`, 16),
      };
    }

    if (hex.length === 6 || hex.length === 8) {
      return {
        r: Number.parseInt(hex.slice(0, 2), 16),
        g: Number.parseInt(hex.slice(2, 4), 16),
        b: Number.parseInt(hex.slice(4, 6), 16),
      };
    }
  }

  const match = trimmed.match(rgbPattern);

  if (match === null) {
    return null;
  }

  const alpha = match[4] === undefined ? 1 : Number(match[4]);

  if (alpha === 0) {
    return null;
  }

  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
  };
}

function toLinear(value: number): number {
  const normalized = value / 255;

  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function rgbToLab(rgb: Rgb): [number, number, number] {
  const r = toLinear(rgb.r);
  const g = toLinear(rgb.g);
  const b = toLinear(rgb.b);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const pivot = (value: number) => (value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116);
  const fx = pivot(x);
  const fy = pivot(y);
  const fz = pivot(z);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE2000(first: Rgb, second: Rgb): number {
  const [l1, a1, b1] = rgbToLab(first);
  const [l2, a2, b2] = rgbToLab(second);
  const rad = Math.PI / 180;
  const c1 = Math.sqrt(a1 ** 2 + b1 ** 2);
  const c2 = Math.sqrt(a2 ** 2 + b2 ** 2);
  const cBar = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const a1Prime = a1 * (1 + g);
  const a2Prime = a2 * (1 + g);
  const c1Prime = Math.sqrt(a1Prime ** 2 + b1 ** 2);
  const c2Prime = Math.sqrt(a2Prime ** 2 + b2 ** 2);
  const hue1 = Math.atan2(b1, a1Prime);
  const hue2 = Math.atan2(b2, a2Prime);
  const h1 = hue1 >= 0 ? hue1 / rad : 360 + hue1 / rad;
  const h2 = hue2 >= 0 ? hue2 / rad : 360 + hue2 / rad;
  const deltaL = l2 - l1;
  const deltaC = c2Prime - c1Prime;
  let deltaH = 0;

  if (c1Prime * c2Prime !== 0) {
    deltaH = h2 - h1;

    if (deltaH > 180) deltaH -= 360;
    if (deltaH < -180) deltaH += 360;
  }

  const deltaHPrime = 2 * Math.sqrt(c1Prime * c2Prime) * Math.sin((deltaH * rad) / 2);
  const lBar = (l1 + l2) / 2;
  const cBarPrime = (c1Prime + c2Prime) / 2;
  let hBar = h1 + h2;

  if (c1Prime * c2Prime === 0) {
    hBar = h1 + h2;
  } else if (Math.abs(h1 - h2) <= 180) {
    hBar = (h1 + h2) / 2;
  } else if (h1 + h2 < 360) {
    hBar = (h1 + h2 + 360) / 2;
  } else {
    hBar = (h1 + h2 - 360) / 2;
  }

  const t =
    1 -
    0.17 * Math.cos((hBar - 30) * rad) +
    0.24 * Math.cos(2 * hBar * rad) +
    0.32 * Math.cos((3 * hBar + 6) * rad) -
    0.2 * Math.cos((4 * hBar - 63) * rad);
  const deltaTheta = 30 * Math.exp(-(((hBar - 275) / 25) ** 2));
  const rC = 2 * Math.sqrt(cBarPrime ** 7 / (cBarPrime ** 7 + 25 ** 7));
  const sL = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sC = 1 + 0.045 * cBarPrime;
  const sH = 1 + 0.015 * cBarPrime * t;
  const rT = -Math.sin(2 * deltaTheta * rad) * rC;

  return Math.sqrt(
    (deltaL / sL) ** 2 +
      (deltaC / sC) ** 2 +
      (deltaHPrime / sH) ** 2 +
      rT * (deltaC / sC) * (deltaHPrime / sH),
  );
}

function nearestColorDistance(color: Rgb, tokens: Rgb[]): number {
  return tokens.reduce((nearest, token) => Math.min(nearest, deltaE2000(color, token)), Infinity);
}

function pixelValue(value: string): number | null {
  const match = value.match(/^(-?[\d.]+)px$/);

  return match === null ? null : Number(match[1]);
}

function onScale(value: string, scale: number[], tolerance: number): boolean {
  const number = pixelValue(value);

  if (number === null) {
    return true;
  }

  return scale.some((entry) => Math.abs(entry - number) <= tolerance);
}

function firstFont(value: string): string {
  return (value.split(",")[0] ?? "").replace(/["']/g, "").trim().toLowerCase();
}

function normalizePadding(value: string): [number, number, number, number] {
  const parts = value
    .trim()
    .split(/\s+/)
    .map((part) => pixelValue(part) ?? 0);

  if (parts.length === 1) return [parts[0] ?? 0, parts[0] ?? 0, parts[0] ?? 0, parts[0] ?? 0];
  if (parts.length === 2) return [parts[0] ?? 0, parts[1] ?? 0, parts[0] ?? 0, parts[1] ?? 0];
  if (parts.length === 3) return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[1] ?? 0];

  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 0];
}

function finding(
  id: string,
  title: string,
  severity: 1 | 2 | 3,
  element: MeasuredElement,
  measuredValue: string,
  fix: string,
  screenshotPath: string,
): Finding {
  return {
    id,
    title,
    citation: "project-design-memory",
    related: ["nielsen-h4"],
    severity,
    confidence: "measured",
    evidence: {
      selector: element.selector,
      screenshotPath,
      measuredValue,
    },
    fix,
  };
}

function serializeDesignMemory(memory: DesignMemory): string {
  const colorLines = Object.entries(memory.colors).map(([name, value]) => `- ${name}: ${value}`);
  const spacingLines = Object.entries(memory.spacing).map(([name, value]) => `- ${name}: ${value}`);
  const radiusLines = Object.entries(memory.radii).map(([name, value]) => `- ${name}: ${value}`);

  return [
    `# ${memory.direction.name}`,
    "",
    memory.direction.description,
    "",
    "## Type",
    "",
    `Pair: ${memory.type.pair.join(", ")}`,
    `Scale: ${memory.type.scale.map((size) => `${size}px`).join(", ")}`,
    "",
    "## Color tokens",
    "",
    ...colorLines,
    "",
    "## Spacing scale",
    "",
    ...spacingLines,
    "",
    "## Radius scale",
    "",
    ...radiusLines,
    "",
    "## Density",
    "",
    memory.density,
    "",
    "## Primary button",
    "",
    `Background: ${memory.button.backgroundColor}`,
    `Text: ${memory.button.color}`,
    `Radius: ${memory.button.borderRadius}`,
    `Font: ${memory.button.fontFamily}, ${memory.button.fontSize}, weight ${memory.button.fontWeight}`,
    `Padding: ${memory.button.padding}`,
    "",
    "## Input",
    "",
    `Background: ${memory.input.backgroundColor}`,
    `Text: ${memory.input.color}`,
    `Border: ${memory.input.borderColor}`,
    `Radius: ${memory.input.borderRadius}`,
    `Font: ${memory.input.fontFamily}, ${memory.input.fontSize}`,
    `Padding: ${memory.input.padding}`,
    "",
    "## Do",
    "",
    ...memory.do.map((entry) => `- ${entry}`),
    "",
    "## Don't",
    "",
    ...memory.dont.map((entry) => `- ${entry}`),
    "",
  ].join("\n");
}

function isDesignMemory(value: unknown): value is DesignMemory {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === 1 &&
    "button" in value &&
    typeof value.button === "object" &&
    value.button !== null
  );
}

export async function readDesignMemory(projectRoot: string): Promise<DesignMemory | null> {
  try {
    const raw = JSON.parse(
      await readFile(fitroomFilePath(projectRoot, "design-memory.json"), "utf8"),
    ) as unknown;

    return isDesignMemory(raw) ? raw : null;
  } catch {
    return null;
  }
}

export async function saveDesignMemory(
  projectRoot: string,
  memory: DesignMemory,
): Promise<SaveDesignMemoryResult> {
  const directory = path.join(projectRoot, ".fitroom");
  const designPath = path.join(directory, "DESIGN.md");
  const memoryPath = path.join(directory, "design-memory.json");
  const files = [".fitroom/DESIGN.md", ".fitroom/design-memory.json"];

  await mkdir(directory, { recursive: true });

  try {
    await stat(designPath);
    const date = new Date().toISOString().slice(0, 10);
    let archive = path.join(directory, `DESIGN.${date}.md`);
    let suffix = 1;

    while (true) {
      try {
        await stat(archive);
        suffix += 1;
        archive = path.join(directory, `DESIGN.${date}-${suffix}.md`);
      } catch {
        break;
      }
    }

    await copyFile(designPath, archive);
    files.push(path.relative(projectRoot, archive).split(path.sep).join("/"));
  } catch {}

  await writeJsonAtomic(memoryPath, memory);
  await writeFileAtomic(designPath, serializeDesignMemory(memory));

  return { files };
}

function measuredElementsScript(): MeasuredElement[] {
  const px = (value: string): number => {
    const match = value.match(/^(-?[\d.]+)px$/);

    return match === null ? 0 : Number(match[1]);
  };
  const selectorFor = (element: HTMLElement): string => {
    if (element.id !== "") {
      return `#${element.id}`;
    }

    const parts: string[] = [];
    let current: HTMLElement | null = element;

    while (current !== null && current !== document.body) {
      const tag = current.tagName.toLowerCase();
      const siblings = current.parentElement
        ? [...current.parentElement.children].filter(
            (sibling) => sibling.tagName.toLowerCase() === tag,
          )
        : [];
      const index = siblings.indexOf(current);

      parts.unshift(`${tag}:nth-of-type(${index + 1})`);
      current = current.parentElement;
    }

    return parts.join(" > ");
  };
  const buttons = [...document.querySelectorAll<HTMLElement>("button")].filter((button) => {
    const rect = button.getBoundingClientRect();

    return rect.width > 0 && rect.height > 0 && getComputedStyle(button).visibility !== "hidden";
  });
  const primary = buttons.find((button) => button.dataset.primary === "true") ?? buttons[0] ?? null;
  const elements = [...document.querySelectorAll<HTMLElement>("body *")];
  const measured: MeasuredElement[] = [];

  for (const element of elements) {
    if (
      ["script", "style", "noscript", "iframe", "video", "object", "embed", "map"].includes(
        element.tagName.toLowerCase(),
      )
    ) {
      continue;
    }

    if (element.closest("iframe, video, object, embed, map") !== null) {
      continue;
    }

    const rect = element.getBoundingClientRect();
    const computed = getComputedStyle(element);

    if (
      rect.width === 0 ||
      rect.height === 0 ||
      computed.display === "none" ||
      computed.visibility === "hidden"
    ) {
      continue;
    }

    const directText = [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? "")
      .join(" ")
      .trim();
    const borderWidths = [
      computed.borderTopWidth,
      computed.borderRightWidth,
      computed.borderBottomWidth,
      computed.borderLeftWidth,
    ].map((width) => px(width));

    measured.push({
      backgroundColor: computed.backgroundColor,
      borderColor: computed.borderTopColor,
      borderWidth: Math.max(...borderWidths),
      borderRadius: computed.borderTopLeftRadius,
      color: computed.color,
      columnGap: computed.columnGap === "normal" ? "0px" : computed.columnGap,
      directText,
      fontFamily: computed.fontFamily,
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
      isPrimary: primary === element,
      padding: [
        computed.paddingTop,
        computed.paddingRight,
        computed.paddingBottom,
        computed.paddingLeft,
      ],
      rowGap: computed.rowGap === "normal" ? "0px" : computed.rowGap,
      selector: selectorFor(element),
      tag: element.tagName.toLowerCase(),
    });
  }

  return measured;
}

function comparePrimaryButton(memory: DesignMemory, element: MeasuredElement): string | null {
  const issues: string[] = [];
  const actualBackground = parseColor(element.backgroundColor);
  const expectedBackground = parseColor(memory.button.backgroundColor);

  if (
    actualBackground === null ||
    expectedBackground === null ||
    deltaE2000(actualBackground, expectedBackground) > 1
  ) {
    issues.push(`background ${element.backgroundColor}`);
  }

  const actualText = parseColor(element.color);
  const expectedText = parseColor(memory.button.color);

  if (actualText === null || expectedText === null || deltaE2000(actualText, expectedText) > 1) {
    issues.push(`text ${element.color}`);
  }

  if (firstFont(element.fontFamily) !== firstFont(memory.button.fontFamily)) {
    issues.push(`font ${element.fontFamily}`);
  }

  if (!onScale(element.fontSize, [pixelValue(memory.button.fontSize) ?? 16], 1)) {
    issues.push(`size ${element.fontSize}`);
  }

  if (element.fontWeight !== memory.button.fontWeight) {
    issues.push(`weight ${element.fontWeight}`);
  }

  if (!onScale(element.borderRadius, [pixelValue(memory.button.borderRadius) ?? 0], 1)) {
    issues.push(`radius ${element.borderRadius}`);
  }

  const expectedPadding = normalizePadding(memory.button.padding);

  if (
    element.padding.some(
      (value, index) => Math.abs((pixelValue(value) ?? 0) - (expectedPadding[index] ?? 0)) > 1,
    )
  ) {
    issues.push(`padding ${element.padding.join(" ")}`);
  }

  return issues.length === 0 ? null : issues.join(", ");
}

export async function auditDesignMemory(input: AuditDesignMemoryInput): Promise<Finding[]> {
  const memory = await readDesignMemory(input.projectRoot);

  if (memory === null) {
    throw new Error("No design memory exists. Approve a design and run fr_handoff first.");
  }

  const outputDir =
    input.outputDir ?? path.join(input.projectRoot, ".fitroom", "design-memory-audit");
  const screenshotPath = path.join(outputDir, "page.png");

  await mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  let elements: MeasuredElement[] = [];

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    await page.goto(input.url, { waitUntil: "load", timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ fullPage: true, path: screenshotPath });
    elements = await page.evaluate(measuredElementsScript);
  } finally {
    await browser.close();
  }

  const colorTokens = Object.values(memory.colors)
    .map((value) => parseColor(value))
    .filter((value): value is Rgb => value !== null);
  const spacingScale = Object.values(memory.spacing)
    .map((value) => pixelValue(value))
    .filter((value): value is number => value !== null);
  const radiusScale = Object.values(memory.radii)
    .map((value) => pixelValue(value))
    .filter((value): value is number => value !== null);
  const typePair = memory.type.pair.map((value) => value.toLowerCase());
  const findings: Finding[] = [];
  let counter = 0;
  const add = (
    title: string,
    severity: 1 | 2 | 3,
    element: MeasuredElement,
    measured: string,
    fix: string,
  ): void => {
    counter += 1;
    findings.push(
      finding(`design-memory-${counter}`, title, severity, element, measured, fix, screenshotPath),
    );
  };

  for (const element of elements) {
    if (element.isPrimary) {
      const difference = comparePrimaryButton(memory, element);

      if (difference !== null) {
        add(
          "Primary button does not match the approved design",
          3,
          element,
          `The primary button differs from design memory: ${difference}.`,
          "Match the approved primary button styles in DESIGN.md, or update the design memory.",
        );
      }

      continue;
    }

    if (element.directText !== "") {
      const text = parseColor(element.color);

      if (text !== null && colorTokens.length > 0 && nearestColorDistance(text, colorTokens) > 3) {
        add(
          "Text color is not a saved design token",
          2,
          element,
          `Text color ${element.color} is more than 3 Delta E from the nearest saved token.`,
          "Use a saved text color in DESIGN.md.",
        );
      }

      if (
        typePair.length > 0 &&
        !typePair.some((family) => firstFont(element.fontFamily) === firstFont(family))
      ) {
        add(
          "Font family is not in the approved type pair",
          2,
          element,
          `Font family ${element.fontFamily} is not in the saved type pair.`,
          "Use one of the saved fonts in DESIGN.md.",
        );
      }

      if (!onScale(element.fontSize, memory.type.scale, 1)) {
        add(
          "Font size is off the approved type scale",
          2,
          element,
          `Font size ${element.fontSize} is not on the saved type scale.`,
          "Use a size from the saved type scale in DESIGN.md.",
        );
      }
    }

    const background = parseColor(element.backgroundColor);

    if (
      background !== null &&
      colorTokens.length > 0 &&
      nearestColorDistance(background, colorTokens) > 3
    ) {
      add(
        "Background color is not a saved design token",
        2,
        element,
        `Background color ${element.backgroundColor} is more than 3 Delta E from the nearest saved token.`,
        "Use a saved background or surface color in DESIGN.md.",
      );
    }

    const border = parseColor(element.borderColor);

    if (
      element.borderWidth > 0 &&
      border !== null &&
      colorTokens.length > 0 &&
      nearestColorDistance(border, colorTokens) > 3
    ) {
      add(
        "Border color is not a saved design token",
        2,
        element,
        `Border color ${element.borderColor} is more than 3 Delta E from the nearest saved token.`,
        "Use a saved border color in DESIGN.md.",
      );
    }

    const spacingValues = [...element.padding, element.rowGap, element.columnGap].filter(
      (value) => (pixelValue(value) ?? 0) > 0,
    );

    if (
      spacingScale.length > 0 &&
      spacingValues.some((value) => !onScale(value, spacingScale, 2))
    ) {
      add(
        "Spacing is not on the approved spacing scale",
        1,
        element,
        `Spacing values ${spacingValues.join(", ")} are not on the saved spacing scale.`,
        "Use a spacing value from DESIGN.md.",
      );
    }

    if (
      radiusScale.length > 0 &&
      (pixelValue(element.borderRadius) ?? 0) > 0 &&
      !onScale(element.borderRadius, radiusScale, 1)
    ) {
      add(
        "Radius is not on the approved radius scale",
        1,
        element,
        `Radius ${element.borderRadius} is not on the saved radius scale.`,
        "Use a radius from DESIGN.md.",
      );
    }
  }

  return findings;
}
