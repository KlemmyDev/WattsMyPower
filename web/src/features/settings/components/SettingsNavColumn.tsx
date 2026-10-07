import { Link } from "@tanstack/react-router";
import { NAV_ROW, NAV_ROW_ACTIVE, NavColumnHeader, NavRow } from "~/features/common/layout/components/NavColumn";
import { SETTINGS_SUB, SETTINGS_TABS } from "~/features/settings/utils";

/** Settings' column in the side nav: its pages, in place of the row of tabs over them. */
export function SettingsNavColumn() {
  return (
    <>
      <NavColumnHeader to="/settings" title="Settings" sub={SETTINGS_SUB} />
      {SETTINGS_TABS.map((t) => (
        <Link key={t.to} to={t.to} activeProps={NAV_ROW_ACTIVE} className={NAV_ROW}>
          <NavRow icon={t.icon} label={t.label} />
        </Link>
      ))}
    </>
  );
}
