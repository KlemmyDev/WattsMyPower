import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Field, HelpText, Input } from "~/features/common/ui/components/Field";
import { Notice } from "~/features/common/ui/components/Notice";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { Switch } from "~/features/common/ui/components/Switch";
import { useToast } from "~/features/common/ui/components/Toast";
import { createEmbed, embedQuery, revokeEmbed } from "~/features/embed/api";
import { VARIANT_HEIGHT, type EmbedTheme, type EmbedVariant } from "~/features/embed/types";
import { ChoiceTiles, OptionList, OptionRow, SettingsSection } from "~/features/settings/components/SettingsSection";
import { SettingsPageHeader } from "~/features/settings/components/SubPageHeader";

/** Settings → Embed: a secret link to the power summary, and the code to show it in a page on another website. */
export function EmbedSettings() {
  return (
    <>
      <SettingsPageHeader
        title="Embed"
        sub="Show the live power summary on another page, such as a website on your network."
      />
      <Sharing />
    </>
  );
}

function Sharing() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isPending, error } = useQuery(embedQuery);
  const save = (fresh: { enabled: boolean; token: string | null }) => qc.setQueryData(embedQuery.queryKey, fresh);
  const turnOn = useMutation({ mutationFn: createEmbed, onSuccess: save });
  const turnOff = useMutation({
    mutationFn: revokeEmbed,
    onSuccess: (fresh) => {
      save(fresh);
      toast("Sharing is off. The link no longer works.");
    },
  });
  // The address the other page uses to reach this dashboard: this one, unless it's reached another way from there
  // (say a public name here, and the server's address on the network there).
  const [base, setBase] = useState(() => window.location.origin);
  const origin = base.trim().replace(/\/+$/, "");
  const [variant, setVariant] = useState<EmbedVariant>("tiles");
  const [theme, setTheme] = useState<EmbedTheme>("auto");
  const [transparent, setTransparent] = useState(false);

  if (isPending) return <Skeleton className="h-64" />;
  if (error) return <Notice>{errorMessage(error)}</Notice>;
  const height = VARIANT_HEIGHT[variant];
  const query = new URLSearchParams({ token: data.token ?? "" });
  if (variant !== "tiles") query.set("variant", variant);
  if (theme !== "auto") query.set("theme", theme);
  if (transparent) query.set("transparent", "1");
  const link = data.token ? `${origin}/embed/power?${query}` : "";
  const code = `<iframe src="${link}" width="100%" height="${height}" style="border:0" title="Power now" loading="lazy"></iframe>`;
  const busy = turnOn.isPending || turnOff.isPending;
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied.`);
    } catch {
      toast("Couldn't copy it. Select it and copy by hand.");
    }
  };

  return (
    <>
      <SettingsSection
        id="h-embed-power"
        title="Power summary"
        sub="Solar, home, grid and battery now, on a page of their own that another page can show in a frame. It has no controls, and the link is the only way in."
        aside={
          data.enabled ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => turnOff.mutate()}>
              Turn off
            </Button>
          ) : undefined
        }
      >
        {!data.enabled ? (
          <div className="flex flex-col gap-3">
            <p className="m-0 text-sm text-ink-muted">
              Sharing is off. Turn it on to get a link. Anyone with the link can see these live figures (not your bills,
              history or controls), so share it only with people and pages you trust.
            </p>
            <div>
              <Button size="sm" disabled={busy} onClick={() => turnOn.mutate()}>
                {turnOn.isPending ? "Turning on…" : "Turn on sharing"}
              </Button>
            </div>
            {turnOn.error && <HelpText tone="bad">{errorMessage(turnOn.error)}</HelpText>}
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <Field
              label="This dashboard's address"
              help="Use the one the other page can reach, such as http://192.168.1.20:8000."
            >
              <Input value={base} onChange={(e) => setBase(e.target.value)} spellCheck={false} inputMode="url" />
            </Field>
            <ChoiceTiles<EmbedVariant>
              label="Look"
              value={variant}
              onChange={setVariant}
              min="10rem"
              options={[
                { value: "tiles", title: "Tiles", sub: "Four cards in a row", icon: "layout" },
                { value: "compact", title: "Strip", sub: "One thin line", icon: "minus" },
                { value: "circuit", title: "Circuit", sub: "Joined by a wire", icon: "plug" },
                { value: "stack", title: "Stack", sub: "A column, for a sidebar", icon: "menu" },
              ]}
            />
            <ChoiceTiles<EmbedTheme>
              label="Colours"
              value={theme}
              onChange={setTheme}
              min="8rem"
              phone={3}
              options={[
                { value: "auto", title: "Automatic", sub: "Follows the viewer", icon: "settings" },
                { value: "dark", title: "Dark", sub: "On a dark page", icon: "moon" },
                { value: "light", title: "Light", sub: "On a light page", icon: "sun" },
              ]}
            />
            <OptionList>
              <OptionRow label="See-through background" help="Lets the page behind show, so it blends in.">
                <Switch on={transparent} onChange={setTransparent} label="See-through background" />
              </OptionRow>
              <OptionRow label="Link" help="Opens the summary on its own.">
                <div className="flex w-full min-w-0 items-center gap-2 max-sm:flex-col max-sm:items-stretch">
                  <code className="min-w-0 flex-1 text-xs break-all text-ink-muted">{link}</code>
                  <Button variant="outline" size="sm" onClick={() => copy(link, "Link")}>
                    Copy link
                  </Button>
                </div>
              </OptionRow>
              <OptionRow label="Code for a page" help="Paste it into the other page where the summary should go.">
                <div className="flex w-full min-w-0 items-center gap-2 max-sm:flex-col max-sm:items-stretch">
                  <code className="min-w-0 flex-1 text-xs break-all text-ink-muted">{code}</code>
                  <Button variant="outline" size="sm" onClick={() => copy(code, "Code")}>
                    Copy code
                  </Button>
                </div>
              </OptionRow>
            </OptionList>
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold">Preview</span>
              <iframe
                key={link}
                src={link}
                title="Power summary preview"
                style={{ height }}
                className="w-full rounded-2xl border border-line-subtle bg-surface"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => turnOn.mutate()}>
                {turnOn.isPending ? "Making…" : "Make a new link"}
              </Button>
              <HelpText>The old link stops working, so change it in the other page too.</HelpText>
            </div>
          </div>
        )}
      </SettingsSection>
      <Notice tone="info">
        The other page has to be on a network that can reach this dashboard. Don't put the link on a public website
        unless you're happy for anyone to see your live power.
      </Notice>
    </>
  );
}
