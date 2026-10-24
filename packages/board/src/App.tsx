import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { type EditOperation, Inspector, type SelectedPreviewElement } from "./Inspector";
import {
  type BoardFinding,
  type BoardRound,
  type BoardState,
  type StructureAction,
  type StructureFile,
  type ViewportWidth,
  viewportWidths,
} from "./types";

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
function boardStatusMessage(state: BoardState): string {
  switch (state.status) {
    case "generating":
      return `Waiting for your agent. Ask your agent: Generate 4 design directions for ${state.scope.name}.`;
    case "approved": {
      const name =
        state.variants.find((variant) => variant.slug === state.approved?.slug)?.name ??
        state.approved?.slug;

      return name === undefined ? "Direction approved." : `Approved: ${name}.`;
    }
    case "handoff_created":
      return "Handoff created. Ask your agent to build the approved design.";
    case "verifying":
      return "Checking the build against the approved design.";
    case "verified":
      return "The build matches the approved design.";
    case "verify_failed":
      return "The build does not match yet. Ask your agent to read the verify report.";
    default:
      return "";
  }
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
  const [chosen, setChosen] = useState<{ slug: string; slot: number } | null>(null);
  const [chosenSnapshot, setChosenSnapshot] = useState<{
    label: string;
    round: number;
    snapshotId: string;
  } | null>(null);
  const [rounds, setRounds] = useState<BoardRound[]>([]);
  const [structure, setStructure] = useState<StructureFile | null>(null);
  const [groupSelection, setGroupSelection] = useState<string[]>([]);
  const [selected, setSelected] = useState<SelectedPreviewElement | null>(null);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const token = tokenProp ?? readToken();

  const loadRounds = useCallback(async (): Promise<void> => {
    if (token === "") {
      return;
    }

    try {
      const response = await fetch(`/api/rounds?token=${encodeURIComponent(token)}`);

      if (response.ok) {
        setRounds((await response.json()) as BoardRound[]);
      }
    } catch {}
  }, [token]);

  const loadStructure = useCallback(async (): Promise<void> => {
    if (token === "") {
      return;
    }

    try {
      const response = await fetch(`/api/structure?token=${encodeURIComponent(token)}`);

      if (response.ok) {
        setStructure((await response.json()) as StructureFile | null);
      }
    } catch {}
  }, [token]);

  useEffect(() => {
    void loadRounds();
    void loadStructure();
  }, [loadRounds, loadStructure]);

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
        const message = JSON.parse(String(event.data)) as {
          type?: string;
          message?: string;
          requests?: Array<{ completedAt?: string }>;
          state?: BoardState;
        };

        if (message.type === "board-update" && message.state !== undefined) {
          setState(message.state);
          void loadRounds();
          void loadStructure();
        } else if (message.type === "requests-update") {
          if ((message.requests ?? []).some((request) => request.completedAt === undefined)) {
            setRequestStatus("Waiting for your agent.");
          }
        } else if (message.type === "direction-request-ack") {
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
  }, [token, loadRounds, loadStructure]);

  async function updateBoard(
    pathname: "/api/regenerate" | "/api/pin" | "/api/request" | "/api/approve",
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
      void loadRounds();
      void loadStructure();
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

  function requestDirections(scopeName: string): void {
    setEmptyMessage(`Ask your agent: Generate 4 design directions for ${scopeName}.`);
    void updateBoard("/api/request", { type: "generate" });
  }

  function approve(): void {
    if (chosen === null) {
      return;
    }

    void updateBoard("/api/approve", chosen);
  }

  function togglePin(slot: number, pinned: boolean): void {
    void updateBoard("/api/pin", { slot, pinned });
  }
  async function restoreSnapshot(): Promise<void> {
    if (chosenSnapshot === null) {
      return;
    }

    setBoardBusy(true);
    setBoardError("");

    try {
      const response = await fetch(`/api/restore?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          round: chosenSnapshot.round,
          snapshotId: chosenSnapshot.snapshotId,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setState((await response.json()) as BoardState);
      setChosenSnapshot(null);
      setPreviewVersion((version) => version + 1);
      await loadRounds();
      await loadStructure();
    } catch (updateError) {
      setBoardError(
        updateError instanceof Error ? updateError.message : "Could not restore the variant.",
      );
    } finally {
      setBoardBusy(false);
    }
  }

  async function applyStructure(action: StructureAction): Promise<void> {
    const slug = chosen?.slug ?? activeSlug ?? state?.variants[0]?.slug;

    if (slug === undefined) {
      return;
    }

    setBoardBusy(true);
    setBoardError("");

    try {
      const response = await fetch(`/api/structure-action?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, slug }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setState((await response.json()) as BoardState);
      setGroupSelection([]);
      setPreviewVersion((version) => version + 1);
      await loadStructure();
      await loadRounds();
    } catch (updateError) {
      setBoardError(
        updateError instanceof Error ? updateError.message : "Could not update the structure.",
      );
    } finally {
      setBoardBusy(false);
    }
  }

  const applyOperation = useCallback(
    async (slug: string, operation: EditOperation): Promise<void> => {
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
        void loadRounds();
        void loadStructure();
      } catch (updateError) {
        setBoardError(
          updateError instanceof Error ? updateError.message : "Could not apply the edit.",
        );
      } finally {
        setBoardBusy(false);
      }
    },
    [token, loadRounds, loadStructure],
  );

  const undo = useCallback(async (): Promise<void> => {
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
      void loadRounds();
      void loadStructure();
    } catch (updateError) {
      setBoardError(updateError instanceof Error ? updateError.message : "Could not undo.");
    } finally {
      setBoardBusy(false);
    }
  }, [activeSlug, token, loadRounds, loadStructure]);

  const redo = useCallback(async (): Promise<void> => {
    if (activeSlug === null) {
      return;
    }

    setBoardBusy(true);
    setBoardError("");

    try {
      const response = await fetch(`/api/redo?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: activeSlug }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setState((await response.json()) as BoardState);
      setPreviewVersion((version) => version + 1);
      void loadRounds();
      void loadStructure();
    } catch (updateError) {
      setBoardError(updateError instanceof Error ? updateError.message : "Could not redo.");
    } finally {
      setBoardBusy(false);
    }
  }, [activeSlug, token, loadRounds, loadStructure]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target;

      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      const modifier = event.metaKey || event.ctrlKey;

      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();

        if (event.shiftKey) {
          void redo();
        } else {
          void undo();
        }

        return;
      }

      if (event.key === "Delete" && selected !== null) {
        event.preventDefault();
        void applyOperation(selected.slug, { op: "delete", id: selected.id });
        return;
      }

      if (event.key === "Escape") {
        setSelected(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, applyOperation, undo, redo]);

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
        key?: unknown;
        metaKey?: unknown;
        ctrlKey?: unknown;
        shiftKey?: unknown;
      };

      if (
        data.type === "fittingroom:key" &&
        typeof data.key === "string" &&
        (data.key === "Escape" || data.key === "Delete" || data.key.toLowerCase() === "z") &&
        typeof data.metaKey === "boolean" &&
        typeof data.ctrlKey === "boolean" &&
        typeof data.shiftKey === "boolean"
      ) {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            ctrlKey: data.ctrlKey,
            key: data.key,
            metaKey: data.metaKey,
            shiftKey: data.shiftKey,
          }),
        );
        return;
      }

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
              disabled={boardBusy}
              onClick={() => requestDirections(selectedScope.name)}
              type="button"
            >
              Generate directions
            </button>
            {state.status === "generating" ? <p role="status">Waiting for your agent.</p> : null}
            {emptyMessage === "" ? null : <p role="status">{emptyMessage}</p>}
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
          <button
            className="redo-button"
            disabled={boardBusy || activeSlug === null}
            onClick={() => void redo()}
            type="button"
          >
            Redo
          </button>
          <button
            className="approve-button"
            disabled={boardBusy || chosen === null}
            onClick={approve}
            type="button"
          >
            Approve selected direction
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

      {boardStatusMessage(state) === "" ? null : (
        <p className="board-status" role="status">
          {boardStatusMessage(state)}
        </p>
      )}

      <main className="comparison">
        <div className="variant-grid">
          {state.variants.map((variant, index) => {
            const count = state.findings.filter(
              (finding) => finding.variantSlug === variant.slug,
            ).length;

            return (
              <article
                className="variant-card"
                data-chosen={chosen?.slot === variant.slot}
                key={variant.slot}
              >
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
                    aria-label={`Choose ${variant.name}`}
                    aria-pressed={chosen?.slot === variant.slot && chosen.slug === variant.slug}
                    className="choose-button"
                    disabled={boardBusy}
                    onClick={() => setChosen({ slug: variant.slug, slot: variant.slot })}
                    type="button"
                  >
                    Choose
                  </button>
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

        {structure === null || structure.blocks.length === 0 ? null : (
          <section className="structure-panel" aria-label="Information design">
            <div className="structure-heading">
              <div>
                <h2>Information design</h2>
                <p className="structure-line">
                  Editing {chosen?.slug ?? activeSlug ?? state.variants[0]?.slug ?? "this variant"}
                </p>
              </div>
              <label>
                Density
                <select
                  aria-label="Density"
                  onChange={(event) =>
                    void applyStructure({
                      action: "density",
                      density: event.target.value as "sparse" | "balanced" | "dense",
                    })
                  }
                  value={structure.density}
                >
                  <option value="sparse">Sparse</option>
                  <option value="balanced">Balanced</option>
                  <option value="dense">Dense</option>
                </select>
              </label>
            </div>
            <ul className="structure-block-list">
              {structure.blocks.map((block) => (
                <li data-block-id={block.id} data-visible={block.visible} key={block.id}>
                  <div className="structure-block-copy">
                    <strong>{block.label}</strong>
                    <span>
                      {block.kind}
                      {block.visible ? "" : " · hidden"}
                    </span>
                  </div>
                  <div className="structure-block-actions">
                    <button
                      aria-label={`Move ${block.label} up`}
                      disabled={boardBusy || !block.visible || block.order === 1}
                      onClick={() =>
                        void applyStructure({
                          action: "reorder",
                          id: block.id,
                          index: block.order - 2,
                        })
                      }
                      type="button"
                    >
                      Up
                    </button>
                    <button
                      aria-label={`Move ${block.label} down`}
                      disabled={
                        boardBusy || !block.visible || block.order === structure.blocks.length
                      }
                      onClick={() =>
                        void applyStructure({
                          action: "reorder",
                          id: block.id,
                          index: block.order,
                        })
                      }
                      type="button"
                    >
                      Down
                    </button>
                    <button
                      aria-label={`Hide ${block.label}`}
                      disabled={boardBusy || !block.visible}
                      onClick={() => void applyStructure({ action: "hide", id: block.id })}
                      type="button"
                    >
                      Hide
                    </button>
                    <button
                      aria-label={`Promote ${block.label}`}
                      disabled={boardBusy || !block.visible}
                      onClick={() => void applyStructure({ action: "promote", id: block.id })}
                      type="button"
                    >
                      Promote
                    </button>
                    <label className="structure-check">
                      <input
                        aria-label={`Select ${block.label} for grouping`}
                        checked={groupSelection.includes(block.id)}
                        disabled={!block.visible}
                        onChange={() =>
                          setGroupSelection((current) =>
                            current.includes(block.id)
                              ? current.filter((id) => id !== block.id)
                              : [...current, block.id],
                          )
                        }
                        type="checkbox"
                      />
                      Group
                    </label>
                    <select
                      aria-label={`Collapse ${block.label}`}
                      disabled={boardBusy || !block.visible}
                      onChange={(event) => {
                        const mode = event.target.value;

                        if (mode === "tab" || mode === "accordion") {
                          void applyStructure({ action: "collapse", id: block.id, mode });
                        }
                      }}
                      value={block.collapse}
                    >
                      <option value="none">Open</option>
                      <option value="tab">Tab</option>
                      <option value="accordion">Accordion</option>
                    </select>
                  </div>
                </li>
              ))}
            </ul>
            <button
              disabled={boardBusy || groupSelection.length !== 2}
              onClick={() => {
                const [first, second] = groupSelection;

                if (first !== undefined && second !== undefined) {
                  void applyStructure({ action: "group", firstId: first, secondId: second });
                }
              }}
              type="button"
            >
              Group selected
            </button>
          </section>
        )}

        {rounds.length > 0 ? (
          <section className="previous-strip" aria-label="Previous rounds">
            <h2>Previous</h2>
            <div className="previous-rounds">
              {rounds.map((round) => (
                <article className="previous-round" data-round={round.number} key={round.id}>
                  <p className="slot-label">
                    Round {round.number}
                    {round.number === state.round ? " (current)" : ""}
                  </p>
                  <div className="round-snapshots">
                    {round.variants.map((snapshot) => (
                      <button
                        aria-label={`Restore ${snapshot.name} from round ${round.number}`}
                        aria-pressed={chosenSnapshot?.snapshotId === snapshot.id}
                        className="round-snapshot"
                        data-snapshot-id={snapshot.id}
                        key={snapshot.id}
                        onClick={() =>
                          setChosenSnapshot({
                            label: `${snapshot.name} from round ${round.number}`,
                            round: round.number,
                            snapshotId: snapshot.id,
                          })
                        }
                        type="button"
                      >
                        {snapshot.screenshot === null ? (
                          <span className="snapshot-placeholder">Slot {snapshot.slot}</span>
                        ) : (
                          <img
                            alt=""
                            src={`/round-assets/${round.number}/${snapshot.screenshot}?token=${encodeURIComponent(token)}`}
                          />
                        )}
                        <span>{snapshot.name}</span>
                        <span className="snapshot-state">
                          {snapshot.current ? "Current" : "Replaced"}
                        </span>
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
            <div className="restore-controls">
              <button
                disabled={boardBusy || chosenSnapshot === null}
                onClick={() => void restoreSnapshot()}
                type="button"
              >
                Restore
              </button>
              {chosenSnapshot === null ? null : (
                <p role="status">Restoring {chosenSnapshot.label}.</p>
              )}
            </div>
          </section>
        ) : state.previousRounds.length > 0 ? (
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
          key={selected.id}
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
