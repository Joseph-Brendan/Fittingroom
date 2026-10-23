import aiNativeSpec from "../directions/ai-native.json";
import analyticalSpec from "../directions/analytical.json";
import appleNativeSpec from "../directions/apple-native.json";
import artDecoSpec from "../directions/art-deco.json";
import auroraMeshSpec from "../directions/aurora-mesh.json";
import bauhausSpec from "../directions/bauhaus.json";
import bentoGridSpec from "../directions/bento-grid.json";
import biophilicSpec from "../directions/biophilic.json";
import calmMonochromeAccentSpec from "../directions/calm-monochrome-accent.json";
import cardBasedSpec from "../directions/card-based.json";
import claymorphismSpec from "../directions/claymorphism.json";
import cleanUiSpec from "../directions/clean-ui.json";
import commandCenterSpec from "../directions/command-center.json";
import cyberpunkSpec from "../directions/cyberpunk.json";
import darkFirstSpec from "../directions/dark-first.json";
import dataDenseUtilitarianSpec from "../directions/data-dense-utilitarian.json";
import dopamineSpec from "../directions/dopamine.json";
import editorialSpec from "../directions/editorial.json";
import executiveMinimalSpec from "../directions/executive-minimal.json";
import fluentSpec from "../directions/fluent.json";
import glassSpec from "../directions/glass.json";
import highContrastInclusiveSpec from "../directions/high-contrast-inclusive.json";
import material3Spec from "../directions/material-3.json";
import memphisSpec from "../directions/memphis.json";
import monochromeSpec from "../directions/monochrome.json";
import neubrutalismSpec from "../directions/neubrutalism.json";
import operationalSpec from "../directions/operational.json";
import organicBlobSpec from "../directions/organic-blob.json";
import retroY2kSpec from "../directions/retro-y2k.json";
import scrapbookHandDrawnSpec from "../directions/scrapbook-hand-drawn.json";
import softUiNeumorphismSpec from "../directions/soft-ui-neumorphism.json";
import spatialSpec from "../directions/spatial.json";
import swissInternationalSpec from "../directions/swiss-international.json";
import terminalCliSpec from "../directions/terminal-cli.json";
import typeFirstSpec from "../directions/type-first.json";
import widgetBentoDashboardSpec from "../directions/widget-bento-dashboard.json";
import refinedSpec from "../specs/1-refined.json";
import nativeSpec from "../specs/2-native.json";
import boldSpec from "../specs/3-bold.json";
import wildcardSpec from "../specs/4-wildcard.json";

export type DirectionSurface = "marketing" | "app" | "dashboard";

export interface TypePair {
  display: string;
  body: string;
}

export interface TypeScale {
  base: number;
  ratio: number;
  steps: number[];
}

export interface RadiusTokens {
  control: string;
  panel: string;
}

export interface ContrastPair {
  foreground: string;
  background: string;
  ratio: number;
  usage: string;
}

export interface ColorRecipe {
  background: string;
  surface: string;
  text: string;
  mutedText: string;
  accent: string;
  accentText: string;
  border: string;
  focus: string;
  contrastPairs: ContrastPair[];
}

export interface DesignDirection {
  slug: string;
  name: string;
  surfaces: string[];
  description: string;
  bestFor: string[];
  typePair: TypePair;
  typeScale: TypeScale;
  radius: RadiusTokens;
  border: string;
  shadow: string;
  colorRecipe: ColorRecipe;
  density: number;
  motion: number;
  layoutRules: string[];
  do: string[];
  dont: string[];
  a11yRisk: string;
}

export interface DirectionSpec {
  slot: number;
  id: string;
  name: string;
  description: string;
  surfaces: string[];
  modes?: string[];
}

export const directionSpecs: readonly DirectionSpec[] = [
  refinedSpec,
  nativeSpec,
  boldSpec,
  wildcardSpec,
];

export const directionLibrary: readonly DesignDirection[] = [
  aiNativeSpec,
  analyticalSpec,
  appleNativeSpec,
  artDecoSpec,
  auroraMeshSpec,
  bauhausSpec,
  bentoGridSpec,
  biophilicSpec,
  calmMonochromeAccentSpec,
  cardBasedSpec,
  claymorphismSpec,
  cleanUiSpec,
  commandCenterSpec,
  cyberpunkSpec,
  darkFirstSpec,
  dataDenseUtilitarianSpec,
  dopamineSpec,
  editorialSpec,
  executiveMinimalSpec,
  fluentSpec,
  glassSpec,
  highContrastInclusiveSpec,
  material3Spec,
  memphisSpec,
  monochromeSpec,
  neubrutalismSpec,
  operationalSpec,
  organicBlobSpec,
  retroY2kSpec,
  scrapbookHandDrawnSpec,
  softUiNeumorphismSpec,
  spatialSpec,
  swissInternationalSpec,
  terminalCliSpec,
  typeFirstSpec,
  widgetBentoDashboardSpec,
];

export function getDirection(slug: string): DesignDirection | undefined {
  return directionLibrary.find((direction) => direction.slug === slug);
}
