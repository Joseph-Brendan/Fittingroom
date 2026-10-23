import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { chromium } from "playwright";
import { PNG } from "pngjs";

export const HANDOFF_WIDTHS = [375, 768, 1440] as const;
export const HANDOFF_HEIGHT = 900;
export const HANDOFF_PIXEL_THRESHOLD = 2;

export const HANDOFF_STYLE_PROPERTIES = [
  "background-color",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "color",
  "column-gap",
  "font-family",
  "font-size",
  "font-weight",
  "gap",
  "line-height",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "row-gap",
] as const;

export type HandoffStyleMap = Record<string, Record<string, string>>;

export interface HandoffScreenshot {
  path: string;
  width: number;
}

export interface HandoffManifest {
  createdAt: string;
  id: string;
  order: string[];
  rationale: string;
  route: string;
  screenshots: HandoffScreenshot[];
  source: string | null;
  styles: HandoffStyleMap;
  tokens: Record<string, string>;
  variantSlug: string;
  version: 1;
}

export interface HandoffReference {
  order: string[];
  screenshots: Array<{ path: string; width: number }>;
  styles: HandoffStyleMap;
}

export interface WriteHandoffInput {
  projectRoot: string;
  rationale: string;
  reference: HandoffReference;
  route: string;
  tokens: Record<string, string>;
  variantFile?: string;
  variantSlug: string;
}

export interface HandoffResult {
  brief: string;
  folder: string;
  handoffId: string;
  manifest: HandoffManifest;
}

export interface CreateHandoffInput {
  projectRoot: string;
  rationale: string;
  referenceUrl: string;
  route: string;
  tokens: Record<string, string>;
  variantSlug: string;
}

export interface RegionDiff {
  differencePercent: number;
  height: number;
  name: string;
  passed: boolean;
  width: number;
  widthViewport: number;
  x: number;
  y: number;
}

export interface StyleMismatch {
  actual: string;
  expected: string;
  id: string;
  property: string;
}

export interface OrderMismatch {
  actual: string | null;
  expected: string | null;
  index: number;
}

export interface VerifyReport {
  handoffId: string;
  orderMismatches: OrderMismatch[];
  passed: boolean;
  regionDiffs: RegionDiff[];
  route: string;
  screenshots: Array<{ path: string; width: number }>;
  styleMismatches: StyleMismatch[];
  tokenMismatches: StyleMismatch[];
}

interface ReferenceCapture {
  order: string[];
  screenshots: Array<{ path: string; width: number }>;
  styles: HandoffStyleMap;
}

async function captureReference(
  referenceUrl: string,
  screenshotDirectory: string,
): Promise<ReferenceCapture> {
  await mkdir(screenshotDirectory, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const screenshots: Array<{ path: string; width: number }> = [];
  let styles: HandoffStyleMap = {};
  let order: string[] = [];

  try {
    const page = await browser.newPage();

    for (const width of HANDOFF_WIDTHS) {
      await page.setViewportSize({ width, height: HANDOFF_HEIGHT });
      await page.goto(referenceUrl, { waitUntil: "networkidle", timeout: 20_000 });
      await page.evaluate(() => document.fonts.ready);
      const screenshotPath = path.join(screenshotDirectory, `${width}.png`);

      await page.screenshot({
        animations: "disabled",
        caret: "hide",
        path: screenshotPath,
      });
      screenshots.push({ path: screenshotPath, width });

      if (width === 1440) {
        const snapshot = await page.evaluate((properties) => {
          const elements = [...document.querySelectorAll<HTMLElement>("[data-fr-id]")];
          const styleMap: Record<string, Record<string, string>> = {};

          for (const element of elements) {
            const id = element.dataset.frId;

            if (id === undefined) {
              continue;
            }

            const computed = getComputedStyle(element);

            styleMap[id] = Object.fromEntries(
              properties.map((property) => [property, computed.getPropertyValue(property)]),
            );
          }

          return {
            order: elements.flatMap((element) =>
              element.dataset.frId === undefined ? [] : [element.dataset.frId],
            ),
            styles: styleMap,
          };
        }, HANDOFF_STYLE_PROPERTIES);

        styles = snapshot.styles;
        order = snapshot.order;
      }
    }
  } finally {
    await browser.close();
  }

  return { order, screenshots, styles };
}

function briefFor(manifest: HandoffManifest): string {
  const source =
    manifest.source === null ? [] : [`The selected design source is in ${manifest.source}.`];

  return [
    `# Implementation handoff: ${manifest.variantSlug}`,
    "",
    `Apply the design to the real ${manifest.route} route.`,
    "Reuse existing project components.",
    "Keep all data wiring and real content.",
    "Use the handoff tokens and match the reference screenshots.",
    ...source,
    "",
    `Call fr_verify with route ${manifest.route} and handoffId ${manifest.id}.`,
    "The build passes with under 2% pixel difference per region, zero token mismatches and zero order mismatches.",
    "",
    manifest.rationale,
  ].join("\n");
}

export async function writeHandoff(input: WriteHandoffInput): Promise<HandoffResult> {
  const handoffId = `handoff-${randomUUID().slice(0, 8)}`;
  const folder = path.join(input.projectRoot, ".fittingroom", "handoffs", handoffId);
  const referenceFolder = path.join(folder, "reference");

  await mkdir(referenceFolder, { recursive: true });

  const screenshots: HandoffScreenshot[] = [];

  for (const screenshot of input.reference.screenshots) {
    const destination = path.join(referenceFolder, `${screenshot.width}.png`);

    await copyFile(screenshot.path, destination);
    screenshots.push({
      path: path.relative(folder, destination).split(path.sep).join("/"),
      width: screenshot.width,
    });
  }

  let source: string | null = null;

  if (input.variantFile !== undefined) {
    const sourceFolder = path.join(folder, "source");
    const sourcePath = path.join(sourceFolder, path.basename(input.variantFile));

    await mkdir(sourceFolder, { recursive: true });
    await copyFile(input.variantFile, sourcePath);
    source = path.relative(folder, sourcePath).split(path.sep).join("/");
  }

  const manifest: HandoffManifest = {
    createdAt: new Date().toISOString(),
    id: handoffId,
    order: input.reference.order,
    rationale: input.rationale,
    route: input.route,
    screenshots,
    source,
    styles: input.reference.styles,
    tokens: input.tokens,
    variantSlug: input.variantSlug,
    version: 1,
  };
  const brief = briefFor(manifest);

  await writeFile(path.join(folder, "handoff.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(folder, "brief.md"), `${brief}\n`);

  return { brief, folder, handoffId, manifest };
}

export async function createHandoff(input: CreateHandoffInput): Promise<HandoffResult> {
  const captureId = randomUUID();
  const captureFolder = path.join(
    input.projectRoot,
    ".fittingroom",
    "reference-captures",
    captureId,
  );

  try {
    const reference = await captureReference(input.referenceUrl, captureFolder);

    return await writeHandoff({
      projectRoot: input.projectRoot,
      rationale: input.rationale,
      reference,
      route: input.route,
      tokens: input.tokens,
      variantSlug: input.variantSlug,
    });
  } finally {
    await rm(captureFolder, { force: true, recursive: true });
  }
}

function urlFor(baseUrl: string, route: string): string {
  return new URL(route, baseUrl).toString();
}

async function screenshotPng(filePath: string): Promise<PNG> {
  return PNG.sync.read(await readFile(filePath));
}

function regionDiffsFor(width: number, reference: PNG, actual: PNG): RegionDiff[] {
  const columns = 3;
  const rows = 3;
  const regions: RegionDiff[] = [];
  const comparedWidth = Math.min(reference.width, actual.width);
  const comparedHeight = Math.min(reference.height, actual.height);

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = Math.floor((comparedWidth * column) / columns);
      const right = Math.floor((comparedWidth * (column + 1)) / columns);
      const y = Math.floor((comparedHeight * row) / rows);
      const bottom = Math.floor((comparedHeight * (row + 1)) / rows);
      const regionWidth = right - x;
      const regionHeight = bottom - y;
      const expected = new PNG({ height: regionHeight, width: regionWidth });
      const received = new PNG({ height: regionHeight, width: regionWidth });

      PNG.bitblt(reference, expected, x, y, regionWidth, regionHeight, 0, 0);
      PNG.bitblt(actual, received, x, y, regionWidth, regionHeight, 0, 0);
      const different = pixelmatch(
        expected.data,
        received.data,
        undefined,
        regionWidth,
        regionHeight,
        { includeAA: false, threshold: 0.1 },
      );
      const dimensionMismatch =
        reference.width !== actual.width || reference.height !== actual.height;
      const rawDifferencePercent = dimensionMismatch
        ? 100
        : (different / (regionWidth * regionHeight)) * 100;

      regions.push({
        differencePercent: Number(rawDifferencePercent.toFixed(2)),
        height: regionHeight,
        name: `${width} px row ${row + 1} column ${column + 1}`,
        passed: rawDifferencePercent < HANDOFF_PIXEL_THRESHOLD,
        width: regionWidth,
        widthViewport: width,
        x,
        y,
      });
    }
  }

  return regions;
}

function compareStyles(expected: HandoffStyleMap, actual: HandoffStyleMap): StyleMismatch[] {
  const mismatches: StyleMismatch[] = [];

  for (const [id, properties] of Object.entries(expected)) {
    const actualProperties = actual[id];

    if (actualProperties === undefined) {
      mismatches.push({
        actual: "Element not found",
        expected: "Element with data-fr-id",
        id,
        property: "element",
      });
      continue;
    }

    for (const [property, value] of Object.entries(properties)) {
      const actualValue = actualProperties[property] ?? "missing";

      if (actualValue !== value) {
        mismatches.push({ actual: actualValue, expected: value, id, property });
      }
    }
  }

  return mismatches;
}

function compareOrder(expected: string[], actual: string[]): OrderMismatch[] {
  const mismatches: OrderMismatch[] = [];
  const length = Math.max(expected.length, actual.length);

  for (let index = 0; index < length; index += 1) {
    const expectedId = expected[index] ?? null;
    const actualId = actual[index] ?? null;

    if (expectedId !== actualId) {
      mismatches.push({ actual: actualId, expected: expectedId, index });
    }
  }

  return mismatches;
}

export interface VerifyImplementationInput {
  baseUrl: string;
  handoffDir: string;
  outputDir: string;
  route: string;
}

export async function verifyImplementation(
  input: VerifyImplementationInput,
): Promise<VerifyReport> {
  const manifest = JSON.parse(
    await readFile(path.join(input.handoffDir, "handoff.json"), "utf8"),
  ) as HandoffManifest;
  const actualFolder = path.join(input.outputDir, "actual");
  const diffFolder = path.join(input.outputDir, "diff");
  const screenshotFolder = path.join(input.outputDir, "reference");

  await mkdir(actualFolder, { recursive: true });
  await mkdir(diffFolder, { recursive: true });
  await mkdir(screenshotFolder, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const screenshots: Array<{ path: string; width: number }> = [];
  let actualStyles: HandoffStyleMap = {};
  let actualOrder: string[] = [];

  try {
    const page = await browser.newPage();

    for (const width of HANDOFF_WIDTHS) {
      await page.setViewportSize({ width, height: HANDOFF_HEIGHT });
      await page.goto(urlFor(input.baseUrl, input.route), {
        waitUntil: "networkidle",
        timeout: 20_000,
      });
      await page.evaluate(() => document.fonts.ready);
      const actualPath = path.join(actualFolder, `${width}.png`);

      await page.screenshot({
        animations: "disabled",
        caret: "hide",
        path: actualPath,
      });
      screenshots.push({ path: actualPath, width });

      if (width === 1440) {
        const snapshot = await page.evaluate((properties) => {
          const elements = [...document.querySelectorAll<HTMLElement>("[data-fr-id]")];
          const styleMap: Record<string, Record<string, string>> = {};

          for (const element of elements) {
            const id = element.dataset.frId;

            if (id === undefined) {
              continue;
            }

            const computed = getComputedStyle(element);

            styleMap[id] = Object.fromEntries(
              properties.map((property) => [property, computed.getPropertyValue(property)]),
            );
          }

          return {
            order: elements.flatMap((element) =>
              element.dataset.frId === undefined ? [] : [element.dataset.frId],
            ),
            styles: styleMap,
          };
        }, HANDOFF_STYLE_PROPERTIES);

        actualStyles = snapshot.styles;
        actualOrder = snapshot.order;
      }
    }
  } finally {
    await browser.close();
  }

  const regionDiffs: RegionDiff[] = [];

  for (const screenshot of manifest.screenshots) {
    const referencePath = path.join(input.handoffDir, screenshot.path);
    const actualPath = path.join(actualFolder, `${screenshot.width}.png`);
    const reference = await screenshotPng(referencePath);
    const actual = await screenshotPng(actualPath);

    await copyFile(referencePath, path.join(screenshotFolder, `${screenshot.width}.png`));
    const regions = regionDiffsFor(screenshot.width, reference, actual);

    regionDiffs.push(...regions);

    if (reference.width === actual.width && reference.height === actual.height) {
      const diff = new PNG({ height: actual.height, width: actual.width });

      pixelmatch(reference.data, actual.data, diff.data, actual.width, actual.height, {
        includeAA: false,
        threshold: 0.1,
      });
      await writeFile(path.join(diffFolder, `${screenshot.width}.png`), PNG.sync.write(diff));
    }
  }

  const styleMismatches = compareStyles(manifest.styles, actualStyles);
  const orderMismatches = compareOrder(manifest.order, actualOrder);
  const passed =
    regionDiffs.every((region) => region.passed) &&
    styleMismatches.length === 0 &&
    orderMismatches.length === 0;

  return {
    handoffId: manifest.id,
    orderMismatches,
    passed,
    regionDiffs,
    route: manifest.route,
    screenshots,
    styleMismatches,
    tokenMismatches: styleMismatches,
  };
}
