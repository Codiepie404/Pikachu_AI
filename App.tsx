
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import Visualizer from './components/Visualizer';
import SystemPanel from './components/SystemPanel';
import { 
  createPcmBlob, 
  decode, 
  decodeAudioData, 
  SYSTEM_INSTRUCTION, 
  FUNCTION_DECLARATIONS 
} from './services/geminiLiveService';
import { 
  SystemAction, 
  SystemActionType, 
  TranscriptionItem, 
  AppConfig 
} from './types';
import { PYTHON_SYSTEM_CONTROLLER, PYTHON_VISUALIZER } from './constants';

const App: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [transcriptions, setTranscriptions] = useState<TranscriptionItem[]>([]);
  const [systemActions, setSystemActions] = useState<SystemAction[]>([]);
  const [config, setConfig] = useState<AppConfig>({ 
    voice: 'Zephyr', 
    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
    sensitivity: 'medium'
  });
  const [activeTab, setActiveTab] = useState<'visualizer' | 'code'>('visualizer');
  const [pythonTab, setPythonTab] = useState<'controller' | 'visualizer'>('controller');

  // Refs for Audio/Session
  const nextStartTimeRef = useRef(0);
  const audioContextInputRef = useRef<AudioContext | null>(null);
  const audioContextOutputRef = useRef<AudioContext | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sessionRef = useRef<any>(null);

  const addSystemAction = (type: SystemActionType, command: string) => {
    const newAction: SystemAction = {
      id: Math.random().toString(36).substr(2, 9),
      type,
      command,
      timestamp: Date.now(),
      status: 'success'
    };
    setSystemActions(prev => [newAction, ...prev].slice(0, 10));
  };

  const handleDisconnect = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
    if (audioContextInputRef.current) audioContextInputRef.current.close();
    if (audioContextOutputRef.current) audioContextOutputRef.current.close();
  }, []);

  const handleConnect = async () => {
    if (isConnecting) return;
    setIsConnecting(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const outputNode = outputCtx.createGain();
      outputNode.connect(outputCtx.destination);
      
      const analyser = outputCtx.createAnalyser();
      analyser.fftSize = 256;
      outputNode.connect(analyser);

      audioContextInputRef.current = inputCtx;
      audioContextOutputRef.current = outputCtx;
      outputNodeRef.current = outputNode;
      analyserRef.current = analyser;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const session = await ai.live.connect({
        model: config.model,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voice } },
          },
          systemInstruction: SYSTEM_INSTRUCTION,
          tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            setIsConnecting(false);
            
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              if (sessionRef.current) {
                sessionRef.current.sendRealtimeInput({ media: pcmBlob });
              }
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData && outputNodeRef.current) {
              const audioCtx = audioContextOutputRef.current!;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioCtx.currentTime);
              const buffer = await decodeAudioData(decode(audioData), audioCtx, 24000, 1);
              const source = audioCtx.createBufferSource();
              source.buffer = buffer;
              source.connect(outputNodeRef.current);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              source.addEventListener('ended', () => audioSourcesRef.current.delete(source));
              audioSourcesRef.current.add(source);
            }

            if (message.serverContent?.interrupted) {
              audioSourcesRef.current.forEach(s => s.stop());
              audioSourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }

            if (message.toolCall) {
              for (const fc of message.toolCall.functionCalls) {
                let type = SystemActionType.APP;
                let command = `${fc.name}(${JSON.stringify(fc.args)})`;

                if (fc.name.includes('volume')) type = SystemActionType.VOLUME;
                if (fc.name.includes('search') || fc.name.includes('open_site')) type = SystemActionType.WEB;
                if (fc.name.includes('brightness')) type = SystemActionType.BRIGHTNESS;
                if (fc.name.includes('power')) type = SystemActionType.POWER;

                addSystemAction(type, command);
                
                if (sessionRef.current) {
                  sessionRef.current.sendToolResponse({
                    functionResponses: { id: fc.id, name: fc.name, response: { result: "ok" } }
                  });
                }
              }
            }

            if (message.serverContent?.inputTranscription) {
              setTranscriptions(prev => [...prev, { sender: 'user', text: message.serverContent!.inputTranscription!.text, timestamp: Date.now() }].slice(-8));
            }
            if (message.serverContent?.outputTranscription) {
              setTranscriptions(prev => [...prev, { sender: 'ai', text: message.serverContent!.outputTranscription!.text, timestamp: Date.now() }].slice(-8));
            }
          },
          onclose: () => handleDisconnect(),
          onerror: () => handleDisconnect()
        }
      });

      sessionRef.current = session;
    } catch (err) {
      console.error(err);
      setIsConnecting(false);
    }
  };

  const formatTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="min-h-screen flex flex-col p-4 md:p-8 bg-[#050505] text-zinc-100">
      <header className="flex flex-col md:flex-row items-center justify-between gap-6 mb-8">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-cyan-400 to-cyan-600 flex items-center justify-center shadow-lg shadow-cyan-900/40">
            <svg className="w-8 h-8 text-black" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11.5,2C11.5,2 11.5,2 11.5,2M13.5,2C13.5,2 13.5,2 13.5,2M12,4.5C7,4.5 3,8.5 3,13.5C3,18.5 7,22.5 12,22.5C17,22.5 21,18.5 21,13.5C21,8.5 17,4.5 12,4.5M12,6.5C15.8,6.5 19,9.6 19,13.5C19,15.1 18.4,16.6 17.5,17.7C16.6,18.6 15.6,19.3 14.5,19.8L12,14.5L9.5,19.8C8.4,19.3 7.4,18.6 6.5,17.7C5.6,16.6 5,15.1 5,13.5C5,9.6 8.1,6.5 12,6.5M12,11A1,1 0 0,0 11,12A1,1 0 0,0 12,13A1,1 0 0,0 13,12A1,1 0 0,0 12,11Z" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Nova <span className="text-cyan-400">Assistant</span></h1>
            <p className="text-xs text-zinc-500 uppercase tracking-widest mono">Advanced Web & System Engine</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <div className="flex items-center gap-2">
             <span className="text-[10px] text-zinc-500 uppercase tracking-widest mono">Neural Voice</span>
             <select 
              className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-cyan-500 transition-all"
              value={config.voice}
              onChange={(e) => setConfig(prev => ({ ...prev, voice: e.target.value as any }))}
              disabled={isConnected}
            >
              <option value="Zephyr">American (Zephyr)</option>
              <option value="Puck">British (Puck)</option>
              <option value="Kore">American Female (Kore)</option>
              <option value="Charon">Sophisticated (Charon)</option>
            </select>
          </div>
          
          <button
            onClick={isConnected ? handleDisconnect : handleConnect}
            disabled={isConnecting}
            className={`px-6 py-2 rounded-lg font-semibold text-sm transition-all flex items-center gap-2 ${
              isConnected 
                ? 'bg-red-500/10 text-red-400 border border-red-500/50 hover:bg-red-500/20' 
                : 'bg-cyan-500 text-black hover:bg-cyan-400 disabled:opacity-50'
            }`}
          >
            {isConnecting ? (
              <><span className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" /> Awakening...</>
            ) : isConnected ? (
              <>Terminate</>
            ) : (
              <>Initiate Link</>
            )}
          </button>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 flex flex-col gap-6">
          <div className="glass rounded-2xl overflow-hidden flex flex-col flex-1 min-h-[500px]">
            <div className="flex border-b border-zinc-800 bg-zinc-900/50">
              <button onClick={() => setActiveTab('visualizer')} className={`px-6 py-4 text-sm font-medium transition-all ${activeTab === 'visualizer' ? 'text-cyan-400 border-b-2 border-cyan-400 bg-cyan-400/5' : 'text-zinc-500 hover:text-zinc-300'}`}>Interface</button>
              <button onClick={() => setActiveTab('code')} className={`px-6 py-4 text-sm font-medium transition-all ${activeTab === 'code' ? 'text-cyan-400 border-b-2 border-cyan-400 bg-cyan-400/5' : 'text-zinc-500 hover:text-zinc-300'}`}>Engine Logic</button>
            </div>

            <div className="flex-1 relative p-6 flex flex-col items-center justify-center bg-gradient-to-b from-transparent to-cyan-950/5">
              {activeTab === 'visualizer' ? (
                <div className="w-full h-full flex flex-col">
                  <div className="flex-1 flex items-center justify-center">
                    <Visualizer analyser={analyserRef.current} isActive={isConnected} color={isConnected ? "#06b6d4" : "#3f3f46"} />
                  </div>
                  <div className="w-full max-w-3xl mt-auto space-y-3 pb-4">
                    <div className="max-h-[220px] overflow-y-auto space-y-3 scrollbar-hide pr-2">
                      {transcriptions.map((t, i) => (
                        <div key={i} className={`flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300 ${t.sender === 'user' ? 'items-end' : 'items-start'}`}>
                          <div className="flex items-center gap-2 mb-1 px-1 text-[10px] mono text-zinc-500 uppercase">
                            {t.sender === 'ai' ? <span className="text-cyan-500 font-bold">NOVA</span> : <span className="text-zinc-400">USER</span>}
                            <span className="text-[8px] opacity-40">[{formatTime(t.timestamp)}]</span>
                          </div>
                          <div className={`text-sm px-4 py-2.5 rounded-2xl max-w-[85%] border shadow-sm leading-relaxed ${t.sender === 'user' ? 'bg-zinc-800 border-zinc-700 text-zinc-200 rounded-tr-none' : 'bg-cyan-500/10 border-cyan-500/20 text-cyan-50 shadow-cyan-900/20 rounded-tl-none'}`}>
                            {t.text}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="w-full h-full flex flex-col">
                  <div className="flex gap-2 mb-4 bg-zinc-950 p-1 rounded-lg w-fit self-center border border-zinc-800">
                    <button onClick={() => setPythonTab('controller')} className={`px-3 py-1.5 text-[10px] uppercase font-bold rounded ${pythonTab === 'controller' ? 'bg-cyan-500 text-black' : 'text-zinc-500'}`}>system_engine.py</button>
                    <button onClick={() => setPythonTab('visualizer')} className={`px-3 py-1.5 text-[10px] uppercase font-bold rounded ${pythonTab === 'visualizer' ? 'bg-cyan-500 text-black' : 'text-zinc-500'}`}>ui_galaxy.py</button>
                  </div>
                  <pre className="flex-1 bg-black/60 p-6 rounded-xl overflow-auto mono text-xs leading-relaxed text-cyan-200/70 border border-zinc-800 scrollbar-hide">
                    {pythonTab === 'controller' ? PYTHON_SYSTEM_CONTROLLER : PYTHON_VISUALIZER}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-4 flex flex-col gap-6">
          <div className="glass rounded-2xl p-6 flex-1 flex flex-col min-h-[400px]">
            <SystemPanel actions={systemActions} />
          </div>

          <div className="glass rounded-2xl p-6 bg-gradient-to-br from-zinc-900 to-black">
            <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">Core Pipeline</h4>
            <div className="space-y-4">
              {[
                { label: 'Web Intents', tech: 'WebHandler' },
                { label: 'Display Link', tech: 'screen-brightness-control' },
                { label: 'Decision Logic', tech: 'IntentRouter' },
                { label: 'Voice Synthesis', tech: 'Edge-TTS' }
              ].map((item, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] mono text-cyan-500 border border-cyan-900">{idx+1}</div>
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-zinc-300">{item.label}</p>
                    <p className="text-[10px] text-zinc-600 mono">{item.tech}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      <footer className="mt-8 flex items-center justify-between text-zinc-600 border-t border-zinc-900 pt-6 px-2">
        <div className="flex items-center gap-4 text-[10px] uppercase tracking-widest mono">
          <span className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-cyan-500 animate-pulse' : 'bg-red-500'}`} />
            Engine: {isConnected ? 'Synchronized' : 'Offline'}
          </span>
        </div>
        <div className="text-[10px] mono">NOVA-ARCH-V2.1 // NEURAL-EDGE-READY</div>
      </footer>
    </div>
  );
};

export default App;
