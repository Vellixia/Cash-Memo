"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { currentMonth, monthLabel, shiftMonth } from "@/lib/format";
import { useUiStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { useMounted } from "@/lib/use-mounted";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function MonthSwitcher() {
  const month = useUiStore((s) => s.month);
  const setMonth = useUiStore((s) => s.setMonth);
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => Number(month.slice(0, 4)));
  const today = currentMonth();
  // The page is prerendered at build time; the month is only known in the browser.
  const mounted = useMounted();

  return (
    <div className="flex items-center justify-between gap-2">
      <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
        <ChevronLeft className="size-5" />
      </Button>
      <Popover
        open={open}
        onOpenChange={(o) => {
          if (o) setYear(Number(month.slice(0, 4)));
          setOpen(o);
        }}
      >
        <PopoverTrigger
          data-testid="month-label"
          aria-label={mounted ? `${monthLabel(month)}, choose month` : "Choose month"}
          className="min-h-11 min-w-0 truncate rounded-full px-4 py-1 font-serif text-2xl tracking-tight transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40 aria-expanded:bg-muted md:text-[1.75rem]"
        >
          {mounted ? monthLabel(month) : <span className="my-1.5 inline-block h-6 w-44 animate-pulse rounded-full bg-muted align-middle" />}
        </PopoverTrigger>
        <PopoverContent className="w-72 gap-3 rounded-2xl p-3">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" aria-label="Previous year" onClick={() => setYear((y) => y - 1)}>
              <ChevronLeft />
            </Button>
            <span className="num text-lg" aria-live="polite">
              {year}
            </span>
            <Button variant="ghost" size="icon" aria-label="Next year" onClick={() => setYear((y) => y + 1)}>
              <ChevronRight />
            </Button>
          </div>
          <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Months">
            {MONTHS.map((m, i) => {
              const value = `${year}-${String(i + 1).padStart(2, "0")}`;
              return (
                <button
                  key={m}
                  type="button"
                  aria-label={monthLabel(value)}
                  aria-pressed={value === month}
                  onClick={() => {
                    setMonth(value);
                    setOpen(false);
                  }}
                  className={cn(
                    "h-10 rounded-xl text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                    value === month ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                    value === today && value !== month && "ring-1 ring-income/50",
                  )}
                >
                  {m}
                </button>
              );
            })}
          </div>
          {month !== today && (
            <Button
              variant="ghost"
              size="sm"
              className="self-center"
              onClick={() => {
                setMonth(today);
                setOpen(false);
              }}
            >
              Jump to this month
            </Button>
          )}
        </PopoverContent>
      </Popover>
      <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
        <ChevronRight className="size-5" />
      </Button>
    </div>
  );
}
