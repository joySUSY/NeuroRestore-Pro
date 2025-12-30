import React, { useState, useRef, useEffect } from 'react';
import ControlPanel from './components/ControlPanel';
import ComparisonSlider from './components/ComparisonSlider';
import CanvasEditor, { CanvasEditorRef } from './components/CanvasEditor';
import LayerPanel from './components/LayerPanel';
import { analyzeImageIssues, restoreOrEditImage, generateNewImage, inpaintImage, fileToGenerativePart, vectorizeImage, extractText } from './services/geminiService';
import { AppMode, RestorationConfig, ImageType, Resolution, AspectRatio, ProcessingState, AnalysisResult, ColorStyle } from './types';

const App: React.FC = () => {
  // Authentication State
  const [hasKey, setHasKey] = useState<boolean>(false);
  const [isCheckingKey, setIsCheckingKey] = useState<boolean>(true);

  // App State
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  // Display Image is the one actually shown (can be modified by LayerPanel, unlike processedImage which is source of truth)
  const [displayImage, setDisplayImage] = useState<string | null>(null);
  
  const [mimeType, setMimeType] = useState<string>('image/jpeg');
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [mode, setMode] = useState<AppMode>(AppMode.RESTORATION);
  
  // Ref for Canvas Editor
  const canvasRef = useRef<CanvasEditorRef>(null);

  const [config, setConfig] = useState<RestorationConfig>({
    imageType: ImageType.DOCUMENT,
    customPrompt: '',
    resolution: Resolution.QHD_2K, // Balanced default
    aspectRatio: AspectRatio.ORIGINAL, // Default to Original for best restoration UX
    colorStyle: ColorStyle.TRUE_TONE, // Default to strict fidelity
    brushSize: 40,
    maskBlendMode: 'add',
    vectorDetail: 'MEDIUM',
    vectorColor: 'COLOR'
  });

  const [processing, setProcessing] = useState<ProcessingState>({
    isProcessing: false,
    stage: 'idle',
    error: null,
    progressMessage: ''
  });

  // Check for API Key on mount
  useEffect(() => {
    checkKey();
  }, []);

  const checkKey = async () => {
    try {
        if ((window as any).aistudio) {
            const selected = await (window as any).aistudio.hasSelectedApiKey();
            setHasKey(selected);
        } else {
            // Fallback for environments without window.aistudio (e.g. local dev with .env)
            setHasKey(true);
        }
    } catch (e) {
        console.error("Failed to check API key status", e);
        setHasKey(false);
    } finally {
        setIsCheckingKey(false);
    }
  };

  const handleSelectKey = async () => {
    if ((window as any).aistudio) {
        try {
            await (window as any).aistudio.openSelectKey();
            // Race condition mitigation: assume success after flow completes
            setHasKey(true);
        } catch (e) {
            console.error("Failed to select key", e);
        }
    }
  };

  const handleAuthError = (error: any) => {
      const msg = error.message || '';
      if (
          msg.includes("Requested entity was not found") || 
          msg.includes("UNAUTHENTICATED") || 
          msg.includes("401") ||
          msg.includes("API keys are not supported")
      ) {
          setHasKey(false);
          return "Session expired or API Key invalid. Please reconnect your API Key.";
      }
      return msg;
  };

  // Handlers
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setProcessing({ isProcessing: true, stage: 'analyzing', error: null, progressMessage: 'Uploading...' });
    setProcessedImage(null);
    setDisplayImage(null);
    setAnalysis(null);
    // Reset mode to RESTORATION unless we are already in Vectorization
    if (mode !== AppMode.VECTORIZATION && mode !== AppMode.EXTRACT_TEXT) {
        setMode(AppMode.RESTORATION); 
    }

    try {
      const base64 = await fileToGenerativePart(file);
      const dataUrl = `data:${file.type};base64,${base64}`;
      setOriginalImage(dataUrl);
      setMimeType(file.type);

      // Auto-analyze
      setProcessing(prev => ({ ...prev, progressMessage: 'Gemini is thinking: Analyzing defects & Type...' }));
      const analysisResult = await analyzeImageIssues(base64, file.type);
      setAnalysis(analysisResult);
      
      // Auto-set Image Type based on analysis
      if (analysisResult.detectedType) {
          setConfig(prev => ({
              ...prev,
              imageType: analysisResult.detectedType as ImageType
          }));
      }

      setProcessing({ isProcessing: false, stage: 'idle', error: null, progressMessage: '' });
    } catch (error: any) {
      const errorMsg = handleAuthError(error);
      setProcessing({ isProcessing: false, stage: 'error', error: errorMsg, progressMessage: '' });
    }
  };

  const handleProcess = async () => {
    // Map mode to stage string
    let stageStr: ProcessingState['stage'] = 'restoring';
    if (mode === AppMode.GENERATION) stageStr = 'generating';
    if (mode === AppMode.INPAINTING) stageStr = 'inpainting';
    if (mode === AppMode.VECTORIZATION) stageStr = 'vectorizing';
    if (mode === AppMode.EXTRACT_TEXT) stageStr = 'extracting_text';

    setProcessing({ isProcessing: true, stage: stageStr, error: null, progressMessage: 'Initiating neural engine...' });

    try {
      let resultUrl = '';
      
      if (mode === AppMode.RESTORATION) {
        if (!originalImage) throw new Error("Please upload an image first.");
        const base64 = originalImage.split(',')[1];
        setProcessing(prev => ({ ...prev, progressMessage: 'Phase 1: Descreening & Dot Melting...' }));
        resultUrl = await restoreOrEditImage(base64, mimeType, config, analysis || undefined);
      } 
      else if (mode === AppMode.INPAINTING) {
          if (!canvasRef.current) throw new Error("Canvas not initialized");
          // Get image from canvas (which includes the mask/outpainting borders)
          const canvasDataUrl = canvasRef.current.getImageData();
          const base64 = canvasDataUrl.split(',')[1];
          setProcessing(prev => ({ ...prev, progressMessage: 'Inpainting/Outpainting regions...' }));
          resultUrl = await inpaintImage(base64, 'image/png', config);
      }
      else if (mode === AppMode.VECTORIZATION) {
          if (!originalImage) throw new Error("Please upload an image first.");
          const base64 = originalImage.split(',')[1];
          setProcessing(prev => ({ ...prev, progressMessage: 'Tracing topology & separating layers...' }));
          resultUrl = await vectorizeImage(base64, mimeType, config);
      }
      else if (mode === AppMode.EXTRACT_TEXT) {
          if (!originalImage) throw new Error("Please upload an image first.");
          const base64 = originalImage.split(',')[1];
          setProcessing(prev => ({ ...prev, progressMessage: 'Isolating textual semantics & removing background...' }));
          resultUrl = await extractText(base64, mimeType);
      }
      else {
        if (!config.customPrompt) throw new Error("Please provide a prompt for generation.");
        setProcessing(prev => ({ ...prev, progressMessage: 'Generating new visual data...' }));
        resultUrl = await generateNewImage(config.customPrompt, config);
      }

      setProcessedImage(resultUrl);
      setDisplayImage(resultUrl); // Initialize display image with result
      
      // If Inpainting, update the canvas source to the new result so user can continue editing
      if (mode === AppMode.INPAINTING) {
          setOriginalImage(resultUrl);
      }

      setProcessing({ isProcessing: false, stage: 'complete', error: null, progressMessage: '' });

    } catch (error: any) {
       const errorMsg = handleAuthError(error);
       setProcessing({ isProcessing: false, stage: 'error', error: errorMsg, progressMessage: '' });
    }
  };

  const handleDownload = () => {
      // If LayerPanel is active, it handles its own download. 
      // This is a fallback or for non-vector modes.
      if (displayImage) {
          const link = document.createElement('a');
          link.href = displayImage;
          const ext = (mode === AppMode.VECTORIZATION || mode === AppMode.EXTRACT_TEXT) ? 'svg' : 'png';
          link.download = `neuro_output_${Date.now()}.${ext}`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
      }
  };

  // --- Auth & Loading Screens ---

  if (isCheckingKey) {
      return (
        <div className="bg-gray-950 h-screen w-full flex items-center justify-center">
            <div className="text-cyan-500 animate-pulse text-sm font-mono">INITIALIZING NEURO-CORE...</div>
        </div>
      );
  }

  if (!hasKey) {
      return (
        <div className="bg-gray-950 h-screen w-full flex items-center justify-center p-4 relative overflow-hidden">
            <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')] opacity-50"></div>
            
            <div className="relative z-10 max-w-lg w-full bg-gray-900/80 backdrop-blur-xl border border-gray-800 rounded-2xl p-10 text-center shadow-2xl shadow-black">
                <div className="w-20 h-20 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-8 shadow-lg shadow-cyan-900/50">
                    <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                    </svg>
                </div>
                
                <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">
                    NeuroRestore Pro
                </h1>
                <p className="text-gray-400 mb-8 text-sm leading-relaxed">
                    Access Gemini 3 Pro Vision & Image Preview models for high-fidelity forensic restoration and upscaling.
                </p>

                <button 
                    onClick={handleSelectKey}
                    className="w-full py-4 bg-white text-gray-900 hover:bg-gray-100 font-bold rounded-xl transition-all mb-6 flex items-center justify-center gap-2 group"
                >
                    <span>Connect Google Cloud Project</span>
                    <svg className="w-4 h-4 text-gray-600 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                </button>

                <p className="text-[10px] text-gray-600 uppercase tracking-widest border-t border-gray-800 pt-6">
                    Requires a paid project • <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="text-cyan-600 hover:text-cyan-400 hover:underline transition-colors">Billing Documentation</a>
                </p>
            </div>
        </div>
      );
  }

  return (
    <div className="flex h-screen w-full bg-gray-950 text-white font-sans overflow-hidden">
      
      {/* Left Sidebar */}
      <ControlPanel 
        config={config} 
        setConfig={setConfig} 
        onProcess={handleProcess}
        isProcessing={processing.isProcessing}
        mode={mode}
        setMode={setMode}
        disabled={(mode === AppMode.RESTORATION || mode === AppMode.INPAINTING || mode === AppMode.VECTORIZATION || mode === AppMode.EXTRACT_TEXT) && !originalImage}
        onExpand={(dir) => canvasRef.current?.expandCanvas(dir, 25)}
        onClearMask={() => canvasRef.current?.clearMask()}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full relative">
        
        {/* Header/Toolbar */}
        <div className="h-16 border-b border-gray-800 bg-gray-900/50 flex items-center justify-between px-6 backdrop-blur-sm z-20">
            <div className="flex items-center gap-4">
                {(mode === AppMode.RESTORATION || mode === AppMode.INPAINTING || mode === AppMode.VECTORIZATION || mode === AppMode.EXTRACT_TEXT) && (
                     <label className="cursor-pointer bg-gray-800 hover:bg-gray-700 text-gray-200 px-4 py-2 rounded text-sm font-medium transition-colors border border-gray-700">
                     <span>{originalImage ? 'Replace Image' : 'Upload Image'}</span>
                     <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
                   </label>
                )}
               
               {analysis && (mode === AppMode.RESTORATION || mode === AppMode.VECTORIZATION || mode === AppMode.EXTRACT_TEXT) && (
                   <div className="flex flex-wrap gap-2 items-center">
                       {analysis.description && (
                           <div className="text-xs text-gray-300 bg-gray-800 px-3 py-1.5 rounded-full border border-gray-700 flex items-center gap-2">
                               <svg className="w-3 h-3 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                               <span className="max-w-[200px] truncate" title={analysis.description}>{analysis.description}</span>
                           </div>
                       )}
                       {analysis.requiresDescreening && (
                           <div className="text-xs text-yellow-200 bg-yellow-900/40 px-3 py-1.5 rounded-full border border-yellow-500/50 flex items-center gap-2 shadow-[0_0_10px_rgba(234,179,8,0.1)]">
                               <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                               </svg>
                               <span className="font-bold tracking-wide">DESCREENING ACTIVE</span>
                           </div>
                       )}
                       <div className="text-xs text-cyan-500 bg-cyan-900/20 px-3 py-1.5 rounded-full border border-cyan-900/50 flex items-center gap-2">
                           <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse"></span>
                           Issues: {analysis.issues.slice(0, 3).join(', ')}
                       </div>
                   </div>
               )}
            </div>

            <div className="flex items-center gap-3">
                 {processing.isProcessing && (
                     <div className="flex items-center gap-2 text-cyan-400 text-sm animate-pulse">
                         <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                         {processing.progressMessage}
                     </div>
                 )}
                 {displayImage && mode !== AppMode.INPAINTING && mode !== AppMode.VECTORIZATION && mode !== AppMode.EXTRACT_TEXT && (
                    <button 
                        onClick={handleDownload}
                        className="px-4 py-2 rounded text-sm font-medium transition-colors border bg-gray-800 hover:bg-cyan-900 text-cyan-400 hover:text-cyan-200 border-cyan-900"
                    >
                        Download Result
                    </button>
                 )}
                 {/* Vector & Extract Text modes have LayerPanel for download, but we keep this as a quick main download */}
                 {(mode === AppMode.VECTORIZATION || mode === AppMode.EXTRACT_TEXT) && displayImage && (
                    <button 
                        onClick={handleDownload}
                        className={`px-4 py-2 rounded text-sm font-medium transition-colors border ${
                           mode === AppMode.EXTRACT_TEXT
                           ? 'bg-green-900/50 border-green-500 text-green-200 hover:bg-green-800'
                           : 'bg-purple-900/50 border-purple-500 text-purple-200 hover:bg-purple-800'
                        }`}
                    >
                        Download SVG
                    </button>
                 )}
                 {mode === AppMode.INPAINTING && originalImage && (
                    <button 
                        onClick={() => {
                            if(canvasRef.current) {
                                const link = document.createElement('a');
                                link.href = canvasRef.current.getImageData();
                                link.download = `inpainted_${Date.now()}.png`;
                                link.click();
                            }
                        }}
                        className="bg-gray-800 hover:bg-cyan-900 text-cyan-400 hover:text-cyan-200 border border-cyan-900 px-4 py-2 rounded text-sm font-medium transition-colors"
                    >
                        Save Canvas
                    </button>
                 )}
            </div>
        </div>

        {/* Viewport */}
        <div className="flex-1 relative bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')] bg-gray-900 p-8 flex items-center justify-center overflow-hidden">
            
            {/* Empty State */}
            {!originalImage && (mode === AppMode.RESTORATION || mode === AppMode.INPAINTING || mode === AppMode.VECTORIZATION || mode === AppMode.EXTRACT_TEXT) && (
                <div className="text-center p-12 border-2 border-dashed border-gray-800 rounded-xl max-w-lg">
                    <div className="w-20 h-20 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-6">
                        <svg className="w-10 h-10 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                    </div>
                    <h3 className="text-xl font-medium text-gray-300 mb-2">Upload a scan or illustration</h3>
                    <p className="text-gray-500 text-sm mb-6">
                        {mode === AppMode.INPAINTING ? "Inpaint/Outpaint mode requires a source image." : "Supports documents, comics, and vector art."}
                    </p>
                    <label className="cursor-pointer bg-cyan-700 hover:bg-cyan-600 text-white px-6 py-3 rounded shadow-lg shadow-cyan-900/50 transition-all">
                        Select File
                        <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
                    </label>
                </div>
            )}

            {/* Empty State Generation */}
            {!processedImage && mode === AppMode.GENERATION && !processing.isProcessing && (
                 <div className="text-center p-12 max-w-lg">
                     <h3 className="text-xl font-medium text-gray-300 mb-2">Generative Mode</h3>
                     <p className="text-gray-500 text-sm">Enter a prompt in the sidebar and click Generate to create high-fidelity art.</p>
                 </div>
            )}

            {/* Error State */}
            {processing.error && (
                <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50">
                    <div className="bg-red-900/20 border border-red-500/50 p-6 rounded-lg max-w-md text-center">
                        <h3 className="text-red-400 font-bold mb-2">Process Failed</h3>
                        <p className="text-red-200 text-sm">{processing.error}</p>
                        <button 
                            onClick={() => setProcessing(p => ({...p, error: null}))}
                            className="mt-4 text-sm text-red-300 hover:text-white underline"
                        >
                            Dismiss
                        </button>
                    </div>
                </div>
            )}

            {/* Content Display */}
            <div className="w-full h-full max-w-6xl flex items-center justify-center relative">
                
                {/* RESTORATION, VECTORIZATION & EXTRACT MODE: Comparison Slider */}
                {/* Note: We reuse Comparison Slider for Vectorization/Extract because the SVG is converted to Base64 Image! */}
                {(mode === AppMode.RESTORATION || mode === AppMode.VECTORIZATION || mode === AppMode.EXTRACT_TEXT) && originalImage && (
                    <>
                        {displayImage ? (
                            <ComparisonSlider 
                                originalImage={originalImage} 
                                restoredImage={displayImage} 
                                className="shadow-2xl shadow-black"
                            />
                        ) : (
                            <div className="relative h-full w-full flex items-center justify-center">
                                <img 
                                    src={originalImage} 
                                    alt="Original" 
                                    className="max-w-full max-h-full object-contain rounded-lg shadow-xl" 
                                />
                                {analysis && !processing.isProcessing && (
                                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur px-4 py-2 rounded-full text-sm text-gray-300 border border-gray-700">
                                        Analysis Complete. Ready to {mode === AppMode.VECTORIZATION ? 'Vectorize' : mode === AppMode.EXTRACT_TEXT ? 'Isolate Text' : 'Re-Render'}.
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}

                {/* INPAINTING MODE: Canvas Editor */}
                {mode === AppMode.INPAINTING && originalImage && (
                    <CanvasEditor
                        ref={canvasRef}
                        imageSrc={originalImage} // In Inpainting mode, processedImage becomes the new "original" in the editor flow
                        brushSize={config.brushSize}
                        maskBlendMode={config.maskBlendMode}
                        className="w-full h-full shadow-2xl shadow-black bg-gray-900 border border-gray-800 rounded-lg"
                    />
                )}

                {/* GENERATION MODE: Simple Image */}
                {mode === AppMode.GENERATION && displayImage && (
                    <img 
                        src={displayImage} 
                        alt="Generated" 
                        className="max-w-full max-h-full object-contain rounded-lg shadow-2xl shadow-cyan-900/20" 
                    />
                )}

                {/* Floating Layer Panel (For Vector & Extract Modes with Result) */}
                {(mode === AppMode.VECTORIZATION || mode === AppMode.EXTRACT_TEXT) && processedImage && (
                    <div className="absolute top-4 right-4 z-20 animate-in fade-in slide-in-from-right-4">
                        <LayerPanel 
                            svgDataUrl={processedImage} 
                            onUpdateView={setDisplayImage} 
                        />
                    </div>
                )}
            </div>

        </div>
      </div>
    </div>
  );
};

export default App;
