"use client";

import { useStore } from '../store';
import React, { useRef, useState } from 'react';

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

    let newValue = min + percentage * (max - min);
    newValue = Math.round(newValue / step) * step;
    onChange(newValue);
  };

  const fillPercentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="flex flex-col border border-gray-600 rounded-[14px] p-4 bg-[#050505] min-w-[200px] font-mono select-none">
      <span className="text-[#e0e0e0] text-[11px] mb-3">{label}</span>

      <div
        ref={trackRef}
        className="w-full h-1.5 rounded-full relative cursor-pointer flex items-center bg-gradient-to-r from-[#4b8cde] via-[#a855f7] to-[#00e5ff]"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Thumb */}
        <div
          className="absolute w-[18px] h-[18px] bg-white rounded-full -translate-x-1/2 cursor-grab active:cursor-grabbing border-[4px] border-[#222]"
          style={{ left: `${fillPercentage}%` }}
        />
      </div>

      <div className="mt-3 text-[11px] text-[#e0e0e0]">
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
