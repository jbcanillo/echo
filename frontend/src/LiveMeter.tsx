import { useEffect, useRef } from 'react';

const BARS = 56;

/** Scrolling level bars drawn from the microphone while recording */
export function LiveMeter({ stream }: { stream: MediaStream }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const g = canvas?.getContext('2d');
    if (!canvas || !g) return;

    const audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const levels: number[] = Array(BARS).fill(0.05);

    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * ratio;
    canvas.height = canvas.clientHeight * ratio;

    let frame = 0;
    let last = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 50) return; // ~20 bars per second
      last = now;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += ((s - 128) / 128) ** 2;
      levels.push(Math.max(0.05, Math.min(1, Math.sqrt(sum / samples.length) * 3.5)));
      levels.shift();

      g.clearRect(0, 0, canvas.width, canvas.height);
      const slot = canvas.width / BARS;
      const barWidth = slot * 0.55;
      levels.forEach((level, i) => {
        const h = Math.max(4 * ratio, level * canvas.height);
        g.fillStyle = i > BARS - 4 ? '#f87171' : 'rgba(248, 113, 113, 0.55)';
        g.beginPath();
        g.roundRect(i * slot + (slot - barWidth) / 2, (canvas.height - h) / 2, barWidth, h, barWidth / 2);
        g.fill();
      });
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      audioCtx.close().catch(() => undefined);
    };
  }, [stream]);

  return <canvas ref={canvasRef} className="live-meter" aria-hidden="true" />;
}
