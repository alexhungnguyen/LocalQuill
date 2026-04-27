import Dexie, { type EntityTable } from "dexie";

/**
 * Persistent story record. Everything sits in a single IndexedDB table —
 * stories are independent documents and we don't need cross-story queries.
 *
 * `memory` is always-prepended context (NovelAI's "Memory"), `authorsNote`
 * is appended near the tail of the prompt (NovelAI's "Author's Note") to
 * gently steer the model without dominating long histories.
 */
export interface Story {
  id: string;
  title: string;
  content: string;
  memory: string;
  authorsNote: string;
  createdAt: number;
  updatedAt: number;
}

export interface Snapshot {
  id: string;
  storyId: string;
  content: string;
  createdAt: number;
  /** Human-readable label, e.g. "before generation" or "manual save". */
  label: string;
}

export interface AppSetting {
  key: string;
  value: unknown;
}

class LocalQuillDB extends Dexie {
  stories!: EntityTable<Story, "id">;
  snapshots!: EntityTable<Snapshot, "id">;
  settings!: EntityTable<AppSetting, "key">;

  constructor() {
    super("localquill");
    this.version(1).stores({
      stories: "id, updatedAt, title",
      snapshots: "id, storyId, createdAt",
      settings: "key",
    });
  }
}

export const db = new LocalQuillDB();
