"use client";

import { useRef, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useStore } from '../store';
import { RoundedBox, Cylinder, Sphere, Torus, Extrude } from '@react-three/drei';
import * as THREE from 'three';
import { useDrag } from '@use-gesture/react';
import { useSpring, a } from '@react-spring/three';

export function Card({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  type = "safe"
}: {
  position?: [number, number, number],
  rotation?: [number, number, number],
  type?: "safe" | "globe"
}) {
  const elementWorldRef = useRef<THREE.Group>(null);
  const elementDropRef = useRef<THREE.Group>(null);
  const localSpinRef = useRef<THREE.Group>(null);
  const chainLinkRef = useRef<THREE.Group>(null);

  const intensity = useStore((s) => s.intensity);
  const speed = useStore((s) => s.speed);
  const wind = useStore((s) => s.wind);
  const saturation = useStore((s) => s.saturation);
  const glare = useStore((s) => s.glare);

  const [hovered, setHovered] = useState(false);
  const [dropped, setDropped] = useState(false);

  const [targetRotationY, setTargetRotationY] = useState(rotation[1]);

  const [springs, api] = useSpring(() => ({
    position: position,
    rotation: rotation,
    config: { mass: 2, tension: 500, friction: 10 }, // Elastic bouncy base
  }));

  const [dropSpring, dropApi] = useSpring(() => ({
    yDropOffset: 0,
    config: { mass: 1, tension: 200, friction: 15 }
  }));

  const bind = useDrag(({ movement: [x, y], active, down }) => {
    if (dropped) return;

    const mappedX = x / 40;
    const mappedY = -y / 40;

    if (down || active) {
      // stiff and instantly responsive while dragging
      api.start({
        position: [position[0] + mappedX, position[1] + mappedY, position[2]],
        config: { mass: 1, tension: 1500, friction: 80 }
      });
    } else {
      // law of Elastic Collision: high tension, low friction for major bounce on release
      api.start({
        position: position,
        config: { mass: 2, tension: 500, friction: 10 }
      });
    }
  });

  const handleHookClick = () => {
    if (dropped) return;
    setDropped(true);

    // drop logic: Only the element drops down. The hook/chain remains where it is.
    dropApi.start({ yDropOffset: -15 });

    setTimeout(() => {
      // Teleport the element above the screen invisibly
      dropApi.start({ yDropOffset: 10, immediate: true });
      // Let it spring back into place
      setTimeout(() => {
        setDropped(false);
        dropApi.start({ yDropOffset: 0, immediate: false, config: { mass: 1, tension: 120, friction: 14 } });
      }, 50);
    }, 1000);
  };

  useFrame((state, delta) => {
    if (!elementWorldRef.current || !localSpinRef.current) return;

    const time = state.clock.elapsedTime;

    // Increased hover rotation speed
    if (hovered && !dropped) {
      setTargetRotationY(targetRotationY + delta * 2.5);
    } else if (!hovered && !dropped) {
      setTargetRotationY(rotation[1]);
    }

    const swayX = Math.sin(time * speed) * wind * intensity * 2;
    const swayZ = Math.cos(time * speed * 0.8) * wind * intensity;

    // The entire assembly (hook + chain end) is dragged/swayed
    elementWorldRef.current.position.x = springs.position.get()[0] + swayX;
    elementWorldRef.current.position.y = springs.position.get()[1];
    elementWorldRef.current.position.z = springs.position.get()[2] + swayZ;

    elementWorldRef.current.rotation.z = -swayX * 0.2;
    elementWorldRef.current.rotation.x = swayZ * 0.2;

    const targetQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), targetRotationY);
    localSpinRef.current.quaternion.slerp(targetQ, delta * 8);

    // Procedural Dynamic Pole Math
    if (chainLinkRef.current) {
      // Top static anchor
      const anchorPos = new THREE.Vector3(position[0], position[1] + 12, position[2]);

      // Bottom hook derived from the swaying parent elementWorldRef
      const hookPos = new THREE.Vector3();
      elementWorldRef.current.getWorldPosition(hookPos);

      // Track precisely to the top of the newly proportioned hook shape (Y=0.6) inside its group offset (Y=1.25)
      const localHookOffset = new THREE.Vector3(-0.08, 1.25 + 0.6, 0).applyQuaternion(elementWorldRef.current.quaternion);
      hookPos.add(localHookOffset);

      chainLinkRef.current.position.copy(anchorPos).lerp(hookPos, 0.5);
      chainLinkRef.current.lookAt(hookPos);

      const dist = anchorPos.distanceTo(hookPos);
      chainLinkRef.current.scale.set(1, 1, dist);
    }
  });

  const materialProps = useMemo(() => {
    return {
      metalness: 0.9,
      roughness: 0.1,
      clearcoat: glare,
      clearcoatRoughness: 0.1,
      iridescence: 1,
      iridescenceIOR: 1.5,
      iridescenceThicknessRange: [100, 400] as [number, number],
      color: new THREE.Color().setHSL(0, 0, 1 - saturation * 0.5),
    };
  }, [glare, saturation]);

  const accentMaterial = useMemo(() => {
    return {
      ...materialProps,
      color: new THREE.Color('#ffaa00'),
      metalness: 1,
      roughness: 0.15
    }
  }, [materialProps]);

  // Very thin sleek J Hook Geometry
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

  return (
    <group>
      {/* Static Top Anchor Ring - Now Gold */}
      <mesh position={[position[0], position[1] + 12, position[2]]}>
        <Torus args={[0.2, 0.05, 16, 32]} rotation={[Math.PI / 2, 0, 0]}>
          <meshPhysicalMaterial {...accentMaterial} />
        </Torus>
      </mesh>

      {/* Dynamic Stretched Gold Pole Assembly */}
      <group ref={chainLinkRef}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 1, 16]} />
          <meshPhysicalMaterial {...accentMaterial} />
        </mesh>
      </group>

      {/* Hook and Element Physics Container */}
      <a.group
        {...bind() as any}
        ref={elementWorldRef}
      >
        {/* Golden Hook explicitly offset so its inner lower arc X=0, Y=1.1, passing perfectly through a Y=1.1 centered Torus */}
        <group position={[-0.08, 1.25, 0]} onClick={(e) => { e.stopPropagation(); handleHookClick(); }}>
          <Extrude args={[hookShape.shape, { extrudePath: hookShape.curve, steps: 50, bevelEnabled: false }]}>
            <meshPhysicalMaterial {...accentMaterial} />
          </Extrude>
          <Sphere args={[0.015, 16, 16]} position={[0.15, -0.05, 0]}>
            <meshPhysicalMaterial {...accentMaterial} />
          </Sphere>
        </group>

        {/* Separated Element that can DROP independently */}
        <a.group
          ref={elementDropRef}
          position-y={dropSpring.yDropOffset}
        >
          <group
            onPointerOver={() => setHovered(true)}
            onPointerOut={() => setHovered(false)}
            ref={localSpinRef}
            position={[0, 0, 0]}
          >
            {type === "safe" && (
              <group position={[0, -0.25, 0]}>
                {/* Centered Eyelet embedded seamlessly at physical bounds (Safe is radius 1.25 + center -0.25 = 1.0) */}
                <group position={[0, 1.15, 0]}>
                  <Cylinder args={[0.06, 0.06, 0.1, 16]} position={[0, -0.1, 0]}>
                    <meshPhysicalMaterial {...accentMaterial} />
                  </Cylinder>
                  <Torus args={[0.08, 0.02, 16, 32]} position={[0, -0.05, 0]} rotation={[0, Math.PI / 2, 0]}>
                    <meshPhysicalMaterial {...accentMaterial} />
                  </Torus>
                </group>

                <RoundedBox args={[2.5, 2.5, 2.5]} radius={0.2} smoothness={4}>
                  <meshPhysicalMaterial {...materialProps} color="#4b8cde" />
                </RoundedBox>
                <group position={[0, 0, 1.3]}>
                  <Cylinder args={[0.8, 0.8, 0.1, 32]} rotation={[Math.PI / 2, 0, 0]}>
                    <meshPhysicalMaterial {...materialProps} color="#111" />
                  </Cylinder>
                  <group>
                    <Torus args={[0.5, 0.05, 16, 32]} rotation={[0, 0, 0]}>
                      <meshPhysicalMaterial {...accentMaterial} />
                    </Torus>
                    <Cylinder args={[0.05, 0.05, 1, 16]} rotation={[0, 0, Math.PI / 4]}>
                      <meshPhysicalMaterial {...accentMaterial} />
                    </Cylinder>
                    <Cylinder args={[0.05, 0.05, 1, 16]} rotation={[0, 0, -Math.PI / 4]}>
                      <meshPhysicalMaterial {...accentMaterial} />
                    </Cylinder>
                    <Cylinder args={[0.1, 0.1, 0.2, 16]} rotation={[Math.PI / 2, 0, 0]}>
                      <meshPhysicalMaterial {...accentMaterial} />
                    </Cylinder>
                  </group>
                </group>
                <group position={[-1.2, -0.8, 1.5]} scale={0.7}>
                  <RoundedBox args={[1.5, 1.5, 0.2]} radius={0.1} smoothness={2} rotation={[0, 0, Math.PI / 4]}>
                    <meshPhysicalMaterial {...accentMaterial} color="#90ee90" />
                  </RoundedBox>
                </group>
              </group>
            )}

            {type === "globe" && (
              <group position={[0, 0.0, 0]}>
                <group position={[0, 1.15, 0]}>
                  <Cylinder args={[0.06, 0.06, 0.1, 16]} position={[0, -0.1, 0]}>
                    <meshPhysicalMaterial {...accentMaterial} />
                  </Cylinder>
                  <Torus args={[0.08, 0.02, 16, 32]} position={[0, -0.05, 0]} rotation={[0, Math.PI / 2, 0]}>
                    <meshPhysicalMaterial {...accentMaterial} />
                  </Torus>
                </group>

                <Sphere args={[1, 32, 32]}>
                  <meshPhysicalMaterial {...materialProps} color="#fff" transmission={0.2} roughness={0.5} />
                </Sphere>
                {[0, Math.PI / 4, Math.PI / 2, Math.PI * 0.75].map((angle, i) => (
                  <Torus key={i} args={[1.3, 0.08, 16, 64]} rotation={[0, angle, 0]}>
                    <meshPhysicalMaterial {...materialProps} color="#8a2be2" />
                  </Torus>
                ))}
                <Torus args={[1.3, 0.08, 16, 64]} rotation={[Math.PI / 2, 0, 0]}>
                  <meshPhysicalMaterial {...materialProps} color="#8a2be2" />
                </Torus>
                <Torus args={[1.3, 0.08, 16, 64]} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.8, 0]} scale={0.8}>
                  <meshPhysicalMaterial {...materialProps} color="#8a2be2" />
                </Torus>
                <group position={[1, -1, 1.3]} scale={0.8}>
                  <RoundedBox args={[1, 0.8, 0.4]} radius={0.1} smoothness={2}>
                    <meshPhysicalMaterial {...accentMaterial} color="#e5a03e" />
                  </RoundedBox>
                  {/* Shackle remains silver to distinguish it */}
                  <Torus args={[0.3, 0.1, 16, 32]} position={[0, 0.5, 0]} rotation={[0, 0, 0]}>
                    <meshPhysicalMaterial {...materialProps} color="#dddddd" metalness={1} roughness={0.2} />
                  </Torus>
                </group>
              </group>
            )}

          </group>
        </a.group>
      </a.group>
    </group>
  );
}
