"use client";

import { Canvas } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { Card } from './Card';

export function Scene() {
  return (
    <div className="absolute inset-0 z-10">
      <Canvas camera={{ position: [0, 0, 10], fov: 45 }}>
        <color attach="background" args={['#050505']} />

        <ambientLight intensity={0.5} />
        <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} intensity={1} />

        <Environment resolution={256} preset="city">
          <group rotation={[-Math.PI / 2, 0, 0]}>
            <Lightformer form="rect" intensity={4} position={[-5, 5, -5]} scale={[10, 5, 1]} target={[0, 0, 0]} />
            <Lightformer form="rect" intensity={4} position={[5, 5, -5]} scale={[10, 5, 1]} target={[0, 0, 0]} />
          </group>
        </Environment>

        {/* Render two 3D elements */}
        {/* Left 'Safe' facing front-ish */}
        <Card position={[-3.0, 0, 0]} rotation={[0, 0.2, 0]} type="safe" />
        {/* Right 'Globe' sideways */}
        <Card position={[3.0, 0, 0]} rotation={[0, Math.PI / 2.2, 0]} type="globe" />
      </Canvas>
    </div>
  );
}
