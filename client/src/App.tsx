import { useEffect, useRef, useState } from 'react';
import { World } from './game/world.ts';
import type { CameraMode } from './game/world.ts';
import { setWorld } from './stage.ts';
import { Landing } from './ui/Landing.tsx';
import { Race } from './ui/Race.tsx';

const roomFrom = (path: string) => path.match(/^\/r\/([a-z0-9-]{1,48})\/?$/)?.[1] ?? null;

function webglAvailable() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

export function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [path, setPath] = useState(location.pathname);
  const [cameraMode, setCameraMode] = useState<CameraMode>('drone');
  const [supported] = useState(webglAvailable);

  useEffect(() => {
    if (!supported) return;
    const w = new World({
      canvas: canvas.current!,
      labels: labels.current!,
      onCameraMode: setCameraMode,
      onSelect: (id) => w.setMode(w.mode === 'drone' ? 'follow' : w.mode, id),
    });
    setWorld(w);
    if (import.meta.env.DEV) (window as unknown as { kart: World }).kart = w;
    setReady(true);
    return () => {
      setWorld(null);
      w.dispose();
    };
  }, [supported]);

  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = (next: string) => {
    history.pushState(null, '', next);
    setPath(next);
  };

  const room = roomFrom(path);

  if (!supported) {
    return (
      <main className="center-note">
        <h1>42 Kart needs WebGL</h1>
        <p>This browser cannot draw the track. Try a recent Chrome, Firefox or Safari.</p>
      </main>
    );
  }

  return (
    <>
      <canvas ref={canvas} className="stage" />
      <div ref={labels} className="labels" />
      {ready && (room ? <Race key={room} code={room} go={go} cameraMode={cameraMode} /> : <Landing go={go} />)}
    </>
  );
}
