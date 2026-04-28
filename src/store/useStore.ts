import { create } from "zustand";
import { db } from "../db/db";

export interface GenerationSettings {
  maxTokens: number;
  temperature: number;
  topP: number;
  repetitionPenalty: number;
  contextTokens: number;
  authorsNoteDepth: number;
  /** Stop sequences that immediately end generation. */
  stop: string[];
  /** Trim trailing whitespace from streamed output before commit. */
  trimTrailingWhitespace: boolean;
}

export const DEFAULT_SETTINGS: GenerationSettings = {
  maxTokens: 220,
  temperature: 0.85,
  topP: 0.95,
  repetitionPenalty: 1.05,
  // Qwen3-30B serves a long context; 8k of prompt is a comfortable working
  // window that still leaves plenty of headroom for output on a Mac.
  contextTokens: 8192,
  authorsNoteDepth: 600,
  stop: [],
  trimTrailingWhitespace: true,
};

interface UIState {
  currentStoryId: string | null;
  isGenerating: boolean;
  settings: GenerationSettings;
  serverStatus: "unknown" | "online" | "offline";
  serverModel: string | null;
  /** Length of last generation, in chars, for the undo button. */
  lastGenerationLength: number | null;
  /** Stack of checkpoint contents to which we can undo. */
  undoStack: string[];
  /** Stack of undone states available for redo. */
  redoStack: string[];
  /** The content at the current history position (the checkpoint). */
  baseContent: string;

  setCurrentStoryId: (id: string | null) => void;
  setIsGenerating: (v: boolean) => void;
  updateSettings: (patch: Partial<GenerationSettings>) => Promise<void>;
  setServerStatus: (s: "unknown" | "online" | "offline") => void;
  setServerModel: (m: string | null) => void;
  setLastGenerationLength: (n: number | null) => void;
  pushCheckpoint: (content: string) => void;
  undo: () => { targetContent: string; removedText: string } | null;
  redo: () => { targetContent: string; addedText: string } | null;
  setBaseContent: (content: string) => void;
  clearHistory: () => void;
  clearRedoStack: () => void;

  loadPersistedSettings: () => Promise<void>;
}

export const useStore = create<UIState>((set, get) => ({
  currentStoryId: null,
  isGenerating: false,
  settings: DEFAULT_SETTINGS,
  serverStatus: "unknown",
  serverModel: null,
  lastGenerationLength: null,
  undoStack: [],
  redoStack: [],
  baseContent: "",

  setCurrentStoryId: (id) => {
    set({ currentStoryId: id, lastGenerationLength: null });
    void db.settings.put({ key: "currentStoryId", value: id });
  },
  setIsGenerating: (v) => set({ isGenerating: v }),
  setServerStatus: (s) => set({ serverStatus: s }),
  setServerModel: (m) => set({ serverModel: m }),
  setLastGenerationLength: (n) => set({ lastGenerationLength: n }),

  pushCheckpoint: (content) =>
    set((state) => {
      const MAX = 50;
      const newStack = [...state.undoStack, content];
      if (newStack.length > MAX) newStack.shift();
      return { undoStack: newStack, redoStack: [] };
    }),

  undo: () => {
    const state = get();
    if (state.undoStack.length === 0) return null;
    const previous = state.undoStack[state.undoStack.length - 1];
    const current = state.baseContent;
    // Ensure current starts with previous; otherwise, state diverged (should be prevented by UI)
    if (!current.startsWith(previous)) return null;
    const removedText = current.slice(previous.length);
    set({
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, current],
      baseContent: previous,
    });
    return { targetContent: previous, removedText };
  },

  redo: () => {
    const state = get();
    if (state.redoStack.length === 0) return null;
    const next = state.redoStack[state.redoStack.length - 1];
    const current = state.baseContent;
    if (!next.startsWith(current)) return null;
    const addedText = next.slice(current.length);
    set({
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, current],
      baseContent: next,
    });
    return { targetContent: next, addedText };
  },

  setBaseContent: (content) => set({ baseContent: content }),

  clearHistory: () => set({ undoStack: [], redoStack: [], baseContent: "" }),

  clearRedoStack: () => set(() => ({ redoStack: [] })),

  updateSettings: async (patch) => {
    const merged = { ...get().settings, ...patch };
    set({ settings: merged });
    await db.settings.put({ key: "settings", value: merged });
  },

  loadPersistedSettings: async () => {
    const [savedSettings, savedStoryId] = await Promise.all([
      db.settings.get("settings"),
      db.settings.get("currentStoryId"),
    ]);
    if (savedSettings?.value) {
      set({
        settings: {
          ...DEFAULT_SETTINGS,
          ...(savedSettings.value as Partial<GenerationSettings>),
        },
      });
    }
    if (savedStoryId?.value) {
      set({ currentStoryId: savedStoryId.value as string });
    }
  },
}));
