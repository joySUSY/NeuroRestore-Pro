import React, { useState, useRef, useEffect } from 'react';
import ControlPanel from './components/ControlPanel';
import ComparisonSlider from './components/ComparisonSlider';
import CanvasEditor, { CanvasEditorRef } from './components/CanvasEditor';
import LayerPanel from './components/LayerPanel';
import ProcessingOverlay from './components/ProcessingOverlay';
import { analyzeImageIssues, restoreOrEditImage, generateNewImage, inpaintImage, fileToGenerativePart, vectorizeImage, extractText } from './services/geminiService';
import { processDocumentWithSwarm } from './services/swarmService';
import { geometricUnwarp, intrinsicDecomposition } from './services/physicsService';
import { AppMode, RestorationConfig, ImageType, Resolution, AspectRatio, ProcessingState, AnalysisResult, ColorStyle } from './types';

const App: React.FC = () => {
  // Authentication State
  const [hasKey, setHasKey] = useState<boolean>(false);
  const [isCheckingKey, setIsCheckingKey] = useState<boolean>(true);

  // App State
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [displayImage, setDisplayImage] = useState<string | null>(null);
  const [showExportMenu, setShowExportMenu] = useState<boolean>(false);
  
  // Image Meta
  const [mimeType, setMimeType] = useState<string>('image/jpeg');
  const [imgDims, setImgDims] = useState({ width: 0, height: 0 });

  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [mode, setMode] = useState<AppMode>(AppMode.RESTORATION);
  
  // Swarm Toggle State
  const [useSwarm, setUseSwarm] = useState(false);

  // Live Palette State
  const [livePalette, setLivePalette] = useState<string[]>([]);
  
  // Physics Log State
  const [physicsLogs, setPhysicsLogs] = useState<string[]>([]);

  const canvasRef = useRef<CanvasEditorRef>(null);

  const [config, setConfig] = useState<RestorationConfig>({
    imageType: ImageType.DOCUMENT,
    customPrompt: '',
    resolution: Resolution.QHD_2K,
    aspectRatio: AspectRatio.ORIGINAL,
    colorStyle: ColorStyle.TRUE_TONE,
    detailEnhancement: 'OFF',
    brushSize: 40,
    maskBlendMode: 'add',
    vectorDetail: 'MEDIUM',
    vectorColor: 'COLOR',
    physics: {
        enableDewarping: false,
        enableIntrinsic: false,
        enableDiffVG: false
    }
  });

  const [processing, setProcessing] = useState<ProcessingState>({
    isProcessing: false,
    stage: 'idle',
    error: null,
    progressMessage: ''
  });

  useEffect(() => {
    checkKey();
  }, []);

  // Close export menu on click outside
  useEffect(() => {
    const closeMenu = () => setShowExportMenu(false);
    if(showExportMenu) {
        document.addEventListener('click', closeMenu);
    }
    return () => document.removeEventListener('click', closeMenu);
  }, [showExportMenu]);

  const checkKey = async () => {
    try {
        if ((window as any).aistudio) {
            const selected = await (window as any).aistudio.hasSelectedApiKey();
            setHasKey(selected);
        } else {
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
          return "SESSION_EXPIRED";
      }
      if (msg === "SVG_TRUNCATED") {
          return "SVG_TRUNCATED";
      }
      return msg;
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setProcessing({ isProcessing: true, stage: 'analyzing', error: null, progressMessage: 'Uploading...' });
    setPhysicsLogs([]);
    setProcessedImage(null);
    setDisplayImage(null);
    setAnalysis(null);
    setLivePalette([]);
    if (mode !== AppMode.VECTORIZATION && mode !== AppMode.EXTRACT_TEXT) {
        setMode(AppMode.RESTORATION); 
    }

    try {
      const base64 = await fileToGenerativePart(file);
      const dataUrl = `data:${file.type};base64,${base64}`;
      setOriginalImage(dataUrl);
      setMimeType(file.type);
      
      // Get Dims
      const img = new Image();
      img.onload = () => {
          setImgDims({ width: img.width, height: img.height });
      };
      img.src = dataUrl;

      setProcessing(prev => ({ ...prev, progressMessage: 'Analyzing defects & Topology...' }));
      const analysisResult = await analyzeImageIssues(base64, file.type);
      setAnalysis(analysisResult);
      
      // Update local palette state if analysis has dominant colors
      if (analysisResult.dominantColors && analysisResult.dominantColors.length > 0) {
          setLivePalette(analysisResult.dominantColors);
      }
      
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

  const updateLog = (msg: string) => {
      setPhysicsLogs(prev => [...prev, msg]);
      setProcessing(prev => ({ ...prev, progressMessage: msg }));
  };

  const handleProcess = async () => {
    let stageStr: ProcessingState['stage'] = 'restoring';
    if (mode === AppMode.GENERATION) stageStr = 'generating';
    if (mode === AppMode.INPAINTING) stageStr = 'inpainting';
    if (mode === AppMode.VECTORIZATION) stageStr = 'vectorizing';
    if (mode === AppMode.EXTRACT_TEXT) stageStr = 'extracting_text';

    setProcessing({ isProcessing: true, stage: stageStr, error: null, progressMessage: 'Initializing Neuro Core...' });
    setPhysicsLogs([]);

    try {
      let resultUrl = '';
      let currentBase64 = originalImage ? originalImage.split(',')[1] : '';
      let currentMime = mimeType;
      
      // --- PHYSICS PRE-PROCESSING PIPELINE ---
      if (mode === AppMode.RESTORATION || mode === AppMode.VECTORIZATION) {
          
          // Step 1: Dewarping (DocTr)
          if (config.physics.enableDewarping && currentBase64) {
              updateLog("📐 Computing 3D Mesh Flow (DocTr)...");
              const dewarpedDataUrl = await geometricUnwarp(currentBase64, currentMime);
              currentBase64 = dewarpedDataUrl.split(',')[1];
              // Update display temporarily to show progress
              setDisplayImage(dewarpedDataUrl);
          }

          // Step 2: Intrinsic Decomposition (PIDNet) - Restoration Only
          if (mode === AppMode.RESTORATION && config.physics.enableIntrinsic && currentBase64) {
              updateLog("💡 Solving Albedo Map (Intrinsic Decomp)...");
              const intrinsicDataUrl = await intrinsicDecomposition(currentBase64, currentMime);
              currentBase64 = intrinsicDataUrl.split(',')[1];
              setDisplayImage(intrinsicDataUrl);
          }
      }

      // --- MAIN PIPELINE ---
      
      if ((mode === AppMode.RESTORATION || mode === AppMode.VECTORIZATION) && useSwarm) {
          if (!currentBase64) throw new Error("No image data.");
          updateLog("🤖 Swarm Agents Active...");
          resultUrl = await processDocumentWithSwarm(
              currentBase64, 
              currentMime, 
              imgDims.width, 
              imgDims.height,
              updateLog
          );
      } 
      else if (mode === AppMode.RESTORATION) {
        if (!currentBase64) throw new Error("No image data.");
        updateLog("✨ Applying Reflexion Loop...");
        resultUrl = await restoreOrEditImage(currentBase64, currentMime, config, analysis || undefined);
      } 
      else if (mode === AppMode.INPAINTING) {
          if (!canvasRef.current) throw new Error("Canvas not initialized");
          const canvasDataUrl = canvasRef.current.getImageData();
          const base64 = canvasDataUrl.split(',')[1];
          updateLog("🖌️ Inpainting Context...");
          resultUrl = await inpaintImage(base64, 'image/png', config);
      }
      else if (mode === AppMode.VECTORIZATION) {
          if (!currentBase64) throw new Error("No image data.");
          if (config.physics.enableDiffVG) updateLog("📉 Optimizing Bezier Control Points (DiffVG)...");
          else updateLog("✒️ Constructing Vector Topology...");
          
          resultUrl = await vectorizeImage(currentBase64, currentMime, config, livePalette);
      }
      else if (mode === AppMode.EXTRACT_TEXT) {
          if (!currentBase64) throw new Error("No image data.");
          updateLog("📝 Extracting Semantic Text...");
          resultUrl = await extractText(currentBase64, currentMime);
      }
      else {
        if (!config.customPrompt) throw new Error("Please provide a prompt for generation.");
        updateLog("🎨 Generating visuals...");
        resultUrl = await generateNewImage(config.customPrompt, config);
      }

      setProcessedImage(resultUrl);
      setDisplayImage(resultUrl);
      
      if (mode === AppMode.INPAINTING) {
          setOriginalImage(resultUrl);
      }

      setProcessing({ isProcessing: false, stage: 'complete', error: null, progressMessage: '' });

    } catch (error: any) {
       const errorMsg = handleAuthError(error);
       setProcessing({ isProcessing: false, stage: 'error', error: errorMsg, progressMessage: '' });
    }
  };

  const processSVGDownload = (url: string, type: 'full' | 'text' | 'nobg') => {
      try {
          const base64 = url.split(',')[1];
          const decoded = decodeURIComponent(escape(atob(base64)));
          const parser = new DOMParser();
          const doc = parser.parseFromString(decoded, "image/svg+xml");

          if (type === 'text') {
              ['layer_graphics', 'layer_background'].forEach(id => {
                  const el = doc.getElementById(id);
                  if (el) el.remove();
              });
          } else if (type === 'nobg') {
              const el = doc.getElementById('layer_background');
              if (el) el.remove();
          }

          const serializer = new XMLSerializer();
          const finalSvg = serializer.serializeToString(doc);
          const blob = new Blob([finalSvg], { type: 'image/svg+xml' });
          return URL.createObjectURL(blob);
      } catch (e) {
          console.error("SVG Processing Error", e);
          return url;
      }
  };

  const handleSmartDownload = (format: 'png' | 'svg', svgType: 'full' | 'text' | 'nobg' = 'full') => {
      let downloadUrl = displayImage;
      let ext = format;
      
      if (!downloadUrl) return;

      if (mode === AppMode.VECTORIZATION || mode === AppMode.EXTRACT_TEXT) {
          if (format === 'svg') {
              downloadUrl = processSVGDownload(downloadUrl, svgType);
          } else {
              ext = 'png'; 
          }
      }

      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `neuro_export_${mode.toLowerCase()}_${svgType}_${Date.now()}.${ext}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  const handleColorRemix = (oldColor: string, newColor: string) => {
     if (!displayImage || !displayImage.startsWith('data:image/svg+xml')) return;
     try {
         const base64 = displayImage.split(',')[1];
         let svgStr = decodeURIComponent(escape(atob(base64)));
         const regex = new RegExp(oldColor, 'gi'); 
         svgStr = svgStr.replace(regex, newColor);
         const newBase64 = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgStr)))}`;
         setDisplayImage(newBase64);
         setProcessedImage(newBase64); 
         setLivePalette(prev => prev.map(c => c.toLowerCase() === oldColor.toLowerCase() ? newColor : c));
     } catch(e) {
         console.error("Remix failed", e);
     }
  };

  if (isCheckingKey) {
      return (
        <div className="h-screen w-full flex items-center justify-center bg-morandi-base">
            <div className="flex flex-col items-center">
                 <div className="w-12 h-12 rounded-full border-2 border-morandi-blue border-t-transparent animate-spin mb-4"></div>
                 <div className="text-morandi-dark font-medium tracking-wide text-sm">System Initializing</div>
            </div>
        </div>
      );
  }

  if (!hasKey) {
      return (
        <div className="h-screen w-full flex items-center justify-center p-6 bg-morandi-base relative overflow-hidden">
            <div className="absolute inset-0 bg-white/40 backdrop-blur-3xl z-0"></div>
            <div className="relative z-10 max-w-md w-full glass-panel p-10 text-center shadow-glass rounded-3xl animate-slide-up">
                <div className="w-16 h-16 bg-morandi-dark text-white rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl">
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                </div>
                <h1 className="text-2xl font-bold text-morandi-dark mb-2">NeuroRestore Pro</h1>
                <p className="text-gray-500 mb-8 text-sm leading-relaxed">Forensic-grade image restoration powered by Gemini 3.0 Vision.</p>
                <button onClick={handleSelectKey} className="w-full py-3.5 bg-morandi-dark text-white hover:bg-black rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 group">
                    <span>Connect Access Key</span>
                    <svg className="w-4 h-4 text-gray-400 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                </button>
            </div>
        </div>
      );
  }

  const isVectorMode = (mode === AppMode.VECTORIZATION || mode === AppMode.EXTRACT_TEXT) && !useSwarm;

  return (
    <div className="flex h-screen w-full font-sans overflow-hidden text-morandi-dark">
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
        dominantColors={livePalette}
        onColorRemix={handleColorRemix}
        useSwarm={useSwarm}
        setUseSwarm={setUseSwarm}
      />

      <div className="flex-1 flex flex-col h-full relative z-0">
        <div className="h-20 flex items-center justify-between px-8 z-20">
             <div className="flex items-center gap-4">
                {(mode === AppMode.RESTORATION || mode === AppMode.INPAINTING || mode === AppMode.VECTORIZATION || mode === AppMode.EXTRACT_TEXT) && (
                     <label className="cursor-pointer glass-button px-5 py-2.5 rounded-xl text-xs font-bold text-morandi-dark flex items-center gap-2 transition-all">
                     <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                     <span>{originalImage ? 'Replace Image' : 'Upload Source'}</span>
                     <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
                   </label>
                )}
               {analysis && (mode === AppMode.RESTORATION || mode === AppMode.VECTORIZATION || mode === AppMode.EXTRACT_TEXT) && (
                   <div className="flex flex-wrap gap-2 items-center animate-fade-in">
                       {analysis.requiresDescreening && (
                           <div className="px-3 py-1.5 rounded-full bg-white/60 border border-white text-[10px] font-bold text-morandi-blue flex items-center gap-2 shadow-sm">
                               <span className="w-1.5 h-1.5 rounded-full bg-morandi-blue animate-pulse"></span>
                               DESCREENING ACTIVE
                           </div>
                       )}
                   </div>
               )}
            </div>

            <div className="flex items-center gap-3">
                 {displayImage && mode !== AppMode.INPAINTING && (
                    <div className="relative" onClick={(e) => e.stopPropagation()}>
                        <button 
                            onClick={() => setShowExportMenu(!showExportMenu)}
                            className={`glass-button px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${showExportMenu ? 'bg-morandi-dark text-white hover:bg-morandi-dark' : 'text-morandi-dark hover:bg-white hover:text-black'}`}
                        >
                            <span>Export Assets</span>
                            <svg className={`w-4 h-4 transition-transform duration-300 ${showExportMenu ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                        </button>
                        {showExportMenu && (
                            <div className="absolute right-0 top-full mt-2 w-56 glass-panel rounded-2xl shadow-xl p-2 animate-fade-in flex flex-col gap-1 z-50">
                                <div className="px-3 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest border-b border-gray-200/50 mb-1">
                                    {isVectorMode ? 'Vector Formats' : 'Raster Formats'}
                                </div>
                                {isVectorMode ? (
                                    <>
                                        <button onClick={() => handleSmartDownload('svg', 'full')} className="text-left w-full px-3 py-2 text-xs font-medium text-gray-700 hover:bg-white hover:text-morandi-dark rounded-xl transition-colors">Full Vector (SVG)</button>
                                        <button onClick={() => handleSmartDownload('svg', 'text')} className="text-left w-full px-3 py-2 text-xs font-medium text-gray-700 hover:bg-white hover:text-morandi-dark rounded-xl transition-colors">Text Only (SVG)</button>
                                        <button onClick={() => handleSmartDownload('svg', 'nobg')} className="text-left w-full px-3 py-2 text-xs font-medium text-gray-700 hover:bg-white hover:text-morandi-dark rounded-xl transition-colors">Transparent (SVG)</button>
                                    </>
                                ) : (
                                    <button onClick={() => handleSmartDownload('png')} className="text-left w-full px-3 py-2 text-xs font-medium text-gray-700 hover:bg-white hover:text-morandi-dark rounded-xl transition-colors">High-Res PNG</button>
                                )}
                            </div>
                        )}
                    </div>
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
                        className="glass-button px-5 py-2.5 rounded-xl text-xs font-bold text-morandi-dark flex items-center gap-2"
                    >
                        Save Canvas
                    </button>
                 )}
            </div>
        </div>

        <div className="flex-1 flex items-center justify-center p-8 overflow-hidden relative">
            <ProcessingOverlay mode={mode} isVisible={processing.isProcessing} analysis={analysis} physicsLogs={physicsLogs} />
            
            {!originalImage && !processing.isProcessing && (mode === AppMode.RESTORATION || mode === AppMode.INPAINTING || mode === AppMode.VECTORIZATION || mode === AppMode.EXTRACT_TEXT) && (
                <div className="text-center p-16 glass-panel rounded-3xl max-w-lg border-2 border-dashed border-white/50">
                    <div className="w-24 h-24 bg-white/50 rounded-full flex items-center justify-center mx-auto mb-8 shadow-inner-light">
                        <svg className="w-10 h-10 text-morandi-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    </div>
                    <h3 className="text-2xl font-bold text-morandi-dark mb-3">Drag & Drop or Select</h3>
                    <p className="text-gray-500 text-sm mb-8 leading-relaxed">Supports high-resolution scans, illustrations, and photos.<br/>We handle the descreening automatically.</p>
                    <label className="cursor-pointer bg-morandi-dark hover:bg-black text-white px-8 py-4 rounded-xl shadow-lg transition-transform hover:scale-105 inline-flex items-center gap-2 font-semibold">
                        <span>Upload Source File</span>
                        <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
                    </label>
                </div>
            )}

            {!processedImage && mode === AppMode.GENERATION && !processing.isProcessing && (
                 <div className="text-center p-12 max-w-lg glass-panel rounded-3xl">
                     <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                        <svg className="w-8 h-8 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                     </div>
                     <h3 className="text-xl font-bold text-morandi-dark mb-2">Creative Mode</h3>
                     <p className="text-gray-500 text-sm">Describe your vision in the sidebar to generate high-fidelity concepts.</p>
                 </div>
            )}

            {processing.error && (
                <div className="absolute inset-0 bg-white/80 backdrop-blur-md flex items-center justify-center z-50 animate-fade-in">
                    <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md text-center border border-red-100 relative">
                        {processing.error === "SVG_TRUNCATED" ? (
                            <>
                                <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-5 text-orange-500 shadow-sm">
                                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                                </div>
                                <h3 className="text-xl font-bold text-gray-800 mb-2">Complexity Overload</h3>
                                <p className="text-gray-500 text-sm mb-6 leading-relaxed">The vector engine reached its token limit. The image contains too many fine details or textures for a single pass.</p>
                                <div className="flex gap-3 justify-center">
                                    <button onClick={() => {setConfig(prev => ({ ...prev, vectorDetail: 'LOW' })); setProcessing(p => ({...p, error: null}));}} className="px-5 py-3 bg-morandi-dark text-white rounded-xl text-xs font-bold hover:bg-black transition-all shadow-lg flex items-center gap-2">
                                        <span>Switch to 'Low Detail'</span>
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                    </button>
                                    <button onClick={() => setProcessing(p => ({...p, error: null}))} className="px-5 py-3 border border-gray-200 text-gray-600 rounded-xl text-xs font-bold hover:bg-gray-50 transition-colors">Cancel</button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4 text-red-500">
                                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                </div>
                                <h3 className="text-red-500 font-bold mb-2">Process Interrupted</h3>
                                <p className="text-gray-600 text-sm mb-6">{processing.error === "SESSION_EXPIRED" ? "Session expired. Please reconnect your API key." : processing.error}</p>
                                <button onClick={() => setProcessing(p => ({...p, error: null}))} className="text-sm font-semibold text-gray-800 underline hover:text-black">Dismiss</button>
                            </>
                        )}
                    </div>
                </div>
            )}

            <div className="w-full h-full max-w-6xl flex items-center justify-center relative">
                {(mode === AppMode.RESTORATION || mode === AppMode.VECTORIZATION || mode === AppMode.EXTRACT_TEXT) && originalImage && !processing.isProcessing && (
                    <>
                        {displayImage ? (
                            <ComparisonSlider originalImage={originalImage} restoredImage={displayImage} className="shadow-2xl shadow-morandi-dark/10" />
                        ) : (
                            <div className="relative h-full w-full flex items-center justify-center p-8">
                                <img src={originalImage} alt="Original" className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl shadow-morandi-dark/10" />
                                {analysis && (
                                    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 glass-panel px-6 py-3 rounded-full text-xs font-semibold text-gray-600 flex items-center gap-2 shadow-lg animate-slide-up">
                                        <div className="w-2 h-2 rounded-full bg-green-400"></div>
                                        Scan Analyzed. Ready to {mode === AppMode.VECTORIZATION ? 'Vectorize' : mode === AppMode.EXTRACT_TEXT ? 'Isolate' : 'Restore'}.
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}
                {mode === AppMode.INPAINTING && originalImage && !processing.isProcessing && (
                    <CanvasEditor ref={canvasRef} imageSrc={originalImage} brushSize={config.brushSize} maskBlendMode={config.maskBlendMode} className="w-full h-full shadow-2xl shadow-morandi-dark/10 bg-gray-100 rounded-2xl border border-white" />
                )}
                {mode === AppMode.GENERATION && displayImage && !processing.isProcessing && (
                    <img src={displayImage} alt="Generated" className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl shadow-morandi-dark/10" />
                )}
                {(isVectorMode) && processedImage && !processing.isProcessing && (
                    <div className="absolute top-8 right-8 z-20 animate-fade-in">
                        <LayerPanel svgDataUrl={processedImage} onUpdateView={setDisplayImage} />
                    </div>
                )}
            </div>
        </div>
      </div>
    </div>
  );
};

export default App;
