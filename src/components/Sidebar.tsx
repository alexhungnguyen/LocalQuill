import { useLiveQuery } from "dexie-react-hooks";
import {
  Plus,
  Trash2,
  Copy,
  Download,
  Upload,
  BookOpen,
  Pencil,
} from "lucide-react";
import { useRef, useState } from "react";
import { db } from "../db/db";
import {
  createStory,
  deleteStory,
  duplicateStory,
  exportStoryAsJSON,
  importStoryFromJSON,
  updateStory,
} from "../lib/stories";
import { useStore } from "../store/useStore";

export function Sidebar() {
  const stories = useLiveQuery(
    () => db.stories.orderBy("updatedAt").reverse().toArray(),
    [],
  );
  const currentStoryId = useStore((s) => s.currentStoryId);
  const setCurrentStoryId = useStore((s) => s.setCurrentStoryId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  const handleNew = async () => {
    const story = await createStory();
    setCurrentStoryId(story.id);
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
    const blob = new Blob([exportStoryAsJSON(story)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug(story.title)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport: React.ChangeEventHandler<HTMLInputElement> = async (
    e,
  ) => {
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

  const startRename = (id: string, current: string) => {
    setEditingId(id);
    setEditingTitle(current);
  };
  const commitRename = async () => {
    if (editingId) {
      const next = editingTitle.trim() || "Untitled Story";
      await updateStory(editingId, { title: next });
    }
    setEditingId(null);
    setEditingTitle("");
  };

  return (
    <aside className="w-72 shrink-0 h-full panel border-r flex flex-col">
      <div className="p-3 border-b border-ink-800 flex items-center gap-2">
        <BookOpen size={16} className="text-accent-500" />
        <h1 className="font-semibold text-ink-50 tracking-tight">LocalQuill</h1>
      </div>

      <div className="p-2 flex gap-1.5">
        <button onClick={handleNew} className="btn-primary flex-1">
          <Plus size={14} /> New Story
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="btn-ghost"
          title="Import story (.json)"
        >
          <Upload size={14} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={handleImport}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {stories?.length === 0 && (
          <div className="text-ink-400 text-sm px-2 py-6 text-center">
            No stories yet.
            <br />
            Click <span className="text-accent-400">New Story</span> to begin.
          </div>
        )}
        <ul className="space-y-1">
          {stories?.map((story) => {
            const isActive = story.id === currentStoryId;
            return (
              <li key={story.id}>
                <div
                  className={[
                    "group rounded-md px-2 py-1.5 cursor-pointer transition-colors",
                    isActive
                      ? "bg-ink-800 text-ink-50"
                      : "hover:bg-ink-800/60 text-ink-200",
                  ].join(" ")}
                  onClick={() => setCurrentStoryId(story.id)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {editingId === story.id ? (
                      <input
                        autoFocus
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") {
                            setEditingId(null);
                            setEditingTitle("");
                          }
                        }}
                        className="field-input py-0.5 text-sm flex-1"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <>
                        <span className="truncate flex-1 text-sm">
                          {story.title || "Untitled"}
                        </span>
                        <div
                          className={[
                            "flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity",
                            isActive ? "opacity-60" : "",
                          ].join(" ")}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <IconBtn
                            title="Rename"
                            onClick={() => startRename(story.id, story.title)}
                          >
                            <Pencil size={12} />
                          </IconBtn>
                          <IconBtn
                            title="Duplicate"
                            onClick={() => handleDuplicate(story.id)}
                          >
                            <Copy size={12} />
                          </IconBtn>
                          <IconBtn
                            title="Export"
                            onClick={() => handleExport(story.id)}
                          >
                            <Download size={12} />
                          </IconBtn>
                          <IconBtn
                            title="Delete"
                            onClick={() => handleDelete(story.id)}
                          >
                            <Trash2 size={12} />
                          </IconBtn>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="text-[11px] text-ink-400 mt-0.5">
                    {formatRelative(story.updatedAt)} ·{" "}
                    {story.content.length.toLocaleString()} chars
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}

function IconBtn(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { title: string },
) {
  return (
    <button
      {...props}
      className="p-1 rounded hover:bg-ink-700 text-ink-300 hover:text-ink-50"
    />
  );
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "story";
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
