import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export interface LoadFitroomFileOptions<T> {
  defaultValue: () => T | Promise<T>;
  fileName: string;
  projectRoot: string;
  schema: (value: unknown) => T;
}

export interface LoadJsonFileOptions<T> {
  defaultValue: () => T | Promise<T>;
  filePath: string;
  schema: (value: unknown) => T;
}

export function fitroomFilePath(projectRoot: string, fileName: string): string {
  return path.join(projectRoot, ".fitroom", fileName);
}

const legacyStateDirectory = [".", "fitting", "room"].join("");

export async function migrateLegacyState(
  projectRoot: string,
  output?: { write: (chunk: string) => unknown },
): Promise<boolean> {
  const legacyPath = path.join(projectRoot, legacyStateDirectory);
  const statePath = path.join(projectRoot, ".fitroom");

  try {
    await access(legacyPath);
  } catch {
    return false;
  }

  try {
    await access(statePath);
    return false;
  } catch {}

  await rename(legacyPath, statePath);
  output?.write(`Moved ${legacyStateDirectory} to .fitroom.\n`);

  return true;
}

export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const directory = path.dirname(filePath);
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;

  await mkdir(directory, { recursive: true });

  try {
    await writeFile(temporaryPath, content);
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const content = `${JSON.stringify(value, null, 2)}\n`;

  await writeFileAtomic(filePath, content);
}

export async function writeFitroomJson(
  projectRoot: string,
  fileName: string,
  value: unknown,
): Promise<void> {
  await writeJsonAtomic(fitroomFilePath(projectRoot, fileName), value);
}

function fileError(filePath: string, reason: string): Error {
  return new Error(
    `Could not read ${filePath}. ${reason} Fix the file or delete it and run the command again.`,
  );
}

export async function loadJsonFile<T>(options: LoadJsonFileOptions<T>): Promise<T> {
  const filePath = options.filePath;
  let content: string;

  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw fileError(
        filePath,
        error instanceof Error ? error.message : "The file could not be read.",
      );
    }

    const defaultValue = await options.defaultValue();
    let validated: T;

    try {
      validated = options.schema(defaultValue);
    } catch (schemaError) {
      throw fileError(
        filePath,
        schemaError instanceof Error ? schemaError.message : "The default value is invalid.",
      );
    }

    await writeJsonAtomic(filePath, validated);

    return validated;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw fileError(filePath, "The file is not valid JSON.");
  }

  try {
    return options.schema(parsed);
  } catch (schemaError) {
    throw fileError(
      filePath,
      schemaError instanceof Error ? schemaError.message : "The file has invalid content.",
    );
  }
}

export async function loadFitroomFile<T>(options: LoadFitroomFileOptions<T>): Promise<T> {
  return loadJsonFile({
    defaultValue: options.defaultValue,
    filePath: fitroomFilePath(options.projectRoot, options.fileName),
    schema: options.schema,
  });
}
