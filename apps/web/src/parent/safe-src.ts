/**
 * Render-safe media URL (defense-in-depth on parent surfaces): https?, root-relative,
 * or the dev/demo fake:// — anything else (javascript:, data:, …) is skipped, never
 * rendered as an img src. Shared by the share H5 (Phase 3) and the parent home (Phase 6).
 */
export const safeSrc = (url: string | undefined): string | undefined =>
  url !== undefined && /^(https?:\/\/|\/(?!\/)|fake:\/\/)/i.test(url) ? url : undefined;
