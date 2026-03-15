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
  pos: THREE.Vector3;   // world position this frame
  vel: THREE.Vector3;   // current velocity
  isDragging: boolean;
  radius: number;       // collision sphere radius
}
const registry = new Map<string, CardPhysicsState>();

// Stagger idle phases across instances (module-level counter, not per-render)
let _instanceCounter = 0;

// Scratch vectors — allocated once, reused every frame (no GC pressure)
const _scratch1 = new THREE.Vector3();
const _scratch2 = new THREE.Vector3();
const _anchorPos = new THREE.Vector3();
const _hookPos = new THREE.Vector3();
const _hookLocalOffset = new THREE.Vector3();

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

  // Refs — zero React re-renders for physics values
  const groupRef = useRef<THREE.Group>(null);
  const localSpinRef = useRef<THREE.Group>(null);
  const poleRef = useRef<THREE.Group>(null);
  const elementDropRef = useRef<THREE.Group>(null);

  // Physics state held in refs
  const posRef = useRef(new THREE.Vector3(...position));
  const velRef = useRef(new THREE.Vector3());
  const rotVelRef = useRef(0);
  const idlePhaseRef = useRef((_instanceCounter++ % 10) * 10); // stagger, no Math.random

  // Drag state
  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef(new THREE.Vector3()); // cursor world pos at drag start minus element pos

  // Drop animation spring (isolated — doesn't touch physics)
  const [dropSpring, dropApi] = useSpring(() => ({
    yOffset: 0,
    config: { mass: 1, tension: 120, friction: 14 },
  }));
  const isDroppedRef = useRef(false);

  // Hover state for cursor
  const [hovered, setHovered] = useState(false);

  // Sliders from store
  const intensity = useStore((s) => s.intensity);
  const speed = useStore((s) => s.speed);
  const wind = useStore((s) => s.wind);
  const saturation = useStore((s) => s.saturation);
  const glare = useStore((s) => s.glare);

  // Register in the module-level registry
  useEffect(() => {
    registry.set(type, {
      pos: posRef.current,
      vel: velRef.current,
      isDragging: false,
      radius: type === 'safe' ? 1.6 : 1.4,
    });
    return () => { registry.delete(type); };
  }, [type]);

  // Cursor style
  useEffect(() => {
    document.body.style.cursor = hovered ? 'grab' : 'default';
    return () => { document.body.style.cursor = 'default'; };
  }, [hovered]);

  // ---------------------------------------------------------------------------
  // Project screen coords → world XY plane at element's Z depth
  // ---------------------------------------------------------------------------
  const screenToWorld = useCallback((x: number, y: number): THREE.Vector3 => {
    const rect = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector3(
      ((x - rect.left) / rect.width) * 2 - 1,
      -((y - rect.top) / rect.height) * 2 + 1,
      0.5,
    );
    ndc.unproject(camera);
    const dir = ndc.sub(camera.position).normalize();
    const t = (posRef.current.z - camera.position.z) / dir.z;
    return camera.position.clone().add(dir.multiplyScalar(t));
  }, [gl, camera]);

  // ---------------------------------------------------------------------------
  // Drag binding
  // ---------------------------------------------------------------------------
  const bind = useDrag(
    ({ xy: [x, y], first, last, velocity: [vx, vy], direction: [dx, dy], active }) => {
      if (isDroppedRef.current) return;

      if (first) {
        isDraggingRef.current = true;
        document.body.style.cursor = 'grabbing';
        const worldPos = screenToWorld(x, y);
        dragOffsetRef.current.copy(posRef.current).sub(worldPos);
        velRef.current.set(0, 0, 0);
      }

      if (active && !last) {
        // Track cursor exactly — zero spring involvement
        const worldPos = screenToWorld(x, y);
        posRef.current.copy(worldPos).add(dragOffsetRef.current);
        velRef.current.set(0, 0, 0);
      }

      if (last) {
        isDraggingRef.current = false;
        document.body.style.cursor = hovered ? 'grab' : 'default';
        // Inject inertia in world units (velocity is px/ms → scale to scene units)
        velRef.current.set(vx * dx * 0.15, -vy * dy * 0.15, 0);
      }

      // Keep registry in sync
      const state = registry.get(type);
      if (state) state.isDragging = isDraggingRef.current;
    },
    { pointer: { capture: true } },
  );

  // ---------------------------------------------------------------------------
  // Hook click — drop animation
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
  // Per-frame physics
  // ---------------------------------------------------------------------------
  useFrame((state, delta) => {
    if (!groupRef.current || !localSpinRef.current) return;

    const dt = Math.min(delta, 0.05); // cap at 50ms to avoid spiral on tab switch
    const time = (idlePhaseRef.current += dt);

    // --- Read store values (physics sliders only) ---
    const storeSpeed = speed;
    const storeWind = wind;

    // --- Rest position: base + wind push (wind alone, no intensity) ---
    // Wind scales naturally: 0=none, 0.5=light, 1=noticeable, 2+=strong
    const windPush = storeWind * 2.5;

    // Idle sway: a fixed organic constant — not slider-driven
    const idleSway = Math.sin(time * 0.45) * 0.07;
    _scratch1.set(position[0] + windPush + idleSway, position[1], position[2]);

    if (!isDraggingRef.current && !isDroppedRef.current) {
      // Spring force toward rest position
      const spring = 4.5;
      const damping = 3.8;

      _scratch2.copy(_scratch1).sub(posRef.current); // displacement
      velRef.current.addScaledVector(_scratch2, spring * dt);
      velRef.current.multiplyScalar(1 - damping * dt);
      posRef.current.addScaledVector(velRef.current, dt);
    }

    // --- Elastic collision with other card ---
    const otherType = type === 'safe' ? 'globe' : 'safe';
    const self = registry.get(type);
    const other = registry.get(otherType);

    if (self && other) {
      self.pos.copy(posRef.current);
      self.isDragging = isDraggingRef.current;

      const dist = posRef.current.distanceTo(other.pos);
      const minDist = self.radius + other.radius;

      if (dist < minDist && dist > 0.001) {
        const overlap = minDist - dist;
        _scratch2.copy(other.pos).sub(posRef.current).normalize();

        // Relative velocity
        const relVelAlongNormal = velRef.current.dot(_scratch2) - other.vel.dot(_scratch2);

        // Only resolve if approaching
        if (relVelAlongNormal < 0) {
          const restitution = 0.75; // elasticity
          const impulse = -(1 + restitution) * relVelAlongNormal * 0.5;

          // Apply impulse to self (push away from other)
          velRef.current.addScaledVector(_scratch2, -impulse);

          // Apply impulse to other (push away from self) — only if not dragging
          if (!other.isDragging) {
            other.vel.addScaledVector(_scratch2, impulse);
          }
        }

        // Positional correction to prevent overlap
        if (!isDraggingRef.current) {
          posRef.current.addScaledVector(_scratch2, -overlap * 0.4);
        }
      }
    }

    // --- Apply position to group ---
    groupRef.current.position.copy(posRef.current);

    // Tilt: driven purely by velocity and wind (no intensity multiplier)
    // Wind tilt: elements lean right proportional to wind strength
    const windTilt = storeWind * 0.07;
    groupRef.current.rotation.z = THREE.MathUtils.lerp(
      groupRef.current.rotation.z,
      -velRef.current.x * 0.12 - windTilt,
      dt * 6,
    );
    groupRef.current.rotation.x = THREE.MathUtils.lerp(
      groupRef.current.rotation.x,
      velRef.current.y * 0.08,
      dt * 6,
    );

    // --- Spin / idle rotation (speed-controlled only) ---
    if (hovered) {
      rotVelRef.current += storeSpeed * 0.1 * dt;
    } else {
      rotVelRef.current += storeSpeed * 0.08 * dt;
    }
    rotVelRef.current *= 0.96;
    localSpinRef.current.rotation.y += rotVelRef.current;

    // --- Pole stretch ---
    if (poleRef.current) {
      _anchorPos.set(position[0], position[1] + 12, position[2]);
      groupRef.current.getWorldPosition(_hookPos);
      // Offset to hook top
      _hookLocalOffset.set(-0.08, 1.65 + 0.6, 0);
      _hookLocalOffset.applyQuaternion(groupRef.current.quaternion);
      _hookPos.add(_hookLocalOffset);

      const midpoint = _anchorPos.clone().lerp(_hookPos, 0.5);
      poleRef.current.position.copy(midpoint);
      poleRef.current.lookAt(_hookPos);

      const poleDist = _anchorPos.distanceTo(_hookPos);
      poleRef.current.scale.set(1, 1, poleDist);
    }
  });

  // ---------------------------------------------------------------------------
  // Materials — intensity drives visuals ONLY
  // ---------------------------------------------------------------------------
  const materialProps = useMemo(() => {
    // intensity → iridescence strength, clearcoat, and color vibrancy
    const iridescenceStrength = THREE.MathUtils.clamp(intensity, 0, 1);
    const clearcoatStrength = THREE.MathUtils.clamp(glare + intensity * 0.5, 0, 5);
    const iridMin = 80 + intensity * 220;   // 80–300
    const iridMax = 250 + intensity * 550;  // 250–800

    return {
      metalness: 0.85 + intensity * 0.12,
      roughness: Math.max(0.02, 0.18 - intensity * 0.12),
      clearcoat: clearcoatStrength,
      clearcoatRoughness: Math.max(0.01, 0.1 - intensity * 0.07),
      iridescence: iridescenceStrength,
      iridescenceIOR: 1.4 + intensity * 0.4,
      iridescenceThicknessRange: [iridMin, iridMax] as [number, number],
      // saturation controls hue richness; intensity boosts lightness toward vivid
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

  // Hook geometry
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

  // ---------------------------------------------------------------------------
  // Eyelet — shared between safe and globe
  // ---------------------------------------------------------------------------
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
  // JSX
  // ---------------------------------------------------------------------------
  return (
    <group>
      {/* Fixed top anchor ring */}
      <mesh position={[position[0], position[1] + 12, position[2]]}>
        <Torus args={[0.2, 0.05, 16, 32]} rotation={[Math.PI / 2, 0, 0]}>
          <meshPhysicalMaterial {...accentMaterial} />
        </Torus>
      </mesh>

      {/* Stretching gold pole */}
      <group ref={poleRef}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.022, 0.022, 1, 16]} />
          <meshPhysicalMaterial {...accentMaterial} />
        </mesh>
      </group>

      {/* Physics body — moves with posRef each frame */}
      <group ref={groupRef} {...(bind() as object)}>
        {/* Gold J-Hook (click to drop) */}
        <group
          position={[-0.08, 1.65, 0]}
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
                {/* Safe body */}
                <RoundedBox args={[2.5, 2.5, 2.5]} radius={0.2} smoothness={4}>
                  <meshPhysicalMaterial {...materialProps} />
                </RoundedBox>
                {/* Safe dial face */}
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
                {/* Globe sphere */}
                <Sphere args={[1, 32, 32]}>
                  <meshPhysicalMaterial {...materialProps} transmission={0.15} roughness={0.4} />
                </Sphere>
                {/* Cage rings */}
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
  );
}
