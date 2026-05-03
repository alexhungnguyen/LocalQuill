import { useStore } from "../useStore";
import { act } from "@testing-library/react";

// Reset store before each test
beforeEach(() => {
  useStore.getState().clearHistory();
});

test("initial state has empty stacks and baseContent", () => {
  const state = useStore.getState();
  expect(state.undoStack).toEqual([]);
  expect(state.redoStack).toEqual([]);
  expect(state.baseContent).toEqual("");
});

test("pushCheckpoint adds to undoStack and clears redoStack", () => {
  const { pushCheckpoint } = useStore.getState();
  pushCheckpoint("hello");
  pushCheckpoint("world");
  const state = useStore.getState();
  expect(state.undoStack).toEqual(["hello", "world"]);
  expect(state.redoStack).toEqual([]);
});

test("undo returns target and updates stacks", () => {
  const { pushCheckpoint, setBaseContent, undo } = useStore.getState();
  pushCheckpoint("abc");
  setBaseContent("abcdef"); // simulate after generation
  const result = undo();
  expect(result).toEqual({ targetContent: "abc", removedText: "def" });
  const state = useStore.getState();
  expect(state.undoStack).toEqual([]);
  expect(state.redoStack).toEqual(["abcdef"]);
  expect(state.baseContent).toBe("abc");
});

test("undo with empty stack returns null", () => {
  const { undo } = useStore.getState();
  const result = undo();
  expect(result).toBeNull();
});

test("redo returns target and updates stacks", () => {
  const { pushCheckpoint, setBaseContent, undo, redo } = useStore.getState();
  pushCheckpoint("xyz");
  setBaseContent("xyz123");
  undo(); // now baseContent="xyz", redoStack=["xyz123"]
  const result = redo();
  expect(result).toEqual({ targetContent: "xyz123", addedText: "123" });
  const state = useStore.getState();
  expect(state.redoStack).toEqual([]);
  expect(state.undoStack).toEqual(["xyz"]);
  expect(state.baseContent).toBe("xyz123");
});

test("clearHistory resets stacks and baseContent", () => {
  const { pushCheckpoint, setBaseContent, clearHistory } = useStore.getState();
  pushCheckpoint("a");
  setBaseContent("ab");
  clearHistory();
  const state = useStore.getState();
  expect(state.undoStack).toEqual([]);
  expect(state.redoStack).toEqual([]);
  expect(state.baseContent).toBe("");
});

test("pushCheckpoint caps undoStack at 50 entries", () => {
  const { pushCheckpoint } = useStore.getState();
  // Add 60 entries
  for (let i = 0; i < 60; i++) {
    pushCheckpoint(`content-${i}`);
  }
  const state = useStore.getState();
  expect(state.undoStack.length).toBe(50);
  // The first 10 should have been dropped, oldest remaining is content-10
  expect(state.undoStack[0]).toBe("content-10");
  // The most recent should be content-59
  expect(state.undoStack[49]).toBe("content-59");
});

test("setSelection updates selectedText and selectionRange", () => {
  useStore.getState().setSelection("hello", { start: 0, end: 5 });
  const s = useStore.getState();
  expect(s.selectedText).toBe("hello");
  expect(s.selectionRange).toEqual({ start: 0, end: 5 });
});

test("setSelection with empty string clears range to null", () => {
  useStore.getState().setSelection("", null);
  const s = useStore.getState();
  expect(s.selectedText).toBe("");
  expect(s.selectionRange).toBeNull();
});

test("setRewritePreview sets and clears preview", () => {
  useStore.getState().setRewritePreview("rewritten text");
  expect(useStore.getState().rewritePreview).toBe("rewritten text");
  useStore.getState().setRewritePreview(null);
  expect(useStore.getState().rewritePreview).toBeNull();
});

test("setPendingRewriteAccept sets and clears pending accept", () => {
  useStore.getState().setPendingRewriteAccept({ start: 5, end: 10, text: "new" });
  expect(useStore.getState().pendingRewriteAccept).toEqual({ start: 5, end: 10, text: "new" });
  useStore.getState().setPendingRewriteAccept(null);
  expect(useStore.getState().pendingRewriteAccept).toBeNull();
});
