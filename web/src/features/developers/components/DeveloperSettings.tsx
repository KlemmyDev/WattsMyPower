import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Field, HelpText, Input } from "~/features/common/ui/components/Field";
import { Notice } from "~/features/common/ui/components/Notice";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { Switch } from "~/features/common/ui/components/Switch";
import { useToast } from "~/features/common/ui/components/Toast";
import { keysQuery, makeKey, removeKey } from "~/features/developers/api";
import type { ApiKey, KeyScope, NewKey } from "~/features/developers/types";
import { OptionList, OptionRow, SettingsSection } from "~/features/settings/components/SettingsSection";
import { SettingsPageHeader } from "~/features/settings/components/SubPageHeader";

/** Settings → Developers: keys that let other apps on your network read your energy data (and nothing more). */
export function DeveloperSettings() {
  return (
    <>
      <SettingsPageHeader
        title="Developers"
        sub="Let other apps on your network, like the Home Hub on the fridge, read your energy data."
      />
      <Keys />
      <Notice tone="info">
        A key can only read, never change anything, and you choose what each one may read. Anyone who has a key can read
        those things from anywhere that can reach this dashboard, so keep it to apps you trust and remove a key you no
        longer use. Signed-in access to the dashboard isn't affected. How to use a key is in docs/developers.md.
      </Notice>
    </>
  );
}

/** "used 3 hours ago", or "never used". */
function used(ts: number | null): string {
  if (!ts) return "never used";
  const minutes = Math.max(0, Math.round((Date.now() / 1000 - ts) / 60));
  if (minutes < 2) return "used just now";
  if (minutes < 60) return `used ${minutes} minutes ago`;
  if (minutes < 1440) return `used ${Math.round(minutes / 60)} hours ago`;
  return `used ${Math.round(minutes / 1440)} days ago`;
}

function Keys() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isPending, error } = useQuery(keysQuery);
  const [fresh, setFresh] = useState<NewKey | null>(null);
  const [sure, setSure] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: removeKey,
    onSuccess: () => {
      setSure(null);
      toast("The key was removed. It no longer works.");
      return qc.invalidateQueries({ queryKey: keysQuery.queryKey });
    },
    onError: (e) => toast(errorMessage(e)),
  });

  if (isPending) return <Skeleton className="h-64" />;
  if (error) return <Notice>{errorMessage(error)}</Notice>;
  const named = (key: ApiKey) =>
    key.scopes.map((id) => data.scopes.find((s) => s.id === id)?.name ?? id).join(", ") || "nothing";

  return (
    <>
      <SettingsSection
        id="h-keys"
        title="Keys"
        sub="Each app that reads your data has a key of its own. The key itself is only ever shown when it's made."
      >
        {fresh && <NewKeyCard made={fresh} />}
        {data.keys.length ? (
          <OptionList>
            {data.keys.map((k) => (
              <OptionRow
                key={k.id}
                icon="terminal"
                label={k.name}
                help={
                  <>
                    <code>{k.prefix}…</code> · Can read: {named(k)} · {used(k.last_used)}
                  </>
                }
              >
                {sure === k.id ? (
                  <div className="flex items-center gap-2">
                    <Button size="sm" disabled={remove.isPending} onClick={() => remove.mutate(k.id)}>
                      Remove it
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setSure(null)}>
                      Keep it
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setSure(k.id)}>
                    Remove
                  </Button>
                )}
              </OptionRow>
            ))}
          </OptionList>
        ) : (
          <p className="m-0 text-sm text-ink-muted">No keys yet. Make one below, then paste it into the app.</p>
        )}
      </SettingsSection>
      <MakeKey scopes={data.scopes} onMade={setFresh} />
    </>
  );
}

function NewKeyCard({ made }: { made: NewKey }) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(made.key);
      toast("Key copied.");
    } catch {
      toast("Couldn't copy it. Select it and copy by hand.");
    }
  };
  const example = `curl -H "Authorization: Bearer ${made.key}" ${window.location.origin}/api/v1/live`;
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-good-subtle p-4" role="status">
      <span className="text-[15px] font-semibold">Your new key for {made.name}</span>
      <div className="flex w-full min-w-0 items-center gap-2 max-sm:flex-col max-sm:items-stretch">
        <code className="min-w-0 flex-1 rounded-xl bg-surface px-3 py-2 text-xs break-all select-all">{made.key}</code>
        <Button size="sm" onClick={copy}>
          Copy key
        </Button>
      </div>
      <HelpText>
        Copy it now and paste it into the other app. It can't be shown again; if it's lost, remove it and make a new
        one.
      </HelpText>
      <HelpText>
        To try it: <code className="break-all">{example}</code>
      </HelpText>
    </div>
  );
}

function MakeKey({ scopes, onMade }: { scopes: KeyScope[]; onMade: (key: NewKey) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(scopes.filter((s) => s.default).map((s) => s.id)));
  const make = useMutation({
    mutationFn: makeKey,
    onSuccess: (key) => {
      onMade(key);
      setName("");
      return qc.invalidateQueries({ queryKey: keysQuery.queryKey });
    },
  });
  const toggle = (id: string, on: boolean) =>
    setPicked((was) => {
      const next = new Set(was);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <SettingsSection
      id="h-make-key"
      title="Make a key"
      sub="Name it after the app, then choose what it may read."
      className="mt-4"
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          make.mutate({ name: name.trim(), scopes: scopes.filter((s) => picked.has(s.id)).map((s) => s.id) });
        }}
      >
        <Field label="What is it for?" help="For example, Home Hub.">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="off" />
        </Field>
        <OptionList>
          {scopes.map((s) => (
            <OptionRow key={s.id} id={`scope-${s.id}`} label={s.name} help={s.about}>
              <Switch on={picked.has(s.id)} onChange={(on) => toggle(s.id, on)} aria-labelledby={`scope-${s.id}`} />
            </OptionRow>
          ))}
        </OptionList>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={make.isPending || !name.trim() || picked.size === 0}>
            {make.isPending ? "Making…" : "Make a key"}
          </Button>
          {make.error && <HelpText tone="bad">{errorMessage(make.error)}</HelpText>}
        </div>
      </form>
    </SettingsSection>
  );
}
