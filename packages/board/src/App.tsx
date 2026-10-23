import { type FormEvent, useEffect, useRef, useState } from "react";
import { type EditOperation, Inspector, type SelectedPreviewElement } from "./Inspector";
import { type BoardFinding, type BoardState, type ViewportWidth, viewportWidths } from "./types";

export interface AppProps {
  initialState?: BoardState;
  token?: string;
}

function readToken(): string {
  if (typeof window === "undefined") {
    return "";
  }

  return new URLSearchParams(window.location.search).get("token") ?? "";
}

function previewSource(slug: string, token: string, version: number): string {
  return `/preview/${encodeURIComponent(slug)}?token=${encodeURIComponent(token)}&v=${version}`;
}

function designSystemBanner(state: BoardState): string {
  const designSystem = state.designSystem;

  if (designSystem === undefined || designSystem.status === "none") {
    return "Design system not found. Edits will create a new token set you can adopt later.";
  }

  return designSystem.summary;
}

function findingLabel(count: number): string {
  return `${count} ${count === 1 ? "finding" : "findings"}`;
}

function groupFindings(findings: BoardFinding[]): Array<[number, BoardFinding[]]> {
  const grouped = new Map<number, BoardFinding[]>();

  for (const finding of findings) {
    grouped.set(finding.severity, [...(grouped.get(finding.severity) ?? []), finding]);
  }

  return [...grouped.entries()].sort(([first], [second]) => second - first);
}

export function App({ initialState, token: tokenProp }: AppProps) {
  const [state, setState] = useState<BoardState | null>(initialState ?? null);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState<ViewportWidth>(1440);
  const [findingsOpen, setFindingsOpen] = useState(false);
  const [socketReady, setSocketReady] = useState(false);
  const [direction, setDirection] = useState("");
  const [requestStatus, setRequestStatus] = useState("");
  const [refinedMode, setRefinedMode] = useState<"light" | "deep">("light");
  const [boardBusy, setBoardBusy] = useState(false);
  const [boardError, setBoardError] = useState("");
  const [selectedScopeId, setSelectedScopeId] = useState("");
  const [emptyMessage, setEmptyMessage] = useState("");
  const [selected, setSelected] = useState<SelectedPreviewElement | null>(null);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const token = tokenProp ?? readToken();

  useEffect(() => {
    if (initialState !== undefined) {
      return;
    }

    if (token === "") {
      setError("This board needs a session token.");
      return;
    }

    const controller = new AbortController();

    fetch(`/api/board?token=${encodeURIComponent(token)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Could not load the board.");
        }

        setState((await response.json()) as BoardState);
      })
      .catch((fetchError: unknown) => {
        if (fetchError instanceof Error && fetchError.name === "AbortError") {
          return;
        }

        setError(fetchError instanceof Error ? fetchError.message : "Could not load the board.");
      });

    return () => controller.abort();
  }, [initialState, token]);

  useEffect(() => {
    if (token === "") {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(
      `${protocol}://${window.location.host}/ws?token=${encodeURIComponent(token)}`,
    );

    socketRef.current = socket;
    socket.addEventListener("open", () => {
      if (socketRef.current === socket) {
        setSocketReady(true);
      }
    });
    socket.addEventListener("close", () => {
      if (socketRef.current === socket) {
        setSocketReady(false);
      }
    });
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { type?: string; message?: string };

        if (message.type === "direction-request-ack") {
          setRequestStatus("Request sent. The agent will pick a new direction.");
        } else if (message.type === "error") {
          setRequestStatus(message.message ?? "Could not send the request.");
        }
      } catch {
        setRequestStatus("Could not read the reply from the board server.");
      }
    });

    return () => {
      socketRef.current = null;
      socket.close();
    };
  }, [token]);

  async function updateBoard(
    pathname: "/api/regenerate" | "/api/pin",
    body: Record<string, unknown>,
  ): Promise<void> {
    setBoardBusy(true);
    setBoardError("");

    try {
      const response = await fetch(`${pathname}?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setState((await response.json()) as BoardState);
    } catch (updateError) {
      setBoardError(
        updateError instanceof Error ? updateError.message : "Could not update the board.",
      );
    } finally {
      setBoardBusy(false);
    }
  }

  function regenerate(slots?: number[]): void {
    void updateBoard("/api/regenerate", {
      mode: refinedMode,
      ...(slots === undefined ? {} : { slots }),
    });
  }

  function togglePin(slot: number, pinned: boolean): void {
    void updateBoard("/api/pin", { slot, pinned });
  }

  async function applyOperation(slug: string, operation: EditOperation): Promise<void> {
    setBoardBusy(true);
    setBoardError("");
    setActiveSlug(slug);

    try {
      const response = await fetch(`/api/edit?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, operation }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setState((await response.json()) as BoardState);
      setPreviewVersion((version) => version + 1);
    } catch (updateError) {
      setBoardError(
        updateError instanceof Error ? updateError.message : "Could not apply the edit.",
      );
    } finally {
      setBoardBusy(false);
    }
  }

  async function undo(): Promise<void> {
    if (activeSlug === null) {
      return;
    }

    setBoardBusy(true);
    setBoardError("");

    try {
      const response = await fetch(`/api/undo?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: activeSlug }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setState((await response.json()) as BoardState);
      setPreviewVersion((version) => version + 1);
    } catch (updateError) {
      setBoardError(updateError instanceof Error ? updateError.message : "Could not undo.");
    } finally {
      setBoardBusy(false);
    }
  }

  useEffect(() => {
    function onMessage(event: MessageEvent): void {
      if (event.origin !== window.location.origin) {
        return;
      }

      const data = event.data as {
        type?: unknown;
        slug?: unknown;
        id?: unknown;
        label?: unknown;
        parentId?: unknown;
        siblings?: unknown;
      };

      if (
        data.type !== "fittingroom:select" ||
        typeof data.slug !== "string" ||
        typeof data.id !== "string"
      ) {
        return;
      }

      setSelected({
        id: data.id,
        label: typeof data.label === "string" ? data.label : data.id,
        slug: data.slug,
        parentId: typeof data.parentId === "string" ? data.parentId : null,
        siblings: Array.isArray(data.siblings)
          ? data.siblings.filter(
              (sibling): sibling is { id: string; label: string } =>
                typeof sibling === "object" &&
                sibling !== null &&
                "id" in sibling &&
                "label" in sibling &&
                typeof sibling.id === "string" &&
                typeof sibling.label === "string",
            )
          : [],
      });
    }

    window.addEventListener("message", onMessage);

    return () => window.removeEventListener("message", onMessage);
  }, []);

  function submitDirection(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (socketRef.current === null || socketRef.current.readyState !== WebSocket.OPEN) {
      setRequestStatus("Live sync is not connected. Try again in a moment.");
      return;
    }

    if (direction.trim() === "") {
      setRequestStatus("Add a direction before sending.");
      return;
    }

    socketRef.current.send(
      JSON.stringify({
        type: "direction-request",
        request: direction.trim(),
      }),
    );
    setDirection("");
    setRequestStatus("Sending request...");
  }

  if (error !== null) {
    return (
      <main className="board-state">
        <h1>Fitting Room</h1>
        <p role="alert">{error}</p>
      </main>
    );
  }

  if (state === null) {
    return (
      <main className="board-state">
        <p className="eyebrow">Fitting Room</p>
        <h1>Fitting Room</h1>
        <p>Loading the comparison board.</p>
      </main>
    );
  }

  const groupedFindings = groupFindings(state.findings);
  const scopes = state.scopes ?? [{ id: state.scope.id, name: state.scope.name }];
  const selectedScope =
    scopes.find((scope) => scope.id === selectedScopeId) ??
    scopes.find((scope) => scope.id === state.scope.id) ??
    scopes[0] ??
    state.scope;
  const scopePicker = (
    <label className="scope-picker">
      Page group
      <select
        aria-label="Page group"
        onChange={(event) => {
          setSelectedScopeId(event.target.value);
          setEmptyMessage("");
        }}
        value={selectedScope.id}
      >
        {scopes.map((scope) => (
          <option key={scope.id} value={scope.id}>
            {scope.name}
          </option>
        ))}
      </select>
    </label>
  );

  if (state.variants.length === 0) {
    return (
      <div className="board-shell">
        <header className="board-header">
          <div>
            <p className="eyebrow">Design board</p>
            <h1>Fitting Room</h1>
            {scopePicker}
          </div>
        </header>

        <div className="design-system-banner" data-status={state.designSystem?.status ?? "none"}>
          {designSystemBanner(state)}
        </div>

        <main className="comparison">
          <section className="empty-board">
            <p className="empty-title">No directions yet.</p>
            <p>Run an audit and generate directions, or click Generate directions.</p>
            <button
              onClick={() => {
                setEmptyMessage(
                  `Use fitting-room to generate 4 directions for ${selectedScope.name} and open the board.`,
                );
              }}
              type="button"
            >
              Generate directions
            </button>
            {emptyMessage === "" ? null : (
              <>
                <p role="status">This board cannot generate directions on its own.</p>
                <p role="status">{emptyMessage}</p>
              </>
            )}
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="board-shell">
      <header className="board-header">
        <div>
          <p className="eyebrow">Design board</p>
          <h1>Fitting Room</h1>
          <p className="scope-line">{state.scope.name}</p>
        </div>

        <div className="board-controls">
          <label className="mode-control">
            Refined mode
            <select
              aria-label="Refined mode"
              onChange={(event) => setRefinedMode(event.target.value as "light" | "deep")}
              value={refinedMode}
            >
              <option value="light">Light touch</option>
              <option value="deep">Deeper polish</option>
            </select>
          </label>
          <button
            className="regenerate-all"
            disabled={boardBusy}
            onClick={() => regenerate()}
            type="button"
          >
            Regenerate all
          </button>
          <button
            className="undo-button"
            disabled={boardBusy || activeSlug === null}
            onClick={() => void undo()}
            type="button"
          >
            Undo
          </button>
          <fieldset className="viewport-switch" aria-label="Preview viewport">
            {viewportWidths.map((width) => (
              <button
                aria-pressed={viewport === width}
                className="switch-button"
                key={width}
                onClick={() => setViewport(width)}
                type="button"
              >
                {width} px
              </button>
            ))}
          </fieldset>
          <button className="findings-button" onClick={() => setFindingsOpen(true)} type="button">
            Findings ({state.findings.length})
          </button>
        </div>
      </header>

      <div className="design-system-banner" data-status={state.designSystem?.status ?? "none"}>
        {designSystemBanner(state)}
      </div>

      <main className="comparison">
        <div className="variant-grid">
          {state.variants.map((variant, index) => {
            const count = state.findings.filter(
              (finding) => finding.variantSlug === variant.slug,
            ).length;

            return (
              <article className="variant-card" key={variant.slot}>
                <div className="variant-copy">
                  <div className="variant-heading">
                    <p className="slot-label">Slot {variant.slot || index + 1}</p>
                    <h2>{variant.name}</h2>
                    <p className="finding-count">{findingLabel(count)}</p>
                  </div>
                  <p className="rationale">{variant.rationale}</p>
                </div>
                <div className="card-actions">
                  <button
                    aria-label={`Regenerate ${variant.name}`}
                    className="icon-button"
                    disabled={boardBusy || variant.pinned}
                    onClick={() => regenerate([variant.slot])}
                    title="Regenerate this slot"
                    type="button"
                  >
                    ↻
                  </button>
                  <button
                    aria-label={variant.pinned ? `Unpin ${variant.name}` : `Pin ${variant.name}`}
                    aria-pressed={variant.pinned}
                    className="pin-button"
                    disabled={boardBusy}
                    onClick={() => togglePin(variant.slot, !variant.pinned)}
                    type="button"
                  >
                    {variant.pinned ? "Pinned" : "Pin"}
                  </button>
                </div>
                <div className="preview-window">
                  <iframe
                    data-variant-slug={variant.slug}
                    height={520}
                    src={previewSource(variant.slug, token, previewVersion)}
                    title={`${variant.name} preview`}
                    width={viewport}
                  />
                </div>
              </article>
            );
          })}
        </div>

        {state.previousRounds.length > 0 ? (
          <section className="previous-strip" aria-label="Previous rounds">
            <h2>Previous</h2>
            <div className="previous-rounds">
              {state.previousRounds.map((round, index) => (
                <article className="previous-round" key={round.id}>
                  <p className="slot-label">Round {index + 1}</p>
                  <p>{round.variants.map((variant) => variant.name).join(" / ")}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {boardError === "" ? null : <p role="alert">{boardError}</p>}

        <form className="direction-form" onSubmit={submitDirection}>
          <label htmlFor="next-direction">Try another direction</label>
          <div className="direction-entry">
            <input
              id="next-direction"
              onChange={(event) => setDirection(event.target.value)}
              placeholder="Make it feel like a Lagos record shop"
              type="text"
              value={direction}
            />
            <button disabled={!socketReady} type="submit">
              Send request
            </button>
          </div>
          <p className="connection-line">
            {socketReady ? "Live sync connected." : "Connecting to live sync."}
          </p>
          {requestStatus === "" ? null : <p role="status">{requestStatus}</p>}
        </form>
      </main>

      {selected === null ? null : (
        <Inspector
          designSystem={state.designSystem}
          onEdit={(slug, operation) => {
            void applyOperation(slug, operation);
          }}
          selected={selected}
        />
      )}

      {findingsOpen ? (
        <aside aria-label="Findings drawer" className="findings-drawer">
          <div className="drawer-heading">
            <h2>Findings</h2>
            <button
              aria-label="Close findings"
              className="drawer-close"
              onClick={() => setFindingsOpen(false)}
              type="button"
            >
              Close
            </button>
          </div>
          {groupedFindings.length === 0 ? (
            <p>No findings for this scope.</p>
          ) : (
            groupedFindings.map(([severity, findings]) => (
              <section className="severity-group" key={severity}>
                <h3>Severity {severity}</h3>
                <ul>
                  {findings.map((finding) => {
                    const variant = state.variants.find(
                      (candidate) => candidate.slug === finding.variantSlug,
                    );

                    return (
                      <li key={finding.id}>
                        <p className="finding-title">{finding.title}</p>
                        <p className="finding-meta">
                          {variant?.name ?? "Variant"} · {finding.confidence}
                        </p>
                        <a href={finding.citationUrl} rel="noreferrer" target="_blank">
                          {finding.citation}
                        </a>
                        <p className="finding-fix">{finding.fix}</p>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </aside>
      ) : null}
    </div>
  );
}
