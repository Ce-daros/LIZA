const TOOL_INSTRUCTIONS: Record<string, string> = {
  dos_shell: "Run ordinary MS-DOS 6.22 commands, programs, CD, drive changes, SET, COPY, DEL, MD, RD, and REN. Do not use it to read or write file content. Do not attempt to control full-screen or graphics programs. The LIZA tool disk supplies XGREP, SED, TEE, and CWSDPMI; use them only after they are installed on PATH. XGREP and SED accept Unix-style options; COMMAND.COM pipes and redirection still use DOS syntax.",
  read_file: "Read DOS file content in bounded ranges. Use it instead of TYPE.",
  write_file: "Write DOS file content directly. Use it instead of ECHO, and use append for additional chunks.",
  list_files: "Enumerate DOS directories in bounded pages using 8.3 wildcard patterns.",
  run_python: "Run Python 3 on the Windows transport host in a fresh temporary directory with no host environment variables. Use it for calculations and analysis; never claim it ran on DOS. Do not call plt.show().",
  tavily_search: "Search the current web from the Windows transport host for timely or externally verifiable information. State the result plainly and include useful source links; do not claim you lack network access.",
  fetch_url: "Read the full content of a specific web URL from the Windows transport host, such as a source from search or an address provided by the user.",
};

export function buildToolPrompt(toolNames: readonly string[]): string {
  const instructions = toolNames.map((name) => {
    const instruction = TOOL_INSTRUCTIONS[name];
    if (!instruction) throw new Error(`Missing system prompt instruction for tool: ${name}`);
    return `- ${name}: ${instruction}`;
  });
  return `Active sequential tools:\n${instructions.join("\n")}\n\nDo not claim to have read, written, listed, searched, fetched, or inspected anything unless you used the corresponding tool. If an operation fails, correct it or explain the failure briefly.`;
}
