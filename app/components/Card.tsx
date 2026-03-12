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
    config: { mass: 2, tension: 170, friction: 32 },
  }));

  const [dropSpring, dropApi] = useSpring(() => ({
      yDropOffset: 0,
      config: { mass: 1, tension: 200, friction: 15 }
  }));

  const bind = useDrag(({ movement: [x, y], active }) => {
    if (dropped) return;
    
    const mappedX = x / 40;
    const mappedY = -y / 40;
    
    if (active) {
      api.start({ position: [position[0] + mappedX, position[1] + mappedY, position[2]] });
    } else {
      api.start({ position: position });
    }
  });

  const handleHookClick = () => {
    if (dropped) return;
    setDropped(true);
    
    // Drop logic: Only the element drops down. The hook/chain remains where it is.
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

    // Procedural Dynamic Chain Math
    if (chainLinkRef.current) {
        // Top static anchor
        const anchorPos = new THREE.Vector3(position[0], position[1] + 12, position[2]);
        
        // Bottom hook derived from the swaying parent elementWorldRef
        const hookPos = new THREE.Vector3();
        elementWorldRef.current.getWorldPosition(hookPos);
        // Track precisely to the top of the newly shortened hook shape (Y=0.6) inside its group offset (Y=1.15)
        const localHookOffset = new THREE.Vector3(-0.05, 1.15 + 0.6, 0).applyQuaternion(elementWorldRef.current.quaternion);
        hookPos.add(localHookOffset);
        
        chainLinkRef.current.position.copy(anchorPos).lerp(hookPos, 0.5);
        chainLinkRef.current.lookAt(hookPos);
        
        const dist = anchorPos.distanceTo(hookPos);
        // Scale ONLY Z to fit distance without destroying link thickness proportion
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
         color: new THREE.Color('#ffb000'), 
         metalness: 1,
         roughness: 0.15
     }
  }, [materialProps]);
  
  const silverMaterial = useMemo(() => {
     return {
         ...materialProps,
         color: new THREE.Color('#dddddd'),
         metalness: 1,
         roughness: 0.2
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
      {/* Static Top Anchor Ring */}
      <mesh position={[position[0], position[1] + 12, position[2]]}>
          <Torus args={[0.2, 0.05, 16, 32]} rotation={[Math.PI / 2, 0, 0]}>
              <meshPhysicalMaterial {...silverMaterial} />
          </Torus>
      </mesh>

      {/* Dynamic Stretched Silver PoleAssembly */}
      {/* We use a simple Cylinder stretching along Z. Since lookAt points local -Z at the target, we must position the cylinder offset relative to Z to span 0 to -1. But the simplest way is to orient the cylinder geometry along Z axis naturally (by passing `rotation={[Math.PI/2, 0, 0]}` to the mesh, and translating it by Z = -0.5 so it spans the pivot). */}
      <group ref={chainLinkRef}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
             {/* scale is (1, distance, 1) when parent scale.set(1, 1, dist) is applied, but wait.. the parent scales Z.
                 So we just use a box or a cylinder that has height 1 and sits on Z. */}
             <cylinderGeometry args={[0.02, 0.02, 1, 16]} />
             <meshPhysicalMaterial {...silverMaterial} />
          </mesh>
      </group>

      
      {/* Hook and Element Physics Container */}
      {/* This holds the hook + element and takes the drag interactions */}
      <a.group 
        {...bind() as any}
        ref={elementWorldRef}
      >
        {/* Golden Hook attached specifically to the interactive drag body */}
        <group position={[-0.05, 1.15, 0]} onClick={(e) => { e.stopPropagation(); handleHookClick(); }}>
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
              {/* Element Top Eyelet Ring (so the hook clips into something physical) */}
              <group position={[0, 0.95, 0]}>
                 <Torus args={[0.15, 0.03, 16, 32]} rotation={[Math.PI / 2, 0, 0]}>
                    <meshPhysicalMaterial {...accentMaterial} />
                 </Torus>
              </group>

              {type === "safe" && (
                <group position={[0, -0.5, 0]}>
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
                 <group position={[0, -0.5, 0]}>
                    <Sphere args={[1, 32, 32]}>
                        <meshPhysicalMaterial {...materialProps} color="#fff" transmission={0.2} roughness={0.5} />
                    </Sphere>
                    {[0, Math.PI/4, Math.PI/2, Math.PI*0.75].map((angle, i) => (
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
                        <Torus args={[0.3, 0.1, 16, 32]} position={[0, 0.5, 0]} rotation={[0, 0, 0]}>
                            <meshPhysicalMaterial {...silverMaterial} />
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
