/**
 * Safety filter — input + output review. M2a is a keyword + length stub; the real layered
 * defense (Tencent 天御 TMS/IMS, minor-protection mode) lands in M6. A failed check returns
 * `ok:false` so the gateway substitutes a fallback (the child never sees a rejection).
 */
import type { SafetyResult } from "@genius-x/contracts";

export interface SafetyFilter {
  reviewInput(text: string): SafetyResult;
  reviewOutput(text: string): SafetyResult;
}

// Placeholder child-safety word list (configurable; real list + 天御 in M6).
const DEFAULT_BANNED = ["暴力", "血腥", "政治", "色情", "自杀", "毒品"];

export class KeywordSafetyFilter implements SafetyFilter {
  constructor(
    private readonly banned: string[] = DEFAULT_BANNED,
    private readonly maxOutputChars = 600,
  ) {}

  reviewInput(text: string): SafetyResult {
    return this.scan(text, false);
  }

  reviewOutput(text: string): SafetyResult {
    return this.scan(text, true);
  }

  private scan(text: string, checkLength: boolean): SafetyResult {
    const reasons: string[] = [];
    for (const w of this.banned) if (text.includes(w)) reasons.push(`banned_word:${w}`);
    if (checkLength && text.length > this.maxOutputChars) reasons.push("length");
    return reasons.length > 0
      ? { ok: false, action: "filtered", reasons }
      : { ok: true, action: "pass", reasons: [] };
  }
}
