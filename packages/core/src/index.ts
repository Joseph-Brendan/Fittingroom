export * from "./audit";
export * from "./board-state";
export * from "./capture";
export * from "./content-inventory";
export * from "./design-memory";
export * from "./design-system";
export * from "./dev-server";
export * from "./edit-engine";
export * from "./fittingroom-store";
export * from "./handoff";
export * from "./regeneration";
export * from "./rounds";
export * from "./routes";
export * from "./scopes";
export * from "./slop";
export * from "./states";
export * from "./structure";

export const corePackage = {
  name: "@fittingroom/core",
  version: "0.0.0",
} as const;

export const coreModules = ["capture", "audit", "detection", "diff"] as const;

export type CoreModule = (typeof coreModules)[number];
