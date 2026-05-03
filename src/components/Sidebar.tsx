import { useLiveQuery } from "dexie-react-hooks";
import {
  Plus,
  Trash2,
  Copy,
  Download,
  Upload,
  BookOpen,
  Pencil,
  FolderPlus,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { useRef, useState } from "react";
import { db } from "../db/db";
import type { Story } from "../db/db";
import {
  createStory,
  deleteStory,
  duplicateStory,
  exportStoryAsJSON,
  importStoryFromJSON,
  updateStory,
} from "../lib/stories";
import {
  createFolder,
  deleteFolder,
  renameFolder,
  moveStoryToFolder,
} from "../lib/folders";
import { useStore } from "../store/useStore";

export function Sidebar() {
  const stories = useLiveQuery(
    () => db.stories.orderBy("updatedAt").reverse().toArray(),
    [],
  );
  const folders = useLiveQuery(() => db.folders.orderBy("name").toArray(), []);
  const currentStoryId = useStore((s) => s.currentStoryId);
  const setCurrentStoryId = useStore((s) => s.setCurrentStoryId);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const toggleFolder = (id: string) =>
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const handleNew = async (folderId: string | null = null) => {
    const story = await createStory();
    if (folderId) await moveStoryToFolder(story.id, folderId);
    setCurrentStoryId(story.id);
    if (folderId) setExpandedFolders((prev) => new Set(prev).add(folderId));
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this story? This cannot be undone.")) return;
    await deleteStory(id);
    if (currentStoryId === id) setCurrentStoryId(null);
  };

  const handleDuplicate = async (id: string) => {
    const copy = await duplicateStory(id);
    if (copy) setCurrentStoryId(copy.id);
  };

  const handleExport = async (id: string) => {
    const story = await db.stories.get(id);
    if (!story) return;
    const blob = new Blob([exportStoryAsJSON(story)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug(story.title)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const story = await importStoryFromJSON(text);
      setCurrentStoryId(story.id);
    } catch (err) {
      alert(`Import failed: ${(err as Error).message}`);
    } finally {
      e.target.value = "";
    }
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim() || "New Folder";
    const folder = await createFolder(name);
    setExpandedFolders((prev) => new Set(prev).add(folder.id));
    setCreatingFolder(false);
    setNewFolderName("");
  };

  const handleDeleteFolder = async (id: string) => {
    if (!confirm("Delete this folder? Stories inside will become uncategorized.")) return;
    await deleteFolder(id);
    setExpandedFolders((prev) => { const s = new Set(prev); s.delete(id); return s; });
  };

  const storiesByFolder = (stories ?? []).reduce<Record<string, Story[]>>((acc, story) => {
    const key = story.folderId ?? "__none__";
    (acc[key] ??= []).push(story);
    return acc;
  }, {});

  const uncategorized = storiesByFolder["__none__"] ?? [];

  return (
    <aside className="w-72 shrink-0 h-full panel border-r flex flex-col">
      <div className="p-3 border-b border-ink-800 flex items-center gap-2">
        <BookOpen size={16} className="text-accent-500" />
        <h1 className="font-semibold text-ink-50 tracking-tight">LocalQuill</h1>
      </div>

      <div className="p-2 flex gap-1.5">
        <button onClick={() => handleNew()} className="btn-primary flex-1">
          <Plus size={14} /> New Story
        </button>
        <button
          onClick={() => { setCreatingFolder(true); setNewFolderName(""); }}
          className="btn-ghost"
          title="New folder"
        >
          <FolderPlus size={14} />
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="btn-ghost"
          title="Import story (.json)"
        >
          <Upload size={14} />
        </button>
        <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={handleImport} />
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {creatingFolder && (
          <div className="flex items-center gap-1 px-1 py-1 mb-1">
            <Folder size={14} className="text-accent-400 shrink-0" />
            <input
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onBlur={handleCreateFolder}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreateFolder();
                if (e.key === "Escape") { setCreatingFolder(false); setNewFolderName(""); }
              }}
              placeholder="Folder name"
              className="field-input py-0.5 text-sm flex-1"
            />
          </div>
        )}

        {(folders ?? []).map((folder) => {
          const isOpen = expandedFolders.has(folder.id);
          const folderStories = storiesByFolder[folder.id] ?? [];
          return (
            <FolderRow
              key={folder.id}
              folder={folder}
              stories={folderStories}
              isOpen={isOpen}
              currentStoryId={currentStoryId}
              folders={folders ?? []}
              onToggle={() => toggleFolder(folder.id)}
              onNewStory={() => void handleNew(folder.id)}
              onRename={renameFolder}
              onDelete={() => void handleDeleteFolder(folder.id)}
              onSelectStory={setCurrentStoryId}
              onDuplicateStory={(id) => void handleDuplicate(id)}
              onExportStory={(id) => void handleExport(id)}
              onDeleteStory={(id) => void handleDelete(id)}
              onMoveStory={moveStoryToFolder}
            />
          );
        })}

        {uncategorized.length > 0 && (
          <div className="mt-1">
            {(folders ?? []).length > 0 && (
              <div className="px-2 py-1 text-[11px] text-ink-500 uppercase tracking-wider">
                Uncategorized
              </div>
            )}
            {uncategorized.map((story) => (
              <StoryRow
                key={story.id}
                story={story}
                isActive={story.id === currentStoryId}
                folders={folders ?? []}
                onSelect={() => setCurrentStoryId(story.id)}
                onDuplicate={() => void handleDuplicate(story.id)}
                onExport={() => void handleExport(story.id)}
                onDelete={() => void handleDelete(story.id)}
                onMove={(folderId) => void moveStoryToFolder(story.id, folderId)}
                onRename={(title) => void updateStory(story.id, { title })}
              />
            ))}
          </div>
        )}

        {(stories ?? []).length === 0 && !creatingFolder && (
          <div className="text-ink-400 text-sm px-2 py-6 text-center">
            No stories yet.
            <br />
            Click <span className="text-accent-400">New Story</span> to begin.
          </div>
        )}
      </div>
    </aside>
  );
}

function FolderRow({
  folder, stories, isOpen, currentStoryId, folders,
  onToggle, onNewStory, onRename, onDelete,
  onSelectStory, onDuplicateStory, onExportStory, onDeleteStory, onMoveStory,
}: {
  folder: import("../db/db").Folder;
  stories: Story[];
  isOpen: boolean;
  currentStoryId: string | null;
  folders: import("../db/db").Folder[];
  onToggle: () => void;
  onNewStory: () => void;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: () => void;
  onSelectStory: (id: string) => void;
  onDuplicateStory: (id: string) => void;
  onExportStory: (id: string) => void;
  onDeleteStory: (id: string) => void;
  onMoveStory: (storyId: string, folderId: string | null) => Promise<void>;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(folder.name);

  const commitRename = async () => {
    await onRename(folder.id, nameValue.trim() || folder.name);
    setEditingName(false);
  };

  return (
    <div className="mb-0.5">
      <div
        className="group flex items-center gap-1 px-1 py-1.5 rounded-md hover:bg-ink-800/60 cursor-pointer"
        onClick={onToggle}
      >
        <span className="text-ink-500 shrink-0">
          {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        {isOpen
          ? <FolderOpen size={14} className="text-accent-400 shrink-0" />
          : <Folder size={14} className="text-accent-400 shrink-0" />
        }
        {editingName ? (
          <input
            autoFocus
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={() => void commitRename()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commitRename();
              if (e.key === "Escape") setEditingName(false);
            }}
            className="field-input py-0 text-sm flex-1"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="flex-1 text-sm text-ink-100 truncate font-medium">{folder.name}</span>
        )}
        <span className="text-[11px] text-ink-500 shrink-0 mr-1">{stories.length}</span>
        <div
          className="flex gap-0.5 opacity-0 group-hover:opacity-100 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <IconBtn title="New story in folder" onClick={onNewStory}><Plus size={11} /></IconBtn>
          <IconBtn title="Rename folder" onClick={() => { setEditingName(true); setNameValue(folder.name); }}><Pencil size={11} /></IconBtn>
          <IconBtn title="Delete folder" onClick={onDelete}><Trash2 size={11} /></IconBtn>
        </div>
      </div>

      {isOpen && (
        <div className="ml-3 border-l border-ink-800 pl-2 mb-1">
          {stories.length === 0 ? (
            <div className="text-[11px] text-ink-500 px-2 py-1.5">Empty — click + to add a story</div>
          ) : (
            stories.map((story) => (
              <StoryRow
                key={story.id}
                story={story}
                isActive={story.id === currentStoryId}
                folders={folders}
                onSelect={() => onSelectStory(story.id)}
                onDuplicate={() => onDuplicateStory(story.id)}
                onExport={() => onExportStory(story.id)}
                onDelete={() => onDeleteStory(story.id)}
                onMove={(folderId) => void onMoveStory(story.id, folderId)}
                onRename={(title) => void updateStory(story.id, { title })}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function StoryRow({
  story, isActive, folders,
  onSelect, onDuplicate, onExport, onDelete, onMove, onRename,
}: {
  story: Story;
  isActive: boolean;
  folders: import("../db/db").Folder[];
  onSelect: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
  onMove: (folderId: string | null) => void;
  onRename: (title: string) => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(story.title);
  const [showMoveMenu, setShowMoveMenu] = useState(false);

  const commitRename = () => {
    onRename(titleValue.trim() || "Untitled Story");
    setEditingTitle(false);
  };

  return (
    <div
      className={[
        "group relative rounded-md px-2 py-1.5 cursor-pointer transition-colors",
        isActive ? "bg-ink-800 text-ink-50" : "hover:bg-ink-800/60 text-ink-200",
      ].join(" ")}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2 min-w-0">
        {editingTitle ? (
          <input
            autoFocus
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setEditingTitle(false);
            }}
            className="field-input py-0.5 text-sm flex-1"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            <span className="truncate flex-1 text-sm">{story.title || "Untitled"}</span>
            <div
              className={["flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity", isActive ? "opacity-60" : ""].join(" ")}
              onClick={(e) => e.stopPropagation()}
            >
              <IconBtn title="Rename" onClick={() => { setEditingTitle(true); setTitleValue(story.title); }}>
                <Pencil size={12} />
              </IconBtn>
              <div className="relative">
                <IconBtn title="Move to folder" onClick={() => setShowMoveMenu((v) => !v)}>
                  <Folder size={12} />
                </IconBtn>
                {showMoveMenu && (
                  <div className="absolute left-0 top-full mt-1 z-20 bg-ink-900 border border-ink-700 rounded-md shadow-lg min-w-[140px] py-1 text-xs">
                    <button
                      className="w-full text-left px-3 py-1.5 hover:bg-ink-800 text-ink-300"
                      onClick={() => { onMove(null); setShowMoveMenu(false); }}
                    >
                      No folder
                    </button>
                    {folders.map((f) => (
                      <button
                        key={f.id}
                        className={["w-full text-left px-3 py-1.5 hover:bg-ink-800", story.folderId === f.id ? "text-accent-400" : "text-ink-300"].join(" ")}
                        onClick={() => { onMove(f.id); setShowMoveMenu(false); }}
                      >
                        {f.name}
                      </button>
                    ))}
                    {folders.length === 0 && (
                      <div className="px-3 py-1.5 text-ink-500">No folders yet</div>
                    )}
                  </div>
                )}
              </div>
              <IconBtn title="Duplicate" onClick={onDuplicate}><Copy size={12} /></IconBtn>
              <IconBtn title="Export" onClick={onExport}><Download size={12} /></IconBtn>
              <IconBtn title="Delete" onClick={onDelete}><Trash2 size={12} /></IconBtn>
            </div>
          </>
        )}
      </div>
      <div className="text-[11px] text-ink-400 mt-0.5">
        {formatRelative(story.updatedAt)} · {story.content.length.toLocaleString()} chars
      </div>
    </div>
  );
}

function IconBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { title: string }) {
  return (
    <button {...props} className="p-1 rounded hover:bg-ink-700 text-ink-300 hover:text-ink-50" />
  );
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "story";
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}
