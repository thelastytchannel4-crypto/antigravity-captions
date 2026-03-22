import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Upload, Rocket, Play, Download, RefreshCw, Mic, MicOff, AlertTriangle } from 'lucide-react';

// ─── Color Palette (every shade) ─────────────────────────────────────────────
const COLORS = [
  '#FF0000','#FF1744','#FF4569','#FF6B6B','#FF8A80','#C62828','#FF5252',
  '#FF00FF','#FF4081','#F50057','#FF80AB','#FF1493','#FF69B4','#FF007F',
  '#FF6D00','#FF9100','#FFAB40','#FF6E40','#FF3D00','#E65100','#FFA500',
  '#FFD600','#FFEA00','#FFE57F','#FFFF00','#FFD700','#FFC200','#FFAB00',
  '#00E676','#69F0AE','#00C853','#76FF03','#CCFF90','#1DE9B6','#64FFDA',
  '#00E5FF','#18FFFF','#84FFFF','#00B8D4','#00BCD4','#26C6DA','#4DD0E1',
  '#2979FF','#448AFF','#82B1FF','#00B0FF','#40C4FF','#80D8FF','#0091EA',
  '#D500F9','#AA00FF','#E040FB','#CE93D8','#BA68C8','#9C27B0','#6A1B9A',
  '#651FFF','#7C4DFF','#B388FF','#9575CD','#673AB7','#5E35B1','#4527A0',
  '#C6FF00','#EEFF41','#F4FF81','#B2FF59','#64DD17','#AEEA00',
  '#00BFA5','#64FFDA','#00897B','#A7FFEB',
  '#FFD700','#FFC107','#FFB300','#FFCA28','#FFD54F',
];
let _lastCI = -1;
const randColor = () => {
  let i; do { i = Math.floor(Math.random() * COLORS.length); } while (i === _lastCI);
  _lastCI = i; return COLORS[i];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const isBrowser = typeof window !== 'undefined';

const isMobile = () => {
  if (!isBrowser) return false;
  return window.innerWidth < 768 ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

const cleanText = (t) => t.replace(/[^a-zA-Z0-9\u0900-\u097F\s]/g, '').trim();

const pad2 = (n) => String(Math.floor(n)).padStart(2, '0');
const toSrtTime = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(sec)},${String(Math.round((sec % 1) * 1000)).padStart(3,'0')}`;
};

const hasSpeechAPI = () => {
  if (!isBrowser) return false;
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
};

// ─── Error Boundary ───────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  state = { err: null };
  static getDerivedStateFromError(e) { return { err: e.message }; }
  render() {
    if (this.state.err) return (
      <div style={{ minHeight:'100vh', background:'#0a0a1a', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24, color:'white', textAlign:'center' }}>
        <AlertTriangle size={48} color="#ff4444" style={{ marginBottom:16 }}/>
        <h2 style={{ color:'#ff4444', marginBottom:12 }}>Something went wrong</h2>
        <p style={{ color:'#888', maxWidth:340, marginBottom:24 }}>{this.state.err}</p>
        <button onClick={() => window.location.reload()} style={{ padding:'10px 28px', border:'2px solid #00f3ff', borderRadius:999, color:'#00f3ff', background:'transparent', cursor:'pointer' }}>Reload</button>
      </div>
    );
    return this.props.children;
  }
}

// ─── Main App ─────────────────────────────────────────────────────────────────
function AppContent() {
  const [mobile, setMobile] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  
  useEffect(() => {
    setIsMounted(true);
    setMobile(isMobile());
  }, []);

  const [stage, setStage] = useState('HOME');    // HOME | READY | LIVE | DONE
  const [videoUrl, setVideoUrl] = useState('');
  const [captionMode, setCaptionMode] = useState('auto');
  const [micState, setMicState]   = useState('idle'); // idle | active | denied
  const [errorMsg, setErrorMsg]   = useState('');

  // Caption data
  const [captionGroups, setCaptionGroups] = useState([]); // [{id, start, end, words:[{text,color}]}]
  const [currentTime, setCurrentTime]     = useState(0);
  const [srtContent, setSrtContent]       = useState('');

  // Refs
  const videoRef      = useRef(null);
  const recRef        = useRef(null);
  const groupBufRef   = useRef([]);   // word buffer for current group
  const groupIdxRef   = useRef(0);
  const lastTimeRef   = useRef(0);
  const finalGroupsRef = useRef([]);  // accumulated final groups
  const rafRef        = useRef(null);

  // ── rAF loop for caption sync ─────────────────────────────────────────────
  useEffect(() => {
    const tick = () => {
      if (videoRef.current)
        setCurrentTime(videoRef.current.paused || videoRef.current.ended ? -1 : videoRef.current.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    if (stage === 'LIVE' || stage === 'DONE') rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [stage]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const getLang = () => {
    if (captionMode === 'en')       return 'en-US';
    if (captionMode === 'hi')       return 'hi-IN';
    if (captionMode === 'hinglish') return 'hi-IN';
    return (isBrowser && navigator.language) || 'en-US';
  };

  const flushBucket = useCallback((bucket, overrideEnd) => {
    if (!bucket.length) return;
    const start = bucket[0].start;
    const end   = overrideEnd ?? bucket[bucket.length - 1].end;
    const group = {
      id:    groupIdxRef.current++,
      start, end,
      words: bucket.map(w => ({ text: w.text, color: randColor() })),
    };
    finalGroupsRef.current = [...finalGroupsRef.current, group];
    setCaptionGroups([...finalGroupsRef.current]);
    return group;
  }, []);

  // ── File Upload ───────────────────────────────────────────────────────────
  const handleFile = useCallback((file) => {
    if (!file) return;
    if (!hasSpeechAPI()) {
      setErrorMsg('Your browser does not support the Web Speech API. Please use Chrome or Safari.');
      return;
    }
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setCaptionGroups([]);
    finalGroupsRef.current = [];
    groupIdxRef.current = 0;
    groupBufRef.current = [];
    lastTimeRef.current = 0;
    setSrtContent('');
    setStage('READY');
    setErrorMsg('');
  }, []);

  // ── Start captioning ──────────────────────────────────────────────────────
  const startCaptioning = useCallback(() => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) { setErrorMsg('Speech recognition not supported.'); return; }

    const rec = new SpeechRec();
    rec.continuous      = true;
    rec.interimResults  = true;
    rec.lang            = getLang();
    recRef.current      = rec;

    rec.onstart = () => setMicState('active');

    rec.onresult = (event) => {
      const t = videoRef.current?.currentTime ?? 0;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res    = event.results[i];
        const raw    = res[0].transcript.trim();
        const words  = raw.split(/\s+/).filter(Boolean);
        if (!words.length) continue;

        if (res.isFinal) {
          const segDur  = Math.max(0.1, t - lastTimeRef.current);
          const wDur    = segDur / words.length;
          words.forEach((w, wi) => {
            const wStart = lastTimeRef.current + wDur * wi;
            const wEnd   = lastTimeRef.current + wDur * (wi + 1);
            groupBufRef.current.push({ text: cleanText(w), start: wStart, end: wEnd });
            if (groupBufRef.current.length >= 3) {
              flushBucket(groupBufRef.current.slice());
              groupBufRef.current = [];
            }
          });
          lastTimeRef.current = t;
        }
      }
    };

    rec.onerror = (e) => {
      if (e.error === 'not-allowed') {
        setMicState('denied');
        setErrorMsg('Microphone access was denied. Please allow microphone permissions and try again.');
      } else if (e.error !== 'aborted' && e.error !== 'no-speech') {
        // Auto-restart on transient errors
        try { rec.start(); } catch {}
      }
    };

    rec.onend = () => {
      const vid = videoRef.current;
      if (vid && !vid.paused && !vid.ended) {
        setTimeout(() => { try { rec.start(); } catch {} }, 200);
      }
    };

    // Play video + start recognition together
    videoRef.current?.play();
    try {
      rec.start();
      setStage('LIVE');
    } catch (e) {
      setErrorMsg('Could not start recognition: ' + e.message);
    }
  }, [captionMode, flushBucket]);

  // ── Stop captioning ───────────────────────────────────────────────────────
  const stopCaptioning = useCallback(() => {
    try { recRef.current?.stop(); } catch {}
    videoRef.current?.pause();
    // Flush any remaining words
    if (groupBufRef.current.length) flushBucket(groupBufRef.current.slice(), videoRef.current?.currentTime);
    groupBufRef.current = [];
    setMicState('idle');

    // Build SRT
    const srt = finalGroupsRef.current.map((g, i) =>
      `${i+1}\n${toSrtTime(g.start)} --> ${toSrtTime(g.end)}\n${g.words.map(w=>w.text.toUpperCase()).join(' ')}\n`
    ).join('\n');
    setSrtContent(srt);
    setStage('DONE');
  }, [flushBucket]);

  const reset = () => {
    try { recRef.current?.stop(); } catch {}
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setCaptionGroups([]);
    finalGroupsRef.current = [];
    setVideoUrl('');
    setSrtContent('');
    setMicState('idle');
    setStage('HOME');
    setErrorMsg('');
  };

  const downloadSrt = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([srtContent], { type: 'text/plain' }));
    a.download = 'captions.srt'; a.click();
  };

  // ── Active caption group ──────────────────────────────────────────────────
  const activeGroup = useMemo(() => {
    if (!captionGroups.length || currentTime < 0) return null;
    return captionGroups.find(g => currentTime >= g.start && currentTime <= g.end + 0.5) || null;
  }, [captionGroups, currentTime]);

  // ── Language buttons ──────────────────────────────────────────────────────
  const langBtns = [
    { key:'en',      flag:'🇺🇸', label:'English',  color:'#3b82f6' },
    { key:'hi',      flag:'🇮🇳', label:'Hindi',    color:'#06b6d4' },
    { key:'hinglish',flag:'🇮🇳', label:'Hinglish', color:'#a855f7' },
    { key:'auto',    flag:'🌍',  label:'Auto',     color:'#ffffff' },
  ];

  const capFS = mobile ? '22px' : '30px';

  // ── Conditional card style ────────────────────────────────────────────────
  const card = mobile
    ? { background:'#111122', border:'1px solid #2a2a3a', borderRadius:16, padding:16 }
    : undefined; // glass-panel class for desktop

  const bgShells = mobile ? null : (
    <>
      <div className="space-bg"/><div className="nebula"/>
      <div className="particle-layer particle-layer-1">
        {Array.from({length:20}).map((_,i)=>(
          <div key={i} className="star" style={{
            top:`${Math.random()*100}%`,left:`${Math.random()*100}%`,
            width:`${Math.random()*3+1}px`,height:`${Math.random()*3+1}px`,
            animationDelay:`${Math.random()*5}s`}}/>
        ))}
      </div>
    </>
  );

  if (!isMounted) return null; // Final SSR safety check after all hooks have run

  return (
    <div style={{ minHeight:'100vh', background: mobile ? '#0a0a1a' : undefined, color:'white', position:'relative', overflowX:'hidden' }}>
      {bgShells}

      <style>{`
        @keyframes pop { 0%{transform:scale(0.85);opacity:0} 100%{transform:scale(1);opacity:1} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>

      <div className="relative min-h-screen flex flex-col items-center justify-start p-4 z-10 w-full">

        {/* ── Header ── */}
        <div style={{ width:'100%', display:'flex', justifyContent:'center', paddingTop:20, paddingBottom:8 }}>
          <h1 style={{
            fontFamily:'Orbitron,sans-serif', fontWeight:800, letterSpacing:'0.08em',
            fontSize: mobile ? 18 : 36, color:'white',
            textShadow: mobile ? 'none' : '0 0 20px #00f3ff',
            display:'flex', alignItems:'center', gap:10, margin:0
          }}>
            <Rocket color="#00f3ff" size={mobile ? 20 : 34}/>
            ZERO GRAVITY CAPTIONS
          </h1>
        </div>

        {/* ── Error ── */}
        {errorMsg && (
          <div style={{ position:'fixed', top:68, left:'50%', transform:'translateX(-50%)', background:'rgba(100,0,0,0.9)', border:'1px solid #f66', color:'#fcc', padding:'12px 18px', borderRadius:12, zIndex:200, maxWidth:360, width:'90%', textAlign:'center', fontSize:14, boxShadow:'0 0 20px rgba(255,0,0,0.4)' }}>
            {errorMsg}
            <button onClick={()=>setErrorMsg('')} style={{ marginLeft:10, textDecoration:'underline', background:'none', border:'none', color:'#fcc', cursor:'pointer', fontSize:12 }}>×</button>
          </div>
        )}

        {/* ══════════ HOME ══════════ */}
        {stage === 'HOME' && (
          <div style={{ width:'100%', maxWidth:560, marginTop:16, display:'flex', flexDirection:'column', gap:18 }}>

            {/* Supported check */}
            {!hasSpeechAPI() && (
              <div style={{ background:'rgba(120,60,0,0.7)', border:'1px solid #f90', borderRadius:12, padding:'12px 16px', color:'#ffc', fontSize:13, textAlign:'center' }}>
                ⚠️ Your browser doesn't support the Web Speech API. Please use <strong>Chrome</strong> or <strong>Safari</strong>.
              </div>
            )}

            {/* Instructions */}
            <div className={mobile ? '' : 'glass-panel'} style={mobile ? {...card, background:'rgba(0,243,255,0.07)', borderColor:'#00f3ff44'} : { padding:16, background:'rgba(0,243,255,0.07)', borderColor:'rgba(0,243,255,0.3)' }}>
              <p style={{ fontSize:13, color:'#aef', margin:0, lineHeight:1.7, textAlign:'center' }}>
                🎙 <strong>How it works:</strong> Upload a video, select a language, then click <strong>Start Captioning</strong>.<br/>
                The app listens via your <strong>microphone</strong> while the video plays — keep speakers on!<br/>
                <span style={{ color:'#facc15', fontSize:12 }}>Best on Chrome. Allow mic when prompted.</span>
              </p>
            </div>

            {/* Language selector */}
            <div style={{ display:'flex', flexWrap:'wrap', justifyContent:'center', gap:10 }}>
              {langBtns.map(({ key, flag, label, color }) => {
                const active = captionMode === key;
                return (
                  <button key={key} onClick={() => setCaptionMode(key)} style={{
                    minHeight:44, padding:'10px 18px', borderRadius:999,
                    border:`1.5px solid ${active ? color : 'rgba(255,255,255,0.18)'}`,
                    background: active ? `${color}22` : 'transparent',
                    boxShadow: active && !mobile ? `0 0 14px ${color}88` : 'none',
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
              className={mobile ? '' : 'glass-panel'}
              style={mobile ? { ...card, cursor:'pointer' } : { padding:24, borderRadius:24, cursor:'pointer' }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
              onClick={() => document.getElementById('fu').click()}
            >
              <div style={{ border:'2px dashed #00f3ff', borderRadius:16, padding: mobile ? '32px 16px' : '52px 24px', display:'flex', flexDirection:'column', alignItems:'center', gap:12 }}>
                <Upload color="#00f3ff" size={mobile ? 36 : 50}/>
                <p style={{ margin:0, fontSize: mobile ? 15 : 18, fontWeight:600 }}>Upload Video or Audio</p>
                <p style={{ margin:0, fontSize:13, color:'#777' }}>Tap or drag · MP4 / MOV / AVI / MP3 · Max 500MB</p>
                <p style={{ margin:0, fontSize:12, color:'#86efac', fontWeight:600 }}>🎬 Any length supported</p>
              </div>
              <input id="fu" type="file" accept="video/*,audio/*" style={{ display:'none' }} onChange={e => handleFile(e.target.files[0])}/>
            </div>
          </div>
        )}

        {/* ══════════ READY ══════════ */}
        {stage === 'READY' && (
          <div style={{ width:'100%', maxWidth:640, marginTop:16, display:'flex', flexDirection:'column', gap:16 }}>
            <div style={{ position:'relative', borderRadius:14, overflow:'hidden', background:'#000', aspectRatio:'16/9', border:'1px solid rgba(0,243,255,0.3)' }}>
              <video ref={videoRef} src={videoUrl} controls playsInline style={{ width:'100%', height:'100%', objectFit:'contain', display:'block' }}/>
            </div>

            <div style={{ display:'flex', flexWrap:'wrap', gap:12, justifyContent:'center' }}>
              <button onClick={startCaptioning} style={{
                minHeight:48, padding:'12px 28px', borderRadius:999,
                background:'linear-gradient(135deg,#00f3ff,#b800ff)',
                color:'white', border:'none', fontFamily:'Orbitron,sans-serif',
                fontWeight:800, fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', gap:10,
                boxShadow:'0 0 24px rgba(0,243,255,0.4)'
              }}>
                <Mic size={18}/> Start Captioning
              </button>
              <button onClick={reset} style={{
                minHeight:48, padding:'12px 20px', borderRadius:999,
                border:'1px solid #555', background:'transparent', color:'#aaa',
                fontFamily:'Orbitron,sans-serif', fontWeight:700, fontSize:13, cursor:'pointer'
              }}>
                Cancel
              </button>
            </div>

            <p style={{ textAlign:'center', color:'#888', fontSize:13, margin:0 }}>
              🔊 Turn speakers on · Allow mic when Chrome/Safari asks
            </p>
          </div>
        )}

        {/* ══════════ LIVE ══════════ */}
        {stage === 'LIVE' && (
          <div style={{ width:'100%', maxWidth:740, marginTop:16, display:'flex', flexDirection:'column', gap:16 }}>

            {/* Mic status pill */}
            <div style={{ display:'flex', justifyContent:'center' }}>
              <div style={{
                display:'flex', alignItems:'center', gap:8, padding:'8px 20px',
                borderRadius:999, border:'1.5px solid #00e676', background:'rgba(0,230,118,0.12)',
                animation:'pulse 1.5s ease-in-out infinite'
              }}>
                <Mic size={16} color="#00e676"/>
                <span style={{ fontFamily:'Orbitron,sans-serif', fontSize:12, fontWeight:700, color:'#00e676' }}>LIVE CAPTIONING</span>
              </div>
            </div>

            {/* Video + caption overlay */}
            <div style={{ position:'relative', borderRadius:14, overflow:'hidden', background:'#000', aspectRatio:'16/9', border:'1px solid rgba(0,243,255,0.25)' }}>
              <video ref={videoRef} src={videoUrl} controls playsInline style={{ width:'100%', height:'100%', objectFit:'contain', display:'block' }}/>

              {/* Caption overlay */}
              <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', width:'90%', pointerEvents:'none', zIndex:20 }}>
                {activeGroup && (
                  <div key={activeGroup.id} style={{ display:'flex', flexWrap:'wrap', justifyContent:'center', gap:8, animation:'pop 120ms ease-out forwards' }}>
                    {activeGroup.words.map((w, i) => {
                      const txt = cleanText(w.text);
                      if (!txt) return null;
                      return (
                        <span key={i} style={{
                          fontFamily:"'Impact','Anton',sans-serif",
                          fontSize: capFS, fontWeight:900,
                          textTransform:'uppercase', letterSpacing:'1px',
                          color: w.color,
                          WebkitTextStroke:'3px black', paintOrder:'stroke fill',
                          lineHeight:1.3,
                        }}>{txt}</span>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display:'flex', justifyContent:'center' }}>
              <button onClick={stopCaptioning} style={{
                minHeight:48, padding:'12px 28px', borderRadius:999,
                border:'2px solid #ff4444', background:'rgba(255,68,68,0.12)',
                color:'#ff6666', fontFamily:'Orbitron,sans-serif', fontWeight:800, fontSize:14, cursor:'pointer',
                display:'flex', alignItems:'center', gap:10
              }}>
                <MicOff size={18}/> Stop & Save
              </button>
            </div>
          </div>
        )}

        {/* ══════════ DONE ══════════ */}
        {stage === 'DONE' && (
          <div style={{ width:'100%', maxWidth:900, marginTop:16, display:'flex', flexDirection: mobile ? 'column' : 'row', gap:18, alignItems:'flex-start' }}>

            {/* Video panel */}
            <div className={mobile ? '' : 'glass-panel'} style={mobile ? { ...card, width:'100%' } : { width:'50%', padding:16 }}>
              <h3 style={{ fontFamily:'Orbitron,sans-serif', color:'#00f3ff', marginBottom:12, display:'flex', alignItems:'center', gap:8 }}>
                <Play size={18}/> Playback
              </h3>
              <div style={{ position:'relative', borderRadius:12, overflow:'hidden', background:'#000', aspectRatio:'16/9', border:'1px solid rgba(0,243,255,0.2)' }}>
                <video ref={videoRef} src={videoUrl} controls playsInline style={{ width:'100%', height:'100%', objectFit:'contain', display:'block' }}/>
                <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', width:'90%', pointerEvents:'none', zIndex:20 }}>
                  {activeGroup && (
                    <div key={activeGroup.id} style={{ display:'flex', flexWrap:'wrap', justifyContent:'center', gap:8, animation:'pop 120ms ease-out forwards' }}>
                      {activeGroup.words.map((w, i) => {
                        const txt = cleanText(w.text);
                        if (!txt) return null;
                        return (
                          <span key={i} style={{
                            fontFamily:"'Impact','Anton',sans-serif",
                            fontSize: capFS, fontWeight:900,
                            textTransform:'uppercase', letterSpacing:'1px',
                            color: w.color, WebkitTextStroke:'3px black', paintOrder:'stroke fill', lineHeight:1.3,
                          }}>{txt}</span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Actions + Transcript */}
            <div style={{ width: mobile ? '100%' : '50%', display:'flex', flexDirection:'column', gap:14 }}>
              <div className={mobile ? '' : 'glass-panel'} style={mobile ? { ...card, display:'flex', flexWrap:'wrap', gap:12, justifyContent:'center' } : { padding:18, display:'flex', flexWrap:'wrap', gap:12, justifyContent:'center' }}>
                <button onClick={downloadSrt} className="hologram-btn" style={{ minHeight:44, padding:'10px 20px', borderRadius:10, fontFamily:'Orbitron,sans-serif', fontWeight:700, display:'flex', alignItems:'center', gap:8 }}>
                  <Download size={16}/> Download SRT
                </button>
                <button onClick={reset} className="hologram-btn" style={{ minHeight:44, padding:'10px 20px', borderRadius:10, fontFamily:'Orbitron,sans-serif', fontWeight:700, display:'flex', alignItems:'center', gap:8, borderColor:'#fff', color:'#fff' }}>
                  <RefreshCw size={16}/> New Video
                </button>
              </div>

              <div className={mobile ? '' : 'glass-panel'} style={mobile ? { ...card, maxHeight:'35vh', overflowY:'auto' } : { padding:18, maxHeight:'40vh', overflowY:'auto' }}>
                <h3 style={{ fontFamily:'Orbitron,sans-serif', color:'#b800ff', marginBottom:10 }}>Transcript</h3>
                <pre style={{ color:'#ccc', fontSize:13, whiteSpace:'pre-wrap', lineHeight:1.7, margin:0 }}>
                  {srtContent || 'No captions captured yet.'}
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
  return <ErrorBoundary><AppContent/></ErrorBoundary>;
}
