export function cashmemoApiCommand(action) {
  return {
    executable: "cargo",
    args: ["run", "-p", "cashmemo-api", "--bin", "cashmemo-api", "--", action],
  };
}
