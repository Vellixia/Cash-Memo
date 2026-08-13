const role = process.env["PROCESS_ROLE"];

if (role === "worker") {
  await import("./worker.js");
} else if (role === "api" || role === "all") {
  await import("./server.js");
} else {
  throw new Error("PROCESS_ROLE_INVALID");
}
