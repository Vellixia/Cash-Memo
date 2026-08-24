export interface HarnessCommand {
  executable: string;
  args: string[];
}

export function cashmemoApiCommand(action: "migrate" | "serve"): HarnessCommand;
