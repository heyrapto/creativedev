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
  worldX: number;   // element's world X this frame (for collision)
  velX: number;     // linear X velocity (scene units/s)
  isDragging: boolean;
  radius: number;
  applyImpulse: (vxImpulse: number) => void;
}
const registry = new Map<string, CardPhysicsState>();

// Counter for staggering idle phases (no Math.random in render)
let _instanceCounter = 0;

// Pre-allocated scratch vectors — zero GC pressure in useFrame
const _anchorWorld = new THREE.Vector3();
const _hookWorld   = new THREE.Vector3();

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
  const elementGroupRef = useRef<THREE.Group>(null); // world-space: hook + element
  const poleRef         = useRef<THREE.Mesh>(null);  // world-space cylinder (stretches)
  const localSpinRef    = useRef<THREE.Group>(null);
  const elementDropRef  = useRef<THREE.Group>(null);

  // ---- World-space spring physics (XY, stored as plain numbers for zero GC) ----
  // Natural hang rest position
  const REST_X  = position[0];
  const REST_Y  = position[1];
  const ANCHOR_Y = position[1] + 12;

  const elemXRef = useRef(REST_X);
  const elemYRef = useRef(REST_Y);
  const velXRef  = useRef(0);
  const velYRef  = useRef(0);
  const rotVelRef = useRef(0);
  const idlePhaseRef = useRef((_instanceCounter++ % 10) * 10);

  // ---- Drag state ----
  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  // ---- Drop spring (isolated from main physics) ----
  const [dropSpring, dropApi] = useSpring(() => ({
    yOffset: 0,
    config: { mass: 1, tension: 120, friction: 14 },
  }));
  const isDroppedRef = useRef(false);

  // ---- Hover ----
  const [hovered, setHovered] = useState(false);

  // ---- Store ----
  const intensity  = useStore((s) => s.intensity);
  const speed      = useStore((s) => s.speed);
  const wind       = useStore((s) => s.wind);
  const saturation = useStore((s) => s.saturation);
  const glare      = useStore((s) => s.glare);

  // ---- Registry ----
  useEffect(() => {
    const entry: CardPhysicsState = {
      worldX: REST_X,
      velX: 0,
      isDragging: false,
      radius: type === 'safe' ? 1.6 : 1.4,
      applyImpulse: (imp) => { velXRef.current += imp; },
    };
    registry.set(type, entry);
    return () => { registry.delete(type); };
  }, [type, REST_X]);

  // ---- Cursor ----
  useEffect(() => {
    document.body.style.cursor = hovered ? 'grab' : 'default';
    return () => { document.body.style.cursor = 'default'; };
  }, [hovered]);

  // ---------------------------------------------------------------------------
  // Convert clientXY → world XY (projects onto the Z=0 plane)
  // ---------------------------------------------------------------------------
  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const rect = gl.domElement.getBoundingClientRect();
    const ndcX =  ((clientX - rect.left) / rect.width)  * 2 - 1;
    const ndcY = -((clientY - rect.top)  / rect.height) * 2 + 1;
    const v = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera);
    const dir = v.sub(camera.position).normalize();
    const t = -camera.position.z / dir.z;
    return {
      x: camera.position.x + dir.x * t,
      y: camera.position.y + dir.y * t,
    };
  }, [gl, camera]);

  // ---------------------------------------------------------------------------
  // Drag — moves element freely in world XY; releases inject velocity
  // ---------------------------------------------------------------------------
  const bind = useDrag(
    ({ xy: [cx, cy], first, last, velocity: [vx, vy], direction: [dx, dy] }) => {
      if (isDroppedRef.current) return;

      if (first) {
        isDraggingRef.current = true;
        document.body.style.cursor = 'grabbing';
        velXRef.current = 0;
        velYRef.current = 0;

        // Calculate initial grab offset in world space
        const w = screenToWorld(cx, cy);
        dragOffsetRef.current = {
          x: w.x - elemXRef.current,
          y: w.y - elemYRef.current
        };
      }

      if (!last) {
        const w = screenToWorld(cx, cy);
        elemXRef.current = w.x - dragOffsetRef.current.x;
        elemYRef.current = w.y - dragOffsetRef.current.y;
      }

      if (last) {
        isDraggingRef.current = false;
        document.body.style.cursor = hovered ? 'grab' : 'default';
        // Inject swipe velocity (scale px/ms → scene units/s)
        const W = gl.domElement.clientWidth;
        const H = gl.domElement.clientHeight;
        velXRef.current  =  (vx * dx * 60) / W;
        velYRef.current  = -(vy * dy * 60) / H;
      }

      const entry = registry.get(type);
      if (entry) {
        entry.isDragging = isDraggingRef.current;
        entry.worldX     = elemXRef.current;
      }
    },
    { pointer: { capture: true } },
  );

  // ---------------------------------------------------------------------------
  // Hook click — drop element
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
  // useFrame — spring physics + pole stretch
  // ---------------------------------------------------------------------------
  useFrame((_state, delta) => {
    if (!elementGroupRef.current || !localSpinRef.current || !poleRef.current) return;

    const dt   = Math.min(delta, 0.05);
    const time = (idlePhaseRef.current += dt);

    // ---- 1. Spring physics (skip while dragging / dropped) ----
    if (!isDraggingRef.current && !isDroppedRef.current) {
      const turbulence = 1
        + Math.sin(time * 0.55) * 0.2
        + Math.sin(time * 1.35) * 0.09;

      // Restore wind functionality using intensity and speed from store
      const windForce = wind * intensity * turbulence * 8; // scaled for XY spring

      // Spring restoring force toward natural hang position
      const SPRING_K = 18;
      const DAMPING  = 5;

      const forceX = SPRING_K * (REST_X - elemXRef.current) + windForce - DAMPING * velXRef.current;
      const forceY = SPRING_K * (REST_Y - elemYRef.current)              - DAMPING * velYRef.current;

      velXRef.current += forceX * dt;
      velYRef.current += forceY * dt;
      elemXRef.current += velXRef.current * dt;
      elemYRef.current += velYRef.current * dt;
    }

    // ---- 2. Elastic collision with other card ----
    const otherType = type === 'safe' ? 'globe' : 'safe';
    const self  = registry.get(type);
    const other = registry.get(otherType);

    if (self && other) {
      self.worldX     = elemXRef.current;
      self.velX       = velXRef.current;
      self.isDragging = isDraggingRef.current;

      const diffX   = elemXRef.current - other.worldX;
      const dist    = Math.abs(diffX);
      const minDist = self.radius + other.radius;

      if (dist < minDist && dist > 0.001) {
        // Position correction: Push elements apart so they don't enter each other
        const overlap = minDist - dist;
        const pushDir = Math.sign(diffX);
        
        // If I'm dragging, I'm the one pushing, but if both are free, split the push
        if (isDraggingRef.current) {
          // Dragging element "owns" the path; other element gets pushed
          if (!other.isDragging) {
             // In the registry, we don't have direct ref to other's elemXRef, 
             // but we'll use applyImpulse for velocity. 
             // For position correction we need to adjust our own position slightly 
             // to avoid clipping during drag.
             elemXRef.current += pushDir * (overlap * 0.1); 
          }
        } else if (!other.isDragging) {
           // Both are free - split the displacement
           elemXRef.current += pushDir * (overlap * 0.5);
           // We can't directly set other's position from here easily without a ref, 
           // but the other card's useFrame will handle its half of the push.
        }

        const relV  = velXRef.current - other.velX;
        if (relV * (-pushDir) > 0) {
          const restitution = 0.8;
          const J = -(1 + restitution) * relV * 0.5;
          velXRef.current += J;
          if (!other.isDragging) other.applyImpulse(-J);
        }
      }
    }

    // ---- 3. Position element group in world space ----
    elementGroupRef.current.position.set(elemXRef.current, elemYRef.current, position[2]);

    // ---- 4. Pole stretch — anchor (fixed) → hook tip (moving) ----
    _anchorWorld.set(position[0], ANCHOR_Y, position[2]);
    // Hook tip is at +1.65 on the element group's local Y (eyelet offset)
    _hookWorld.set(elemXRef.current, elemYRef.current + 1.65, position[2]);

    const poleDist = _anchorWorld.distanceTo(_hookWorld);

    // Midpoint
    poleRef.current.position.lerpVectors(_anchorWorld, _hookWorld, 0.5);

    // Orient: rotate default Y-axis to point from anchor → hook tip
    const dir = _hookWorld.clone().sub(_anchorWorld).normalize();
    poleRef.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

    // Scale
    poleRef.current.scale.set(1, poleDist, 1);

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
    const cc   = THREE.MathUtils.clamp(glare + intensity * 0.5, 0, 5);
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
      new THREE.Vector3(0,    0.6,   0),
      new THREE.Vector3(0,    0.1,   0),
      new THREE.Vector3(0,   -0.05,  0),
      new THREE.Vector3(0.08,-0.15,  0),
      new THREE.Vector3(0.15,-0.05,  0),
    ]);
    return { shape, curve };
  }, []);

  // Eyelet — gold ring + stem at top of each element
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
  //    <mesh>        anchor torus  — fixed world position
  //    <mesh ref={poleRef}>        — world-space pole, stretched each frame
  //    <group ref={elementGroupRef}> — world-space; positioned by physics each frame
  //      hook (local y +1.65)
  //      <a.group elementDropRef>
  //        <group localSpinRef>
  //          Safe / Globe mesh
  // ---------------------------------------------------------------------------
  return (
    <group>
      {/* Fixed top anchor ring */}
      <mesh position={[position[0], ANCHOR_Y, position[2]]}>
        <Torus args={[0.2, 0.05, 16, 32]} rotation={[Math.PI / 2, 0, 0]}>
          <meshPhysicalMaterial {...accentMaterial} />
        </Torus>
      </mesh>

      {/* World-space pole — stretches between anchor and hook tip */}
      <mesh ref={poleRef}>
        <cylinderGeometry args={[0.022, 0.022, 1, 16]} />
        <meshPhysicalMaterial {...accentMaterial} />
      </mesh>

      {/* Element group — hook + element, positioned by spring physics each frame */}
      <group ref={elementGroupRef} {...(bind() as object)}>

        {/* Gold J-Hook at eyelet offset */}
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
  );
}
