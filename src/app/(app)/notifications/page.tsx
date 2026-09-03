import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { listNotifications } from "./actions";
import { NotificationList } from "@/components/notifications/notification-list";

export default async function NotificationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const items = await listNotifications();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Notifications</h1>
      <NotificationList items={items} />
    </div>
  );
}
