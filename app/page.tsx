import { Scene } from './components/Scene';
import { Overlays } from './components/Sliders';

export default function Home() {
  return (
    <main className="relative w-screen h-screen overflow-hidden bg-black text-white">
      <Scene />
      <Overlays />
    </main>
  );
}