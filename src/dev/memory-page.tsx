// Development page: /?dev=memory — how much texture memory this phone gives one page before it fails.
// Allocates 16 MB RGBA8 textures one by one (with data, so they are really committed) and remembers the
// progress in localStorage: if iOS kills the page, reopening it shows where it stopped.
import { useEffect, useState } from 'preact/hooks';
import { createContext } from '../render/gl';
import { devStrings } from '../ui/strings';

const KEY = 'binder.memoryTest';
const SIDE = 2048; // 2048² · 4 = 16 MB
const STEP_MB = 16;
const MAX_MB = 4096;

interface Record {
  running: boolean;
  mb: number;
  reason?: string;
}

function readRecord(): Record | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record) : null;
  } catch {
    return null;
  }
}

function writeRecord(record: Record): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // not remembered
  }
}

export function MemoryPage() {
  const [previous] = useState(readRecord);
  const [status, setStatus] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    // a record still marked "running" means the page was killed during the previous run
    if (previous?.running) writeRecord({ ...previous, running: false, reason: 'page killed' });
  }, [previous]);

  const start = async () => {
    setRunning(true);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const gl = createContext(canvas);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
    });
    const zeros = new Uint8Array(SIDE * SIDE * 4);
    const textures: WebGLTexture[] = [];
    let mb = 0;
    let reason = `${MAX_MB} MB`;
    writeRecord({ running: true, mb });
    while (mb < MAX_MB) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, SIDE, SIDE);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SIDE, SIDE, gl.RGBA, gl.UNSIGNED_BYTE, zeros);
      gl.finish();
      const error = gl.getError();
      if (gl.isContextLost()) {
        reason = 'contesto GPU perso';
        break;
      }
      if (error === gl.OUT_OF_MEMORY) {
        reason = 'OUT_OF_MEMORY';
        break;
      }
      textures.push(texture);
      mb += STEP_MB;
      writeRecord({ running: true, mb });
      setStatus(devStrings.memoryRunning(mb));
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    writeRecord({ running: false, mb, reason });
    setStatus(devStrings.memoryStopped(mb, reason));
    textures.forEach((t) => {
      gl.deleteTexture(t);
    });
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    setRunning(false);
  };

  return (
    <main class="dev-text">
      <h1>{devStrings.memoryTitle}</h1>
      <p>
        {previous?.running
          ? devStrings.memoryLastRun(previous.mb)
          : previous
            ? devStrings.memoryStopped(previous.mb, previous.reason ?? '')
            : devStrings.memoryNoLastRun}
      </p>
      <p>
        <button type="button" disabled={running} onClick={() => void start()}>
          {devStrings.memoryStart}
        </button>
      </p>
      {status && <p data-testid="memory-status">{status}</p>}
    </main>
  );
}
