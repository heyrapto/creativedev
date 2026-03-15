"use client";

import { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useStore } from '../store';
import { RoundedBox, Cylinder, Sphere, Torus, Extrude } from '@react-three/drei';
import * as THREE from 'three';
import { useDrag } from '@use-gesture/react';
import { useSpring, a } from '@react-spring/three';

// ---------------------------------------------------------------------------
// Module-level physics registry — shared across all Card instances
// ---------------------------------------------------------------------------
interface CardPhysicsState {
  worldX: number;           // element's world X this frame (for collision)
  angularVel: number;       // angular velocity for collision transfer
  isDragging: boolean;
  radius: number;
  applyImpulse: (angImpulse: number) => void;
}
const registry = new Map<string, CardPhysicsState>();

// Counter for staggering idle phases (no Math.random in render)
let _instanceCounter = 0;

// Pre-allocated scratch vectors — zero GC pressure in useFrame
const _anchorWorld = new THREE.Vector3();
const _hookWorld = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Card component
// ---------------------------------------------------------------------------
export function Card({
  position = [0, 0, 0],
  type = "safe",
}: {
  position?: [number, number, number];
  type?: "safe" | "globe";
}) {
  const { gl, camera } = useThree();

  // ---- Visual refs ----
  // anchorGroupRef: pivot placed at the fixed top anchor.
  //   Its rotation.z = pendulum angle, so the entire chain+hook+element tilts as one.
  const anchorGroupRef = useRef<THREE.Group>(null);
  const poleRef = useRef<THREE.Group>(null);   // vertical cylinder inside the pivot
  const localSpinRef = useRef<THREE.Group>(null); // element Y-spin (isolated)
  const elementDropRef = useRef<THREE.Group>(null);

  // ---- Pendulum physics state (all refs → zero re-renders per frame) ----
  const angleRef = useRef(0);      // radians from vertical; positive = right
  const angVelRef = useRef(0);     // rad/s
  const rotVelRef = useRef(0);     // element Y-spin velocity
  const idlePhaseRef = useRef((_instanceCounter++ % 10) * 10); // stagger

  // Hanging system dimensions
  const HANG_LENGTH = 12; // distance from anchor top to element centre (scene units)

  // ---- Drag state ----
  const isDraggingRef = useRef(false);

  // ---- Drop spring (isolated from pendulum) ----
  const [dropSpring, dropApi] = useSpring(() => ({
    yOffset: 0,
    config: { mass: 1, tension: 120, friction: 14 },
  }));
  const isDroppedRef = useRef(false);

  // ---- Hover ----
  const [hovered, setHovered] = useState(false);

  // ---- Store ----
  const intensity = useStore((s) => s.intensity);
  const speed = useStore((s) => s.speed);
  const wind = useStore((s) => s.wind);
  const saturation = useStore((s) => s.saturation);
  const glare = useStore((s) => s.glare);

  // ---- Registry ----
  useEffect(() => {
    const entry: CardPhysicsState = {
      worldX: position[0],
      angularVel: 0,
      isDragging: false,
      radius: type === 'safe' ? 1.6 : 1.4,
      applyImpulse: (imp) => { angVelRef.current += imp; },
    };
    registry.set(type, entry);
    return () => { registry.delete(type); };
  }, [type, position]);

  // ---- Cursor ----
  useEffect(() => {
    document.body.style.cursor = hovered ? 'grab' : 'default';
    return () => { document.body.style.cursor = 'default'; };
  }, [hovered]);

  // ---------------------------------------------------------------------------
  // Convert clientX → pendulum angle (projects cursor onto the world XZ plane)
  // ---------------------------------------------------------------------------
  const screenToAngle = useCallback((clientX: number) => {
    const rect = gl.domElement.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const v = new THREE.Vector3(ndcX, 0, 0.5).unproject(camera);
    const dir = v.sub(camera.position).normalize();
    const t = -camera.position.z / dir.z;
    const worldX = camera.position.x + dir.x * t;
    return Math.atan2(worldX - position[0], HANG_LENGTH);
  }, [gl, camera, position]);

  // ---------------------------------------------------------------------------
  // Drag — sets pendulum angle directly while dragging
  // ---------------------------------------------------------------------------
  const bind = useDrag(
    ({ xy: [x], first, last, velocity: [vx], direction: [dx] }) => {
      if (isDroppedRef.current) return;

      if (first) {
        isDraggingRef.current = true;
        document.body.style.cursor = 'grabbing';
        angVelRef.current = 0;
      }

      if (!last) {
        angleRef.current = screenToAngle(x);
      }

      if (last) {
        isDraggingRef.current = false;
        document.body.style.cursor = hovered ? 'grab' : 'default';
        // Convert swipe speed (px/ms) → angular velocity (rad/s)
        const W = gl.domElement.clientWidth;
        angVelRef.current = (vx * dx * 0.004 * HANG_LENGTH * 60) / W;
      }

      const entry = registry.get(type);
      if (entry) {
        entry.isDragging = isDraggingRef.current;
        entry.worldX = position[0] + Math.sin(angleRef.current) * HANG_LENGTH;
      }
    },
    { pointer: { capture: true } },
  );

  // ---------------------------------------------------------------------------
  // Hook click — drop element (isolated from pendulum physics)
  // ---------------------------------------------------------------------------
  const handleHookClick = useCallback(() => {
    if (isDroppedRef.current) return;
    isDroppedRef.current = true;
    dropApi.start({ yOffset: -15 });
    setTimeout(() => {
      dropApi.start({ yOffset: 12, immediate: true });
      setTimeout(() => {
        isDroppedRef.current = false;
        dropApi.start({ yOffset: 0, immediate: false });
      }, 60);
    }, 1000);
  }, [dropApi]);

  // ---------------------------------------------------------------------------
  // useFrame — pendulum physics + rendering
  // ---------------------------------------------------------------------------
  useFrame((_state, delta) => {
    if (!anchorGroupRef.current || !localSpinRef.current) return;

    const dt = Math.min(delta, 0.05);
    const time = (idlePhaseRef.current += dt);

    // ---- 1. Pendulum physics (skip while dragging or dropped) ----
    if (!isDraggingRef.current && !isDroppedRef.current) {
      // Wind: continuous force + natural turbulence
      const turbulence = 1
        + Math.sin(time * 0.55) * 0.2
        + Math.sin(time * 1.35) * 0.09;
      const windAcc = wind * turbulence * 0.5; // angular acceleration (rad/s²)

      // Gravity restoring force (pendulum equation)
      const G = 9.8;
      const restoring = -(G / HANG_LENGTH) * Math.sin(angleRef.current);

      // Air damping (keeps oscillation organic, not infinite)
      const AIR_DAMPING = 1.6;
      const drag = -angVelRef.current * AIR_DAMPING;

      // Integrate
      angVelRef.current += (windAcc + restoring + drag) * dt;
      angleRef.current += angVelRef.current * dt;

      // Hard clamp: max ~55° tilt
      angleRef.current = THREE.MathUtils.clamp(
        angleRef.current, -Math.PI * 0.31, Math.PI * 0.31,
      );
    }

    // ---- 2. Elastic collision with other card ----
    const otherType = type === 'safe' ? 'globe' : 'safe';
    const self = registry.get(type);
    const other = registry.get(otherType);

    if (self && other) {
      const myX = position[0] + Math.sin(angleRef.current) * HANG_LENGTH;
      self.worldX = myX;
      self.angularVel = angVelRef.current;
      self.isDragging = isDraggingRef.current;

      const dist = Math.abs(myX - other.worldX);
      const minDist = self.radius + other.radius;

      if (dist < minDist && dist > 0.001) {
        // Linearised tangential velocities
        const cosA = Math.cos(angleRef.current);
        const myVx = angVelRef.current * cosA * HANG_LENGTH;
        const otherVx = other.angularVel * Math.cos(Math.asin(
          THREE.MathUtils.clamp((other.worldX - position[0]) / HANG_LENGTH, -1, 1),
        )) * HANG_LENGTH;

        const sign = Math.sign(other.worldX - myX);
        if ((myVx - otherVx) * sign > 0) {
          const restitution = 0.7;
          const relV = myVx - otherVx;
          const J = -(1 + restitution) * relV * 0.5;
          const dAngSelf = J / (cosA * HANG_LENGTH + 0.001);

          angVelRef.current += dAngSelf;
          if (!other.isDragging) other.applyImpulse(-dAngSelf);
        }
      }
    }

    // ---- 3. Apply angle → pivot group ----
    // The anchor pivot is fixed at the ceiling attachment point.
    // Rotating it by angleRef.current tilts the entire rig (pole + hook + element).
    anchorGroupRef.current.rotation.z = angleRef.current;

    // ---- 4. Pole stretch ----
    if (poleRef.current) {
      // Pole lives in local pivot space, pointing straight down (–Y)
      const hookLocalY = -(HANG_LENGTH - 1.65);
      _anchorWorld.setFromMatrixPosition(anchorGroupRef.current.matrixWorld);
      _hookWorld.set(0, hookLocalY, 0)
        .applyMatrix4(anchorGroupRef.current.matrixWorld);
      const poleDist = _anchorWorld.distanceTo(_hookWorld);
      poleRef.current.scale.set(1, poleDist, 1);
      // Centre the pole between anchor and hook (local Y)
      poleRef.current.position.set(0, hookLocalY * 0.5, 0);
    }

    // ---- 5. Element spin ----
    rotVelRef.current += (hovered ? speed * 0.1 : speed * 0.055) * dt;
    rotVelRef.current *= 0.96;
    localSpinRef.current.rotation.y += rotVelRef.current;
  });

  // ---------------------------------------------------------------------------
  // Materials
  // ---------------------------------------------------------------------------
  const materialProps = useMemo(() => {
    const irid = THREE.MathUtils.clamp(intensity, 0, 1);
    const cc = THREE.MathUtils.clamp(glare + intensity * 0.5, 0, 5);
    return {
      metalness: 0.85 + intensity * 0.12,
      roughness: Math.max(0.02, 0.18 - intensity * 0.12),
      clearcoat: cc,
      clearcoatRoughness: Math.max(0.01, 0.1 - intensity * 0.07),
      iridescence: irid,
      iridescenceIOR: 1.4 + intensity * 0.4,
      iridescenceThicknessRange: [80 + intensity * 220, 250 + intensity * 550] as [number, number],
      color: new THREE.Color().setHSL(
        0.6,
        saturation * 0.9 + intensity * 0.1,
        0.45 + saturation * 0.1 + intensity * 0.08,
      ),
    };
  }, [glare, saturation, intensity]);

  const accentMaterial = useMemo(() => ({
    metalness: 1,
    roughness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    color: new THREE.Color('#ffaa00'),
  }), []);

  // Hook J-curve geometry
  const hookShape = useMemo(() => {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, 0.015, 0, Math.PI * 2, false);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.6, 0),
      new THREE.Vector3(0, 0.1, 0),
      new THREE.Vector3(0, -0.05, 0),
      new THREE.Vector3(0.08, -0.15, 0),
      new THREE.Vector3(0.15, -0.05, 0),
    ]);
    return { shape, curve };
  }, []);

  // Eyelet ring component — gold ring + stem at the top of each element
  const Eyelet = () => (
    <group position={[0, 1.6, 0]}>
      <Cylinder args={[0.06, 0.06, 0.32, 16]} position={[0, -0.18, 0]}>
        <meshPhysicalMaterial {...accentMaterial} />
      </Cylinder>
      <Torus args={[0.08, 0.022, 16, 32]} position={[0, -0.04, 0]} rotation={[0, Math.PI / 2, 0]}>
        <meshPhysicalMaterial {...accentMaterial} />
      </Torus>
    </group>
  );

  // ---------------------------------------------------------------------------
  // JSX — scene hierarchy:
  //
  //  <group>  (world root)
  //    <mesh> top anchor torus (fixed world position)
  //    <group anchorGroupRef>  ← pivot at anchor; rotation.z = pendulum angle
  //      <group poleRef>       ← gold pole, scaled to HANG_LENGTH
  //      hook                  ← at bottom of pivot (local y = -(HANG_LENGTH - 1.65))
  //      elementDropRef        ← drop spring offset
  //        localSpinRef        ← element Y-spin
  //          Safe / Globe mesh
  // ---------------------------------------------------------------------------
  return (
    <group>
      {/* Fixed top anchor ring — never moves */}
      <mesh position={[position[0], position[1] + 12, position[2]]}>
        <Torus args={[0.2, 0.05, 16, 32]} rotation={[Math.PI / 2, 0, 0]}>
          <meshPhysicalMaterial {...accentMaterial} />
        </Torus>
      </mesh>

      {/* Pivot group — positioned at anchor, rotated by pendulum angle */}
      <group
        ref={anchorGroupRef}
        position={[position[0], position[1] + 12, position[2]]}
      >
        {/* Gold pole — vertical, scales to fill HANG_LENGTH */}
        <group ref={poleRef}>
          <mesh>
            <cylinderGeometry args={[0.022, 0.022, 1, 16]} />
            <meshPhysicalMaterial {...accentMaterial} />
          </mesh>
        </group>

        {/* Everything below the anchor pivot, at -(HANG_LENGTH - gap) local Y */}
        <group position={[0, -(HANG_LENGTH - 1.65), 0]} {...(bind() as object)}>

          {/* Gold J-Hook */}
          <group
            position={[-0.08, 0, 0]}
            onClick={(e) => { e.stopPropagation(); handleHookClick(); }}
          >
            <Extrude args={[hookShape.shape, { extrudePath: hookShape.curve, steps: 50, bevelEnabled: false }]}>
              <meshPhysicalMaterial {...accentMaterial} />
            </Extrude>
            <Sphere args={[0.015, 12, 12]} position={[0.15, -0.05, 0]}>
              <meshPhysicalMaterial {...accentMaterial} />
            </Sphere>
          </group>

          {/* Element — drops independently via spring */}
          <a.group ref={elementDropRef} position-y={dropSpring.yOffset}>
            <group
              ref={localSpinRef}
              onPointerOver={() => setHovered(true)}
              onPointerOut={() => setHovered(false)}
            >

              {type === "safe" && (
                <group>
                  <Eyelet />
                  <RoundedBox args={[2.5, 2.5, 2.5]} radius={0.2} smoothness={4}>
                    <meshPhysicalMaterial {...materialProps} />
                  </RoundedBox>
                  {/* Dial face */}
                  <group position={[0, 0, 1.3]}>
                    <Cylinder args={[0.8, 0.8, 0.1, 32]} rotation={[Math.PI / 2, 0, 0]}>
                      <meshPhysicalMaterial metalness={0.9} roughness={0.05} color="#111" />
                    </Cylinder>
                    <group position={[0, 0, 0.12]}>
                      <Torus args={[0.5, 0.05, 16, 32]}>
                        <meshPhysicalMaterial {...accentMaterial} />
                      </Torus>
                      <Cylinder args={[0.05, 0.05, 1, 12]} rotation={[0, 0, Math.PI / 4]}>
                        <meshPhysicalMaterial {...accentMaterial} />
                      </Cylinder>
                      <Cylinder args={[0.05, 0.05, 1, 12]} rotation={[0, 0, -Math.PI / 4]}>
                        <meshPhysicalMaterial {...accentMaterial} />
                      </Cylinder>
                      <Cylinder args={[0.1, 0.1, 0.15, 12]} rotation={[Math.PI / 2, 0, 0]}>
                        <meshPhysicalMaterial {...accentMaterial} />
                      </Cylinder>
                    </group>
                  </group>
                  {/* Shield badge */}
                  <group position={[-1.2, -0.8, 1.4]} scale={0.7}>
                    <RoundedBox args={[1.5, 1.5, 0.2]} radius={0.1} smoothness={2} rotation={[0, 0, Math.PI / 4]}>
                      <meshPhysicalMaterial {...accentMaterial} color="#90ee90" />
                    </RoundedBox>
                  </group>
                </group>
              )}

              {type === "globe" && (
                <group>
                  <Eyelet />
                  <Sphere args={[1, 32, 32]}>
                    <meshPhysicalMaterial {...materialProps} transmission={0.15} roughness={0.4} />
                  </Sphere>
                  {[0, Math.PI / 4, Math.PI / 2, Math.PI * 0.75].map((angle, i) => (
                    <Torus key={i} args={[1.3, 0.07, 12, 32]} rotation={[0, angle, 0]}>
                      <meshPhysicalMaterial {...materialProps} />
                    </Torus>
                  ))}
                  <Torus args={[1.3, 0.07, 12, 32]} rotation={[Math.PI / 2, 0, 0]}>
                    <meshPhysicalMaterial {...materialProps} />
                  </Torus>
                  {/* Padlock */}
                  <group position={[1, -1, 1.3]} scale={0.8}>
                    <RoundedBox args={[1, 0.8, 0.4]} radius={0.1} smoothness={2}>
                      <meshPhysicalMaterial {...accentMaterial} />
                    </RoundedBox>
                    <Torus args={[0.3, 0.09, 12, 24]} position={[0, 0.5, 0]}>
                      <meshPhysicalMaterial metalness={1} roughness={0.2} color="#dddddd" />
                    </Torus>
                  </group>
                </group>
              )}

            </group>
          </a.group>
        </group>
      </group>
    </group>
  );
}
