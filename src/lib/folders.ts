import { nanoid } from "nanoid";
import { db, type Folder } from "../db/db";

export async function createFolder(name: string): Promise<Folder> {
  const now = Date.now();
  const folder: Folder = { id: nanoid(10), name, createdAt: now, updatedAt: now };
  await db.folders.add(folder);
  return folder;
}

export async function renameFolder(id: string, name: string): Promise<void> {
  await db.folders.update(id, { name, updatedAt: Date.now() });
}

export async function deleteFolder(id: string): Promise<void> {
  await db.transaction("rw", db.folders, db.stories, async () => {
    await db.folders.delete(id);
    // Orphan stories rather than deleting them.
    await db.stories.where("folderId").equals(id).modify({ folderId: null });
  });
}

export async function moveStoryToFolder(storyId: string, folderId: string | null): Promise<void> {
  await db.stories.update(storyId, { folderId, updatedAt: Date.now() });
}
