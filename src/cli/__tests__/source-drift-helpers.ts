/** Canonical sources use capability names even in examples; native examples belong in adapter docs. */
const nativeTools = /\b(?:Glob|Grep|LS|Bash|WebSearch|WebFetch|AskUserQuestion|TodoWrite|MultiEdit|NotebookEdit|ToolSearch|TaskCreate|TaskUpdate|TaskList|TaskGet|TaskStop)\b|`(?:Read|Write|Edit|Agent|Task)`|\b(?:Read|Write|Edit|Agent|Task) tool\b|\bUse Read\b/;
const concreteModels = /\b(?:sonnet|opus|haiku|fable|gpt-\d[\w.-]*|claude-(?:sonnet|opus|haiku|fable)[\w.-]*)\b/i;
export interface WorkerReference { file: string; line: number; name: string }

export const sourceFailures = (file: string, contents: string): string[] => contents.split("\n").flatMap((line, index) => {
  const failures = [];
  const location = `${file}:${index + 1}`;
  if (nativeTools.test(line)) failures.push(`${location}: native tool name; use shared capability/orchestration vocabulary and keep host examples in adapter docs`);
  if (concreteModels.test(line)) failures.push(`${location}: concrete model name; declare a neutral tier and put host model bindings in adapters`);
  if (/CLAUDE_PLUGIN_ROOT/.test(line)) failures.push(`${location}: host-specific plugin root; use flight-rules doc or the native-installation guide`);
  if (/\.claude\/flight-rules\.(?:local|qa)\.md/.test(line)) failures.push(`${location}: hardcoded host config path; use flight-rules config path or config show`);
  return failures;
});

/** Registry names, explicit dispatch/agent prose, and Agent/Worker/Registration table columns. No historical name prefixes. */
export const workerReferences = (file: string, contents: string, names: ReadonlySet<string>): WorkerReference[] => {
  const references: WorkerReference[] = [];
  let agentColumns: number[] = [];
  for (const [index, line] of contents.split("\n").entries()) {
    const cells = line.trim().startsWith("|") ? line.split("|") : [];
    if (cells.length === 0) agentColumns = [];
    const headers = cells.flatMap((cell, column) => /^(?:agent|worker|registration)$/i.test(cell.trim()) ? [column] : []);
    if (headers.length > 0) agentColumns = headers;
    for (const match of line.matchAll(/`([a-z][a-z0-9-]*)`/g)) {
      const name = match[1] ?? "";
      const offset = match.index;
      const before = line.slice(0, offset).replaceAll("*", "");
      const after = line.slice(offset + match[0].length).replaceAll("*", "");
      const column = line.slice(0, offset).split("|").length - 1;
      const explicit = /\b(?:dispatch|dispatches|dispatching)(?:\s+the)?\s+$/i.test(before)
        || /\b(?:named|agent|worker|registration)\s+$/i.test(before)
        || /`dispatch(?:Many)?`\s+(?:with|to)(?:\s+the)?(?:\s+named)?\s+$/i.test(before)
        || /^\s+(?:agent|worker|registration)\b/i.test(after)
        || (cells.length > 0 && agentColumns.includes(column));
      if (names.has(name) || explicit) references.push({ file, line: index + 1, name });
    }
  }
  return references;
};

export const unresolvedWorkers = (references: WorkerReference[], names: ReadonlySet<string>): string[] =>
  references.filter((reference) => !names.has(reference.name)).map(({ file, line, name }) =>
    `${file}:${line}: unknown worker ${name}; add a canonical definition/named variant or use an existing registry name`,
  );
