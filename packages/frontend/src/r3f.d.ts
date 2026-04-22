/**
 * Bridges @react-three/fiber JSX types into React 19's React.JSX namespace.
 *
 * R3F v8 augments the global `JSX.IntrinsicElements`. With `"jsx": "react-jsx"`
 * TypeScript resolves intrinsic elements via `React.JSX.IntrinsicElements`.
 * This file merges the two so Three.js elements (mesh, group, etc.) are recognized.
 */
import type { ThreeElements } from "@react-three/fiber";

declare global {
  namespace React {
    namespace JSX {
      // eslint-disable-next-line @typescript-eslint/no-empty-object-type
      interface IntrinsicElements extends ThreeElements {}
    }
  }
}
