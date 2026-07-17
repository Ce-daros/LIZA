export type ToolStatusState = "start" | "ok" | "fail";

export type ToolStatusReporter = (state: ToolStatusState, label: string, detail?: string) => void;
