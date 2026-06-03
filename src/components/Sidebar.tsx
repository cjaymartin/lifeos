import { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  ChevronRight,
  ChevronLeft,
  LogOut,
  Sun,
  Moon,
  type LucideIcon,
} from 'lucide-react';
import * as icons from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { Stack } from '@/lib/stacks';

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
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('sidebar-collapsed') === 'true';
    }
    return false;
  });

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('theme') as 'dark' | 'light') ?? 'dark';
    }
    return 'dark';
  });

  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(collapsed));
  }, [collapsed]);

  useEffect(() => {
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
          <div className="shrink-0 flex items-center justify-center w-7 h-7 rounded-md bg-primary/15">
            <svg width="20" height="20" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="2" y="2" width="28" height="28" rx="9" fill="currentColor"></rect>
              <circle cx="16" cy="16" r="8.5" fill="none" stroke="var(--logo-bg, #fff)" strokeWidth="2.4" strokeDasharray="40 13.4" strokeLinecap="round" transform="rotate(-35 16 16)"></circle>
              <circle cx="16" cy="16" r="3" fill="var(--logo-bg, #fff)"></circle>
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
