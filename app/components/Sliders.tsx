"use client";

import { useStore } from '../store';
import React, { useRef, useState, useEffect } from 'react';

const CustomSlider = ({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (val: number) => void;
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    updateValue(e.clientX);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isDragging) {
      updateValue(e.clientX);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const updateValue = (clientX: number) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    let percentage = (clientX - rect.left) / rect.width;
    percentage = Math.max(0, Math.min(1, percentage));

    // Calculate raw value
    let newValue = min + percentage * (max - min);
    // Snap to step
    newValue = Math.round(newValue / step) * step;

    onChange(newValue);
  };

  const fillPercentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="flex flex-col border border-white/20 rounded-xl p-3 bg-black/40 backdrop-blur min-w-[150px] font-mono select-none">
      <div className="flex items-center justify-between mb-2">
        <span className="text-white text-xs">{label}</span>
      </div>
      <div
        ref={trackRef}
        className="w-full h-1 bg-white/20 rounded-full relative cursor-pointer"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-300"
          style={{ width: `${fillPercentage}%`, pointerEvents: 'none' }}
        />
        <div
          className="absolute top-1/2 w-3 h-3 bg-white rounded-full shadow-[0_0_5px_rgba(255,255,255,0.8)] -translate-y-1/2 -ml-1.5 cursor-grab active:cursor-grabbing"
          style={{ left: `${fillPercentage}%` }}
        />
      </div>
      <div className="mt-2 text-[10px] text-white/70">
        {value.toFixed(2)}
      </div>
    </div>
  );
};

export const Overlays = () => {
  const { intensity, speed, wind, saturation, glare, holoThickness, setControls } = useStore();

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between overflow-hidden z-20 font-mono">
      {/* Top Header */}
      <div className="w-full flex justify-between p-6 xs:p-10 pointer-events-auto">
        <div className="text-white/80 text-xs md:text-sm tracking-[0.2em]">
          CUT THE STRIPE
        </div>
        <div className="text-white/80 text-[10px] md:text-xs text-right leading-relaxed flex flex-col gap-1 tracking-widest uppercase">
          <div>KANO, NG</div>
          <div>CAMBRILS, ES</div>
          <div>PRESIDENTE PRUDENTE, BR</div>
        </div>
      </div>

      {/* Bottom Controls */}
      <div className="w-full overflow-x-auto pointer-events-auto">
        <div className="flex items-center gap-4 w-max mx-auto md:mx-0 md:w-full md:justify-center">
          <CustomSlider label="Intensity" value={intensity} min={0} max={1} onChange={(v) => setControls({ intensity: v })} />
          <CustomSlider label="Speed" value={speed} min={0} max={5} onChange={(v) => setControls({ speed: v })} />
          <CustomSlider label="Wind" value={wind} min={0} max={1} onChange={(v) => setControls({ wind: v })} />
          <CustomSlider label="Saturation" value={saturation} min={0} max={1} onChange={(v) => setControls({ saturation: v })} />
          <CustomSlider label="Glare" value={glare} min={0} max={5} onChange={(v) => setControls({ glare: v })} />
          <CustomSlider label="Holo Thickness" value={holoThickness} min={0} max={5} onChange={(v) => setControls({ holoThickness: v })} />
        </div>
      </div>
    </div>
  );
};
