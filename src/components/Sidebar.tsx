import { useState, useEffect, useRef } from 'react';
import {
  LayoutDashboard,
  ChevronRight,
  ChevronLeft,
  LogOut,
  Settings,
  Sun,
  Moon,
  type LucideIcon,
} from 'lucide-react';
import * as icons from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { Stack } from '@/features';

interface Props {
  stacks: Stack[];
  currentPath: string;
}

function NavIcon({ name }: { name: string }) {
  const Icon = (icons as unknown as Record<string, LucideIcon>)[name];
  return Icon ? <Icon size={18} /> : <LayoutDashboard size={18} />;
}

function NavItem({
  href,
  icon,
  label,
  collapsed,
  active,
}: {
  href: string;
  icon: string;
  label: string;
  collapsed: boolean;
  active: boolean;
}) {
  const inner = (
    <a
      href={href}
      className={cn(
        'flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        active ? 'bg-accent text-foreground' : 'text-muted-foreground',
        collapsed && 'justify-center px-2',
      )}
    >
      <span className="shrink-0">
        <NavIcon name={icon} />
      </span>
      {!collapsed && <span className="truncate">{label}</span>}
    </a>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{inner}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    );
  }

  return inner;
}

export default function Sidebar({ stacks, currentPath }: Props) {
  // Always seed to `false` (expanded) so the first client render matches the SSR
  // markup (SSR has no `window`, so it always renders the expanded `w-56`
  // sidebar). Reading localStorage in the initializer would diverge from SSR on
  // a `sidebar-collapsed=true` client → React #418 hydration mismatch + a
  // w-14↔w-56 layout reflow on every page load (#20, sibling of NIM-9 / #4). The
  // real stored value is adopted post-mount in the effect below.
  const [collapsed, setCollapsed] = useState(false);

  // Always seed to 'dark' so the first client render matches the SSR markup
  // (SSR has no `window`, so it always renders 'dark'). Reading localStorage in
  // the initializer would diverge from SSR on a `theme=light` client → React
  // #418 hydration mismatch on every page load (NIM-9 / #4). The real stored
  // theme is adopted post-mount in the effect below.
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // After mount, adopt the persisted collapsed state. This corrects the sidebar
  // width to the user's preference without affecting the hydration markup (which
  // must stay the SSR-default expanded sidebar — see the useState seed above).
  useEffect(() => {
    setCollapsed(localStorage.getItem('sidebar-collapsed') === 'true');
  }, []);

  // Persist whenever the user toggles. Skip the initial mount: on mount
  // `collapsed` is still the SSR default (`false`) which may not match the stored
  // value yet — writing here would clobber a stored `true` before the adoption
  // effect above gets a chance to read it.
  const collapsedMounted = useRef(false);
  useEffect(() => {
    if (!collapsedMounted.current) {
      collapsedMounted.current = true;
      return;
    }
    localStorage.setItem('sidebar-collapsed', String(collapsed));
  }, [collapsed]);

  // After mount, adopt the theme the AppLayout inline FOUC script already
  // applied to <html> (sourced from localStorage). This corrects the toggle
  // control to reflect the active theme without affecting the hydration markup.
  useEffect(() => {
    const stored = (localStorage.getItem('theme') as 'dark' | 'light') ?? 'dark';
    setTheme(stored);
  }, []);

  // Apply + persist the theme whenever the user toggles it. Skip the initial
  // mount: the inline FOUC script already set the class and localStorage, and on
  // mount `theme` is still the SSR default ('dark') which may not match the
  // stored value yet — writing here would clobber it and flash the page.
  const themeMounted = useRef(false);
  useEffect(() => {
    if (!themeMounted.current) {
      themeMounted.current = true;
      return;
    }
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.classList.toggle('light', theme === 'light');
    localStorage.setItem('theme', theme);
  }, [theme]);

  const navItems = [
    { href: '/', icon: 'LayoutDashboard', label: 'Dashboard' },
    ...stacks.map((s) => ({ href: s.href, icon: s.icon, label: s.label })),
  ];

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'flex flex-col h-screen bg-card border-r border-border',
          'transition-all duration-200 ease-in-out shrink-0',
          collapsed ? 'w-14' : 'w-56',
        )}
      >
        {/* Wordmark */}
        <div
          className={cn(
            'flex items-center gap-2.5 h-14 px-3 border-b border-border',
            collapsed && 'justify-center',
          )}
        >
          <div className="shrink-0 flex items-center justify-center w-7 h-7 rounded-md bg-primary text-primary-foreground">
            <svg width="18" height="18" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="16" cy="16" r="8.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeDasharray="40 13.4" strokeLinecap="round" transform="rotate(-35 16 16)" />
              <circle cx="16" cy="16" r="3" fill="currentColor" />
            </svg>
          </div>
          {!collapsed && (
            <span className="font-semibold text-sm text-foreground tracking-tight">LifeOS</span>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {navItems.map((item) => (
            <NavItem
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={item.label}
              collapsed={collapsed}
              active={currentPath === item.href}
            />
          ))}
        </nav>

        <Separator />

        {/* Bottom controls */}
        <div className="p-2 space-y-0.5">
          {/* Settings */}
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href="/settings/logins"
                  className={cn(
                    'flex w-full items-center justify-center rounded-md p-2 transition-colors hover:bg-accent hover:text-foreground',
                    currentPath.startsWith('/settings') ? 'bg-accent text-foreground' : 'text-muted-foreground',
                  )}
                  aria-label="Settings"
                >
                  <Settings size={16} />
                </a>
              </TooltipTrigger>
              <TooltipContent side="right">Settings</TooltipContent>
            </Tooltip>
          ) : (
            <a
              href="/settings/logins"
              className={cn(
                'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-accent hover:text-foreground',
                currentPath.startsWith('/settings') ? 'bg-accent text-foreground' : 'text-muted-foreground',
              )}
            >
              <Settings size={16} className="shrink-0" />
              <span>Settings</span>
            </a>
          )}

          {/* Theme toggle */}
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  className="flex w-full items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  aria-label="Toggle theme"
                >
                  {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                Switch to {theme === 'dark' ? 'light' : 'dark'} mode
              </TooltipContent>
            </Tooltip>
          ) : (
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              {theme === 'dark' ? <Sun size={16} className="shrink-0" /> : <Moon size={16} className="shrink-0" />}
              <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
            </button>
          )}

          {/* Logout */}
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <form method="POST" action="/api/auth/logout">
                  <button
                    type="submit"
                    className="flex w-full items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                    aria-label="Sign out"
                  >
                    <LogOut size={16} />
                  </button>
                </form>
              </TooltipTrigger>
              <TooltipContent side="right">Sign out</TooltipContent>
            </Tooltip>
          ) : (
            <form method="POST" action="/api/auth/logout">
              <button
                type="submit"
                className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <LogOut size={16} className="shrink-0" />
                <span>Sign out</span>
              </button>
            </form>
          )}

          <Separator className="my-1" />

          {/* Collapse toggle */}
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setCollapsed(false)}
                  className="flex w-full items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  aria-label="Expand sidebar"
                >
                  <ChevronRight size={16} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Expand</TooltipContent>
            </Tooltip>
          ) : (
            <button
              onClick={() => setCollapsed(true)}
              className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <ChevronLeft size={16} className="shrink-0" />
              <span>Collapse</span>
            </button>
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}
