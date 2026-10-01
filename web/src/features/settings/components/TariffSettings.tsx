import { useReducer, useRef } from "react";
import type { PlanTariff } from "~/features/settings/types";
import { PlanFinder } from "~/features/settings/components/PlanFinder";
import { TariffEditor } from "~/features/settings/components/TariffEditor";
import { EDITOR_START, editorReducer } from "~/features/settings/utils";

/** Settings → Tariffs: the plan finder, which loads a published plan into the rates editor below it. */
export function TariffSettings() {
  const [editor, dispatch] = useReducer(editorReducer, EDITOR_START);
  const editorRef = useRef<HTMLElement>(null);

  // Load a published plan into the editor (not saved until Save rates).
  const importPlan = (plan: PlanTariff) => {
    dispatch({ type: "import", plan });
    editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <PlanFinder onImport={importPlan} />
      <TariffEditor ref={editorRef} state={editor} dispatch={dispatch} />
    </>
  );
}
