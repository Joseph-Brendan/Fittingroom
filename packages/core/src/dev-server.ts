const defaultPorts = [3000, 3001, 5173, 4173, 4321, 8080, 8000] as const;

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
