"use client";

import { signOut } from "next-auth/react";

export function LogoutButton() {
  return (
    <button
      className="min-h-11 w-full rounded-md border border-slate-700/60 px-3 py-2 text-left text-sm font-medium text-sidebar-text transition hover:border-slate-600 hover:bg-slate-800 hover:text-white md:min-h-0"
      type="button"
      onClick={() => signOut({ callbackUrl: "/login" })}
    >
      Log out
    </button>
  );
}
