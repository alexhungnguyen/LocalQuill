import Dexie, { type EntityTable } from "dexie";

/** Marks a span of the story content that was produced by the LLM. */
export interface GenerationSpan {
  start: number;
  end: number;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface Story {
  id: string;
  title: string;
  content: string;
  memory: string;
  authorsNote: string;
  /** Character ranges of LLM-generated text within content. */
  generationSpans: GenerationSpan[];
  /** Folder this story belongs to, or null for uncategorized. */
  folderId: string | null;
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
  folders!: EntityTable<Folder, "id">;

  constructor() {
    super("localquill");
    this.version(1).stores({
      stories: "id, updatedAt, title",
      snapshots: "id, storyId, createdAt",
      settings: "key",
    });
    this.version(2).stores({
      stories: "id, updatedAt, title",
      snapshots: "id, storyId, createdAt",
      settings: "key",
    }).upgrade((tx) => {
      return tx.table("stories").toCollection().modify((story: Story) => {
        if (!story.generationSpans) story.generationSpans = [];
      });
    });
    this.version(3).stores({
      stories: "id, updatedAt, title, folderId",
      snapshots: "id, storyId, createdAt",
      settings: "key",
      folders: "id, name",
    }).upgrade((tx) => {
      return tx.table("stories").toCollection().modify((story: Story) => {
        if (story.folderId === undefined) story.folderId = null;
      });
    });
  }
}

export const db = new LocalQuillDB();
