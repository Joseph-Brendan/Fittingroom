import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";
import type { BoardDesignSystem } from "./types";
import { Button, CopyIcon, PlusIcon, TrashIcon } from "./ui";

export interface SelectedPreviewElement {
  id: string;
  label: string;
  parentId: string | null;
  siblings: Array<{ id: string; label: string }>;
  slug: string;
}

export interface EditOperation {
  [key: string]: unknown;
  op: string;
}

interface InspectorProps {
  designSystem?: BoardDesignSystem | undefined;
  onEdit: (slug: string, operation: EditOperation) => void;
  selected: SelectedPreviewElement;
}

interface TokenFieldProps {
  category: "color" | "space" | "radius" | "fontSize";
  designSystem?: BoardDesignSystem | undefined;
  label: string;
  onEdit: (slug: string, operation: EditOperation) => void;
  property: string;
  selected: SelectedPreviewElement;
}

interface SortableItemProps {
  id: string;
  label: string;
}

const basicComponents = ["heading", "text", "button", "input", "image"] as const;

function tokenOptions(
  designSystem: BoardDesignSystem | undefined,
  category: TokenFieldProps["category"],
): Array<[string, string]> {
  return Object.entries(designSystem?.tokens[category] ?? {});
}

function TokenField({
  category,
  designSystem,
  label,
  onEdit,
  property,
  selected,
}: TokenFieldProps) {
  const [choice, setChoice] = useState("");
  const [customValue, setCustomValue] = useState("");

  function choose(next: string): void {
    setChoice(next);

    if (next !== "" && next !== "custom") {
      onEdit(selected.slug, {
        op: "set-token",
        id: selected.id,
        property,
        token: next,
      });
    }
  }

  function applyCustom(): void {
    if (customValue.trim() === "") {
      return;
    }

    onEdit(selected.slug, {
      op: "set-token",
      id: selected.id,
      property,
      token: customValue.trim(),
    });
  }

  return (
    <div className="inspector-field">
      <label>
        {label}
        <select aria-label={label} onChange={(event) => choose(event.target.value)} value={choice}>
          <option value="">Choose a token</option>
          {tokenOptions(designSystem, category).map(([name, value]) => (
            <option key={name} value={`${category}.${name}`}>
              {name} ({value})
            </option>
          ))}
          <option value="custom">Custom value</option>
        </select>
      </label>
      {choice === "custom" ? (
        <div className="custom-value">
          <p>Custom value, not in your system.</p>
          <input
            aria-label={`Custom ${label.toLowerCase()}`}
            onChange={(event) => setCustomValue(event.target.value)}
            placeholder="Enter a CSS value"
            value={customValue}
          />
          <Button onClick={applyCustom} variant="primary">
            Apply custom value
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SortableItem({ id, label }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });

  return (
    <li
      className="structure-item"
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        {...attributes}
        {...listeners}
        aria-label={`Drag ${label}`}
        className="drag-handle"
        type="button"
      >
        {label}
      </button>
    </li>
  );
}

export function Inspector({ designSystem, onEdit, selected }: InspectorProps) {
  const [insertComponent, setInsertComponent] = useState(
    designSystem?.components[0]?.toLowerCase() ?? basicComponents[0],
  );
  const [text, setText] = useState(selected.label);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const projectComponents = (designSystem?.components ?? []).map((component) => ({
    label: `${component} (project)`,
    value: component.toLowerCase(),
  }));
  const options = [
    ...projectComponents,
    ...basicComponents
      .filter((component) => !projectComponents.some((project) => project.value === component))
      .map((component) => ({ label: component, value: component })),
  ];

  function dragEnd(event: DragEndEvent): void {
    const { active, over } = event;

    if (over === null || active.id === over.id || selected.parentId === null) {
      return;
    }

    const index = selected.siblings.findIndex((sibling) => sibling.id === over.id);

    if (index === -1) {
      return;
    }

    onEdit(selected.slug, {
      op: "move",
      id: String(active.id),
      parent: selected.parentId,
      index,
    });
  }

  return (
    <div className="inspector-content">
      <div className="inspector-heading">
        <h2>Inspector</h2>
        <p className="selected-id" data-testid="selected-fr-id" title={selected.id}>
          {selected.id}
        </p>
      </div>

      <div className="inspector-fields">
        <div className="inspector-field">
          <span>Text</span>
          <input
            aria-label="Text content"
            onChange={(event) => setText(event.target.value)}
            type="text"
            value={text}
          />
          <Button
            className="apply-text"
            onClick={() =>
              onEdit(selected.slug, { op: "set-text", id: selected.id, text: text.trim() })
            }
            variant="secondary"
          >
            Apply text
          </Button>
        </div>
        <div className="inspector-field">
          <label>
            Font weight
            <select
              aria-label="Font weight"
              defaultValue=""
              onChange={(event) => {
                if (event.target.value === "") {
                  return;
                }

                onEdit(selected.slug, {
                  op: "set-token",
                  id: selected.id,
                  property: "fontWeight",
                  token: event.target.value,
                });
              }}
            >
              <option value="">Choose a weight</option>
              <option value="400">400 Regular</option>
              <option value="500">500 Medium</option>
              <option value="600">600 Semibold</option>
              <option value="700">700 Bold</option>
            </select>
          </label>
        </div>
        <div className="inspector-field">
          <label>
            Visibility
            <select
              aria-label="Visibility"
              defaultValue=""
              onChange={(event) => {
                if (event.target.value === "") {
                  return;
                }

                onEdit(selected.slug, {
                  op: "set-token",
                  id: selected.id,
                  property: "visibility",
                  token: event.target.value,
                });
              }}
            >
              <option value="">Choose visibility</option>
              <option value="visible">Visible</option>
              <option value="hidden">Hidden</option>
            </select>
          </label>
        </div>
        <TokenField
          category="color"
          designSystem={designSystem}
          label="Color"
          onEdit={onEdit}
          property="color"
          selected={selected}
        />
        <TokenField
          category="space"
          designSystem={designSystem}
          label="Spacing"
          onEdit={onEdit}
          property="padding"
          selected={selected}
        />
        <TokenField
          category="radius"
          designSystem={designSystem}
          label="Radius"
          onEdit={onEdit}
          property="borderRadius"
          selected={selected}
        />
        <TokenField
          category="fontSize"
          designSystem={designSystem}
          label="Type"
          onEdit={onEdit}
          property="fontSize"
          selected={selected}
        />
      </div>

      <div className="inspector-actions">
        <Button
          icon={<TrashIcon />}
          onClick={() => onEdit(selected.slug, { op: "delete", id: selected.id })}
          variant="danger"
        >
          Delete
        </Button>
        <Button
          icon={<CopyIcon />}
          onClick={() =>
            onEdit(selected.slug, {
              op: "duplicate",
              id: selected.id,
              newId: `${selected.id}-copy`,
            })
          }
          variant="secondary"
        >
          Duplicate
        </Button>
      </div>

      <section className="insert-panel">
        <h3 className="inspector-section-title">Insert</h3>
        <div className="insert-row">
          <select
            aria-label="Insert component"
            onChange={(event) => setInsertComponent(event.target.value)}
            value={insertComponent}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <Button
            icon={<PlusIcon />}
            onClick={() =>
              onEdit(selected.slug, {
                op: "insert",
                parent: selected.id,
                component: insertComponent,
                id: `insert-${Date.now().toString(36)}`,
                text: insertComponent,
              })
            }
            variant="secondary"
          >
            Insert
          </Button>
        </div>
      </section>

      {selected.siblings.length > 1 ? (
        <section className="structure-order">
          <h3 className="inspector-section-title">Order in {selected.parentId ?? "parent"}</h3>
          <DndContext collisionDetection={closestCenter} onDragEnd={dragEnd} sensors={sensors}>
            <SortableContext
              items={selected.siblings.map((sibling) => sibling.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="order-list">
                {selected.siblings.map((sibling) => (
                  <SortableItem id={sibling.id} key={sibling.id} label={sibling.label} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </section>
      ) : null}
    </div>
  );
}
