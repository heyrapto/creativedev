"use client";

import { useRef, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useStore } from '../store';
import { Text, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { useDrag } from '@use-gesture/react';
import { useSpring, a } from '@react-spring/three';

export function Card({ position = [0, 0, 0], rotation = [0, 0, 0] }: { position?: [number, number, number], rotation?: [number, number, number] }) {
  const groupRef = useRef<THREE.Group>(null);

  const intensity = useStore((s) => s.intensity);
  const speed = useStore((s) => s.speed);
  const wind = useStore((s) => s.wind);
  const saturation = useStore((s) => s.saturation);
  const glare = useStore((s) => s.glare);
  const holoThickness = useStore((s) => s.holoThickness);

  const [hovered, setHovered] = useState(false);
  const [targetRotationY, setTargetRotationY] = useState(rotation[1]);

  const [springs, api] = useSpring(() => ({
    position: position,
    rotation: rotation,
    config: { mass: 1, tension: 170, friction: 26 },
  }));

  const bind = useDrag(({ offset: [x, y], active }) => {
    // Basic mapping from screen pixels to 3D space
    const mappedX = x / 50;
    const mappedY = -y / 50;

    if (active) {
      api.start({ position: [position[0] + mappedX, position[1] + mappedY, position[2]] });
    } else {
      // Snap back or stay? The reference says "drag it anywhere in the screen", so we let it stay where dragged,
      // but if we want it to swing from that new position, we let it stay.
      // For simplicity, let's it just stay. (We don't reset position).
    }
  });

  useFrame((state, delta) => {
    if (!groupRef.current) return;

    // Smooth hover rotation (360 degrees when hovered)
    if (hovered) {
      setTargetRotationY(rotation[1] + Math.PI * 2);
      // To keep it spinning or just rotate once? 
      // "rotates 360" usually means it completes a full spin. Let's just linearly interpolate towards a target.
    } else {
      setTargetRotationY(rotation[1]);
    }

    // Swinging effect based on wind and speed
    const time = state.clock.elapsedTime;
    const swayX = Math.sin(time * speed) * wind * intensity;
    const swayZ = Math.cos(time * speed * 0.8) * wind * intensity;

    // Apply swing
    groupRef.current.rotation.z = swayX;
    groupRef.current.rotation.x = swayZ;

    // Apply target y rotation
    groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, targetRotationY, delta * 2);
  });

  // Material properties
  const materialProps = useMemo(() => {
    return {
      transmission: 0.9,     // glass-like
      opacity: 1,
      metalness: 0,
      roughness: 0.1,
      ior: 1.5,
      thickness: holoThickness,
      clearcoat: glare,
      clearcoatRoughness: 0.1,
      iridescence: 1,
      iridescenceIOR: 1.3,
      iridescenceThicknessRange: [100, 400] as [number, number],
      color: new THREE.Color().setHSL(0, 0, 1 - saturation * 0.5),
    };
  }, [holoThickness, glare, saturation]);

  return (
    <a.group
      {...springs}
      {...bind() as any}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
      ref={groupRef}
    >
      {/* Lanyard Line */}
      <mesh position={[0, 11.9, 0]}>
        <boxGeometry args={[0.15, 20, 0.05]} />
        <meshStandardMaterial color="#111" />
        <Text
          position={[0, -7.5, 0.03]}
          rotation={[0, 0, -Math.PI / 2]}
          fontSize={0.12}
          color="white"
          anchorX="center"
          anchorY="middle"
          letterSpacing={0.1}
        >
          CREATIVE CLUB CREATIVE
        </Text>
      </mesh>

      {/* Card Body */}
      <RoundedBox args={[2.2, 3.8, 0.1]} radius={0.05} smoothness={4} position={[0, 0, 0]}>
        <meshPhysicalMaterial {...materialProps} />

        {/* Texts */}
        <group position={[0, 0, 0.06]}>
          <Text
            position={[0, 0.4, 0]}
            fontSize={0.35}
            color="white"
            maxWidth={2}
            textAlign="center"
            anchorX="center"
            anchorY="middle"
          >
            Creative{'\n'}Club
          </Text>
          <Text
            position={[-0.9, -1.3, 0]}
            fontSize={0.08}
            color="white"
            anchorX="left"
            anchorY="top"
          >
            YAROSLAV{'\n'}SAMOYLOV{'\n'}DESIGNER{'\n'}PORTLAND, OR, U.S.
          </Text>
        </group>
      </RoundedBox>
    </a.group>
  );
}
