import { useQuery } from "@tanstack/react-query";
import { useReducer, useRef } from "react";
import { AmberTariffRow } from "~/features/amber/components/AmberTariffRow";
import { tariffQuery } from "~/features/common/tariffs/api";
import type { PlanTariff } from "~/features/settings/types";
import { PlanFinder } from "~/features/settings/components/PlanFinder";
import { TariffEditor } from "~/features/settings/components/TariffEditor";
import { EDITOR_START, editorReducer } from "~/features/settings/utils";

/**
 * Settings → Bills, its rates: Amber Electric (switching the rates to its prices), the plan finder (which loads a
 * published plan into the rates editor below it), and the rates editor.
 */
export function TariffSettings() {
  const [editor, dispatch] = useReducer(editorReducer, EDITOR_START);
  const editorRef = useRef<HTMLElement>(null);
  const saved = useQuery(tariffQuery).data;

  // Switch the editor to Amber prices (not saved until Save rates).
  const switchToAmber = () => {
    const base = editor.draft ?? saved;
    if (base) dispatch({ type: "edit", base, edit: { type: "set-rate-type", value: "amber" } });
    editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Load a published plan into the editor (not saved until Save rates).
  const importPlan = (plan: PlanTariff) => {
    dispatch({ type: "import", plan });
    editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <AmberTariffRow onUse={switchToAmber} />
      <PlanFinder onImport={importPlan} />
      <TariffEditor ref={editorRef} state={editor} dispatch={dispatch} />
    </>
  );
}
