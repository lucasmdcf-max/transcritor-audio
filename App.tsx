import React, { useState, useRef, useEffect } from 'react';
import { 
  Mic, Square, Loader2, Copy, RefreshCw, FileText, 
  AlertCircle, Upload, CheckCircle2, Languages, FileDown, 
  Sparkles, ListCheck, Search, Volume2, ShieldCheck, Zap
} from 'lucide-react';
import { AppStatus } from './types';
import { transcribeAudio, translateToPortuguese, summarizeText, extractActionItems } from './services/geminiService';
import { Visualizer } from './components/Visualizer';
import { AudioPlayer } from './components/AudioPlayer';
import { jsPDF } from 'jspdf';

const CHUNK_SIZE_MINUTES = 15;
const TRANSLATION_CHUNK_SIZE = 8000;

export const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [activeTab, setActiveTab] = useState<'transcript' | 'summary' | 'actions' | 'translation'>('transcript');
  
  // Audio & Data state
  const [transcription, setTranscription] = useState<string>("");
  const [summary, setSummary] = useState<string>("");
  const [actionItems, setActionItems] = useState<string>("");
  const [translatedText, setTranslatedText] = useState<string>("");
  
  // Loading states for AI actions
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isExtractingActions, setIsExtractingActions] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  
  // File & Playback state
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioFileName, setAudioFileName] = useState<string>("");
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  
  // UI Helpers
  const [searchQuery, setSearchQuery] = useState("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [recordingDuration, setRecordingDuration] = useState<number>(0);
  const [progress, setProgress] = useState<{current: number, total: number}>({current: 0, total: 0});
  const [copied, setCopied] = useState(false);
  
  // References
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  const startTimer = () => {
    setRecordingDuration(0);
    timerRef.current = window.setInterval(() => {
      setRecordingDuration(prev => prev + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleStartRecording = async () => {
    resetState();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const recordedBlob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType });
        const url = URL.createObjectURL(recordedBlob);
        setAudioUrl(url);
        setAudioFileName(`Gravação_${new Date().toLocaleTimeString('pt-BR')}.webm`);
        await processAudioInChunks(recordedBlob);
        stream.getTracks().forEach(track => track.stop());
        audioStreamRef.current = null;
      };

      mediaRecorder.start();
      setStatus(AppStatus.RECORDING);
      startTimer();
    } catch (err) {
      setErrorMessage("Não foi possível acessar o microfone. Verifique suas permissões.");
      setStatus(AppStatus.ERROR);
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      stopTimer();
      setStatus(AppStatus.PROCESSING);
    }
  };

  const handleFileSelect = async (file: File) => {
    if (!file.type.startsWith('audio/') && !file.name.match(/\.(mp3|wav|m4a|ogg|webm|aac|flac)$/i)) {
      setErrorMessage("Por favor, selecione um arquivo de áudio válido (.mp3, .wav, .m4a, .ogg, .webm).");
      setStatus(AppStatus.ERROR);
      return;
    }

    resetState();
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
    setAudioFileName(file.name);
    setStatus(AppStatus.PROCESSING);

    await processAudioInChunks(file);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await handleFileSelect(file);
      event.target.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await handleFileSelect(file);
    }
  };

  const processAudioInChunks = async (file: Blob) => {
    try {
      // Se o áudio for pequeno (menos de 3MB base64), envia direto
      if (file.size < 3 * 1024 * 1024) {
        setProgress({ current: 1, total: 1 });
        const mimeType = file.type || 'audio/mp3';
        const base64 = await blobToBase64(file);
        const chunkText = await transcribeAudio(base64, mimeType);
        setTranscription(chunkText.trim());
        setStatus(AppStatus.COMPLETED);
        return;
      }

      // Para áudios mais longos (como 15 min), fatia em blocos leves de 5 minutos
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      const duration = audioBuffer.duration;
      const chunkSizeInSeconds = 5 * 60; // 5 minutos por fatia
      const totalChunks = Math.ceil(duration / chunkSizeInSeconds);
      
      setProgress({ current: 0, total: totalChunks });
      let fullTranscript = "";

      for (let i = 0; i < totalChunks; i++) {
        setProgress(prev => ({ ...prev, current: i + 1 }));
        
        const start = i * chunkSizeInSeconds;
        const end = Math.min((i + 1) * chunkSizeInSeconds, duration);
        const chunkDuration = end - start;

        const offlineCtx = new OfflineAudioContext(
          audioBuffer.numberOfChannels,
          Math.max(1, Math.floor(chunkDuration * audioBuffer.sampleRate)),
          audioBuffer.sampleRate
        );
        
        const source = offlineCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(offlineCtx.destination);
        source.start(0, start, chunkDuration);
        
        const renderedBuffer = await offlineCtx.startRendering();
        const wavBlob = await bufferToWav(renderedBuffer);
        const base64 = await blobToBase64(wavBlob);
        
        const chunkText = await transcribeAudio(base64, "audio/wav");
        fullTranscript += (chunkText + " ");

        if (i < totalChunks - 1) {
          await new Promise(r => setTimeout(r, 500));
        }
      }

      setTranscription(fullTranscript.trim());
      setStatus(AppStatus.COMPLETED);
    } catch (error: any) {
      console.error("Erro no processamento:", error);
      // Fallback para envio direto se a decodificação do áudio falhar
      try {
        const mimeType = file.type || 'audio/mp3';
        const base64 = await blobToBase64(file);
        const chunkText = await transcribeAudio(base64, mimeType);
        setTranscription(chunkText.trim());
        setStatus(AppStatus.COMPLETED);
      } catch (err: any) {
        setErrorMessage(err.message || "Erro ao processar o áudio. Verifique sua conexão ou tente um arquivo menor.");
        setStatus(AppStatus.ERROR);
      }
    }
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      reader.readAsDataURL(blob);
    });
  };

  const bufferToWav = (buffer: AudioBuffer): Promise<Blob> => {
    return new Promise((resolve) => {
      const numOfChan = buffer.numberOfChannels,
        length = buffer.length * numOfChan * 2 + 44,
        bufferArr = new ArrayBuffer(length),
        view = new DataView(bufferArr),
        channels = [],
        sampleRate = buffer.sampleRate;
      let offset = 0, pos = 0;

      const setUint32 = (data: number) => { view.setUint32(pos, data, true); pos += 4; };
      const setUint16 = (data: number) => { view.setUint16(pos, data, true); pos += 2; };

      setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157);
      setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan);
      setUint32(sampleRate); setUint32(sampleRate * 2 * numOfChan);
      setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164);
      setUint32(length - pos - 4);

      for (let i = 0; i < numOfChan; i++) channels.push(buffer.getChannelData(i));

      while (pos < length) {
        for (let i = 0; i < numOfChan; i++) {
          let s = Math.max(-1, Math.min(1, channels[i][offset]));
          view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
          pos += 2;
        }
        offset++;
      }
      resolve(new Blob([bufferArr], { type: "audio/wav" }));
    });
  };

  // AI Feature Handlers
  const handleGenerateSummary = async () => {
    if (summary) {
      setActiveTab('summary');
      return;
    }
    setIsSummarizing(true);
    try {
      const res = await summarizeText(transcription);
      setSummary(res);
      setActiveTab('summary');
    } catch (err) {
      alert("Erro ao gerar resumo.");
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleExtractActions = async () => {
    if (actionItems) {
      setActiveTab('actions');
      return;
    }
    setIsExtractingActions(true);
    try {
      const res = await extractActionItems(transcription);
      setActionItems(res);
      setActiveTab('actions');
    } catch (err) {
      alert("Erro ao extrair tarefas.");
    } finally {
      setIsExtractingActions(false);
    }
  };

  const handleTranslate = async () => {
    if (translatedText) {
      setActiveTab('translation');
      return;
    }
    setIsTranslating(true);
    try {
      const chunks = transcription.match(new RegExp(`.{1,${TRANSLATION_CHUNK_SIZE}}`, 'g')) || [];
      let fullTranslation = "";
      for (let i = 0; i < chunks.length; i++) {
        const result = await translateToPortuguese(chunks[i]);
        fullTranslation += result + " ";
      }
      setTranslatedText(fullTranslation.trim());
      setActiveTab('translation');
    } catch (err) {
      alert("Erro ao traduzir o texto.");
    } finally {
      setIsTranslating(false);
    }
  };

  // Export Options
  const getCurrentTabContent = () => {
    switch (activeTab) {
      case 'summary': return summary || transcription;
      case 'actions': return actionItems || transcription;
      case 'translation': return translatedText || transcription;
      default: return transcription;
    }
  };

  const handleExportPDF = () => {
    const text = getCurrentTabContent();
    if (!text) return;

    const defaultTitle = audioFileName ? audioFileName.replace(/\.[^/.]+$/, "") : "Transcricao_Audio";
    const fileName = window.prompt("Nome do arquivo PDF:", defaultTitle) || defaultTitle;

    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 20;
      const maxLineWidth = pageWidth - margin * 2;

      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      doc.text(fileName, margin, 25);
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Gerado em ${new Date().toLocaleDateString('pt-BR')} • Categoria: ${activeTab.toUpperCase()}`, margin, 32);
      
      doc.setDrawColor(220, 226, 235);
      doc.line(margin, 36, pageWidth - margin, 36);

      doc.setFontSize(11);
      const splitText = doc.splitTextToSize(text, maxLineWidth);
      let cursorY = 44;

      for (let i = 0; i < splitText.length; i++) {
        if (cursorY > pageHeight - margin) {
          doc.addPage();
          cursorY = margin;
        }
        doc.text(splitText[i], margin, cursorY);
        cursorY += 6;
      }

      doc.save(`${fileName}.pdf`);
    } catch (err) {
      alert("Erro ao gerar arquivo PDF.");
    }
  };

  const handleExportTXT = () => {
    const text = getCurrentTabContent();
    if (!text) return;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${audioFileName || 'Transcricao'}_${activeTab}.txt`;
    link.click();
  };

  const handleExportMD = () => {
    const text = getCurrentTabContent();
    if (!text) return;
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${audioFileName || 'Transcricao'}_${activeTab}.md`;
    link.click();
  };

  const handleCopyText = () => {
    const text = getCurrentTabContent();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const resetState = () => {
    setStatus(AppStatus.IDLE);
    setTranscription("");
    setSummary("");
    setActionItems("");
    setTranslatedText("");
    setAudioUrl(null);
    setAudioFileName("");
    setErrorMessage("");
    setActiveTab('transcript');
    setProgress({current: 0, total: 0});
  };

  // Word count & statistics
  const currentContent = getCurrentTabContent();
  const wordCount = currentContent ? currentContent.trim().split(/\s+/).length : 0;
  const readingTimeMins = Math.ceil(wordCount / 200);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col selection:bg-indigo-500 selection:text-white">
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        className="hidden" 
        accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.aac,.flac" 
      />

      {/* Header */}
      <header className="bg-slate-900/80 backdrop-blur-xl border-b border-slate-800/80 sticky top-0 z-50 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-tr from-indigo-600 to-purple-600 rounded-xl text-white shadow-lg shadow-indigo-500/20">
              <Zap size={22} className="animate-pulse" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold tracking-tight text-white flex items-center gap-2">
                Transcritor IA Pro
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono">v2.0</span>
              </h1>
              <p className="text-xs text-slate-400 flex items-center gap-2 font-medium">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
                Gemini 3.6 Flash • Transcrição & Análise de Áudio em Alta Velocidade
              </p>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-4 text-xs text-slate-400 font-medium border-l border-slate-800 pl-6">
            <div className="flex items-center gap-1.5">
              <ShieldCheck size={16} className="text-emerald-400" />
              <span>Processamento Seguro</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-5xl mx-auto w-full p-6 flex flex-col gap-6">
        
        {/* Upload & Record Container */}
        <div 
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative rounded-3xl p-8 transition-all duration-300 border ${
            isDragging 
              ? 'bg-indigo-950/40 border-indigo-500 shadow-2xl shadow-indigo-500/20 scale-[1.01]' 
              : 'bg-slate-900/40 border-slate-800/80 hover:border-slate-700'
          } backdrop-blur-sm overflow-hidden`}
        >
          <div className="flex flex-col items-center justify-center gap-6 text-center max-w-xl mx-auto z-10 relative">
            
            {/* Visualizer & Mic Button */}
            <div className="relative flex flex-col items-center gap-4">
              {status === AppStatus.RECORDING && (
                <div className="absolute inset-0 rounded-full animate-ping bg-rose-500/20 z-0 scale-125"></div>
              )}

              {status === AppStatus.IDLE || status === AppStatus.COMPLETED || status === AppStatus.ERROR ? (
                <button 
                  onClick={handleStartRecording} 
                  className="group relative z-10 w-24 h-24 rounded-3xl bg-gradient-to-tr from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 active:scale-95 transition-all duration-200 flex flex-col items-center justify-center text-white shadow-xl shadow-indigo-600/30 border border-indigo-400/30"
                  title="Clique para iniciar gravação de áudio"
                >
                  <Mic size={32} className="group-hover:scale-110 transition-transform" />
                  <span className="text-[10px] font-bold mt-1 uppercase tracking-wider">Gravar</span>
                </button>
              ) : status === AppStatus.RECORDING ? (
                <button 
                  onClick={handleStopRecording} 
                  className="relative z-10 w-24 h-24 rounded-3xl bg-rose-600 hover:bg-rose-500 active:scale-95 transition-all flex flex-col items-center justify-center text-white shadow-xl shadow-rose-600/40 animate-pulse border border-rose-400/30"
                >
                  <Square size={32} fill="currentColor" />
                  <span className="text-[10px] font-bold mt-1 uppercase tracking-wider">Parar</span>
                </button>
              ) : (
                <div className="w-24 h-24 rounded-3xl bg-slate-800/80 border border-slate-700 flex flex-col items-center justify-center text-indigo-400">
                  <Loader2 size={36} className="animate-spin" />
                  <span className="text-[10px] font-bold mt-1 text-slate-400 uppercase tracking-wider">IA Ativa</span>
                </div>
              )}

              {/* Real Audio Frequency Waveform */}
              <div className="w-full max-w-sm mt-2">
                <Visualizer 
                  stream={audioStreamRef.current} 
                  isRecording={status === AppStatus.RECORDING} 
                  isPlaying={isPlayingAudio} 
                />
              </div>
            </div>

            {/* Dynamic Status Text & Progress */}
            <div className="space-y-3 w-full">
              <h2 className="text-xl font-bold text-slate-100">
                {status === AppStatus.IDLE && "Arraste um Áudio ou Clique para Gravá-lo"}
                {status === AppStatus.RECORDING && "Gravando Áudio em Tempo Real..."}
                {status === AppStatus.PROCESSING && `Processando segmento ${progress.current} de ${progress.total}`}
                {status === AppStatus.COMPLETED && "Transcrição Concluída com Sucesso!"}
                {status === AppStatus.ERROR && "Falha no Processamento"}
              </h2>

              {status === AppStatus.RECORDING && (
                <div className="font-mono text-2xl font-semibold text-rose-400 tabular-nums">
                  {formatTime(recordingDuration)}
                </div>
              )}

              {status === AppStatus.PROCESSING && (
                <div className="space-y-2 max-w-xs mx-auto">
                  <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden border border-slate-700">
                    <div 
                      className="bg-gradient-to-r from-indigo-500 to-purple-500 h-full transition-all duration-300"
                      style={{ width: `${(progress.current / (progress.total || 1)) * 100}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 font-medium">Analizando fala com Gemini 3.6 Flash...</p>
                </div>
              )}

              {status === AppStatus.IDLE && (
                <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                  Suporta arquivos de áudio <span className="text-slate-200 font-semibold">MP3, WAV, M4A, OGG, WEBM</span> e gravações diretas do microfone sem limite de tempo.
                </p>
              )}
            </div>

            {/* Select Audio File Button */}
            {(status === AppStatus.IDLE || status === AppStatus.COMPLETED || status === AppStatus.ERROR) && (
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button 
                  onClick={() => fileInputRef.current?.click()} 
                  className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 transition-all shadow-md active:scale-95"
                >
                  <Upload size={18} className="text-indigo-400" />
                  <span>Carregar Arquivo de Áudio</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Embedded Audio Player if file/recording is loaded */}
        {audioUrl && (
          <AudioPlayer 
            src={audioUrl} 
            fileName={audioFileName} 
            onPlayStateChange={(playing) => setIsPlayingAudio(playing)} 
          />
        )}

        {/* Error Alert Box */}
        {errorMessage && (
          <div className="bg-rose-950/40 border border-rose-800/80 rounded-2xl p-4 flex items-start gap-3 text-rose-300 text-sm backdrop-blur-sm">
            <AlertCircle className="shrink-0 mt-0.5 text-rose-400" size={20} />
            <div className="flex-1">
              <p className="font-bold">Ocorreu um erro</p>
              <p className="text-xs text-rose-400 mt-0.5">{errorMessage}</p>
              <button 
                onClick={resetState} 
                className="mt-3 px-3 py-1 bg-rose-900/60 hover:bg-rose-800/60 border border-rose-700/50 rounded-lg text-xs font-semibold text-rose-200 transition-colors"
              >
                Tentar Novamente
              </button>
            </div>
          </div>
        )}

        {/* Results Area */}
        {(status === AppStatus.COMPLETED || transcription) && (
          <div className="bg-slate-900/60 border border-slate-800/90 rounded-3xl overflow-hidden backdrop-blur-md shadow-2xl flex flex-col">
            
            {/* Top Toolbar: Tabs & AI Actions */}
            <div className="px-6 py-4 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-4 bg-slate-900/90">
              
              {/* Main Tabs */}
              <div className="flex items-center gap-1.5 p-1 bg-slate-950/80 rounded-xl border border-slate-800">
                <button
                  onClick={() => setActiveTab('transcript')}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    activeTab === 'transcript'
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <FileText size={15} />
                  <span>Transcrição Fiel</span>
                </button>

                <button
                  onClick={handleGenerateSummary}
                  disabled={isSummarizing}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    activeTab === 'summary'
                      ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                      : 'text-slate-400 hover:text-slate-200'
                  } disabled:opacity-50`}
                >
                  {isSummarizing ? <Loader2 size={15} className="animate-spin text-purple-300" /> : <Sparkles size={15} className="text-purple-400" />}
                  <span>Resumo IA</span>
                </button>

                <button
                  onClick={handleExtractActions}
                  disabled={isExtractingActions}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    activeTab === 'actions'
                      ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/30'
                      : 'text-slate-400 hover:text-slate-200'
                  } disabled:opacity-50`}
                >
                  {isExtractingActions ? <Loader2 size={15} className="animate-spin text-cyan-300" /> : <ListCheck size={15} className="text-cyan-400" />}
                  <span>Tarefas & Decisões</span>
                </button>

                <button
                  onClick={handleTranslate}
                  disabled={isTranslating}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    activeTab === 'translation'
                      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                      : 'text-slate-400 hover:text-slate-200'
                  } disabled:opacity-50`}
                >
                  {isTranslating ? <Loader2 size={15} className="animate-spin text-emerald-300" /> : <Languages size={15} className="text-emerald-400" />}
                  <span>Tradução</span>
                </button>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                
                {/* Export Dropdown options */}
                <div className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
                  <button
                    onClick={handleExportPDF}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                    title="Exportar como PDF"
                  >
                    <FileDown size={14} className="text-rose-400" />
                    <span>PDF</span>
                  </button>

                  <button
                    onClick={handleExportTXT}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                    title="Exportar como Texto"
                  >
                    <FileText size={14} className="text-indigo-400" />
                    <span>TXT</span>
                  </button>

                  <button
                    onClick={handleExportMD}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                    title="Exportar como Markdown"
                  >
                    <FileText size={14} className="text-cyan-400" />
                    <span>MD</span>
                  </button>
                </div>

                {/* Copy Button */}
                <button
                  onClick={handleCopyText}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all border ${
                    copied 
                      ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300' 
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  {copied ? <CheckCircle2 size={15} /> : <Copy size={15} />}
                  <span>{copied ? 'Copiado!' : 'Copiar'}</span>
                </button>

                {/* Reset Button */}
                <button 
                  onClick={resetState} 
                  className="p-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                  title="Limpar e Reiniciar"
                >
                  <RefreshCw size={16} />
                </button>
              </div>
            </div>

            {/* Sub-header with Search & Metrics */}
            <div className="px-6 py-3 bg-slate-950/40 border-b border-slate-800/60 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
              
              <div className="flex items-center gap-4">
                <span>Total de Palavras: <strong className="text-slate-200">{wordCount}</strong></span>
                <span>Tempo de Leitura: <strong className="text-slate-200">~{readingTimeMins} min</strong></span>
              </div>

              {/* Search Bar */}
              <div className="relative flex items-center min-w-[200px]">
                <Search size={14} className="absolute left-3 text-slate-500" />
                <input
                  type="text"
                  placeholder="Pesquisar no texto..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-950/80 border border-slate-800 rounded-lg pl-8 pr-3 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50"
                />
              </div>
            </div>

            {/* Text View Area */}
            <div className="p-8 min-h-[320px] relative bg-slate-950/20">
              <div className="prose prose-invert max-w-none">
                <p className="whitespace-pre-wrap text-slate-300 leading-relaxed text-base font-normal font-sans">
                  {currentContent ? (
                    searchQuery ? (
                      currentContent.split(new RegExp(`(${searchQuery})`, 'gi')).map((part, i) => 
                        part.toLowerCase() === searchQuery.toLowerCase() ? (
                          <mark key={i} className="bg-amber-500/30 text-amber-200 px-0.5 rounded border border-amber-500/50">{part}</mark>
                        ) : part
                      )
                    ) : (
                      currentContent
                    )
                  ) : (
                    <span className="italic text-slate-500">Nenhum conteúdo disponível nesta aba.</span>
                  )}
                </p>
              </div>
            </div>

          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="py-6 border-t border-slate-900 text-center text-slate-500 text-[11px] font-medium tracking-wide">
        <p>Desenvolvido com Gemini 3.6 Flash • Transcrição, Análise e Processamento de Áudio de Alta Performance</p>
      </footer>
    </div>
  );
};

export default App;
