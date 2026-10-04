"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils/cn";

export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "inline-flex items-center gap-1",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        // The encoding chip from the proof slip: transparent border at rest so
        // selection never shifts layout; selected is the terracotta wash.
        "rounded-sm border border-transparent px-2 py-1 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-foreground/70 transition-colors",
        "hover:text-foreground",
        "data-[state=active]:border-border data-[state=active]:bg-accent-muted data-[state=active]:text-accent",
        className,
      )}
      {...props}
    />
  );
}
