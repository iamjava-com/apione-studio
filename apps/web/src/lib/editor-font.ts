/**
 * Monaco takes a font stack string, not a CSS var — keep this in step with --font-mono.
 *
 * It lives apart from monaco-setup so that reading the font does not pull the editor in: that
 * module configures Monaco on import, and anything importing it inherits the whole bundle.
 */
export const EDITOR_FONT = "'JetBrains Mono Variable', 'PingFang SC', 'Hiragino Sans', 'Microsoft YaHei', monospace";
