/// <reference types="@react-three/fiber" />
/**
 * CouncilScene — 3D Jedi-Council-style panel interview room
 *
 * Six stylized "toy" characters sit in a semicircle. The active speaker
 * steps forward, scales up, and glows in their accent color. The BiasAudit
 * agent sits center-back: normally a quiet green glow, pulsing red when a
 * bias flag is raised.
 *
 * Built with React Three Fiber + Drei. No external animation library —
 * everything runs via useFrame + linear interpolation.
 */

import { Suspense, useRef, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";

// ─── Seat definitions ─────────────────────────────────────────────────────────

interface Seat {
  /** Must match the panel id used in app.tsx */
  id: string;
  name: string;
  role: string;
  /** Saturated accent hex — also used for emissive glow */
  color: string;
  /** Base world position [x, y, z] */
  pos: [number, number, number];
  /** Y-axis rotation so the character faces center/camera */
  rotY: number;
  /** Marks the silent bias observer at the back */
  isBias?: boolean;
}

/**
 * Semicircle layout (5 main agents) + BiasAudit center-back.
 * x-axis: left/right spread  |  z-axis: depth (higher = closer to camera)
 */
const SEATS: Seat[] = [
  {
    id: "recruiter",
    name: "Recruiter",
    role: "Screening",
    color: "#34d399",
    pos: [-3.1, 0, 0.2],
    rotY: 0.24
  },
  {
    id: "technical",
    name: "Technical",
    role: "Systems",
    color: "#38bdf8",
    pos: [-1.55, 0, 1.55],
    rotY: 0.12
  },
  {
    id: "orchestrator",
    name: "Orchestrator",
    role: "Moderator",
    color: "#22d3ee",
    pos: [0, 0, 2.1],
    rotY: 0
  },
  {
    id: "culture",
    name: "Culture",
    role: "Behavioral",
    color: "#fbbf24",
    pos: [1.55, 0, 1.55],
    rotY: -0.12
  },
  {
    id: "domain",
    name: "Domain",
    role: "Industry",
    color: "#a78bfa",
    pos: [3.1, 0, 0.2],
    rotY: -0.24
  },
  {
    id: "bias-audit",
    name: "Bias Auditor",
    role: "Observer",
    color: "#4ade80",
    pos: [0, 0.25, -1.7],
    rotY: 0,
    isBias: true
  }
];

// ─── Utility ──────────────────────────────────────────────────────────────────

/** Multiply each RGB channel of a hex color by `factor` (0=black, 1=original) */
function darken(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (
    "#" +
    [r, g, b]
      .map((v) =>
        Math.round(v * factor)
          .toString(16)
          .padStart(2, "0")
      )
      .join("")
  );
}

// ─── Per-character mesh ───────────────────────────────────────────────────────

function CouncilCharacter({
  seat,
  isActive,
  biasFlag
}: {
  seat: Seat;
  isActive: boolean;
  biasFlag: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null!);
  const headMatRef = useRef<THREE.MeshStandardMaterial>(null!);
  const ringRef = useRef<THREE.Mesh>(null!);
  const biasLightRef = useRef<THREE.PointLight>(null!);

  // Colors: bias agent flips red on flag
  const displayColor = seat.isBias && biasFlag ? "#ef4444" : seat.color;
  const chairColor = darken(displayColor, 0.45);

  // Smooth step-forward + scale animation
  useFrame((_state, delta) => {
    if (!groupRef.current) return;
    const k = Math.min(1, delta * 4.5);

    const targetZ = isActive ? seat.pos[2] + 0.8 : seat.pos[2];
    const targetY = isActive ? seat.pos[1] + 0.1 : seat.pos[1];
    const targetS = isActive ? 1.13 : 1.0;

    groupRef.current.position.z = THREE.MathUtils.lerp(
      groupRef.current.position.z,
      targetZ,
      k
    );
    groupRef.current.position.y = THREE.MathUtils.lerp(
      groupRef.current.position.y,
      targetY,
      k
    );
    groupRef.current.scale.setScalar(
      THREE.MathUtils.lerp(groupRef.current.scale.x, targetS, k)
    );
  });

  // Head emissive fade + ring spin
  useFrame((state) => {
    if (headMatRef.current) {
      const target = isActive ? 0.38 : seat.isBias ? 0.14 : 0.05;
      headMatRef.current.emissiveIntensity = THREE.MathUtils.lerp(
        headMatRef.current.emissiveIntensity,
        target,
        0.07
      );
    }

    if (ringRef.current) {
      ringRef.current.visible = isActive;
      if (isActive) {
        ringRef.current.rotation.z = state.clock.elapsedTime * 1.4;
        const pulse = 1 + Math.sin(state.clock.elapsedTime * 2.8) * 0.14;
        ringRef.current.scale.setScalar(pulse);
      }
    }

    // Bias light pulse
    if (biasLightRef.current && seat.isBias) {
      const targetIntensity = biasFlag
        ? 2.0 + Math.sin(state.clock.elapsedTime * 5) * 1.4
        : 0.55;
      biasLightRef.current.intensity = THREE.MathUtils.lerp(
        biasLightRef.current.intensity,
        targetIntensity,
        0.06
      );
      biasLightRef.current.color.lerp(
        new THREE.Color(biasFlag ? "#ef4444" : "#4ade80"),
        0.04
      );
    }
  });

  return (
    <group
      ref={groupRef}
      position={[...seat.pos] as [number, number, number]}
      rotation={[0, seat.rotY, 0]}
    >
      {/* ── Chair pedestal ── */}
      <mesh position={[0, -0.11, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.54, 0.6, 0.22, 14]} />
        <meshStandardMaterial
          color={chairColor}
          roughness={0.75}
          metalness={0.1}
        />
      </mesh>

      {/* ── Chair back slab ── */}
      <mesh position={[0, 0.5, -0.3]} castShadow>
        <boxGeometry args={[0.8, 1.02, 0.07]} />
        <meshStandardMaterial color={chairColor} roughness={0.65} />
      </mesh>

      {/* ── Left armrest ── */}
      <mesh position={[-0.39, 0.44, -0.08]}>
        <boxGeometry args={[0.065, 0.065, 0.35]} />
        <meshStandardMaterial color={chairColor} roughness={0.7} />
      </mesh>

      {/* ── Right armrest ── */}
      <mesh position={[0.39, 0.44, -0.08]}>
        <boxGeometry args={[0.065, 0.065, 0.35]} />
        <meshStandardMaterial color={chairColor} roughness={0.7} />
      </mesh>

      {/* ── Torso (capsule — the iconic "toy body") ── */}
      <mesh position={[0, 0.54, 0]} castShadow>
        <capsuleGeometry args={[0.23, 0.32, 5, 14]} />
        <meshStandardMaterial
          color={displayColor}
          roughness={0.42}
          metalness={0.06}
          emissive={displayColor}
          emissiveIntensity={isActive ? 0.09 : 0.02}
        />
      </mesh>

      {/* ── Neck connector ── */}
      <mesh position={[0, 0.99, 0]}>
        <sphereGeometry args={[0.115, 10, 10]} />
        <meshStandardMaterial color={displayColor} roughness={0.5} />
      </mesh>

      {/* ── Head (big oversized toy sphere — 60 % of torso height) ── */}
      <mesh position={[0, 1.29, 0]} castShadow>
        <sphereGeometry args={[0.34, 22, 22]} />
        <meshStandardMaterial
          ref={headMatRef}
          color={displayColor}
          roughness={0.32}
          metalness={0.08}
          emissive={displayColor}
          emissiveIntensity={0.05}
        />
      </mesh>

      {/* ── Left eye (white emissive) ── */}
      <mesh position={[-0.135, 1.335, 0.295]}>
        <sphereGeometry args={[0.046, 10, 10]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive="#ffffff"
          emissiveIntensity={2.2}
          roughness={0.05}
        />
      </mesh>

      {/* ── Right eye (white emissive) ── */}
      <mesh position={[0.135, 1.335, 0.295]}>
        <sphereGeometry args={[0.046, 10, 10]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive="#ffffff"
          emissiveIntensity={2.2}
          roughness={0.05}
        />
      </mesh>

      {/* ── Left pupil ── */}
      <mesh position={[-0.135, 1.335, 0.328]}>
        <sphereGeometry args={[0.026, 8, 8]} />
        <meshStandardMaterial color="#060d1c" roughness={0.2} />
      </mesh>

      {/* ── Right pupil ── */}
      <mesh position={[0.135, 1.335, 0.328]}>
        <sphereGeometry args={[0.026, 8, 8]} />
        <meshStandardMaterial color="#060d1c" roughness={0.2} />
      </mesh>

      {/* ── Spinning halo ring (shows while active/speaking) ── */}
      <mesh ref={ringRef} position={[0, 1.88, 0]} visible={false}>
        <ringGeometry args={[0.3, 0.4, 36]} />
        <meshStandardMaterial
          color={displayColor}
          emissive={displayColor}
          emissiveIntensity={0.95}
          side={THREE.DoubleSide}
          transparent
          opacity={0.78}
        />
      </mesh>

      {/* ── Speaker point light ── */}
      {isActive && (
        <pointLight
          position={[0, 1.7, 0.7]}
          color={displayColor}
          intensity={4.0}
          distance={5.5}
          decay={2}
        />
      )}

      {/* ── Bias auditor persistent glow ── */}
      {seat.isBias && (
        <pointLight
          ref={biasLightRef}
          position={[0, 1.3, 0.6]}
          color={displayColor}
          intensity={0.55}
          distance={3.5}
          decay={2}
        />
      )}

      {/* ── Name label (HTML overlay) ── */}
      <Html
        position={[0, 2.08, 0]}
        center
        style={{ pointerEvents: "none" }}
        zIndexRange={[10, 0]}
      >
        <div
          style={{
            background: "rgba(2,8,23,0.88)",
            border: `1px solid ${displayColor}55`,
            borderRadius: "5px",
            padding: "3px 9px 4px",
            textAlign: "center",
            whiteSpace: "nowrap",
            transition: "box-shadow 0.4s",
            boxShadow: isActive ? `0 0 14px ${displayColor}66` : "none"
          }}
        >
          <p
            style={{
              color: displayColor,
              fontSize: "11px",
              fontWeight: 700,
              fontFamily: "system-ui, sans-serif",
              letterSpacing: "0.06em",
              margin: 0
            }}
          >
            {seat.name}
          </p>
          <p
            style={{
              color: "#64748b",
              fontSize: "9px",
              fontFamily: "system-ui, sans-serif",
              margin: "1px 0 0"
            }}
          >
            {seat.role}
          </p>
        </div>
      </Html>
    </group>
  );
}

// ─── Room environment ─────────────────────────────────────────────────────────

function SceneEnvironment() {
  const { scene } = useThree();

  useEffect(() => {
    scene.background = new THREE.Color(0x020b18);
    scene.fog = new THREE.FogExp2(0x020b18, 0.026);
  }, [scene]);

  return (
    <>
      {/* Deep blue ambient fill */}
      <ambientLight color={0x1e3a5f} intensity={0.65} />

      {/* Primary top-front key light */}
      <directionalLight
        position={[1.5, 8, 7]}
        color={0x8ecff8}
        intensity={1.15}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />

      {/* Subtle back-rim light (adds depth) */}
      <directionalLight
        position={[0, 4, -9]}
        color={0x0a2540}
        intensity={0.35}
      />

      {/* Floor plane — dark near-black */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.25, 0]}
        receiveShadow
      >
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial
          color={0x050d1c}
          roughness={0.95}
          metalness={0.0}
        />
      </mesh>

      {/* Subtle grid overlay — barely visible, adds "room" depth */}
      <gridHelper
        args={[40, 50, 0x0d2740, 0x071422]}
        position={[0, -0.24, 0]}
      />

      {/* Back wall — dark backdrop */}
      <mesh position={[0, 3.5, -8]}>
        <planeGeometry args={[22, 14]} />
        <meshStandardMaterial color={0x030912} roughness={1} />
      </mesh>

      {/* Side walls — left */}
      <mesh position={[-8, 3.5, -2]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[12, 14]} />
        <meshStandardMaterial color={0x04101e} roughness={1} />
      </mesh>

      {/* Side walls — right */}
      <mesh position={[8, 3.5, -2]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[12, 14]} />
        <meshStandardMaterial color={0x04101e} roughness={1} />
      </mesh>

      {/* Faint ceiling light glow strip at top */}
      <pointLight
        position={[0, 8, 0]}
        color={0x0d3060}
        intensity={1.5}
        distance={15}
        decay={1.5}
      />
    </>
  );
}

// ─── Council Scene (public export) ───────────────────────────────────────────

export interface CouncilSceneProps {
  /** ID of the agent currently speaking. Maps to a SEAT id. */
  activeSpeakerId?: string;
  /** True while assistant message is streaming */
  isStreaming?: boolean;
  /** True when BiasAuditAgent has raised a flag */
  biasFlag?: boolean;
}

/**
 * Drop-in 3D panel. Expects a parent container with an explicit height
 * (e.g. `h-[430px]` or `flex-1`). The Canvas expands to fill it.
 */
export function CouncilScene({
  activeSpeakerId = "orchestrator",
  isStreaming: _isStreaming = false,
  biasFlag = false
}: CouncilSceneProps) {
  return (
    <Canvas
      camera={{ position: [0, 3.7, 9.8], fov: 40, near: 0.1, far: 80 }}
      shadows
      gl={{ antialias: true, alpha: false }}
      style={{ width: "100%", height: "100%", display: "block" }}
    >
      <Suspense fallback={null}>
        <SceneEnvironment />
        {SEATS.map((seat) => (
          <CouncilCharacter
            key={seat.id}
            seat={seat}
            isActive={seat.id === activeSpeakerId}
            biasFlag={biasFlag}
          />
        ))}
      </Suspense>
    </Canvas>
  );
}
