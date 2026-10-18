import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "~/features/common/api/utils";
import { Notice } from "~/features/common/ui/components/Notice";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { notificationsQuery } from "~/features/notifications/api";
import { ChannelsCard } from "~/features/notifications/components/ChannelsCard";
import { HistoryCard } from "~/features/notifications/components/HistoryCard";
import { OptionsCard } from "~/features/notifications/components/OptionsCard";
import { RulesCard } from "~/features/notifications/components/RulesCard";
import { ThisDevice } from "~/features/notifications/components/ThisDevice";
import { SettingsPageHeader } from "~/features/settings/components/SubPageHeader";

/** Settings → Notifications: this device, what you're told about, other places to send it, limits, and what was sent. */
export function NotificationsSettings() {
  const { data, error } = useQuery(notificationsQuery);
  return (
    <>
      <SettingsPageHeader
        title="Notifications"
        sub="Be told when the grid goes down, the battery runs low and more, on your phone or computer."
      />
      {error && !data && <Notice>{errorMessage(error)}</Notice>}
      {!data && !error && <Skeleton className="h-64" />}
      {data && (
        <>
          <ThisDevice publicKey={data.push.public_key} devices={data.push.devices} />
          <RulesCard rules={data.rules} channels={data.channels} hasDevices={data.push.devices.length > 0} />
          <ChannelsCard channels={data.channels} fields={data.fields} />
          <OptionsCard options={data.options} />
          <HistoryCard history={data.history} />
        </>
      )}
    </>
  );
}
