/**
 * @panelai/shared
 *
 * Shared types, constants, and utilities used across all PanelAI packages.
 * This package is source-only — it's consumed directly by other packages
 * via workspace resolution, not built independently.
 */

// Re-export everything from constants and utils
export * from "./constants/index.js";
export * from "./utils/index.js";

// Re-export all types
export * from "./types/index.js";
