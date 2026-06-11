/**
 * Tool registry — versioned git config (docs/contracts/tool.md). Validated FAIL-CLOSED at
 * boot against the lesson (`StageConfig.tools` refs must resolve; option fragments must
 * pass the brand-vocabulary denylist — scene content only; childName/labels are
 * child-facing copy bound by the banned-wording rule).
 *
 * Phase 5 ships ONE real mechanic: `image_refine` — the iterative aesthetics loop
 * ("把这一张变成那样"): the child picks one of their OWN works and asks for a declared
 * variation; the gateway runs img2img with the option's SCENE fragment + the brand suffix.
 */
import type { ToolDefinition } from "@genius-x/contracts";

export const TOOL_REGISTRY: readonly ToolDefinition[] = [
  {
    toolId: "magic_brush",
    version: "magic_brush_v1",
    childName: "魔法画笔",
    mechanic: "image_refine",
    options: [
      { id: "sparkle", label: "亮晶晶", promptFragment: "加上闪闪发光的星星点缀" },
      { id: "hat", label: "戴帽子", promptFragment: "戴上一顶可爱的小帽子" },
      { id: "wings", label: "长翅膀", promptFragment: "背上长出一对小翅膀" },
    ],
  },
];

export function toolById(toolId: string): ToolDefinition | undefined {
  return TOOL_REGISTRY.find((t) => t.toolId === toolId);
}
