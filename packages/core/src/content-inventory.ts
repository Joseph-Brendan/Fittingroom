import { readFile } from "node:fs/promises";

export interface ContentInventoryItem {
  role: string;
  text: string;
}

interface AccessibilityValue {
  value?: unknown;
}

interface AccessibilityNode {
  ignored?: boolean;
  name?: AccessibilityValue;
  role?: AccessibilityValue;
}

const contentRoles = new Set([
  "article",
  "banner",
  "button",
  "checkbox",
  "combobox",
  "contentinfo",
  "form",
  "heading",
  "img",
  "link",
  "list",
  "listbox",
  "listitem",
  "main",
  "menuitem",
  "navigation",
  "paragraph",
  "radio",
  "region",
  "searchbox",
  "switch",
  "tab",
  "table",
  "textbox",
]);

export async function readContentInventory(
  accessibilityTreePath: string,
): Promise<ContentInventoryItem[]> {
  const raw = JSON.parse(await readFile(accessibilityTreePath, "utf8")) as {
    nodes?: AccessibilityNode[];
  };
  const inventory: ContentInventoryItem[] = [];
  const seen = new Set<string>();

  for (const node of raw.nodes ?? []) {
    if (node.ignored === true) {
      continue;
    }

    const role = node.role?.value;
    const text = node.name?.value;

    if (
      typeof role !== "string" ||
      typeof text !== "string" ||
      text.trim() === "" ||
      !contentRoles.has(role)
    ) {
      continue;
    }

    const key = `${role}:${text}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    inventory.push({ role, text });
  }

  return inventory;
}
