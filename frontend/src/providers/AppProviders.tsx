"use client";

import { QueryProvider } from "./QueryProvider";
import { ThemeProvider } from "./ThemeProvider";
import { CartProvider } from "./CartProvider";
import ColdStartModal from "@/components/common/ColdStartModal";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <ThemeProvider>
        <ColdStartModal />
        <CartProvider>{children}</CartProvider>
      </ThemeProvider>
    </QueryProvider>
  );
}
