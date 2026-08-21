"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas text-ink">
      <NotificationCenter />

      {/* Desktop: persistent sidebar. */}
      <Sidebar className="hidden w-60 shrink-0 lg:flex" />

      {/* Tablet/mobile: sidebar inside an accessible dialog (focus trap,
       * Escape to close, backdrop). */}
      <Dialog.Root open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="drawer-overlay fixed inset-0 z-50 bg-black/60 lg:hidden" />
          <Dialog.Content
            className="drawer-content drawer-content--left fixed inset-y-0 left-0 z-50 w-64 outline-none lg:hidden"
            aria-describedby={undefined}
          >
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <Sidebar className="h-full w-64" onNavigate={() => setMobileNavOpen(false)} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <Header onOpenMobileNav={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
