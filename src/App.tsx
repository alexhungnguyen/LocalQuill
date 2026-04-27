import { useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { Editor } from "./components/Editor";
import { SettingsPanel } from "./components/SettingsPanel";
import { useStore } from "./store/useStore";
import { pingServer } from "./lib/mlx";

export default function App() {
  const loadPersistedSettings = useStore((s) => s.loadPersistedSettings);
  const setServerStatus = useStore((s) => s.setServerStatus);
  const setServerModel = useStore((s) => s.setServerModel);

  useEffect(() => {
    void loadPersistedSettings();
  }, [loadPersistedSettings]);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const { ok, model } = await pingServer();
      if (cancelled) return;
      setServerStatus(ok ? "online" : "offline");
      setServerModel(model ?? null);
    };
    void check();
    const id = setInterval(check, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [setServerStatus, setServerModel]);

  return (
    <div className="flex h-full w-full">
      <Sidebar />
      <Editor />
      <SettingsPanel />
    </div>
  );
}
