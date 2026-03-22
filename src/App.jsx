import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';
import { Upload, Rocket, Play, Download, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { transliterate } from 'transliteration';

// ─── Helpers ────────────────────────────────────────────────────────────────

const isMobileDevice = () =>
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

const hasSharedArrayBuffer = () => typeof SharedArrayBuffer !== 'undefined';

const pad = (n, s) => ('000' + n).slice(s * -1);

const formatSrt = (s) => {
  const t = parseFloat(s).toFixed(3);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = Math.floor(t % 60);
  const ms = t.slice(-3);
  return `${pad(h,2)}:${pad(m,2)}:${pad(sec,2)},${ms}`;
};
const formatVtt = (s) => formatSrt(s).replace(',', '.');

const srtFormat = (chunks) =>
  chunks.map((c, i) =>
    `${i + 1}\n${formatSrt(c.timestamp[0])} --> ${formatSrt(c.timestamp[1] ?? c.timestamp[0] + 1)}\n${c.text.trim()}\n`
  ).join('\n');

const vttFormat = (chunks) =>
  'WEBVTT\n\n' + chunks.map((c) =>
    `${formatVtt(c.timestamp[0])} --> ${formatVtt(c.timestamp[1] ?? c.timestamp[0] + 1)}\n${c.text.trim()}\n`
  ).join('\n');

// Strip non-alphanumeric but keep Devanagari for Hindi captions
const cleanText = (text) =>
  text.replace(/[^a-zA-Z0-9\u0900-\u097F\s]/g, '').trim();

// Build caption groups: max 3 words, split on pauses > 0.4s
function buildGroups(indexedChunks) {
  const colorWheel = (idx) => {
    const hue = (idx * 137.508) % 360; // golden-angle for max contrast spread
    const sat = 80 + (idx % 3) * 7;
    const lit = 52 + (idx % 5) * 2;
    return `hsl(${hue},${sat}%,${lit}%)`;
  };

  const groups = [];
  let bucket = [];
  let gIdx = 0;

  const flush = () => {
    if (!bucket.length) return;
    // longest-word becomes keyword
    let kwIdx = 0, maxLen = 0;
    bucket.forEach((w, i) => {
      const l = w.text.replace(/\W/g, '').length;
      if (l > maxLen) { maxLen = l; kwIdx = i; }
    });
    const color = colorWheel(gIdx);
    const start = bucket[0].timestamp[0];
    const last = bucket[bucket.length - 1];
    const end = last.timestamp[1] ?? last.timestamp[0] + 0.25;
    groups.push({
      id: gIdx++,
      start, end,
      words: bucket.map((w, i) => ({
        ...w,
        isKeyword: i === kwIdx,
        color: i === kwIdx ? color : '#FFFFFF',
      })),
    });
    bucket = [];
  };

  for (const w of indexedChunks) {
    if (bucket.length > 0) {
      const prev = bucket[bucket.length - 1];
      const prevEnd = prev.timestamp[1] ?? prev.timestamp[0] + 0.25;
      const gap = w.timestamp[0] - prevEnd;
      if (gap > 0.4 || bucket.length >= 3) flush();
    }
    bucket.push(w);
  }
  flush();
  return groups;
}

// ─── Error Boundary ──────────────────────────────────────────────────────────

class ErrorBoundary extends React.Component {
  state = { hasError: false, msg: '' };
  static getDerivedStateFromError(e) { return { hasError: true, msg: e.message }; }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight:'100vh', background:'#020817', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'24px', textAlign:'center', color:'white' }}>
          <AlertTriangle size={52} color="#ff4d4d" style={{ marginBottom:16 }} />
          <h2 style={{ fontSize:24, fontWeight:'bold', color:'#ff4d4d', marginBottom:12 }}>Something Went Wrong</h2>
          <p style={{ maxWidth:400, color:'#aaa', marginBottom:24 }}>
            {this.state.msg || 'An unexpected error occurred. If you are on mobile, try a shorter video (under 2 min).'}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{ padding:'10px 28px', border:'2px solid #00f3ff', borderRadius:999, color:'#00f3ff', background:'transparent', cursor:'pointer', fontSize:16 }}
          >
            Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Main App ────────────────────────────────────────────────────────────────

function AppContent() {
  const [stage, setStage] = useState('HOME');
  const [videoUrl, setVideoUrl] = useState('');
  const [captionMode, setCaptionMode] = useState('auto');

  const [audioProgress, setAudioProgress] = useState(0);
  const [captionProgress, setCaptionProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState('');
  const [isModelDownloading, setIsModelDownloading] = useState(false);
  const [modelPct, setModelPct] = useState(0);
  const [compatMode, setCompatMode] = useState(false);

  const [srtCaptions, setSrtCaptions] = useState('');
  const [vttCaptions, setVttCaptions] = useState('');
  const [wordGroups, setWordGroups] = useState([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  const workerRef = useRef(null);
  const ffmpegRef = useRef(new FFmpeg());
  const videoRef = useRef(null);
  const isMobile = isMobileDevice();
  const memoryGB = navigator.deviceMemory || 4;

  // ── Worker setup ────────────────────────────────────────────────────────
  useEffect(() => {
    workerRef.current = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

    const onMsg = (e) => {
      const { type, data, result, originalSettings, error } = e.data;

      if (type === 'progress') {
        if (data?.status === 'progress' || data?.status === 'download' || data?.status === 'init') {
          setIsModelDownloading(true);
          if (data.progress != null) setModelPct(Math.floor(data.progress));
        }
        if (data?.status === 'ready') {
          setIsModelDownloading(false);
          setModelPct(100);
        }
      }

      if (type === 'complete') {
        setIsModelDownloading(false);
        setCaptionProgress(100);
        setProgressMsg('Captions ready!');

        const rawChunks = result.chunks || [];
        const mode = originalSettings?.captionMode || 'auto';
        const isHindi = rawChunks.some(c => /[\u0900-\u097F]/.test(c.text));
        const needsRoman = mode === 'hinglish' || (mode === 'auto' && isHindi);

        const chunks = rawChunks.map(c => ({
          ...c,
          text: needsRoman ? transliterate(c.text) : c.text,
        }));

        setSrtCaptions(srtFormat(chunks));
        setVttCaptions(vttFormat(chunks));

        const indexed = chunks.map((c, i) => ({ ...c, globalIndex: i }));
        setWordGroups(buildGroups(indexed));
        setStage('RESULT');
      }

      if (type === 'error') {
        setErrorMsg(error || 'Transcription failed. Try a shorter clip.');
        setStage('HOME');
      }
    };

    workerRef.current.addEventListener('message', onMsg);
    return () => workerRef.current?.terminate();
  }, []);

  // ── rAF sync loop ────────────────────────────────────────────────────────
  useEffect(() => {
    let raf;
    const tick = () => {
      if (videoRef.current) {
        setCurrentTime(videoRef.current.paused || videoRef.current.ended
          ? -1
          : videoRef.current.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    if (stage === 'RESULT') raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stage]);

  // ── File upload ──────────────────────────────────────────────────────────
  const handleFile = useCallback(async (file) => {
    if (!file) return;
    if (isMobile && file.size > 150 * 1024 * 1024) {
      if (!window.confirm('This file is over 150MB. Processing on mobile may be slow or crash. Try a clip under 2 min. Continue?')) return;
    }
    if (file.size > 500 * 1024 * 1024) {
      setErrorMsg('File too large. Max 500MB.'); return;
    }

    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setStage('PROCESSING');
    setErrorMsg('');
    setAudioProgress(0);
    setCaptionProgress(0);
    setIsModelDownloading(false);

    try {
      let float32Audio;

      if (isMobile || !hasSharedArrayBuffer()) {
        // ── Mobile / no-SAB path: use Web Audio API directly ────────────
        setCompatMode(!hasSharedArrayBuffer());
        setProgressMsg('Reading audio (mobile mode)...');
        setAudioProgress(30);
        const arrayBuf = await file.arrayBuffer();
        const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const decoded = await ctx.decodeAudioData(arrayBuf);
        float32Audio = decoded.getChannelData(0);
        ctx.close();
        setAudioProgress(100);
        setProgressMsg('Audio ready! Starting transcription...');
      } else {
        // ── Desktop path: FFmpeg for reliable format support ─────────────
        setCompatMode(false);
        setProgressMsg('Loading FFmpeg...');
        const ffmpeg = ffmpegRef.current;
        if (!ffmpeg.loaded) {
          const base = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
          await ffmpeg.load({
            coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
          });
        }
        ffmpeg.on('progress', ({ progress }) => {
          setAudioProgress(Math.round(progress * 100));
          setProgressMsg('Extracting audio...');
        });
        await ffmpeg.writeFile('input_video', await fetchFile(file));
        await ffmpeg.exec(['-i', 'input_video', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', 'output.wav']);
        const raw = await ffmpeg.readFile('output.wav');
        const audioBuf = new Uint8Array(raw).buffer;
        try { ffmpeg.deleteFile('input_video'); } catch {}
        try { ffmpeg.deleteFile('output.wav'); } catch {}

        setProgressMsg('Decoding audio...');
        const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const decoded = await ctx.decodeAudioData(audioBuf);
        float32Audio = decoded.getChannelData(0);
        ctx.close();
        setAudioProgress(100);
        setProgressMsg('Audio extracted! Starting Whisper...');
      }

      // Determine whisper language
      let whisperLang = undefined;
      if (captionMode === 'en') whisperLang = 'en';
      if (captionMode === 'hi' || captionMode === 'hinglish') whisperLang = 'hi';

      // Simulate progress while Whisper runs
      let sim = 0;
      const simInt = setInterval(() => {
        sim = Math.min(sim + 1.5, 97);
        setCaptionProgress(Math.round(sim));
      }, 800);

      workerRef.current.postMessage(
        { type: 'generate', audioData: float32Audio, language: whisperLang, captionMode, isMobile, memoryGB },
        [float32Audio.buffer]
      );

      // Clear sim when worker finishes (handled in onMsg)
      const clearSim = () => clearInterval(simInt);
      workerRef.current.addEventListener('message', (e) => {
        if (e.data.type === 'complete' || e.data.type === 'error') clearSim();
      }, { once: true });

    } catch (err) {
      setErrorMsg('Processing failed: ' + err.message + (isMobile ? ' — Try a shorter clip.' : ''));
      setStage('HOME');
      URL.revokeObjectURL(url);
    }
  }, [captionMode, isMobile, memoryGB]);

  const handleInputChange = (e) => handleFile(e.target.files[0]);
  const handleDrop = (e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); };

  const downloadFile = (content, name) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
    a.download = name; a.click();
  };

  const reset = () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setStage('HOME'); setVideoUrl(''); setSrtCaptions(''); setVttCaptions(''); setWordGroups([]);
  };

  // ── Caption group lookup ─────────────────────────────────────────────────
  const activeGroup = useMemo(() => {
    if (!wordGroups.length || currentTime < 0) return null;
    return wordGroups.find(g => currentTime >= g.start && currentTime <= g.end) || null;
  }, [wordGroups, currentTime]);

  // ── Language selector buttons ─────────────────────────────────────────────
  const langBtns = [
    { key: 'en',       flag: '🇺🇸', label: 'English',     glow: 'rgba(59,130,246,0.6)',  bg: 'rgba(59,130,246,0.2)',  border: '#3b82f6' },
    { key: 'hinglish', flag: '🇮🇳', label: 'Hinglish',    glow: 'rgba(168,85,247,0.6)',  bg: 'rgba(168,85,247,0.2)', border: '#a855f7' },
    { key: 'hi',       flag: '🇮🇳', label: 'Hindi',       glow: 'rgba(6,182,212,0.6)',   bg: 'rgba(6,182,212,0.2)',  border: '#06b6d4' },
    { key: 'auto',     flag: '🌍',  label: 'Auto Detect', glow: 'rgba(255,255,255,0.4)', bg: 'rgba(255,255,255,0.15)',border: '#ffffff' },
  ];

  // ── Font-size for captions (mobile = 20px, desktop = 28px) ───────────────
  const capFontSize = isMobile ? '20px' : '28px';

  return (
    <>
      {/* Animated background */}
      <div className="space-bg" />
      <div className="nebula" />
      <div className="particle-layer particle-layer-1">
        {Array.from({ length: 25 }).map((_, i) => (
          <div key={i} className="star" style={{
            top: `${Math.random() * 100}%`, left: `${Math.random() * 100}%`,
            width: `${Math.random() * 3 + 1}px`, height: `${Math.random() * 3 + 1}px`,
            animationDelay: `${Math.random() * 5}s`
          }} />
        ))}
      </div>

      <style>{`
        @keyframes opusPop {
          0%   { transform: scale(0.88); opacity: 0; }
          100% { transform: scale(1);    opacity: 1; }
        }
      `}</style>

      <div className="relative min-h-screen flex flex-col items-center justify-center p-4 z-10 w-full">

        {/* Header */}
        <div className="absolute top-6 left-0 w-full flex justify-center px-4 animate-float">
          <h1 className="text-3xl md:text-5xl font-orbitron font-bold neon-text text-white tracking-widest flex items-center gap-3">
            <Rocket className="text-neonBlue" size={40} />
            ZERO GRAVITY CAPTIONS
          </h1>
        </div>

        {/* Compatibility banner */}
        {compatMode && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-yellow-900/60 border border-yellow-400 text-yellow-200 text-sm px-4 py-2 rounded-xl backdrop-blur-md z-50 text-center max-w-sm">
            ⚡ Compatibility mode — running without SharedArrayBuffer
          </div>
        )}

        {/* Error */}
        {errorMsg && (
          <div className="absolute top-24 bg-red-900/60 border border-red-500 text-red-100 px-6 py-3 rounded-xl shadow-[0_0_15px_rgba(255,0,0,0.5)] backdrop-blur-md z-50 text-center max-w-sm">
            {errorMsg}
            <button onClick={() => setErrorMsg('')} className="ml-3 underline text-xs">Dismiss</button>
          </div>
        )}

        {/* ── HOME ─────────────────────────────────────────────────── */}
        {stage === 'HOME' && (
          <div className="w-full max-w-xl mt-20 flex flex-col items-center gap-6">
            {/* Language selector */}
            <div className="flex flex-wrap justify-center gap-3">
              {langBtns.map(({ key, flag, label, glow, bg, border }) => (
                <button
                  key={key}
                  onClick={() => setCaptionMode(key)}
                  style={{
                    minHeight: 44,
                    padding: '10px 20px',
                    borderRadius: 999,
                    border: `1.5px solid ${captionMode === key ? border : 'rgba(255,255,255,0.2)'}`,
                    background: captionMode === key ? bg : 'transparent',
                    boxShadow: captionMode === key ? `0 0 18px ${glow}` : 'none',
                    color: captionMode === key ? '#fff' : '#9ca3af',
                    fontFamily: 'Orbitron, sans-serif',
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  {flag} {label}
                </button>
              ))}
            </div>

            {/* Upload zone */}
            <div
              className="glass-panel w-full p-8 rounded-3xl flex flex-col items-center justify-center text-center cursor-pointer"
              style={{ minHeight: 220 }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => document.getElementById('file-upload').click()}
            >
              <div className="border-2 border-dashed border-neonBlue rounded-2xl w-full py-12 flex flex-col items-center gap-4 hover:border-neonPurple transition-colors hologram-scan">
                <Upload className="w-16 h-16 text-neonBlue animate-float" />
                <p className="text-lg text-gray-200 font-semibold">Deploy Video to Force Field</p>
                <p className="text-sm text-gray-400">(Drag & Drop or Tap · Max 500MB · MP4/MOV/AVI)</p>
                {isMobile && <p className="text-xs text-yellow-400">📱 Mobile: best under 150MB / 2 min</p>}
              </div>
              <input id="file-upload" type="file" accept="video/*,audio/*" className="hidden" onChange={handleInputChange} />
            </div>
          </div>
        )}

        {/* ── PROCESSING ───────────────────────────────────────────── */}
        {stage === 'PROCESSING' && (
          <div className="flex flex-col items-center w-full max-w-md mt-20 gap-6">
            <div className="relative w-48 h-48 flex items-center justify-center">
              <div className="absolute w-full h-full rounded-full border-4 border-t-neonBlue border-r-transparent border-b-neonPurple border-l-transparent animate-spin" style={{ animationDuration:'3s' }} />
              <div className="absolute w-4/5 h-4/5 rounded-full border-4 border-t-transparent border-r-neonCyan border-b-transparent border-l-neonBlue animate-spin" style={{ animationDuration:'2s', animationDirection:'reverse' }} />
              <Loader2 className="w-12 h-12 text-white animate-spin" />
            </div>

            <h2 className="text-xl font-orbitron neon-text text-center">{progressMsg}</h2>

            <div className="w-full glass-panel p-6 flex flex-col gap-5">
              {/* Audio bar */}
              <div>
                <div className="flex justify-between mb-1 text-sm">
                  <span className="text-neonBlue font-semibold">Audio Extraction</span>
                  <span className="text-gray-300">{audioProgress}%</span>
                </div>
                <div className="w-full bg-spaceDark rounded-full h-3 border border-glassBorder overflow-hidden">
                  <div className="bg-neonBlue h-full rounded-full transition-all duration-300 shadow-[0_0_10px_#00f3ff]" style={{ width:`${audioProgress}%` }} />
                </div>
              </div>

              {/* Caption bar */}
              <div>
                <div className="flex justify-between mb-1 text-sm">
                  <span className="text-neonPurple font-semibold">Caption Generation</span>
                  <span className="text-gray-300">{captionProgress}%</span>
                </div>
                <div className="w-full bg-spaceDark rounded-full h-3 border border-glassBorder overflow-hidden">
                  <div className="bg-neonPurple h-full rounded-full transition-all duration-300 shadow-[0_0_10px_#b800ff]" style={{ width:`${captionProgress}%` }} />
                </div>
              </div>

              {/* Model download */}
              {isModelDownloading && (
                <div className="p-4 bg-blue-900/40 border border-blue-500 rounded-xl text-center animate-pulse">
                  <p className="text-blue-200 text-sm mb-2">Downloading AI model ({modelPct}%)… cached after first time.</p>
                  <div className="w-full bg-spaceDark rounded-full h-2">
                    <div className="bg-blue-400 h-2 rounded-full transition-all" style={{ width:`${modelPct}%` }} />
                  </div>
                </div>
              )}

              {isMobile && (
                <p className="text-yellow-400 text-xs text-center">📱 Mobile mode — using lightweight engine</p>
              )}
            </div>
          </div>
        )}

        {/* ── RESULT ──────────────────────────────────────────────── */}
        {stage === 'RESULT' && (
          <div className="w-full max-w-6xl mt-20 flex flex-col lg:flex-row gap-6 items-start">

            {/* Video + captions */}
            <div className="w-full lg:w-1/2 glass-panel p-4 flex flex-col">
              <h3 className="text-lg font-orbitron text-neonBlue mb-3 flex items-center gap-2">
                <Play size={18} /> Preview
              </h3>
              <div className="relative rounded-xl overflow-hidden bg-spaceDark w-full aspect-video border border-neonBlue/30">
                {/* scanline overlay */}
                <div className="absolute inset-0 pointer-events-none bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(0,243,255,0.04)_2px,rgba(0,243,255,0.04)_4px)] z-10 mix-blend-screen opacity-40" />

                <video
                  ref={videoRef}
                  src={videoUrl}
                  controls
                  className="w-full h-full object-contain z-20 relative"
                  playsInline
                />

                {/* Captions overlay */}
                <div
                  className="absolute pointer-events-none z-30"
                  style={{ top:'50%', left:'50%', transform:'translate(-50%,-50%)', width:'90%' }}
                >
                  {activeGroup && (
                    <div
                      key={activeGroup.id}
                      className="flex flex-wrap justify-center items-center w-full"
                      style={{ animation:'opusPop 120ms ease-out forwards', gap:10 }}
                    >
                      {activeGroup.words.map((w, i) => {
                        const txt = cleanText(w.text);
                        if (!txt) return null;
                        return (
                          <span key={i} style={{
                            fontFamily: "'Impact','Anton',sans-serif",
                            fontSize: capFontSize,
                            fontWeight: 900,
                            textTransform: 'uppercase',
                            letterSpacing: '1px',
                            color: w.color,
                            WebkitTextStroke: '3px black',
                            paintOrder: 'stroke fill',
                            lineHeight: 1.25,
                          }}>
                            {txt}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Actions + Transcript */}
            <div className="w-full lg:w-1/2 flex flex-col gap-5">
              <div className="glass-panel p-5 flex flex-wrap gap-3 justify-center">
                <button onClick={() => downloadFile(srtCaptions, 'captions.srt')}
                  className="hologram-btn px-5 py-3 rounded-lg font-orbitron font-bold flex items-center gap-2 min-h-[44px]">
                  <Download size={18}/> SRT
                </button>
                <button onClick={() => downloadFile(vttCaptions, 'captions.vtt')}
                  className="hologram-btn px-5 py-3 rounded-lg font-orbitron font-bold flex items-center gap-2 min-h-[44px]"
                  style={{ borderColor:'#b800ff', color:'#b800ff' }}>
                  <Download size={18}/> VTT
                </button>
                <button onClick={reset}
                  className="hologram-btn px-5 py-3 rounded-lg font-orbitron font-bold flex items-center gap-2 min-h-[44px]"
                  style={{ borderColor:'#fff', color:'#fff' }}>
                  <RefreshCw size={18}/> New Video
                </button>
              </div>

              <div className="glass-panel p-5 flex-1 max-h-[45vh] overflow-y-auto">
                <h3 className="text-lg font-orbitron text-neonPurple mb-3 sticky top-0 bg-glassBg backdrop-blur-md py-1">Transcript</h3>
                <pre className="text-gray-300 font-exo whitespace-pre-wrap text-sm leading-relaxed">
                  {srtCaptions || 'No captions generated.'}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
