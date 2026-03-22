import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';
import { Upload, Rocket, Play, Download, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { transliterate } from 'transliteration';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_DURATION_SEC = 120; // 2 minutes hard limit

// Full rainbow palette — every shade on earth
const COLOR_PALETTE = [
  // Reds
  '#FF0000','#FF1744','#FF4569','#FF6B6B','#FF8A80','#C62828','#B71C1C','#FF5252',
  // Pinks
  '#FF00FF','#FF4081','#F50057','#FF80AB','#FF1493','#FF69B4','#FFB6C1','#FF007F',
  // Oranges
  '#FF6D00','#FF9100','#FFAB40','#FF6E40','#FF3D00','#E65100','#FF8C00','#FFA500',
  // Yellows
  '#FFD600','#FFEA00','#FFE57F','#FFF176','#FFFF00','#FFD700','#FFC200','#FFAB00',
  // Greens
  '#00E676','#69F0AE','#00C853','#76FF03','#CCFF90','#00BFA5','#1DE9B6','#64FFDA',
  // Cyans
  '#00E5FF','#18FFFF','#84FFFF','#00B8D4','#00BCD4','#00ACC1','#26C6DA','#4DD0E1',
  // Blues
  '#2979FF','#448AFF','#82B1FF','#00B0FF','#40C4FF','#80D8FF','#0091EA','#448AFF',
  // Purples
  '#D500F9','#AA00FF','#E040FB','#CE93D8','#BA68C8','#9C27B0','#7B1FA2','#6A1B9A',
  // Violets
  '#651FFF','#7C4DFF','#B388FF','#9575CD','#673AB7','#5E35B1','#4527A0','#7C4DFF',
  // Magentas
  '#FF4081','#F50057','#FF80AB','#FF6090','#D81B60','#C2185B','#AD1457','#880E4F',
  // Limes
  '#C6FF00','#EEFF41','#F4FF81','#B2FF59','#76FF03','#64DD17','#AEEA00','#CCF700',
  // Teals
  '#00BFA5','#1DE9B6','#64FFDA','#00897B','#00796B','#00695C','#004D40','#A7FFEB',
  // Golds
  '#FFD700','#FFC107','#FFB300','#FFA000','#FF8F00','#FF6F00','#FFCA28','#FFD54F',
];

// Pick random color, never same as previous
let _lastColorIdx = -1;
function randomColor() {
  let idx;
  do { idx = Math.floor(Math.random() * COLOR_PALETTE.length); }
  while (idx === _lastColorIdx);
  _lastColorIdx = idx;
  return COLOR_PALETTE[idx];
}

// ─── Utilities ────────────────────────────────────────────────────────────────

const isMobileDevice = () => window.innerWidth < 768 ||
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

const hasSharedArrayBuffer = () => typeof SharedArrayBuffer !== 'undefined';

const pad = (n, s) => ('000' + n).slice(s * -1);
const fmtSrt = (s) => {
  const t = parseFloat(s).toFixed(3);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = Math.floor(t % 60);
  return `${pad(h,2)}:${pad(m,2)}:${pad(sec,2)},${t.slice(-3)}`;
};
const fmtVtt = (s) => fmtSrt(s).replace(',', '.');

const srtFormat = (chunks) =>
  chunks.map((c, i) =>
    `${i+1}\n${fmtSrt(c.timestamp[0])} --> ${fmtSrt(c.timestamp[1] ?? c.timestamp[0]+1)}\n${c.text.trim()}\n`
  ).join('\n');

const vttFormat = (chunks) =>
  'WEBVTT\n\n' + chunks.map(c =>
    `${fmtVtt(c.timestamp[0])} --> ${fmtVtt(c.timestamp[1] ?? c.timestamp[0]+1)}\n${c.text.trim()}\n`
  ).join('\n');

// Strip symbols but keep Devanagari
const cleanText = (t) => t.replace(/[^a-zA-Z0-9\u0900-\u097F\s]/g, '').trim();

// Build 3-word caption groups; each word gets a unique random color
function buildGroups(chunks) {
  const groups = [];
  let bucket = [];
  let gIdx = 0;

  const flush = () => {
    if (!bucket.length) return;
    const start = bucket[0].timestamp[0];
    const last = bucket[bucket.length - 1];
    const end = last.timestamp[1] ?? last.timestamp[0] + 0.25;
    groups.push({
      id: gIdx++, start, end,
      words: bucket.map(w => ({ ...w, color: randomColor() })),
    });
    bucket = [];
  };

  for (const w of chunks) {
    if (bucket.length > 0) {
      const prev = bucket[bucket.length - 1];
      const prevEnd = prev.timestamp[1] ?? prev.timestamp[0] + 0.25;
      if (w.timestamp[0] - prevEnd > 0.4 || bucket.length >= 3) flush();
    }
    bucket.push(w);
  }
  flush();
  return groups;
}

// Check video duration using HTMLVideoElement (no file load)
function getVideoDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const vid = document.createElement('video');
    vid.preload = 'metadata';
    vid.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(vid.duration); };
    vid.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
    vid.src = url;
  });
}

// ─── Error Boundary ───────────────────────────────────────────────────────────

class ErrorBoundary extends React.Component {
  state = { hasError: false, msg: '' };
  static getDerivedStateFromError(e) { return { hasError: true, msg: e.message }; }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight:'100vh', background:'#0a0a1a', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24, textAlign:'center', color:'white' }}>
          <AlertTriangle size={52} color="#ff4d4d" style={{ marginBottom:16 }}/>
          <h2 style={{ fontSize:22, color:'#ff4d4d', marginBottom:12 }}>Something Went Wrong</h2>
          <p style={{ maxWidth:380, color:'#aaa', marginBottom:24 }}>
            {this.state.msg || 'An unexpected error occurred. On mobile, try a shorter clip under 2 minutes.'}
          </p>
          <button onClick={() => window.location.reload()}
            style={{ padding:'10px 28px', border:'2px solid #00f3ff', borderRadius:999, color:'#00f3ff', background:'transparent', cursor:'pointer', fontSize:16 }}>
            Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────

function AppContent() {
  const [stage, setStage] = useState('HOME');
  const [videoUrl, setVideoUrl] = useState('');
  const [captionMode, setCaptionMode] = useState('auto');

  const [audioProgress, setAudioProgress] = useState(0);
  const [captionProgress, setCaptionProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState('');
  const [isModelDL, setIsModelDL] = useState(false);
  const [modelPct, setModelPct] = useState(0);

  const [srtCaptions, setSrtCaptions] = useState('');
  const [vttCaptions, setVttCaptions] = useState('');
  const [wordGroups, setWordGroups] = useState([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  const workerRef = useRef(null);
  const ffmpegRef = useRef(new FFmpeg());
  const videoRef = useRef(null);

  // Detect mobile once on mount
  const [isMobile] = useState(() => isMobileDevice());
  const memoryGB = navigator.deviceMemory || 4;
  const capFontSize = isMobile ? '22px' : '28px';

  // ── Worker ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    workerRef.current = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

    const onMsg = ({ data }) => {
      const { type, result, originalSettings, error } = data;

      if (type === 'progress') {
        const d = data.data;
        if (d?.status === 'progress' || d?.status === 'download' || d?.status === 'init') {
          setIsModelDL(true);
          if (d.progress != null) setModelPct(Math.floor(d.progress));
        }
        if (d?.status === 'ready') { setIsModelDL(false); setModelPct(100); }
      }

      if (type === 'complete') {
        setIsModelDL(false);
        setCaptionProgress(100);
        setProgressMsg('Captions ready!');

        const raw = result.chunks || [];
        const mode = originalSettings?.captionMode || 'auto';
        const isHindi = raw.some(c => /[\u0900-\u097F]/.test(c.text));
        const roman = mode === 'hinglish' || (mode === 'auto' && isHindi);

        const chunks = raw.map(c => ({ ...c, text: roman ? transliterate(c.text) : c.text }));
        setSrtCaptions(srtFormat(chunks));
        setVttCaptions(vttFormat(chunks));
        setWordGroups(buildGroups(chunks.map((c,i) => ({ ...c, globalIndex: i }))));
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

  // ── rAF loop ───────────────────────────────────────────────────────────────
  useEffect(() => {
    let raf;
    const tick = () => {
      if (videoRef.current)
        setCurrentTime(videoRef.current.paused || videoRef.current.ended ? -1 : videoRef.current.currentTime);
      raf = requestAnimationFrame(tick);
    };
    if (stage === 'RESULT') raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stage]);

  // ── File handler ───────────────────────────────────────────────────────────
  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setErrorMsg('');

    // 1. Check duration BEFORE loading anything into RAM
    setProgressMsg('Checking video duration...');
    const dur = await getVideoDuration(file);
    if (dur > MAX_DURATION_SEC) {
      setErrorMsg(`⏱ Video is ${Math.floor(dur)}s long. Maximum is 2 minutes (120s). Please trim your video first.`);
      return;
    }

    if (file.size > 500 * 1024 * 1024) { setErrorMsg('File too large. Max 500MB.'); return; }

    const blobUrl = URL.createObjectURL(file);
    setVideoUrl(blobUrl);
    setStage('PROCESSING');
    setAudioProgress(0);
    setCaptionProgress(0);
    setIsModelDL(false);

    try {
      let float32Audio;

      if (isMobile || !hasSharedArrayBuffer()) {
        // ── Mobile: Web Audio API — no FFmpeg.wasm (saves ~100MB RAM) ────
        setProgressMsg('Reading audio (mobile mode)...');
        setAudioProgress(20);

        const arrayBuf = await file.arrayBuffer();
        setAudioProgress(60);

        const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const decoded = await ctx.decodeAudioData(arrayBuf);

        // Trim to 2 min max even if ffmpeg check was bypassed
        const maxSamples = MAX_DURATION_SEC * 16000;
        float32Audio = decoded.getChannelData(0).slice(0, maxSamples);

        ctx.close();
        setAudioProgress(100);
        setProgressMsg('Audio ready! Starting Whisper...');

      } else {
        // ── Desktop: FFmpeg — reliable for all video formats ──────────────
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

        // Extract max 2 min of audio to keep memory low
        await ffmpeg.writeFile('input_video', await fetchFile(file));
        await ffmpeg.exec([
          '-i', 'input_video',
          '-t', String(MAX_DURATION_SEC),
          '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', 'output.wav'
        ]);
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
        setProgressMsg('Audio ready! Starting Whisper...');
      }

      let whisperLang;
      if (captionMode === 'en') whisperLang = 'en';
      if (captionMode === 'hi' || captionMode === 'hinglish') whisperLang = 'hi';

      // Simulate caption progress bar moving while Whisper runs
      let sim = 0;
      const simInt = setInterval(() => {
        sim = Math.min(sim + 1.2, 96);
        setCaptionProgress(Math.round(sim));
      }, 700);

      const clearSim = () => clearInterval(simInt);
      workerRef.current.addEventListener('message', (e) => {
        if (e.data.type === 'complete' || e.data.type === 'error') clearSim();
      }, { once: true });

      workerRef.current.postMessage(
        { type: 'generate', audioData: float32Audio, language: whisperLang, captionMode, isMobile, memoryGB },
        [float32Audio.buffer]
      );
    } catch (err) {
      setErrorMsg('Processing failed: ' + (err.message || String(err)));
      setStage('HOME');
      URL.revokeObjectURL(blobUrl);
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

  const activeGroup = useMemo(() => {
    if (!wordGroups.length || currentTime < 0) return null;
    return wordGroups.find(g => currentTime >= g.start && currentTime <= g.end) || null;
  }, [wordGroups, currentTime]);

  // ── Language buttons config ────────────────────────────────────────────────
  const langBtns = [
    { key:'en',       flag:'🇺🇸', label:'English',     color:'#3b82f6' },
    { key:'hinglish', flag:'🇮🇳', label:'Hinglish',    color:'#a855f7' },
    { key:'hi',       flag:'🇮🇳', label:'Hindi',       color:'#06b6d4' },
    { key:'auto',     flag:'🌍',  label:'Auto Detect', color:'#ffffff' },
  ];

  // ── Conditional styles: mobile = flat, desktop = glass ────────────────────
  const cardStyle = isMobile
    ? { background:'#111122', border:'1px solid #334', borderRadius:16, padding:16 }
    : undefined; // glass-panel class handles desktop

  const bgContent = isMobile ? null : (
    <>
      <div className="space-bg" />
      <div className="nebula" />
      <div className="particle-layer particle-layer-1">
        {Array.from({ length: 25 }).map((_, i) => (
          <div key={i} className="star" style={{
            top:`${Math.random()*100}%`, left:`${Math.random()*100}%`,
            width:`${Math.random()*3+1}px`, height:`${Math.random()*3+1}px`,
            animationDelay:`${Math.random()*5}s`
          }}/>
        ))}
      </div>
    </>
  );

  const headerClass = isMobile
    ? '' // no float animation on mobile
    : 'animate-float';

  return (
    <div style={{ minHeight:'100vh', background: isMobile ? '#0a0a1a' : undefined, color:'white', position:'relative' }}>
      {bgContent}

      <style>{`
        @keyframes opusPop {
          0%   { transform: scale(0.85); opacity: 0; }
          100% { transform: scale(1);    opacity: 1; }
        }
      `}</style>

      <div className="relative min-h-screen flex flex-col items-center justify-center p-4 z-10 w-full">

        {/* ── Header ── */}
        <div className={`absolute top-5 left-0 w-full flex justify-center px-4 ${headerClass}`}>
          <h1 style={{
            fontFamily:'Orbitron,sans-serif', fontWeight:800,
            fontSize: isMobile ? 20 : 40,
            color:'white',
            textShadow: isMobile ? 'none' : '0 0 20px #00f3ff',
            display:'flex', alignItems:'center', gap:10, letterSpacing:'0.1em'
          }}>
            <Rocket color="#00f3ff" size={isMobile ? 22 : 36}/>
            ZERO GRAVITY CAPTIONS
          </h1>
        </div>

        {/* ── Error banner ── */}
        {errorMsg && (
          <div style={{
            position:'fixed', top:72, left:'50%', transform:'translateX(-50%)',
            background:'rgba(120,0,0,0.85)', border:'1px solid #ff4444',
            color:'#fcc', padding:'12px 20px', borderRadius:12,
            zIndex:100, maxWidth:360, textAlign:'center', fontSize:14
          }}>
            {errorMsg}
            <button onClick={() => setErrorMsg('')} style={{ marginLeft:10, textDecoration:'underline', background:'none', border:'none', color:'#fcc', cursor:'pointer', fontSize:12 }}>
              Dismiss
            </button>
          </div>
        )}

        {/* ════════════ HOME ════════════ */}
        {stage === 'HOME' && (
          <div style={{ width:'100%', maxWidth:560, marginTop:72, display:'flex', flexDirection:'column', alignItems:'center', gap:20 }}>

            {/* Language selector */}
            <div style={{ display:'flex', flexWrap:'wrap', justifyContent:'center', gap:10 }}>
              {langBtns.map(({ key, flag, label, color }) => {
                const active = captionMode === key;
                return (
                  <button key={key} onClick={() => setCaptionMode(key)} style={{
                    minHeight:44, padding:'10px 18px', borderRadius:999,
                    border:`1.5px solid ${active ? color : 'rgba(255,255,255,0.2)'}`,
                    background: active ? `${color}25` : 'transparent',
                    boxShadow: active && !isMobile ? `0 0 16px ${color}88` : 'none',
                    color: active ? '#fff' : '#888',
                    fontFamily:'Orbitron,sans-serif', fontWeight:700, fontSize:12,
                    cursor:'pointer', transition:'all 0.15s',
                  }}>
                    {flag} {label}
                  </button>
                );
              })}
            </div>

            {/* Upload zone */}
            <div
              className={isMobile ? '' : 'glass-panel'}
              style={isMobile ? { ...cardStyle, width:'100%' } : { width:'100%', padding:24, borderRadius:24 }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => document.getElementById('file-upload').click()}
            >
              <div style={{
                border:'2px dashed #00f3ff', borderRadius:16,
                padding:isMobile ? '32px 16px' : '56px 24px',
                display:'flex', flexDirection:'column', alignItems:'center', gap:12,
                cursor:'pointer'
              }}>
                <Upload color="#00f3ff" size={isMobile ? 36 : 52}/>
                <p style={{ fontSize:isMobile ? 15 : 18, fontWeight:600, margin:0 }}>Deploy Video to Force Field</p>
                <p style={{ fontSize:13, color:'#777', margin:0 }}>Tap or drag · MP4/MOV/AVI · Max 500MB</p>
                <p style={{ fontSize:12, color:'#facc15', margin:0, fontWeight:600 }}>
                  ⏱ Max 2 minutes · longer videos will be rejected
                </p>
              </div>
              <input id="file-upload" type="file" accept="video/*,audio/*" style={{ display:'none' }} onChange={handleInputChange}/>
            </div>
          </div>
        )}

        {/* ════════════ PROCESSING ════════════ */}
        {stage === 'PROCESSING' && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', width:'100%', maxWidth:420, marginTop:72, gap:24 }}>
            {/* Spinner — static on mobile, animated on desktop */}
            {isMobile ? (
              <Loader2 size={52} color="#00f3ff" style={{ animation:'spin 1s linear infinite' }}/>
            ) : (
              <div style={{ position:'relative', width:160, height:160, display:'flex', alignItems:'center', justifyContent:'center' }}>
                <div className="absolute w-full h-full rounded-full border-4 border-t-neonBlue border-r-transparent border-b-neonPurple border-l-transparent animate-spin" style={{ animationDuration:'3s' }}/>
                <div className="absolute w-4/5 h-4/5 rounded-full border-4 border-t-transparent border-r-neonCyan border-b-transparent border-l-neonBlue animate-spin" style={{ animationDuration:'2s', animationDirection:'reverse' }}/>
                <Loader2 size={40} color="white" className="animate-spin"/>
              </div>
            )}

            <p style={{ fontFamily:'Orbitron,sans-serif', fontSize:15, textAlign:'center', color:'#00f3ff' }}>{progressMsg}</p>

            <div className={isMobile ? '' : 'glass-panel'} style={isMobile ? { ...cardStyle, width:'100%' } : { width:'100%', padding:24 }}>
              {/* Audio bar */}
              <div style={{ marginBottom:16 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6, fontSize:13 }}>
                  <span style={{ color:'#00f3ff', fontWeight:700 }}>Audio</span>
                  <span style={{ color:'#ccc' }}>{audioProgress}%</span>
                </div>
                <div style={{ height:8, background:'#111', borderRadius:99, overflow:'hidden', border:'1px solid #333' }}>
                  <div style={{ height:'100%', width:`${audioProgress}%`, background:'#00f3ff', borderRadius:99, transition:'width 0.3s' }}/>
                </div>
              </div>
              {/* Caption bar */}
              <div style={{ marginBottom: isModelDL ? 16 : 0 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6, fontSize:13 }}>
                  <span style={{ color:'#b800ff', fontWeight:700 }}>Captions</span>
                  <span style={{ color:'#ccc' }}>{captionProgress}%</span>
                </div>
                <div style={{ height:8, background:'#111', borderRadius:99, overflow:'hidden', border:'1px solid #333' }}>
                  <div style={{ height:'100%', width:`${captionProgress}%`, background:'#b800ff', borderRadius:99, transition:'width 0.3s' }}/>
                </div>
              </div>
              {/* Model download */}
              {isModelDL && (
                <div style={{ background:'rgba(30,60,120,0.5)', border:'1px solid #3b82f6', borderRadius:10, padding:'12px 14px', textAlign:'center' }}>
                  <p style={{ color:'#93c5fd', fontSize:13, marginBottom:8 }}>Downloading AI model ({modelPct}%)… cached after first use.</p>
                  <div style={{ height:6, background:'#111', borderRadius:99, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:`${modelPct}%`, background:'#3b82f6', transition:'width 0.3s' }}/>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ════════════ RESULT ════════════ */}
        {stage === 'RESULT' && (
          <div style={{ width:'100%', maxWidth:1100, marginTop:72, display:'flex', flexDirection: isMobile ? 'column' : 'row', gap:20, alignItems:'flex-start' }}>

            {/* Video panel */}
            <div className={isMobile ? '' : 'glass-panel'} style={isMobile ? { ...cardStyle, width:'100%' } : { width:'50%', padding:16 }}>
              <h3 style={{ fontFamily:'Orbitron,sans-serif', color:'#00f3ff', marginBottom:12, display:'flex', alignItems:'center', gap:8 }}>
                <Play size={18}/> Preview
              </h3>
              <div style={{ position:'relative', borderRadius:12, overflow:'hidden', background:'#000', aspectRatio:'16/9', border:'1px solid rgba(0,243,255,0.25)' }}>
                <video ref={videoRef} src={videoUrl} controls playsInline
                  style={{ width:'100%', height:'100%', objectFit:'contain', display:'block' }}/>

                {/* Caption overlay — centered */}
                <div style={{
                  position:'absolute', top:'50%', left:'50%',
                  transform:'translate(-50%,-50%)',
                  width:'90%', pointerEvents:'none', zIndex:30
                }}>
                  {activeGroup && (
                    <div key={activeGroup.id} style={{
                      display:'flex', flexWrap:'wrap', justifyContent:'center',
                      alignItems:'center', gap:8,
                      animation:'opusPop 120ms ease-out forwards'
                    }}>
                      {activeGroup.words.map((w, i) => {
                        const txt = cleanText(w.text);
                        if (!txt) return null;
                        return (
                          <span key={i} style={{
                            fontFamily:"'Impact','Anton',sans-serif",
                            fontSize: capFontSize,
                            fontWeight: 900,
                            textTransform: 'uppercase',
                            letterSpacing: '1px',
                            color: w.color,
                            WebkitTextStroke: '3px black',
                            paintOrder: 'stroke fill',
                            lineHeight: 1.25,
                          }}>{txt}</span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Actions + transcript */}
            <div style={{ width: isMobile ? '100%' : '50%', display:'flex', flexDirection:'column', gap:16 }}>
              <div className={isMobile ? '' : 'glass-panel'} style={isMobile
                ? { ...cardStyle, display:'flex', flexWrap:'wrap', gap:12, justifyContent:'center' }
                : { padding:20, display:'flex', flexWrap:'wrap', gap:12, justifyContent:'center' }}>
                <button onClick={() => downloadFile(srtCaptions,'captions.srt')}
                  className="hologram-btn" style={{ minHeight:44, padding:'10px 20px', borderRadius:10, fontFamily:'Orbitron,sans-serif', fontWeight:700, display:'flex', alignItems:'center', gap:8 }}>
                  <Download size={16}/> SRT
                </button>
                <button onClick={() => downloadFile(vttCaptions,'captions.vtt')}
                  className="hologram-btn" style={{ minHeight:44, padding:'10px 20px', borderRadius:10, fontFamily:'Orbitron,sans-serif', fontWeight:700, display:'flex', alignItems:'center', gap:8, borderColor:'#b800ff', color:'#b800ff' }}>
                  <Download size={16}/> VTT
                </button>
                <button onClick={reset}
                  className="hologram-btn" style={{ minHeight:44, padding:'10px 20px', borderRadius:10, fontFamily:'Orbitron,sans-serif', fontWeight:700, display:'flex', alignItems:'center', gap:8, borderColor:'#fff', color:'#fff' }}>
                  <RefreshCw size={16}/> New Video
                </button>
              </div>

              <div className={isMobile ? '' : 'glass-panel'} style={isMobile
                ? { ...cardStyle, maxHeight:'35vh', overflowY:'auto' }
                : { padding:20, maxHeight:'40vh', overflowY:'auto' }}>
                <h3 style={{ fontFamily:'Orbitron,sans-serif', color:'#b800ff', marginBottom:12, position:'sticky', top:0, background: isMobile ? '#111122' : undefined, paddingBottom:4 }}>Transcript</h3>
                <pre style={{ color:'#ccc', fontSize:13, whiteSpace:'pre-wrap', lineHeight:1.7, fontFamily:'monospace', margin:0 }}>
                  {srtCaptions || 'No captions yet.'}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent/>
    </ErrorBoundary>
  );
}
