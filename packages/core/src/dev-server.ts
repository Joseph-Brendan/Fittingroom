import { readFile } from "node:fs/promises";
import path from "node:path";

const defaultPorts = [3000, 3001, 3100, 3200, 5173, 4173, 4321, 8080, 8000] as const;

export interface DetectDevServerOptions {
  ports?: readonly number[];
  host?: string;
  timeoutMs?: number;
}

export async function detectDevServer(
  options: DetectDevServerOptions = {},
): Promise<string | null> {
  const ports = options.ports ?? defaultPorts;
  const host = options.host ?? "127.0.0.1";
  const timeoutMs = options.timeoutMs ?? 750;

  for (const port of ports) {
    const origin = `http://${host}:${port}`;

    try {
      const response = await fetch(`${origin}/`, {
        headers: { accept: "text/html" },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const contentType = response.headers.get("content-type") ?? "";

      if (response.ok && contentType.includes("text/html")) {
        return origin;
      }
    } catch {}
  }

  return null;
}

function devScriptPort(script: string): number | null {
  const match = script.match(/(?:-p|--port|-l)(?:\s+|=)(\d+)/) ?? script.match(/\bPORT=(\d+)/);

  if (match === null) {
    return null;
  }

  const port = Number(match[1]);

  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

export async function detectProjectDevServer(projectRoot: string): Promise<string | null> {
  let declaredPort: number | null = null;

  try {
    const raw = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, unknown>;
    };
    const devScript = raw.scripts?.dev;

    if (typeof devScript === "string") {
      declaredPort = devScriptPort(devScript);
    }
  } catch {}

  if (declaredPort !== null) {
    return detectDevServer({ ports: [declaredPort] });
  }

  return detectDevServer();
}
