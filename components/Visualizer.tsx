import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  stream?: MediaStream | null;
  audioUrl?: string | null;
  isPlaying?: boolean;
  isRecording?: boolean;
}

export const Visualizer: React.FC<VisualizerProps> = ({ stream, audioUrl, isPlaying, isRecording }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;

    if (isRecording && stream) {
      try {
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
      } catch (err) {
        console.error("Audio context error:", err);
      }
    }

    const bufferLength = analyser ? analyser.frequencyBinCount : 24;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      if (analyser && isRecording) {
        analyser.getByteFrequencyData(dataArray);
      } else if (isPlaying) {
        for (let i = 0; i < bufferLength; i++) {
          dataArray[i] = Math.floor(Math.random() * 180 + 50);
        }
      } else {
        dataArray.fill(10);
      }

      const barWidth = (width / bufferLength) * 0.7;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = Math.max(4, (dataArray[i] / 255) * height * 0.85);

        // Vibrant gradient: Purple/Cyan
        const gradient = ctx.createLinearGradient(0, height, 0, 0);
        gradient.addColorStop(0, '#6366f1');
        gradient.addColorStop(0.5, '#a855f7');
        gradient.addColorStop(1, '#06b6d4');

        ctx.fillStyle = isRecording || isPlaying ? gradient : 'rgba(148, 163, 184, 0.2)';
        
        // Rounded bars
        const radius = Math.min(barWidth / 2, 4);
        const y = (height - barHeight) / 2;

        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, radius);
        ctx.fill();

        x += barWidth + (width / bufferLength) * 0.3;
      }
    };

    draw();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (audioCtx) audioCtx.close();
    };
  }, [stream, isRecording, isPlaying]);

  return (
    <div className="w-full h-16 flex items-center justify-center bg-slate-900/40 rounded-xl border border-slate-800 p-2 overflow-hidden">
      <canvas ref={canvasRef} width={320} height={48} className="w-full h-full max-w-sm" />
    </div>
  );
};