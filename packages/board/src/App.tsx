import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { type EditOperation, Inspector, type SelectedPreviewElement } from "./Inspector";
import {
  type BoardFinding,
  type BoardRound,
  type BoardState,
  type BoardVariant,
  type StructureAction,
  type StructureBlock,
  type StructureFile,
  type ViewportWidth,
  viewportWidths,
} from "./types";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  Button,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  ExpandIcon,
  EyeOffIcon,
  GroupIcon,
  IconButton,
  InfoIcon,
  LayersIcon,
  ListIcon,
  MarkIcon,
  PanelIcon,
  PinIcon,
  PromoteIcon,
  RedoIcon,
  RefreshIcon,
  SegmentedControl,
  Skeleton,
  SlidersIcon,
  Tabs,
  type ToastMessage,
  ToastStack,
  UndoIcon,
  WarningIcon,
} from "./ui";

export interface AppProps {
  initialState?: BoardState;
  token?: string;
}

type PanelTab = "inspector" | "structure" | "findings";

const roleLabels: Record<number, string> = {
  1: "Refined",
  2: "Native",
  3: "Bold",
  4: "Wildcard",
};

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

function boardStatus(state: BoardState): { detail?: string; main: string } | null {
  switch (state.status) {
    case "generating":
      return {
        detail: `Ask your agent: Generate 4 design directions for ${state.scope.name}.`,
        main: "Waiting for your agent.",
      };
    case "approved": {
      const name =
        state.variants.find((variant) => variant.slug === state.approved?.slug)?.name ??
        state.approved?.slug;

      return { main: name === undefined ? "Direction approved." : `Approved: ${name}.` };
    }
    case "handoff_created":
      return { main: "Handoff created. Ask your agent to build the approved design." };
    case "verifying":
      return { main: "Checking the build against the approved design." };
    case "verified":
      return { main: "The build matches the approved design." };
    case "verify_failed":
      return { main: "The build does not match yet. Ask your agent to read the verify report." };
    default:
      return null;
  }
}

function groupFindings(findings: BoardFinding[]): Array<[number, BoardFinding[]]> {
  const grouped = new Map<number, BoardFinding[]>();

  for (const finding of findings) {
    grouped.set(finding.severity, [...(grouped.get(finding.severity) ?? []), finding]);
  }

  return [...grouped.entries()].sort(([first], [second]) => second - first);
}

function focusCardInDirection(cards: HTMLElement[], current: HTMLElement, key: string): void {
  const currentBox = current.getBoundingClientRect();
  const currentX = currentBox.left + currentBox.width / 2;
  const currentY = currentBox.top + currentBox.height / 2;
  let best: { element: HTMLElement; score: number } | null = null;

  for (const card of cards) {
    if (card === current) {
      continue;
    }

    const box = card.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const dx = x - currentX;
    const dy = y - currentY;
    let primary = 0;
    let secondary = 0;

    if (key === "ArrowRight" && dx > 0) {
      primary = dx;
      secondary = Math.abs(dy);
    } else if (key === "ArrowLeft" && dx < 0) {
      primary = -dx;
      secondary = Math.abs(dy);
    } else if (key === "ArrowDown" && dy > 0) {
      primary = dy;
      secondary = Math.abs(dx);
    } else if (key === "ArrowUp" && dy < 0) {
      primary = -dy;
      secondary = Math.abs(dx);
    } else {
      continue;
    }

    const score = primary + secondary * 0.35;

    if (best === null || score < best.score) {
      best = { element: card, score };
    }
  }

  best?.element.querySelector<HTMLButtonElement>("[data-card-choose]")?.focus();
}

function structureKindLabel(kind: StructureBlock["kind"]): string {
  return kind.replace(/-/g, " ");
}

interface VariantPreviewProps {
  onOpen: (trigger: HTMLElement) => void;
  token: string;
  variant: BoardVariant;
  version: number;
  viewport: ViewportWidth;
}

function VariantPreview({ onOpen, token, variant, version, viewport }: VariantPreviewProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(0);
  const scale = stageWidth === 0 ? 1 : stageWidth / viewport;
  const left = Math.max(0, (stageWidth - viewport * scale) / 2);

  useEffect(() => {
    const stage = stageRef.current;

    if (stage === null) {
      return;
    }

    const update = (): void => {
      setStageWidth(stage.clientWidth);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);

    return () => observer.disconnect();
  }, []);

  return (
    <div className="card-preview" data-preview-clip="true" data-testid="preview-window">
      <div className="preview-stage" data-preview-clip="true" ref={stageRef}>
        <iframe
          className="preview-frame"
          data-variant-slug={variant.slug}
          height={900}
          scrolling="no"
          src={previewSource(variant.slug, token, version)}
          style={{
            height: "900px",
            left: `${left}px`,
            transform: `scale(${scale})`,
            width: `${viewport}px`,
          }}
          tabIndex={-1}
          title={`${variant.name} preview`}
          width={viewport}
        />
      </div>
      <div className="preview-open">
        <Button
          aria-label={`Open full size ${variant.name}`}
          icon={<ExpandIcon />}
          onClick={(event) => onOpen(event.currentTarget)}
          size="sm"
          variant="secondary"
        >
          Full size
        </Button>
      </div>
    </div>
  );
}

interface FullSizePreviewProps {
  onClose: () => void;
  token: string;
  variant: BoardVariant;
  version: number;
  viewport: ViewportWidth;
}

function FullSizePreview({ onClose, token, variant, version, viewport }: FullSizePreviewProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <div className="dialog-layer">
      <div
        aria-label={`${variant.name} full size preview`}
        aria-modal="true"
        className="full-size-dialog"
        role="dialog"
      >
        <div className="dialog-head">
          <h2>{variant.name} full size preview</h2>
          <IconButton label="Close full size preview" onClick={onClose} ref={closeRef}>
            <CloseIcon />
          </IconButton>
        </div>
        <div className="dialog-body">
          <iframe
            data-variant-slug={variant.slug}
            height={800}
            src={previewSource(variant.slug, token, version)}
            title={`${variant.name} full size preview`}
            width={viewport}
          />
        </div>
      </div>
    </div>
  );
}

export function App({ initialState, token: tokenProp }: AppProps) {
  const [state, setState] = useState<BoardState | null>(initialState ?? null);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState<ViewportWidth>(() => {
    if (typeof window === "undefined") {
      return 1440;
    }

    if (window.innerWidth < 768) {
      return 375;
    }

    if (window.innerWidth < 1280) {
      return 768;
    }

    return 1440;
  });
  const [panelTab, setPanelTab] = useState<PanelTab>("inspector");
  const [panelOpen, setPanelOpen] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1280px)").matches,
  );
  const [previousOpen, setPreviousOpen] = useState(false);
  const [socketReady, setSocketReady] = useState(false);
  const [direction, setDirection] = useState("");
  const [refinedMode, setRefinedMode] = useState<"light" | "deep">("light");
  const [boardBusy, setBoardBusy] = useState(false);
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
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [fullSize, setFullSize] = useState<{
    trigger: HTMLElement | null;
    variant: BoardVariant;
  } | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const toastCounter = useRef(0);
  const panelOpenerRef = useRef<HTMLElement | null>(null);
  const panelToggleRef = useRef<HTMLButtonElement>(null);
  const cardRefs = useRef<Array<HTMLElement | null>>([]);
  const token = tokenProp ?? readToken();

  const addToast = useCallback((message: string): void => {
    toastCounter.current += 1;
    const id = `${Date.now()}-${toastCounter.current}`;

    setToasts((current) => [...current, { id, message }].slice(-3));

    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4_000);
  }, []);

  const closePanel = useCallback((): void => {
    setPanelOpen(false);
    window.setTimeout(() => {
      (panelOpenerRef.current ?? panelToggleRef.current)?.focus();
    }, 0);
  }, []);

  const openPanel = useCallback((tab: PanelTab, event?: { currentTarget: HTMLElement }): void => {
    if (event !== undefined) {
      panelOpenerRef.current = event.currentTarget;
    }

    setPanelTab(tab);
    setPanelOpen(true);
  }, []);

  const closeFullSize = useCallback((): void => {
    setFullSize((current) => {
      const trigger = current?.trigger ?? null;

      window.setTimeout(() => trigger?.focus(), 0);
      return null;
    });
  }, []);

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
    const query = window.matchMedia("(min-width: 1280px)");
    const onChange = (): void => setPanelOpen(query.matches);

    query.addEventListener("change", onChange);

    return () => query.removeEventListener("change", onChange);
  }, []);

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
        } else if (message.type === "direction-request-ack") {
          addToast("Request sent. The agent will pick a new direction.");
        } else if (message.type === "error") {
          addToast(message.message ?? "Could not send the request.");
        }
      } catch {
        addToast("Could not read the reply from the board server.");
      }
    });

    return () => {
      socketRef.current = null;
      socket.close();
    };
  }, [token, loadRounds, loadStructure, addToast]);

  async function updateBoard(
    pathname: "/api/regenerate" | "/api/pin" | "/api/request" | "/api/approve",
    body: Record<string, unknown>,
  ): Promise<void> {
    setBoardBusy(true);

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
      addToast(updateError instanceof Error ? updateError.message : "Could not update the board.");
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
      addToast(
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
      addToast(
        updateError instanceof Error ? updateError.message : "Could not update the structure.",
      );
    } finally {
      setBoardBusy(false);
    }
  }

  const applyOperation = useCallback(
    async (slug: string, operation: EditOperation): Promise<void> => {
      setBoardBusy(true);
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
        addToast(updateError instanceof Error ? updateError.message : "Could not apply the edit.");
      } finally {
        setBoardBusy(false);
      }
    },
    [token, loadRounds, loadStructure, addToast],
  );

  const undo = useCallback(async (): Promise<void> => {
    if (activeSlug === null) {
      return;
    }

    setBoardBusy(true);

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
      addToast(updateError instanceof Error ? updateError.message : "Could not undo.");
    } finally {
      setBoardBusy(false);
    }
  }, [activeSlug, token, loadRounds, loadStructure, addToast]);

  const redo = useCallback(async (): Promise<void> => {
    if (activeSlug === null) {
      return;
    }

    setBoardBusy(true);

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
      addToast(updateError instanceof Error ? updateError.message : "Could not redo.");
    } finally {
      setBoardBusy(false);
    }
  }, [activeSlug, token, loadRounds, loadStructure, addToast]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        if (fullSize !== null) {
          event.preventDefault();
          closeFullSize();
          return;
        }

        if (panelOpen) {
          event.preventDefault();
          closePanel();
          return;
        }

        if (selected !== null) {
          setSelected(null);
        }

        return;
      }

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
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeFullSize, closePanel, fullSize, panelOpen, redo, selected, undo, applyOperation]);

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

      if (document.activeElement instanceof HTMLElement) {
        panelOpenerRef.current = document.activeElement;
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
      setPanelTab("inspector");
      setPanelOpen(true);
    }

    window.addEventListener("message", onMessage);

    return () => window.removeEventListener("message", onMessage);
  }, []);

  function submitDirection(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (socketRef.current === null || socketRef.current.readyState !== WebSocket.OPEN) {
      addToast("Live sync is not connected. Try again in a moment.");
      return;
    }

    if (direction.trim() === "") {
      addToast("Add a direction before sending.");
      return;
    }

    socketRef.current.send(
      JSON.stringify({
        type: "direction-request",
        request: direction.trim(),
      }),
    );
    setDirection("");
  }

  function handleCardKeyDown(event: ReactKeyboardEvent<HTMLElement>, index: number): void {
    if (event.target !== event.currentTarget) {
      return;
    }

    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      const cards = cardRefs.current.filter((card): card is HTMLElement => card !== null);

      if (cards[index] !== undefined) {
        focusCardInDirection(cards, cards[index], event.key);
      }

      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const variant = state?.variants[index];

      if (variant !== undefined) {
        setChosen({ slug: variant.slug, slot: variant.slot });
      }
    }
  }

  function openFullSize(variant: BoardVariant, trigger: HTMLElement): void {
    setFullSize({ trigger, variant });
  }

  if (error !== null) {
    return (
      <main className="app-shell">
        <header className="top-bar" data-testid="top-bar">
          <div className="top-bar-brand">
            <span className="brand-mark">
              <MarkIcon />
            </span>
            <h1 className="brand-name">Fitting Room</h1>
          </div>
        </header>
        <div className="board-main">
          <section className="empty-state">
            <h2>Fitting Room</h2>
            <p role="alert">{error}</p>
          </section>
        </div>
      </main>
    );
  }

  if (state === null) {
    return (
      <main className="app-shell">
        <header className="top-bar" data-testid="top-bar">
          <div className="top-bar-brand">
            <span className="brand-mark">
              <MarkIcon />
            </span>
            <h1 className="brand-name">Fitting Room</h1>
          </div>
        </header>
        <div className="loading-shell">
          <p className="sr-only" role="status">
            Loading the comparison board.
          </p>
          <Skeleton height="32px" width="240px" />
          <div className="loading-grid">
            {[1, 2, 3, 4].map((item) => (
              <div className="skeleton-card" key={item}>
                <Skeleton />
                <Skeleton />
              </div>
            ))}
          </div>
        </div>
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
  const status = boardStatus(state);
  const populated = state.variants.length > 0;
  const panelLabel =
    panelTab === "inspector"
      ? "Inspector"
      : panelTab === "structure"
        ? "Information design"
        : "Findings drawer";
  const panelTabItems = [
    {
      icon: <SlidersIcon />,
      id: "inspector",
      label: "Inspector",
    },
    {
      icon: <LayersIcon />,
      id: "structure",
      label: "Structure",
    },
    {
      count: state.findings.length,
      icon: <ListIcon />,
      id: "findings",
      label: "Findings",
    },
  ];
  const previousAvailable = rounds.length > 0 || state.previousRounds.length > 0;

  return (
    <div className="app-shell">
      <header className="top-bar" data-testid="top-bar">
        <div className="top-bar-brand">
          <span className="brand-mark">
            <MarkIcon />
          </span>
          <h1 className="brand-name">Fitting Room</h1>
        </div>

        <label className="scope-pill">
          <span className="sr-only">Page group</span>
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
                Working on: {scope.name}
              </option>
            ))}
          </select>
          <ChevronDownIcon className="scope-chevron" />
        </label>

        <div className="top-bar-actions">
          <div className="action-group">
            <IconButton
              disabled={boardBusy || activeSlug === null}
              label="Undo"
              onClick={() => void undo()}
            >
              <UndoIcon />
            </IconButton>
            <IconButton
              disabled={boardBusy || activeSlug === null}
              label="Redo"
              onClick={() => void redo()}
            >
              <RedoIcon />
            </IconButton>
          </div>

          <label className="mode-control">
            <span>Refined</span>
            <select
              aria-label="Refined mode"
              onChange={(event) => setRefinedMode(event.target.value as "light" | "deep")}
              value={refinedMode}
            >
              <option value="light">Light</option>
              <option value="deep">Deep</option>
            </select>
          </label>

          <div className="desktop-viewport">
            <SegmentedControl
              label="Viewport size"
              onChange={(value) => setViewport(value as ViewportWidth)}
              options={viewportWidths.map((width) => ({
                label: `${width} px`,
                value: width,
              }))}
              value={viewport}
            />
          </div>

          <label className="viewport-select">
            <span className="sr-only">Preview viewport</span>
            <select
              aria-label="Preview viewport"
              onChange={(event) => setViewport(Number(event.target.value) as ViewportWidth)}
              value={viewport}
            >
              {viewportWidths.map((width) => (
                <option key={width} value={width}>
                  {width} px
                </option>
              ))}
            </select>
          </label>

          <Button
            aria-label="Regenerate all"
            disabled={!populated}
            icon={<RefreshIcon />}
            loading={boardBusy}
            onClick={() => regenerate()}
            variant="secondary"
          >
            Regenerate
          </Button>

          <IconButton
            className="top-bar-findings"
            label={`Findings (${state.findings.length})`}
            onClick={(event) => openPanel("findings", event)}
            variant="secondary"
          >
            <ListIcon />
          </IconButton>

          <Button
            aria-label="Approve selected direction"
            disabled={boardBusy || chosen === null}
            onClick={approve}
            variant="primary"
          >
            Approve
          </Button>

          <IconButton
            className="panel-toggle"
            data-testid="panel-toggle"
            label={panelOpen ? "Close panel" : "Open panel"}
            onClick={(event) => {
              if (panelOpen) {
                closePanel();
              } else {
                openPanel(panelTab, event);
              }
            }}
            ref={panelToggleRef}
            variant="secondary"
          >
            <PanelIcon />
          </IconButton>
        </div>
      </header>

      <div className="banner-row" data-status={state.designSystem?.status ?? "none"}>
        {state.designSystem?.status === "connected" ? (
          <CheckIcon className="banner-icon" />
        ) : state.designSystem?.status === "partial" ? (
          <WarningIcon className="banner-icon" />
        ) : (
          <InfoIcon className="banner-icon" />
        )}
        <span className="banner-text">{designSystemBanner(state)}</span>
      </div>

      {populated && status !== null ? (
        <div className="status-row" role="status">
          {state.status === "generating" ? <span className="status-dot" /> : <CheckIcon />}
          <span>{status.main}</span>
          {status.detail === undefined ? null : (
            <span className="status-row-detail">{status.detail}</span>
          )}
        </div>
      ) : null}

      <div className="board-layout" data-panel-open={panelOpen}>
        <main className="board-main">
          {!populated ? (
            <section className="empty-state">
              <h2>No directions yet.</h2>
              <p>Run an audit and generate directions, or click Generate directions.</p>
              <div className="empty-actions">
                <Button
                  disabled={boardBusy}
                  loading={boardBusy}
                  onClick={() => requestDirections(selectedScope.name)}
                  variant="primary"
                >
                  Generate directions
                </Button>
              </div>
              {state.status === "generating" ? (
                <p className="waiting-line" role="status">
                  <span className="status-dot" />
                  Waiting for your agent.
                </p>
              ) : null}
              {emptyMessage === "" ? null : (
                <p className="ask-line" role="status">
                  {emptyMessage}
                </p>
              )}
            </section>
          ) : (
            <>
              <section
                aria-label="Design variants"
                className="variant-grid"
                data-testid="variant-grid"
              >
                {state.variants.map((variant, index) => {
                  const count = state.findings.filter(
                    (finding) => finding.variantSlug === variant.slug,
                  ).length;
                  const isChosen = chosen?.slot === variant.slot && chosen.slug === variant.slug;

                  return (
                    <article
                      aria-label={`${String(variant.slot).padStart(2, "0")} ${
                        roleLabels[variant.slot] ?? "Direction"
                      }: ${variant.name}`}
                      className="variant-card"
                      data-chosen={isChosen}
                      data-testid="variant-card"
                      key={variant.slot}
                      ref={(element) => {
                        cardRefs.current[index] = element;
                      }}
                    >
                      <div className="card-header">
                        <span className="card-index">
                          {String(variant.slot).padStart(2, "0")}{" "}
                          {roleLabels[variant.slot] ?? "Direction"}
                        </span>
                        <h2
                          className={
                            variant.slot === 1 ? "card-name card-name-refined" : "card-name"
                          }
                          title={variant.name}
                        >
                          {variant.name}
                        </h2>
                        {isChosen ? (
                          <span className="card-state" data-selected="true">
                            Selected
                          </span>
                        ) : variant.pinned ? (
                          <span className="card-state" data-pinned="true">
                            Pinned
                          </span>
                        ) : null}
                        <span className="card-finding-count">{findingLabel(count)}</span>
                        <div className="card-actions">
                          <IconButton
                            disabled={boardBusy}
                            label={variant.pinned ? `Unpin ${variant.name}` : `Pin ${variant.name}`}
                            onClick={() => togglePin(variant.slot, !variant.pinned)}
                            pressed={variant.pinned}
                            tooltip={variant.pinned ? "Unpin direction" : "Pin direction"}
                          >
                            <PinIcon />
                          </IconButton>
                          <IconButton
                            disabled={boardBusy || variant.pinned}
                            label={`Regenerate ${variant.name}`}
                            onClick={() => regenerate([variant.slot])}
                            tooltip={
                              variant.pinned
                                ? "Pinned directions do not regenerate"
                                : "Regenerate this slot"
                            }
                          >
                            <RefreshIcon />
                          </IconButton>
                        </div>
                      </div>

                      <VariantPreview
                        onOpen={(trigger) => openFullSize(variant, trigger)}
                        token={token}
                        variant={variant}
                        version={previewVersion}
                        viewport={viewport}
                      />

                      <div className="card-footer">
                        {variant.slot === 1 ? (
                          <div className="card-meta">
                            <span className="refined-label">Your design, refined.</span>
                          </div>
                        ) : null}
                        <p
                          className="rationale"
                          data-testid="card-rationale"
                          title={variant.rationale}
                        >
                          {variant.rationale}
                        </p>
                        <div className="card-footer-actions">
                          <Button
                            aria-label={`Choose ${variant.name}`}
                            aria-pressed={isChosen}
                            data-card-choose="true"
                            icon={isChosen ? <CheckIcon /> : undefined}
                            onClick={() => setChosen({ slug: variant.slug, slot: variant.slot })}
                            onKeyDown={(event) => handleCardKeyDown(event, index)}
                            variant={isChosen ? "primary" : "secondary"}
                          >
                            Choose
                          </Button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </section>

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
                  <Button disabled={!socketReady} type="submit" variant="primary">
                    Send request
                  </Button>
                </div>
                <p className="connection-line">
                  {socketReady ? "Live sync connected." : "Connecting to live sync."}
                </p>
              </form>

              {previousAvailable ? (
                <section aria-label="Previous rounds" className="previous-strip">
                  <button
                    aria-expanded={previousOpen}
                    className="previous-toggle"
                    onClick={() => setPreviousOpen((open) => !open)}
                    type="button"
                  >
                    <ChevronRightIcon className="previous-chevron" />
                    <span>{previousOpen ? "Hide previous rounds" : "Show previous rounds"}</span>
                  </button>

                  {previousOpen ? (
                    <div className="previous-body">
                      {rounds.length > 0
                        ? rounds.map((round) => (
                            <article
                              className="previous-round"
                              data-round={round.number}
                              key={round.id}
                            >
                              <div className="previous-round-head">
                                <span>
                                  Round {round.number}
                                  {round.number === state.round ? " (current)" : ""}
                                </span>
                                <span>{round.variants.length} directions</span>
                              </div>
                              <div className="round-snapshots">
                                {round.variants.map((snapshot) => (
                                  <button
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
                                    <span className="sr-only">Restore</span>
                                    {snapshot.screenshot === null ? (
                                      <span className="snapshot-placeholder">
                                        Slot {snapshot.slot}
                                      </span>
                                    ) : (
                                      <img
                                        alt=""
                                        src={`/round-assets/${round.number}/${snapshot.screenshot}?token=${encodeURIComponent(token)}`}
                                      />
                                    )}
                                    <span className="snapshot-name" title={snapshot.name}>
                                      {snapshot.name}
                                    </span>
                                    <span className="snapshot-state">
                                      {snapshot.current ? "Current" : "Replaced"}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            </article>
                          ))
                        : state.previousRounds.map((round, index) => (
                            <article className="previous-round" key={round.id}>
                              <div className="previous-round-head">
                                <span>Round {index + 1}</span>
                              </div>
                              <p className="rationale">
                                {round.variants.map((variant) => variant.name).join(" / ")}
                              </p>
                            </article>
                          ))}
                      <div className="restore-controls">
                        <Button
                          disabled={boardBusy || chosenSnapshot === null}
                          onClick={() => void restoreSnapshot()}
                          variant="secondary"
                        >
                          Restore
                        </Button>
                        {chosenSnapshot === null ? null : (
                          <span>Restoring {chosenSnapshot.label}.</span>
                        )}
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : null}
            </>
          )}
        </main>

        {panelOpen ? (
          <aside aria-label={panelLabel} className="board-panel" data-testid="board-panel">
            <div className="panel-handle" />
            <div className="panel-head">
              <div className="panel-history">
                <IconButton
                  disabled={boardBusy || activeSlug === null}
                  label="Undo"
                  onClick={() => void undo()}
                >
                  <UndoIcon />
                </IconButton>
                <IconButton
                  disabled={boardBusy || activeSlug === null}
                  label="Redo"
                  onClick={() => void redo()}
                >
                  <RedoIcon />
                </IconButton>
              </div>
              <span className="panel-head-spacer" />
              <IconButton label="Close panel" onClick={closePanel}>
                <CloseIcon />
              </IconButton>
            </div>

            <Tabs
              active={panelTab}
              idPrefix="board-panel"
              label="Board panel"
              onChange={(id) => setPanelTab(id as PanelTab)}
              tabs={panelTabItems}
            />

            <div
              aria-labelledby={`board-panel-tab-${panelTab}`}
              className="panel-scroll"
              id={`board-panel-${panelTab}`}
              role="tabpanel"
            >
              {panelTab === "inspector" ? (
                selected === null ? (
                  <div className="panel-empty">
                    <SlidersIcon size={20} />
                    <strong>Select an element in a preview.</strong>
                    <p>Choose any element in a card to edit its text, color and spacing.</p>
                  </div>
                ) : (
                  <Inspector
                    designSystem={state.designSystem}
                    key={selected.id}
                    onEdit={(slug, operation) => {
                      void applyOperation(slug, operation);
                    }}
                    selected={selected}
                  />
                )
              ) : null}

              {panelTab === "structure" ? (
                structure === null || structure.blocks.length === 0 ? (
                  <div className="panel-empty">
                    <LayersIcon size={20} />
                    <strong>No structure yet.</strong>
                    <p>Choose a variant to see its content blocks.</p>
                  </div>
                ) : (
                  <section aria-label="Information design" className="structure-content">
                    <div className="structure-heading">
                      <div>
                        <h2>Information design</h2>
                        <p className="structure-line">
                          Editing{" "}
                          {chosen?.slug ?? activeSlug ?? state.variants[0]?.slug ?? "this variant"}
                        </p>
                      </div>
                      <label className="field-inline">
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
                    <ul className="structure-list">
                      {structure.blocks.map((block) => (
                        <li
                          className="structure-block"
                          data-block-id={block.id}
                          data-visible={block.visible}
                          key={block.id}
                        >
                          <div className="structure-block-copy">
                            <strong title={block.label}>{block.label}</strong>
                            <span>
                              {structureKindLabel(block.kind)}
                              {block.visible ? "" : " / hidden"}
                            </span>
                          </div>
                          <div className="structure-block-actions">
                            <IconButton
                              disabled={boardBusy || !block.visible || block.order === 1}
                              label={`Move ${block.label} up`}
                              onClick={() =>
                                void applyStructure({
                                  action: "reorder",
                                  id: block.id,
                                  index: block.order - 2,
                                })
                              }
                              variant="secondary"
                            >
                              <ArrowUpIcon />
                            </IconButton>
                            <IconButton
                              disabled={
                                boardBusy ||
                                !block.visible ||
                                block.order === structure.blocks.length
                              }
                              label={`Move ${block.label} down`}
                              onClick={() =>
                                void applyStructure({
                                  action: "reorder",
                                  id: block.id,
                                  index: block.order,
                                })
                              }
                              variant="secondary"
                            >
                              <ArrowDownIcon />
                            </IconButton>
                            <IconButton
                              disabled={boardBusy || !block.visible}
                              label={`Hide ${block.label}`}
                              onClick={() => void applyStructure({ action: "hide", id: block.id })}
                              variant="secondary"
                            >
                              <EyeOffIcon />
                            </IconButton>
                            <IconButton
                              disabled={boardBusy || !block.visible}
                              label={`Promote ${block.label}`}
                              onClick={() =>
                                void applyStructure({ action: "promote", id: block.id })
                              }
                              variant="secondary"
                            >
                              <PromoteIcon />
                            </IconButton>
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
                    <Button
                      disabled={boardBusy || groupSelection.length !== 2}
                      icon={<GroupIcon />}
                      onClick={() => {
                        const [first, second] = groupSelection;

                        if (first !== undefined && second !== undefined) {
                          void applyStructure({
                            action: "group",
                            firstId: first,
                            secondId: second,
                          });
                        }
                      }}
                      variant="secondary"
                    >
                      Group selected
                    </Button>
                  </section>
                )
              ) : null}

              {panelTab === "findings" ? (
                groupedFindings.length === 0 ? (
                  <div className="panel-empty">
                    <ListIcon size={20} />
                    <strong>No findings for this scope.</strong>
                    <p>Run an audit to fill this panel.</p>
                  </div>
                ) : (
                  <div className="findings-list">
                    {groupedFindings.map(([severity, findings]) => (
                      <section className="severity-group" key={severity}>
                        <h3 className="severity-title">Severity {severity}</h3>
                        <div className="findings-list">
                          {findings.map((finding) => {
                            const variant = state.variants.find(
                              (candidate) => candidate.slug === finding.variantSlug,
                            );

                            return (
                              <article className="finding-card" key={finding.id}>
                                <p className="finding-title" title={finding.title}>
                                  {finding.title}
                                </p>
                                <p className="finding-meta">
                                  {variant?.name ?? "Variant"} / {finding.confidence}
                                </p>
                                <a
                                  className="citation-link"
                                  href={finding.citationUrl}
                                  rel="noreferrer"
                                  target="_blank"
                                  title={finding.citation}
                                >
                                  {finding.citation}
                                </a>
                                <p className="finding-fix">{finding.fix}</p>
                              </article>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                )
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>

      {panelOpen ? <div aria-hidden="true" className="panel-scrim" onClick={closePanel} /> : null}

      <ToastStack
        onDismiss={(id) => setToasts((items) => items.filter((toast) => toast.id !== id))}
        toasts={toasts}
      />

      {fullSize === null ? null : (
        <FullSizePreview
          onClose={closeFullSize}
          token={token}
          variant={fullSize.variant}
          version={previewVersion}
          viewport={viewport}
        />
      )}
    </div>
  );
}
