const APP_WORKSPACES = Object.freeze([
  {
    key: "composer",
    label: "Composer",
    description: "Build fixture and parent market payloads from the selected fixture context.",
    generatePage: "builder",
    targetId: "generateSection",
  },
  {
    key: "fixtures",
    label: "Upcoming Fixtures",
    description: "Browse live league schedules by matchweek before applying a fixture into the composer.",
    generatePage: "fixtures",
    targetId: "generateSection",
  },
  {
    key: "verify",
    label: "Verify",
    description: "Inspect incoming payloads and run strict CSV-backed verification.",
    targetId: "verifySection",
  },
]);

const WORKSPACE_BY_KEY = new Map(APP_WORKSPACES.map((workspace) => [workspace.key, workspace]));

export function getAppWorkspaces() {
  return APP_WORKSPACES.slice();
}

export function getAppWorkspace(key) {
  return WORKSPACE_BY_KEY.get(String(key || "").trim()) || null;
}
