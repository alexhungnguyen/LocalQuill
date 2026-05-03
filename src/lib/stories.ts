import { nanoid } from "nanoid";
import { db, type Story } from "../db/db";

export async function createStory(title = "Untitled Story"): Promise<Story> {
  const now = Date.now();
  const story: Story = {
    id: nanoid(10),
    title,
    content: "",
    memory: "",
    authorsNote: "",
    generationSpans: [],
    folderId: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.stories.add(story);
  return story;
}

export async function deleteStory(id: string): Promise<void> {
  await db.transaction("rw", db.stories, db.snapshots, async () => {
    await db.stories.delete(id);
    await db.snapshots.where("storyId").equals(id).delete();
  });
}

export async function duplicateStory(id: string): Promise<Story | null> {
  const original = await db.stories.get(id);
  if (!original) return null;
  const now = Date.now();
  const copy: Story = {
    ...original,
    id: nanoid(10),
    title: `${original.title} (copy)`,
    createdAt: now,
    updatedAt: now,
  };
  await db.stories.add(copy);
  return copy;
}

export async function updateStory(
  id: string,
  patch: Partial<Omit<Story, "id" | "createdAt">>,
): Promise<void> {
  await db.stories.update(id, { ...patch, updatedAt: Date.now() });
}

export async function snapshotStory(
  storyId: string,
  content: string,
  label: string,
): Promise<void> {
  await db.snapshots.add({
    id: nanoid(12),
    storyId,
    content,
    createdAt: Date.now(),
    label,
  });
  // Keep only the most recent N snapshots per story to bound storage.
  const KEEP = 30;
  const all = await db.snapshots
    .where("storyId")
    .equals(storyId)
    .sortBy("createdAt");
  if (all.length > KEEP) {
    const toDelete = all.slice(0, all.length - KEEP).map((s) => s.id);
    await db.snapshots.bulkDelete(toDelete);
  }
}

export function exportStoryAsJSON(story: Story): string {
  return JSON.stringify(story, null, 2);
}

export async function importStoryFromJSON(json: string): Promise<Story> {
  const parsed = JSON.parse(json) as Partial<Story>;
  const now = Date.now();
  const story: Story = {
    id: nanoid(10),
    title: parsed.title ?? "Imported Story",
    content: parsed.content ?? "",
    memory: parsed.memory ?? "",
    authorsNote: parsed.authorsNote ?? "",
    generationSpans: parsed.generationSpans ?? [],
    folderId: parsed.folderId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await db.stories.add(story);
  return story;
}
