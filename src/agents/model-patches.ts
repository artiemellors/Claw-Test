export type ModelPatch = {
  match: string | RegExp;
  appendSystem?: string;
  prependSystem?: string;
};

const BUILTIN_PATCHES: ModelPatch[] = [
  {
    match: /claude.*sonnet/i,
    appendSystem: "Be concise. Avoid over-commenting code. Verify your work before reporting done.",
  },
  {
    match: /gpt-4/i,
    appendSystem: "Do not add excessive inline comments. Prefer showing changes over explaining them.",
  },
  {
    match: /gemini/i,
    appendSystem: "Keep responses focused. Do not repeat the question back. Make minimal targeted changes when editing files.",
  },
];

function testRegex(re: RegExp, str: string): boolean {
  re.lastIndex = 0;
  return re.test(str);
}

export function getModelPatches(modelName: string): ModelPatch[] {
  return BUILTIN_PATCHES.filter((p) =>
    typeof p.match === "string"
      ? modelName.toLowerCase().includes(p.match.toLowerCase())
      : testRegex(p.match, modelName)
  );
}

export function applyModelPatches(
  systemPrompt: string,
  modelName: string,
): string {
  const patches = getModelPatches(modelName);
  let result = systemPrompt;
  for (const patch of patches) {
    if (patch.prependSystem) {
      result = patch.prependSystem + "\n" + result;
    }
    if (patch.appendSystem) {
      result = result + "\n" + patch.appendSystem;
    }
  }
  return result;
}
