import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { SessionSystemPromptReport } from "../config/sessions/types.js";
import { buildBootstrapInjectionStats } from "./bootstrap-budget.js";
import type { EmbeddedContextFile } from "./pi-embedded-helpers.js";
import { normalizeStructuredPromptSection } from "./prompt-cache-stability.js";
import type { WorkspaceBootstrapFile } from "./workspace.js";

function extractBetween(
  input: string,
  startMarker: string,
  endMarker: string,
): { text: string; found: boolean } {
  const start = input.indexOf(startMarker);
  if (start === -1) {
    return { text: "", found: false };
  }
  const end = input.indexOf(endMarker, start + startMarker.length);
  if (end === -1) {
    return { text: input.slice(start), found: true };
  }
  return { text: input.slice(start, end), found: true };
}

function parseSkillBlocks(skillsPrompt: string): Array<{ name: string; blockChars: number }> {
  const prompt = skillsPrompt.trim();
  if (!prompt) {
    return [];
  }
  const blocks = Array.from(prompt.matchAll(/<skill>[\s\S]*?<\/skill>/gi)).map(
    (match) => match[0] ?? "",
  );
  return blocks
    .map((block) => {
      const name = block.match(/<name>\s*([^<]+?)\s*<\/name>/i)?.[1]?.trim() || "(unknown)";
      return { name, blockChars: block.length };
    })
    .filter((b) => b.blockChars > 0);
}

function buildToolsEntries(tools: AgentTool[]): SessionSystemPromptReport["tools"]["entries"] {
  return tools.map((tool) => {
    const name = tool.name;
    const summary = tool.description?.trim() || tool.label?.trim() || "";
    const summaryChars = summary.length;
    const schemaChars = (() => {
      if (!tool.parameters || typeof tool.parameters !== "object") {
        return 0;
      }
      try {
        return JSON.stringify(tool.parameters).length;
      } catch {
        return 0;
      }
    })();
    const propertiesCount = (() => {
      const schema =
        tool.parameters && typeof tool.parameters === "object"
          ? (tool.parameters as Record<string, unknown>)
          : null;
      const props = schema && typeof schema.properties === "object" ? schema.properties : null;
      if (!props || typeof props !== "object") {
        return null;
      }
      return Object.keys(props as Record<string, unknown>).length;
    })();
    return { name, summaryChars, schemaChars, propertiesCount };
  });
}

const SKILLS_SECTION_HEADER_PATTERN = [
  "## Skills \\(mandatory\\)",
  "Before replying: scan <available_skills> <description> entries\\.",
  "- If exactly one skill clearly applies: read its SKILL\\.md at <location> with `[^`]+`, then follow it\\.",
  "- If multiple could apply: choose the most specific one, then read/follow it\\.",
  "- If none clearly apply: do not read any SKILL\\.md\\.",
  "Constraints: never read more than one skill up front; only read after selecting\\.",
  "- When a skill drives external API writes, assume rate limits: prefer fewer larger writes, avoid tight one-item loops, serialize bursts when possible, and respect 429/Retry-After\\.",
].join("\\n");

function extractSkillsPromptText(systemPrompt: string, rawSkillsPrompt: string): string {
  const normalizedSkillsPrompt = normalizeStructuredPromptSection(rawSkillsPrompt);
  if (!normalizedSkillsPrompt) {
    return "";
  }
  const sectionPrefixPattern = new RegExp(`${SKILLS_SECTION_HEADER_PATTERN}\\n$`);
  let searchStart = 0;
  while (searchStart < systemPrompt.length) {
    const promptIndex = systemPrompt.indexOf(normalizedSkillsPrompt, searchStart);
    if (promptIndex === -1) {
      return "";
    }
    if (sectionPrefixPattern.test(systemPrompt.slice(0, promptIndex))) {
      return normalizedSkillsPrompt;
    }
    searchStart = promptIndex + normalizedSkillsPrompt.length;
  }
  return "";
}

export function buildSystemPromptReport(params: {
  source: SessionSystemPromptReport["source"];
  generatedAt: number;
  sessionId?: string;
  sessionKey?: string;
  provider?: string;
  model?: string;
  workspaceDir?: string;
  bootstrapMaxChars: number;
  bootstrapTotalMaxChars?: number;
  bootstrapTruncation?: SessionSystemPromptReport["bootstrapTruncation"];
  sandbox?: SessionSystemPromptReport["sandbox"];
  systemPrompt: string;
  bootstrapFiles: WorkspaceBootstrapFile[];
  injectedFiles: EmbeddedContextFile[];
  skillsPrompt: string;
  tools: AgentTool[];
}): SessionSystemPromptReport {
  const systemPrompt = params.systemPrompt.trim();
  const projectContext = extractBetween(
    systemPrompt,
    "\n# Project Context\n",
    "\n## Silent Replies\n",
  );
  const projectContextChars = projectContext.text.length;
  const toolsEntries = buildToolsEntries(params.tools);
  const toolsSchemaChars = toolsEntries.reduce((sum, t) => sum + (t.schemaChars ?? 0), 0);
  const renderedSkillsPrompt = extractSkillsPromptText(systemPrompt, params.skillsPrompt);
  const skillsEntries = parseSkillBlocks(renderedSkillsPrompt);

  return {
    source: params.source,
    generatedAt: params.generatedAt,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    provider: params.provider,
    model: params.model,
    workspaceDir: params.workspaceDir,
    bootstrapMaxChars: params.bootstrapMaxChars,
    bootstrapTotalMaxChars: params.bootstrapTotalMaxChars,
    ...(params.bootstrapTruncation ? { bootstrapTruncation: params.bootstrapTruncation } : {}),
    sandbox: params.sandbox,
    systemPrompt: {
      chars: systemPrompt.length,
      projectContextChars,
      nonProjectContextChars: Math.max(0, systemPrompt.length - projectContextChars),
    },
    injectedWorkspaceFiles: buildBootstrapInjectionStats({
      bootstrapFiles: params.bootstrapFiles,
      injectedFiles: params.injectedFiles,
    }),
    skills: {
      promptChars: renderedSkillsPrompt.length,
      entries: skillsEntries,
    },
    tools: {
      listChars: 0,
      schemaChars: toolsSchemaChars,
      entries: toolsEntries,
    },
  };
}
