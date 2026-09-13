"use client";

import { Menu } from "@base-ui/react/menu";
import { signOut } from "@/app/actions";

/**
 * Top-bar user chip (avatar + name). Clicking it opens a dropdown with the
 * user's identity/roles, a link to the account page, and a sign-out action —
 * so the chip is visibly interactive and always reveals user information.
 */
export function UserMenu({
  fullName,
  email,
  rolesLabel,
  initial,
}: {
  fullName: string;
  email: string;
  rolesLabel: string;
  initial: string;
}) {
  return (
    // Uncontrolled: Base UI owns open/close (mousedown toggle on the trigger).
    // A manual `onClick` toggle (added for touch fallback) double-toggled:
    // the trigger already opens on mousedown, then the click flipped it shut —
    // "click does nothing, click-and-hold works". Removing it restores the
    // standard click-to-open behavior.
    <Menu.Root>
      <Menu.Trigger
        aria-label="Menu utilisateur"
        title="Voir mes informations"
        className="flex items-center gap-2 rounded-full transition-colors select-none outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500/40 data-pressed:bg-slate-100"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-700 text-xs font-bold text-white">
          {initial}
        </span>
        <span className="hidden text-xs text-slate-500 sm:inline">{fullName}</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={6} className="z-50 outline-none">
          <Menu.Popup className="w-64 origin-[var(--transform-origin)] rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl outline-none transition-[scale,opacity] duration-100 ease-out data-starting-style:scale-[0.98] data-starting-style:opacity-0 data-ending-style:scale-[0.98] data-ending-style:opacity-0">
            <div className="border-b border-slate-100 px-3 py-2.5">
              <div className="truncate text-sm font-bold text-slate-900">{fullName}</div>
              <div className="truncate text-xs text-slate-500">{email}</div>
              {rolesLabel && (
                <div className="mt-1 truncate text-[11px] font-medium text-slate-400">{rolesLabel}</div>
              )}
            </div>
            <Menu.Separator className="mx-2 my-1 h-px bg-slate-100" />
            <Menu.Item
              closeOnClick={false}
              onClick={async () => {
                await signOut();
              }}
              className="flex cursor-pointer items-center rounded-lg px-3 py-2 text-sm text-red-600 outline-none select-none data-highlighted:bg-red-50 data-highlighted:text-red-700"
            >
              Se déconnecter
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
