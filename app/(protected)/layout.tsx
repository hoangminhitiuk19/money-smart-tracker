import Link from "next/link";
import { headers } from "next/headers";
import { LogoutButton } from "@/components/logout-button";
import { requireAuth } from "@/lib/auth";
import {
  ActivityIcon,
  CloseIcon,
  DashboardIcon,
  GoalIcon,
  MenuIcon,
  ProjectIcon,
  RenewalIcon,
  ReportsIcon,
  SettingsIcon,
  TransactionsIcon,
  UploadIcon,
  WalletIcon
} from "@/components/ui/icons";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: DashboardIcon },
  { href: "/transactions", label: "Transactions", icon: TransactionsIcon },
  { href: "/receipt-upload", label: "Receipt Upload", icon: UploadIcon },
  { href: "/goals", label: "Goals", icon: GoalIcon },
  { href: "/projects", label: "Projects", icon: ProjectIcon },
  { href: "/accounts", label: "Accounts", icon: WalletIcon },
  { href: "/renewals", label: "Renewals", icon: RenewalIcon },
  { href: "/reports", label: "Reports", icon: ReportsIcon },
  { href: "/activity-log", label: "Activity Log", icon: ActivityIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon }
];

export default async function ProtectedLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireAuth();
  const headerList = headers();
  const currentPath =
    headerList.get("x-next-url") ??
    headerList.get("x-url") ??
    headerList.get("x-invoke-path") ??
    headerList.get("next-url") ??
    "";

  const isActive = (href: string) =>
    currentPath === href || currentPath.startsWith(`${href}/`);

  const initials = user.name
    ? user.name
        .split(" ")
        .map((part) => part[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "?";

  return (
    <div className="min-h-screen bg-page-bg text-slate-950">
      <div className="flex min-h-screen">
        <aside className="hidden min-h-screen w-64 shrink-0 flex-col bg-sidebar-bg md:flex">
          <div className="flex items-center gap-2.5 border-b border-slate-800/80 px-5 py-5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">
              M
            </span>
            <Link
              className="truncate text-[15px] font-semibold text-white"
              href="/dashboard"
            >
              Money Quality Tracker
            </Link>
          </div>
          <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
            {navItems.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;

              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={[
                    "group flex min-h-11 items-center gap-3 rounded-md border-l-2 px-3 py-2 text-sm font-medium transition md:min-h-0",
                    active
                      ? "border-sidebar-active bg-slate-800/80 text-white"
                      : "border-transparent text-sidebar-text hover:border-slate-700 hover:bg-slate-800/40 hover:text-slate-100"
                  ].join(" ")}
                  href={item.href}
                  key={item.href}
                >
                  <Icon
                    className={[
                      "h-4 w-4 shrink-0 transition",
                      active
                        ? "text-sidebar-active"
                        : "text-slate-500 group-hover:text-slate-300"
                    ].join(" ")}
                  />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="border-t border-slate-800/80 p-4">
            <div className="mb-3 flex items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-slate-200">
                {initials}
              </span>
              <p className="truncate text-sm font-medium text-white">
                {user.name}
              </p>
            </div>
            <LogoutButton />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="relative z-40 bg-sidebar-bg px-4 py-3 md:hidden">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-white [&::-webkit-details-marker]:hidden">
                <Link className="flex items-center gap-2.5" href="/dashboard">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-bold text-white">
                    M
                  </span>
                  <span className="text-base font-semibold">
                    Money Quality Tracker
                  </span>
                </Link>
                <span className="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-slate-700 text-sidebar-text transition group-open:border-slate-600 group-open:bg-slate-800 group-open:text-white md:min-h-0 md:min-w-0">
                  <span className="sr-only">Menu</span>
                  <MenuIcon className="h-5 w-5 group-open:hidden" />
                  <CloseIcon className="hidden h-5 w-5 group-open:block" />
                </span>
              </summary>
              <div className="absolute inset-x-0 top-full z-40 max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-slate-800/80 bg-sidebar-bg px-4 pb-4 pt-4 shadow-xl">
                <div className="mb-3 flex items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-slate-200">
                    {initials}
                  </span>
                  <p className="truncate text-sm font-medium text-white">
                    {user.name}
                  </p>
                </div>
                <nav className="space-y-0.5">
                  {navItems.map((item) => {
                    const active = isActive(item.href);
                    const Icon = item.icon;

                    return (
                      <Link
                        aria-current={active ? "page" : undefined}
                        className={[
                          "flex min-h-11 items-center gap-3 rounded-md border-l-2 px-3 py-2 text-sm font-medium transition md:min-h-0",
                          active
                            ? "border-sidebar-active bg-slate-800/80 text-white"
                            : "border-transparent text-sidebar-text hover:bg-slate-800/40 hover:text-slate-100"
                        ].join(" ")}
                        href={item.href}
                        key={item.href}
                      >
                        <Icon
                          className={[
                            "h-4 w-4 shrink-0",
                            active ? "text-sidebar-active" : "text-slate-500"
                          ].join(" ")}
                        />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    );
                  })}
                </nav>
                <div className="mt-4">
                  <LogoutButton />
                </div>
              </div>
            </details>
          </header>
          <main className="flex-1 bg-page-bg p-4 md:p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
