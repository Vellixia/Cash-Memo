"use client";

import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { Segmented } from "@/components/segmented";
import { useMounted } from "@/lib/use-mounted";

export const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;
type Theme = (typeof THEMES)[number]["value"];

/** Light / Dark / System. Renders only after mount: the stored theme is unknown on the server. */
export function ThemeSelect() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  return (
    <Segmented<Theme>
      label="Theme"
      className="flex w-full"
      value={mounted ? ((theme as Theme) ?? "system") : "system"}
      onChange={setTheme}
      options={THEMES.map(({ value, label, icon: Icon }) => ({
        value,
        label: (
          <>
            <Icon className="size-4" /> {label}
          </>
        ),
      }))}
    />
  );
}
