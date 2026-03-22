import React, { useState, useEffect, useRef, useMemo } from 'react';
import VanillaTilt from 'vanilla-tilt';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';
import { Upload, Rocket, Play, Download, Loader2, RefreshCw } from 'lucide-react';
import { transliterate } from 'transliteration';

const formatTimeSrt = (seconds) => {
  const pad = (num, size) => ('000' + num).slice(size * -1);
  const time = parseFloat(seconds).toFixed(3);
  const hours = Math.floor(time / 60 / 60);
  const minutes = Math.floor(time / 60) % 60;
  const secs = Math.floor(time - minutes * 60 - hours * 60 * 60);
  const milliseconds = time.slice(-3);
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)},${milliseconds}`;
};

const formatTimeVtt = (seconds) => {
  const pad = (num, size) => ('000' + num).slice(size * -1);
  const time = parseFloat(seconds).toFixed(3);
  const hours = Math.floor(time / 60 / 60);
  const minutes = Math.floor(time / 60) % 60;
  const secs = Math.floor(time - minutes * 60 - hours * 60 * 60);
  const milliseconds = time.slice(-3);
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)}.${milliseconds}`;
};

const srtFormat = (chunks) => {
  return chunks.map((chunk, i) => {
    return `${i + 1}\n${formatTimeSrt(chunk.timestamp[0])} --> ${formatTimeSrt(chunk.timestamp[1] || chunk.timestamp[0] + 1)}\n${chunk.text.trim()}\n`;
  }).join('\n');
};

const vttFormat = (chunks) => {
  return "WEBVTT\n\n" + chunks.map((chunk, i) => {
    return `${formatTimeVtt(chunk.timestamp[0])} --> ${formatTimeVtt(chunk.timestamp[1] || chunk.timestamp[0] + 1)}\n${chunk.text.trim()}\n`;
  }).join('\n');
};

function CursorTrail() {
  useEffect(() => {
    let dot = document.querySelector(".cursor-dot");
    if(!dot) {
      dot = document.createElement("div");
      dot.className = "cursor-dot";
      document.body.appendChild(dot);
    }
    const moveCursor = (e) => {
      dot.style.left = e.clientX + 'px';
      dot.style.top = e.clientY + 'px';
    };
    window.addEventListener('mousemove', moveCursor);
    return () => {
      window.removeEventListener('mousemove', moveCursor);
      if(dot && dot.parentNode) dot.parentNode.removeChild(dot);
    };
  }, []);
  return null;
}

export default function App() {
  const [stage, setStage] = useState('HOME'); // HOME, PROCESSING, RESULT
  const [videoFile, setVideoFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [captionMode, setCaptionMode] = useState('auto'); // 'en', 'hinglish', 'hi', 'auto'
  
  const [audioProgress, setAudioProgress] = useState(0);
  const [captionProgress, setCaptionProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState('');
  
  const [isModelDownloading, setIsModelDownloading] = useState(false);
  const [modelDownloadProgress, setModelDownloadProgress] = useState(0);
  
  const [srtCaptions, setSrtCaptions] = useState('');
  const [vttCaptions, setVttCaptions] = useState('');
  const [wordGroups, setWordGroups] = useState([]);
  const [currentTime, setCurrentTime] = useState(0);
  
  const [errorMsg, setErrorMsg] = useState('');

  const tiltRef = useRef(null);
  const workerRef = useRef(null);
  const ffmpegRef = useRef(new FFmpeg());
  const videoRef = useRef(null);

  useEffect(() => {
    if (tiltRef.current) {
      VanillaTilt.init(tiltRef.current, {
        max: 10,
        speed: 400,
        glare: true,
        'max-glare': 0.1,
      });
    }
  }, [stage]);

  // Handle worker setup
  useEffect(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    }
    const onMessageReceived = (e) => {
      const resp = e.data;
      if (resp.status === 'init' || resp.status === 'download') {
         setIsModelDownloading(true);
      }
      if (resp.type === 'progress') {
        if (resp.data.status === 'progress') {
           setIsModelDownloading(true);
           if (resp.data.progress) setModelDownloadProgress(Math.floor(resp.data.progress));
        }
      }
      if (resp.type === 'complete') {
        const { result, originalSettings } = resp;
        setIsModelDownloading(false);
        setCaptionProgress(100);
        setProgressMsg('Captions generated successfully!');
        
        let rawChunks = result.chunks || [];
        const mode = originalSettings?.captionMode || 'auto';
        const isHindiDetected = rawChunks.some(c => /[\u0900-\u097F]/.test(c.text));
        const shouldTransliterate = mode === 'hinglish' || (mode === 'auto' && isHindiDetected);

        const chunks = rawChunks.map(chunk => {
           let text = chunk.text;
           if (shouldTransliterate) {
              text = transliterate(text);
           }
           return { ...chunk, text };
        });

        setSrtCaptions(srtFormat(chunks));
        setVttCaptions(vttFormat(chunks));
        
        const indexedChunks = chunks.map((chunk, i) => ({ ...chunk, globalIndex: i }));
        const groups = [];
        let currentGroup = [];
        let groupIdx = 0;

        const createGroup = (wordsList, idx) => {
          let keywordIdx = 0;
          let maxLen = 0;
          for (let i = 0; i < wordsList.length; i++) {
            const clean = wordsList[i].text.replace(/[^\w]/g, '');
            if (clean.length > maxLen) {
              maxLen = clean.length;
              keywordIdx = i;
            }
          }
          // Provide a completely random bright hex combination out of all 16.7 million shade combinations for every group
          const hue = Math.floor(Math.random() * 360);
          const saturation = 80 + Math.random() * 20; // 80-100%
          const lightness = 50 + Math.random() * 10; // 50-60% brightness
          const keywordColor = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
          const start = wordsList[0].timestamp[0];
          const lastW = wordsList[wordsList.length - 1];
          const end = (lastW.timestamp[1] !== null && lastW.timestamp[1] !== undefined) ? lastW.timestamp[1] : lastW.timestamp[0] + 0.2;
          
          return {
            id: idx,
            start,
            end,
            words: wordsList.map((w, i) => ({
              ...w,
              isKeyword: i === keywordIdx,
              color: i === keywordIdx ? keywordColor : '#FFFFFF'
            }))
          };
        };

        for (let i = 0; i < indexedChunks.length; i++) {
          const w = indexedChunks[i];
          if (currentGroup.length > 0) {
            const lastW = currentGroup[currentGroup.length - 1];
            const lastEnd = (lastW.timestamp[1] !== null && lastW.timestamp[1] !== undefined) ? lastW.timestamp[1] : lastW.timestamp[0] + 0.2;
            const gap = w.timestamp[0] - lastEnd;
            if (gap > 0.4 || currentGroup.length >= 3) {
              groups.push(createGroup(currentGroup, groupIdx++));
              currentGroup = [];
            }
          }
          currentGroup.push(w);
        }
        if (currentGroup.length > 0) {
          groups.push(createGroup(currentGroup, groupIdx++));
        }

        setWordGroups(groups);
        
        // Immediately navigate to result page, no timeout
        setStage('RESULT');
      }
      if (resp.type === 'error') {
        setErrorMsg('Transcription failed or timed out: ' + resp.error + ' Please try again or use a shorter clip.');
        setStage('HOME');
      }
    };
    workerRef.current.addEventListener('message', onMessageReceived);
    return () => workerRef.current.removeEventListener('message', onMessageReceived);
  }, []);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 500 * 1024 * 1024) {
      setErrorMsg('File too large. Maximum size is 500MB.');
      return;
    }
    const url = URL.createObjectURL(file);
    setVideoFile(file);
    setVideoUrl(url);
    processVideo(file);
  };
  
  const handleDragOver = (e) => { e.preventDefault(); };
  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload({ target: { files: [e.dataTransfer.files[0]] } });
    }
  };

  const processVideo = async (file) => {
    setStage('PROCESSING');
    setErrorMsg('');
    setAudioProgress(0);
    setCaptionProgress(0);
    setIsModelDownloading(false);
    
    try {
      setProgressMsg('Warming up the warp drive (FFmpeg)...');
      let ffmpeg = ffmpegRef.current;
      
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
      if (!ffmpeg.loaded) {
        await ffmpeg.load({
          coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
      }

      ffmpeg.on('progress', ({ progress }) => {
        setAudioProgress(Math.round(progress * 100));
        setProgressMsg('Extracting audio from the cosmos...');
      });

      await ffmpeg.writeFile('input_video', await fetchFile(file));
      // Extract audio: 16kHz, mono (required for whisper)
      await ffmpeg.exec(['-i', 'input_video', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', 'output.wav']);
      setProgressMsg('Audio extracted! Calibrating AI sensors...');
      
      const audioData = await ffmpeg.readFile('output.wav');
      const audioBuffer = new Uint8Array(audioData).buffer;

      // Decode audio
      setProgressMsg('Decoding audio for Whisper...');
      let audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      let decodedAudio = await audioCtx.decodeAudioData(audioBuffer);
      let float32Audio = decodedAudio.getChannelData(0); // Whisper needs Float32Array 16kHz mono
      
      setProgressMsg('Whisper AI is reading your video...');
      setAudioProgress(100);
      
      let whisperLang = undefined;
      if (captionMode === 'en') whisperLang = 'en';
      if (captionMode === 'hi' || captionMode === 'hinglish') whisperLang = 'hi';

      // Send to worker
      workerRef.current.postMessage({ type: 'generate', audioData: float32Audio, language: whisperLang, captionMode }, [float32Audio.buffer]);
      
      // Simulating some visual progress while worker is busy
      let sim = 0;
      const progressInt = setInterval(() => {
        sim += 2;
        if (sim < 98) setCaptionProgress(sim);
        else clearInterval(progressInt);
      }, 500);

    } catch (err) {
      console.error(err);
      setErrorMsg('An error occurred during processing: ' + err.message);
      setStage('HOME');
    }
  };

  const downloadFile = (content, filename) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(u);
  };

  const reset = () => {
    setStage('HOME');
    setVideoFile(null);
    setVideoUrl('');
    setSrtCaptions('');
    setVttCaptions('');
    setWordGroups([]);
  };

  // Use requestAnimationFrame for precise sync as requested
  useEffect(() => {
    let animationFrameId;
    const loop = () => {
      if (videoRef.current && stage === 'RESULT') {
        if (videoRef.current.paused || videoRef.current.ended) {
          setCurrentTime(-1); // Hide captions when paused
        } else {
          setCurrentTime(videoRef.current.currentTime);
        }
      }
      animationFrameId = requestAnimationFrame(loop);
    };
    if (stage === 'RESULT') {
      animationFrameId = requestAnimationFrame(loop);
    }
    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [stage]);

  // Find the exact single active group strictly bounded
  const activeGroup = useMemo(() => {
    if (!wordGroups || wordGroups.length === 0 || currentTime < 0) return null;
    return wordGroups.find(g => currentTime >= g.start && currentTime <= g.end);
  }, [wordGroups, currentTime]);

  return (
    <>
      <CursorTrail />
      {/* Background purely CSS */}
      <div className="space-bg" />
      <div className="bg-objects"><div className="css-ring" style={{ width: '400px', height: '400px', top: '10%', left: '20%' }}/></div>
      <div className="bg-objects"><div className="css-ring" style={{ width: '600px', height: '600px', bottom: '-10%', right: '-10%', animationDirection: 'reverse' }}/></div>
      <div className="nebula" />
      <div className="particle-layer particle-layer-1">
        {Array.from({length: 30}).map((_, i) => (
          <div key={i} className="star" style={{ top: `${Math.random() * 100}%`, left: `${Math.random() * 100}%`, width: `${Math.random() * 3 + 1}px`, height: `${Math.random() * 3 + 1}px`, animationDelay: `${Math.random() * 5}s` }}/>
        ))}
      </div>

      <style>{`
        @keyframes opusPop {
          0% { transform: scale(0.9); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>

      <div className="relative min-h-screen flex flex-col items-center justify-center p-6 z-10 w-full">
        
        {/* Header */}
        <div className="absolute top-8 left-0 w-full flex justify-center text-center px-4 animate-float">
          <h1 className="text-4xl md:text-6xl font-orbitron font-bold neon-text text-white tracking-widest flex items-center gap-4">
            <Rocket className="text-neonBlue" size={48} />
            ZERO GRAVITY CAPTIONS
          </h1>
        </div>

        {errorMsg && (
          <div className="absolute top-28 bg-red-900/50 border border-red-500 text-red-100 px-6 py-3 rounded-xl shadow-[0_0_15px_rgba(255,0,0,0.5)] backdrop-blur-md z-50 animate-bounce">
            {errorMsg}
          </div>
        )}

        {/* Home Stage */}
        {stage === 'HOME' && (
          <div className="tilt-wrapper w-full max-w-2xl mt-24 flex flex-col items-center">
            
            <div className="flex flex-wrap justify-center gap-4 mb-8">
               <button 
                  onClick={() => setCaptionMode('en')}
                  className={`px-6 py-3 rounded-full font-orbitron font-bold flex items-center gap-2 transition-all duration-300 border backdrop-blur-md ${captionMode==='en' ? 'bg-blue-500/30 border-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.5)] text-white' : 'border-white/20 text-gray-400 hover:border-white/50'}`}
               >🇺🇸 English</button>
               <button 
                  onClick={() => setCaptionMode('hinglish')}
                  className={`px-6 py-3 rounded-full font-orbitron font-bold flex items-center gap-2 transition-all duration-300 border backdrop-blur-md ${captionMode==='hinglish' ? 'bg-purple-500/30 border-purple-400 shadow-[0_0_20px_rgba(168,85,247,0.5)] text-white' : 'border-white/20 text-gray-400 hover:border-white/50'}`}
               >🇮🇳 Hinglish</button>
               <button 
                  onClick={() => setCaptionMode('hi')}
                  className={`px-6 py-3 rounded-full font-orbitron font-bold flex items-center gap-2 transition-all duration-300 border backdrop-blur-md ${captionMode==='hi' ? 'bg-cyan-500/30 border-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.5)] text-white' : 'border-white/20 text-gray-400 hover:border-white/50'}`}
               >🇮🇳 Hindi</button>
               <button 
                  onClick={() => setCaptionMode('auto')}
                  className={`px-6 py-3 rounded-full font-orbitron font-bold flex items-center gap-2 transition-all duration-300 border backdrop-blur-md ${captionMode==='auto' ? 'bg-white/30 border-white shadow-[0_0_20px_rgba(255,255,255,0.5)] text-white' : 'border-white/20 text-gray-400 hover:border-white/50'}`}
               >🌍 Auto Detect</button>
            </div>

            <div ref={tiltRef} className="w-full glass-panel tilt-inner p-10 flex flex-col items-center justify-center text-center rounded-3xl group transition-all duration-300 transform preserve-3d">
              
              <div 
                className="w-full h-80 border-2 border-dashed border-neonBlue rounded-2xl flex flex-col items-center justify-center cursor-pointer relative overflow-hidden group-hover:border-neonPurple transition-colors duration-500 hologram-scan"
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={() => document.getElementById('file-upload').click()}
              >
                <div className="absolute inset-0 bg-neonBlue/5 group-hover:bg-neonPurple/10 transition-colors duration-500" />
                <Upload className="w-20 h-20 text-neonBlue mb-6 group-hover:scale-110 group-hover:text-neonPurple transition-transform duration-500 animate-float" />
                <p className="text-xl text-gray-200 font-exo font-semibold z-10">Deploy Video to Force Field</p>
                <p className="text-sm text-gray-400 mt-2 z-10">(Drag & Drop or Click. Max 500MB, MP4/AVI/MOV)</p>
                <input id="file-upload" type="file" accept="video/mp4,video/x-m4v,video/*,audio/*" className="hidden" onChange={handleFileUpload} />
              </div>

            </div>
          </div>
        )}

        {/* Processing Stage */}
        {stage === 'PROCESSING' && (
          <div className="flex flex-col items-center justify-center w-full max-w-xl animate-float">
            <div className="relative w-64 h-64 flex items-center justify-center mb-8">
              <div className="absolute w-full h-full rounded-full border-4 border-t-neonBlue border-r-transparent border-b-neonPurple border-l-transparent animate-spin" style={{animationDuration: '3s'}} />
              <div className="absolute w-4/5 h-4/5 rounded-full border-4 border-t-transparent border-r-neonCyan border-b-transparent border-l-neonBlue animate-spin" style={{animationDuration: '2s', animationDirection: 'reverse'}} />
              <Loader2 className="w-16 h-16 text-white animate-spin" />
            </div>

            <h2 className="text-2xl font-orbitron neon-text mb-6 tracking-wider text-center">{progressMsg}</h2>
            
            <div className="w-full glass-panel p-6 space-y-6">
              <div>
                <div className="flex justify-between mb-2">
                  <span className="text-sm font-semibold text-neonBlue">Audio Extraction</span>
                  <span className="text-sm text-gray-300">{audioProgress}%</span>
                </div>
                <div className="w-full bg-spaceDark rounded-full h-3 overflow-hidden border border-glassBorder">
                  <div className="bg-neonBlue h-3 rounded-full transition-all duration-300 shadow-[0_0_10px_#00f3ff]" style={{ width: `${audioProgress}%` }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between mb-2">
                  <span className="text-sm font-semibold text-neonPurple">Caption Generation</span>
                  <span className="text-sm text-gray-300">{captionProgress}%</span>
                </div>
                <div className="w-full bg-spaceDark rounded-full h-3 overflow-hidden border border-glassBorder">
                  <div className="bg-neonPurple h-3 rounded-full transition-all duration-300 shadow-[0_0_10px_#b800ff]" style={{ width: `${captionProgress}%` }} />
                </div>
              </div>

              {isModelDownloading && (
                 <div className="mt-4 p-4 bg-blue-900/40 border border-blue-500 rounded-lg text-center animate-pulse">
                    <p className="text-blue-200 text-sm">Downloading AI model for the first time — this takes 1 minute only once and is cached in your browser.</p>
                    <div className="mt-2 w-full bg-spaceDark rounded-full h-2">
                      <div className="bg-blue-400 h-2 rounded-full" style={{ width: `${modelDownloadProgress}%` }}></div>
                    </div>
                 </div>
              )}
            </div>
          </div>
        )}

        {/* Result Stage */}
        {stage === 'RESULT' && (
          <div className="w-full max-w-6xl mt-24 flex flex-col lg:flex-row gap-8 items-start justify-center animate-float-delay">
            {/* Holographic Video Player */}
            <div className="w-full lg:w-1/2 glass-panel p-4 flex flex-col relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-neonBlue to-neonPurple" />
              <h3 className="text-xl font-orbitron text-neonBlue mb-4 flex items-center gap-2">
                <Play size={20} /> Preview
              </h3>
              <div className="relative rounded-xl overflow-hidden bg-spaceDark w-full aspect-video border border-neonBlue/30 shadow-[0_0_20px_rgba(0,243,255,0.2)]">
                <div className="absolute inset-0 pointer-events-none bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(0,243,255,0.05)_2px,rgba(0,243,255,0.05)_4px)] z-10 mix-blend-screen opacity-50"/>
                
                <video 
                  ref={videoRef}
                  src={videoUrl} 
                  controls 
                  className="w-full h-full object-contain relative z-20"
                />
                
                {/* Minimal Opus Style Box Overlay */}
                <div 
                   className="absolute pointer-events-none z-30 flex justify-center"
                   style={{
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      width: '90%'
                   }}
                >
                   {activeGroup && (
                      <div 
                        key={activeGroup.id}
                        className="flex flex-wrap justify-center items-center w-full"
                        style={{
                          animation: 'opusPop 120ms ease-out forwards',
                          gap: '8px'
                        }}
                      >
                        {activeGroup.words.map((w, idx) => {
                          const cleanText = w.text.replace(/[^a-zA-Z0-9\s]/g, '');
                          if (!cleanText) return null;
                          return (
                            <span
                              key={idx}
                              style={{
                                fontFamily: "'Impact', 'Anton', sans-serif",
                                fontSize: '26px',
                                fontWeight: 900,
                                textTransform: 'uppercase',
                                letterSpacing: '1px',
                                color: w.color,
                                WebkitTextStroke: '3px black',
                                paintOrder: 'stroke fill',
                                lineHeight: 1.2,
                                textShadow: 'none'
                              }}
                            >
                              {cleanText}
                            </span>
                          );
                        })}
                      </div>
                   )}
                </div>
                
              </div>
            </div>

            {/* Actions & Captions Panel */}
            <div className="w-full lg:w-1/2 flex flex-col gap-6">
              
              <div className="glass-panel p-6 flex flex-col sm:flex-row gap-4 justify-between items-center">
                <button onClick={() => downloadFile(srtCaptions, 'captions.srt')} className="hologram-btn px-6 py-3 rounded-lg font-orbitron font-bold flex items-center gap-2 w-full sm:w-auto justify-center">
                  <Download size={20} /> Download SRT
                </button>
                <button onClick={() => downloadFile(vttCaptions, 'captions.vtt')} className="hologram-btn px-6 py-3 rounded-lg border-neonPurple text-neonPurple hover:bg-neonPurple/20 hover:text-white hover:shadow-[0_0_20px_#b800ff] font-orbitron font-bold flex items-center gap-2 w-full sm:w-auto justify-center">
                  <Download size={20} /> Download VTT
                </button>
                <button onClick={reset} className="hologram-btn flex-1 px-6 py-3 rounded-lg border-white text-white hover:bg-white/20 hover:shadow-[0_0_20px_white] font-orbitron font-bold flex items-center gap-2 w-full sm:w-auto justify-center">
                  <RefreshCw size={20} /> Restart
                </button>
              </div>

              <div className="glass-panel p-6 flex-1 max-h-[50vh] overflow-y-auto w-full relative">
                <h3 className="text-xl font-orbitron text-neonPurple mb-4 sticky top-0 bg-glassBg backdrop-blur-md py-2 z-10">Transcript</h3>
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
