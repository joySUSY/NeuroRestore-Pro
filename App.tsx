import React, { useState, useRef, useEffect } from 'react';
import ControlPanel from './components/ControlPanel';
import ComparisonSlider from './components/ComparisonSlider';
import CanvasEditor, { CanvasEditorRef } from './components/CanvasEditor';
import AtlasOverlay from './components/AtlasOverlay';
import ProcessingOverlay from './components/ProcessingOverlay';
import LayerPanel from './components/LayerPanel';
import { generateNewImage, inpaintImage, fileToGenerativePart, vectorizeImage } from './services/geminiService';
import { buildSemanticAtlas } from './services/perceptionService';
import { renderPDSR, refineRegion } from './services/restorationService';
import { validateRestoration } from './services/consistencyService';
import { AppMode, RestorationConfig, ImageType, Resolution, AspectRatio, ProcessingState, ColorStyle, AgentStatus, SemanticAtlas, ValidationReport } from './types';

const App: React.FC = () => {
  // Authentication State
  const [hasKey, setHasKey] = useState<boolean>(false);
  const [isCheckingKey, setIsCheckingKey] = useState<boolean>(true);

  // App State
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [displayImage, setDisplayImage] = useState<string | null>(null);
  const [showExportMenu, setShowExportMenu] = useState<boolean>(false);
  const [showAtlas, setShowAtlas] = useState<boolean>(false);
  
  // Image Meta
  const [mimeType, setMimeType] = useState<string>('image/jpeg');
  const [imgDims, setImgDims] = useState({ width: 0, height: 0 });

  // PDSR State
  const [semanticAtlas, setSemanticAtlas] = useState<SemanticAtlas | null>(null);
  const [validationReport, setValidationReport] = useState<ValidationReport | null>(null);
  const [mode, setMode] = useState<AppMode>(AppMode.RESTORATION);
  
  // Log State
  const [physicsLogs, setPhysicsLogs] = useState<string[]>([]);

  // Cancellation Ref
  const cancelRef = useRef<boolean>(false);

  const canvasRef = useRef<CanvasEditorRef>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const [config, setConfig] = useState<RestorationConfig>({
    imageType: ImageType.DOCUMENT,
    customPrompt: '',
    resolution: Resolution.QHD_2K,
    aspectRatio: AspectRatio.ORIGINAL,
    colorStyle: ColorStyle.TRUE_TONE,
    detailEnhancement: 'BALANCED',
    brushSize: 40,
    maskBlendMode: 'add',
    vectorDetail: 'MEDIUM',
    vectorColor: 'COLOR',
    pdsr: {
        enableTextPriors: true,
        enableTextureTransfer: true,
        enableSemanticRepair: true
    },
    physics: { enableDewarping: true, enableIntrinsic: false, enableDiffVG: true, enableMaterial: true }
  });

  const [processing, setProcessing] = useState<ProcessingState>({
    isProcessing: false,
    stage: 'idle',
    error: null,
    progressMessage: '',
    progress: 0,
    networkStatus: 'IDLE',
    latencyMs: 0
  });

  // --- PROGRESS SIMULATION EFFECT ---
  useEffect(() => {
    // FIX: Use ReturnType<typeof setInterval> to handle both Node and Browser environments correctly
    let interval: ReturnType<typeof setInterval>;
    
    if (processing.isProcessing) {
        // Define target progress based on stage
        let target = 0;
        let speed = 200; // ms per update

        switch(processing.stage) {
            case 'perception': target = 10; break;
            case 'atlas_building': target = 35; break;
            case 'restoring': target = 75; break;
            case 'judging': target = 90; break;
            case 'refining': target = 98; break;
            case 'complete': target = 100; break;
            default: target = 5;
        }

        interval = setInterval(() => {
            setProcessing(prev => {
                // Network Latency Simulation (jitter)
                const latencyJitter = Math.floor(Math.random() * 20) + 40; 
                
                if (prev.progress >= target && prev.stage !== 'complete') {
                    return { ...prev, networkStatus: 'WAITING', latencyMs: latencyJitter };
                }

                // Increment logic
                const diff = target - prev.progress;
                const increment = Math.max(0.1, diff * 0.05); // Smooth ease-out
                
                const nextProgress = Math.min(target, prev.progress + increment);
                
                return { 
                    ...prev, 
                    progress: nextProgress, 
                    networkStatus: prev.progress < target ? 'RECEIVING' : 'WAITING',
                    latencyMs: latencyJitter 
                };
            });
        }, speed);
    }
    return () => clearInterval(interval);
  }, [processing.isProcessing, processing.stage]);

  useEffect(() => {
    checkKey();
  }, []);

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

  const handleApiError = (error: any) => {
      const actualError = error?.error || error;
      const code = actualError?.code || actualError?.status;
      const msg = (actualError?.message || actualError?.toString() || "").toLowerCase();

      if (msg.includes("unauthenticated") || code === 401) {
          setHasKey(false);
          return "SESSION_EXPIRED";
      }
      if (msg.includes("429") || msg.includes("quota") || code === 429) {
          return "RATE_LIMIT_EXCEEDED";
      }
      if (msg.includes("safety") || msg.includes("blocked")) {
          return "SAFETY_BLOCK";
      }
      if (msg.includes("500") || msg.includes("internal server error") || code === 500) {
          return "SERVER_ERROR";
      }
      if (msg.includes("503") || msg.includes("overloaded") || code === 503) {
          return "SERVER_OVERLOAD";
      }
      return error.message || "An unexpected error occurred.";
  };

  const handleCancel = () => {
      cancelRef.current = true;
      setProcessing(prev => ({ ...prev, isProcessing: false, stage: 'idle', error: null, progressMessage: '', networkStatus: 'IDLE' }));
      setPhysicsLogs([]);
  };

  const handleRetry = () => {
    setProcessing(prev => ({ ...prev, error: null }));
    setTimeout(() => {
        handleProcess();
    }, 100);
  };

  const updateLog = (msg: string) => {
      if (cancelRef.current) return;
      setPhysicsLogs(prev => [...prev, msg]);
      setProcessing(prev => ({ ...prev, progressMessage: msg }));
  };

  // Helper to Crop image from base64 with Context Padding
  const cropImageFromBase64 = async (base64: string, bbox: number[]): Promise<string> => {
      return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
              const canvas = document.createElement('canvas');
              const h = img.height;
              const w = img.width;
              // bbox is 0-1000 scale: [ymin, xmin, ymax, xmax]
              const y = (bbox[0] / 1000) * h;
              const x = (bbox[1] / 1000) * w;
              const boxH = ((bbox[2] - bbox[0]) / 1000) * h;
              const boxW = ((bbox[3] - bbox[1]) / 1000) * w;
              
              // Add Context Padding (25% or 20px)
              const pad = Math.max(boxW * 0.25, boxH * 0.25, 20); 
              
              const cropX = Math.max(0, x - pad);
              const cropY = Math.max(0, y - pad);
              const cropW = Math.min(w - cropX, boxW + (pad * 2));
              const cropH = Math.min(h - cropY, boxH + (pad * 2));

              canvas.width = cropW;
              canvas.height = cropH;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                  ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
                  resolve(canvas.toDataURL().split(',')[1]);
              } else resolve('');
          };
          img.src = `data:image/png;base64,${base64}`;
      });
  };

  // Helper to Patch image (Reverse of crop)
  const patchImage = async (baseImageBase64: string, patchBase64: string, bbox: number[]): Promise<string> => {
      return new Promise((resolve) => {
          const baseImg = new Image();
          baseImg.onload = () => {
              const canvas = document.createElement('canvas');
              canvas.width = baseImg.width;
              canvas.height = baseImg.height;
              const ctx = canvas.getContext('2d');
              if (!ctx) { resolve(baseImageBase64); return; }
              
              ctx.drawImage(baseImg, 0, 0);

              const patchImg = new Image();
              patchImg.onload = () => {
                   // Calculate same coords as crop including padding
                   const h = baseImg.height;
                   const w = baseImg.width;
                   const y = (bbox[0] / 1000) * h;
                   const x = (bbox[1] / 1000) * w;
                   const boxH = ((bbox[2] - bbox[0]) / 1000) * h;
                   const boxW = ((bbox[3] - bbox[1]) / 1000) * w;
                   
                   const pad = Math.max(boxW * 0.25, boxH * 0.25, 20); 

                   const cropX = Math.max(0, x - pad);
                   const cropY = Math.max(0, y - pad);
                   const cropW = Math.min(w - cropX, boxW + (pad * 2));
                   const cropH = Math.min(h - cropY, boxH + (pad * 2));
                   
                   ctx.drawImage(patchImg, cropX, cropY, cropW, cropH);
                   resolve(canvas.toDataURL());
              };
              patchImg.src = `data:image/png;base64,${patchBase64}`;
          };
          baseImg.src = baseImageBase64.startsWith('data:') ? baseImageBase64 : `data:image/png;base64,${baseImageBase64}`;
      });
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset State
    setProcessing({ 
        isProcessing: true, 
        stage: 'perception', 
        error: null, 
        progressMessage: 'Uploading...',
        progress: 0,
        networkStatus: 'UPLOADING',
        latencyMs: 5
    });
    
    cancelRef.current = false;
    setPhysicsLogs([]);
    setProcessedImage(null);
    setDisplayImage(null);
    setSemanticAtlas(null);
    setValidationReport(null);
    setShowAtlas(false);
    
    try {
      const base64 = await fileToGenerativePart(file);
      if (cancelRef.current) return;

      const dataUrl = `data:${file.type};base64,${base64}`;
      setOriginalImage(dataUrl);
      setMimeType(file.type);
      
      const img = new Image();
      img.onload = () => {
          setImgDims({ width: img.width, height: img.height });
      };
      img.src = dataUrl;

      // --- PHASE 1: PERCEPTION (Atlas Building) ---
      setProcessing(prev => ({ ...prev, stage: 'atlas_building', progressMessage: 'Building Semantic Atlas...' }));
      const atlasRes = await buildSemanticAtlas(base64, file.type);
      
      if (cancelRef.current) return;

      if (atlasRes.status === AgentStatus.SUCCESS && atlasRes.data) {
          setSemanticAtlas(atlasRes.data);
          updateLog(`🧠 Atlas Built: ${atlasRes.data.regions.length} Regions Detected`);
          updateLog(`📉 Physics: ${atlasRes.data.globalPhysics.noiseProfile} | ${atlasRes.data.globalPhysics.blurKernel}`);
          // Auto-enable atlas view for visualization
          setShowAtlas(true);
      } else {
          updateLog("⚠️ Atlas Build Failed. Proceeding with Blind Restoration.");
          setSemanticAtlas({ 
              globalPhysics: { paperWhitePoint: '#FFFFFF', noiseProfile: 'CLEAN', blurKernel: 'NONE', lightingCondition: 'FLAT' }, 
              regions: [], 
              degradationScore: 0 
          });
      }

      setProcessing(prev => ({ ...prev, isProcessing: false, stage: 'idle', error: null, progressMessage: '', progress: 100 }));
    } catch (error: any) {
      if (cancelRef.current) return;
      const errorMsg = handleApiError(error);
      setProcessing(prev => ({ ...prev, isProcessing: false, stage: 'error', error: errorMsg, progressMessage: '' }));
    }
  };

  const handleProcess = async () => {
    setProcessing({ 
        isProcessing: true, 
        stage: 'restoring', 
        error: null, 
        progressMessage: 'Initializing Engine...',
        progress: 40,
        networkStatus: 'WAITING',
        latencyMs: 30
    });
    
    cancelRef.current = false;
    setPhysicsLogs([]);
    setValidationReport(null);

    try {
      let resultUrl = '';
      let currentBase64 = originalImage ? originalImage.split(',')[1] : '';
      
      if (mode === AppMode.RESTORATION) {
          if (!currentBase64) throw new Error("No image data.");
          if (!semanticAtlas) throw new Error("Semantic Atlas not ready.");

          // --- PHASE 2: RESTORATION ---
          updateLog("👁️ PDSR Engine: Injecting Text Priors...");
          updateLog("🎨 Neural Texture Transfer Active...");
          
          const res = await renderPDSR(currentBase64, mimeType, imgDims.width, imgDims.height, semanticAtlas, config);
          
          if (res.status !== AgentStatus.SUCCESS || !res.data) {
              throw new Error(res.message);
          }
          let restoredBase64 = res.data.split(',')[1];
          resultUrl = res.data;
          
          if (cancelRef.current) return;

          // --- PHASE 3: THE JUDGE (Consistency Check) ---
          setProcessing(prev => ({ ...prev, stage: 'judging', progressMessage: 'Validating Semantic Consistency...' }));
          updateLog("⚖️ The Judge: Comparing Semantic Truth...");
          
          const validationRes = await validateRestoration(currentBase64, restoredBase64, semanticAtlas);
          
          if (validationRes.status === AgentStatus.SUCCESS && validationRes.data) {
              setValidationReport(validationRes.data);
              
              if (!validationRes.data.isConsistent) {
                   const failures = validationRes.data.results.filter(r => r.status === 'FAIL');
                   updateLog(`⚠️ Validation Warning: ${failures.length} regions inconsistent.`);
                   
                   // --- PHASE 4: SURGICAL REFINEMENT ---
                   if (failures.length > 0) {
                        setProcessing(prev => ({ ...prev, stage: 'refining', progressMessage: 'Performing Surgical Refinement...' }));
                        updateLog("💉 Surgical Loop: Correcting Hallucinations...");

                        // Iterate and Patch
                        let patchedImage = resultUrl;
                        for (const failure of failures) {
                            if (cancelRef.current) break;
                            const region = semanticAtlas.regions.find(r => r.id === failure.regionId);
                            if (!region) continue;

                            updateLog(`🔧 Fixing Region ${region.id} (${failure.reason})...`);
                            
                            // 1. Crop original (ground truth context)
                            const cropBase64 = await cropImageFromBase64(currentBase64, region.bbox);
                            if (!cropBase64) continue;

                            // 2. Refine with Adaptive Prompting
                            const fixRes = await refineRegion(cropBase64, failure.reason, region.content, region.semanticType);
                            if (fixRes.status === AgentStatus.SUCCESS && fixRes.data) {
                                // 3. Patch back onto the *current restored image*
                                const fixBase64 = fixRes.data.split(',')[1];
                                patchedImage = await patchImage(patchedImage, fixBase64, region.bbox);
                            }
                        }
                        resultUrl = patchedImage;
                   }
              } else {
                  updateLog("✅ Validation Passed: 100% Consistent.");
              }
          }

      } 
      else if (mode === AppMode.VECTORIZATION) {
          if (!currentBase64) throw new Error("No image data.");
          updateLog("📐 Initializing DiffVG Topology Engine...");
          
          // Use Atlas for ink detection if available, else pass undefined
          const res = await vectorizeImage(
              currentBase64, 
              mimeType, 
              config, 
              undefined, 
              (msg) => updateLog(msg),
              semanticAtlas ? { ...semanticAtlas, detectedInk: 'UNKNOWN', detectedPaper: 'UNKNOWN' } as any : undefined // simplified passing
          );
          
          if (res.status === AgentStatus.SUCCESS && res.data) resultUrl = res.data;
          else throw new Error(res.message);
      }
      else if (mode === AppMode.INPAINTING) {
          if (!canvasRef.current) throw new Error("Canvas not initialized");
          const canvasDataUrl = canvasRef.current.getImageData();
          const base64 = canvasDataUrl.split(',')[1];
          updateLog("🖌️ Inpainting Context...");
          const res = await inpaintImage(base64, 'image/png', config);
          if (res.status === AgentStatus.SUCCESS && res.data) resultUrl = res.data;
          else throw new Error(res.message);
      }
      else if (mode === AppMode.GENERATION) {
        if (!config.customPrompt) throw new Error("Please provide a prompt for generation.");
        updateLog("🎨 Generating visuals...");
        const res = await generateNewImage(config.customPrompt, config);
        if (res.status === AgentStatus.SUCCESS && res.data) resultUrl = res.data;
        else throw new Error(res.message);
      }

      if (cancelRef.current) return;

      setProcessedImage(resultUrl);
      setDisplayImage(resultUrl);
      
      if (mode === AppMode.INPAINTING) {
          setOriginalImage(resultUrl);
      }

      setProcessing(prev => ({ ...prev, isProcessing: false, stage: 'complete', error: null, progressMessage: '', progress: 100, networkStatus: 'IDLE' }));

    } catch (error: any) {
       if (cancelRef.current) return;
       const errorMsg = handleApiError(error);
       setProcessing(prev => ({ ...prev, isProcessing: false, stage: 'error', error: errorMsg, progressMessage: '' }));
    }
  };

  const handleSmartDownload = (format: 'png' | 'svg') => {
      if (!displayImage) return;
      const link = document.createElement('a');
      link.href = displayImage;
      link.download = `neuro_export_${Date.now()}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  if (isCheckingKey) {
      return (
        <div className="h-screen w-full flex items-center justify-center bg-morandi-base">
            <div className="flex flex-col items-center">
                 <div className="w-12 h-12 rounded-full border-2 border-morandi-blue border-t-transparent animate-spin mb-4"></div>
                 <div className="text-morandi-text font-medium tracking-wide text-sm">System Initializing</div>
            </div>
        </div>
      );
  }

  if (!hasKey) {
      return (
        <div className="h-screen w-full flex items-center justify-center p-6 bg-morandi-base relative overflow-hidden">
            <div className="absolute inset-0 bg-white/40 backdrop-blur-3xl z-0"></div>
            <div className="relative z-10 max-w-md w-full glass-panel p-10 text-center shadow-glass rounded-3xl animate-slide-up">
                <div className="w-16 h-16 bg-morandi-text text-white rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl">
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                </div>
                <h1 className="text-2xl font-bold text-morandi-text mb-2">NeuroRestore PDSR</h1>
                <p className="text-morandi-subtext mb-8 text-sm leading-relaxed">Perception-Driven Semantic Restoration Engine.</p>
                <button onClick={handleSelectKey} className="w-full py-3.5 bg-morandi-dark text-white hover:bg-morandi-text rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 group">
                    <span>Connect Access Key</span>
                    <svg className="w-4 h-4 text-white/70 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                </button>
            </div>
        </div>
      );
  }

  return (
    <div className="flex h-screen w-full font-sans overflow-hidden text-morandi-text">
      <ControlPanel 
        config={config} 
        setConfig={setConfig} 
        onProcess={handleProcess}
        isProcessing={processing.isProcessing}
        mode={mode}
        setMode={setMode}
        disabled={(mode === AppMode.RESTORATION || mode === AppMode.VECTORIZATION || mode === AppMode.INPAINTING) && !originalImage}
        onExpand={(dir) => canvasRef.current?.expandCanvas(dir, 25)}
        onClearMask={() => canvasRef.current?.clearMask()}
        onChangeKey={handleSelectKey}
      />

      <div className="flex-1 flex flex-col h-full relative z-0">
        <div className="h-20 flex items-center justify-between px-8 z-20">
             <div className="flex items-center gap-4">
                {(mode === AppMode.RESTORATION || mode === AppMode.VECTORIZATION || mode === AppMode.INPAINTING) && (
                     <label className="cursor-pointer glass-button px-5 py-2.5 rounded-xl text-xs font-bold text-morandi-text flex items-center gap-2 transition-all hover:text-morandi-blue">
                     <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                     <span>{originalImage ? 'Replace Image' : 'Upload Source'}</span>
                     <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
                   </label>
                )}
               {semanticAtlas && (mode === AppMode.RESTORATION) && (
                   <button 
                       onClick={() => setShowAtlas(!showAtlas)}
                       className={`px-3 py-1.5 rounded-full border text-[10px] font-bold flex items-center gap-2 shadow-sm transition-all ${showAtlas ? 'bg-morandi-blue text-white border-morandi-blue' : 'bg-white/60 text-morandi-blue border-white'}`}
                   >
                       <span className={`w-1.5 h-1.5 rounded-full bg-current ${showAtlas ? 'animate-pulse' : ''}`}></span>
                       {showAtlas ? 'HIDE ATLAS' : 'SHOW ATLAS'} ({semanticAtlas.regions.length})
                   </button>
               )}
            </div>

            <div className="flex items-center gap-3">
                 {displayImage && mode !== AppMode.INPAINTING && (
                    <button 
                        onClick={() => handleSmartDownload(mode === AppMode.VECTORIZATION ? 'svg' : 'png')}
                        className="glass-button px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all hover:bg-white hover:text-morandi-blue"
                    >
                        <span>Download {mode === AppMode.VECTORIZATION ? 'SVG' : 'Output'}</span>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                    </button>
                 )}
            </div>
        </div>

        <div className="flex-1 flex items-center justify-center p-8 overflow-hidden relative">
            <ProcessingOverlay 
                mode={mode} 
                isVisible={processing.isProcessing} 
                physicsLogs={physicsLogs} 
                progress={processing.progress}
                networkStatus={processing.networkStatus}
                latencyMs={processing.latencyMs}
                onCancel={handleCancel} 
            />
            
            {/* Display LayerPanel floating on the right when in Vector Mode with output */}
            {mode === AppMode.VECTORIZATION && processedImage && (
                <div className="absolute right-8 top-8 z-30 animate-fade-in">
                    <LayerPanel svgDataUrl={processedImage} onUpdateView={setDisplayImage} />
                </div>
            )}
            
            {!originalImage && !processing.isProcessing && (mode === AppMode.RESTORATION || mode === AppMode.VECTORIZATION || mode === AppMode.INPAINTING) && (
                <div className="text-center p-16 glass-panel rounded-3xl max-w-lg border-2 border-dashed border-white/50">
                    <div className="w-24 h-24 bg-white/50 rounded-full flex items-center justify-center mx-auto mb-8 shadow-inner-light">
                        <svg className="w-10 h-10 text-morandi-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    </div>
                    <h3 className="text-2xl font-bold text-morandi-text mb-3">Drag & Drop Source</h3>
                    <p className="text-morandi-subtext text-sm mb-8 leading-relaxed">Perception-Driven Semantic Restoration.<br/>We analyze text priors and material physics.</p>
                    <label className="cursor-pointer bg-morandi-text hover:bg-morandi-text/80 text-white px-8 py-4 rounded-xl shadow-lg transition-transform hover:scale-105 inline-flex items-center gap-2 font-semibold">
                        <span>Upload Source File</span>
                        <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
                    </label>
                </div>
            )}

            {!processedImage && mode === AppMode.GENERATION && !processing.isProcessing && (
                 <div className="text-center p-12 max-w-lg glass-panel rounded-3xl">
                     <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                        <svg className="w-8 h-8 text-morandi-mauve" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                     </div>
                     <h3 className="text-xl font-bold text-morandi-text mb-2">Creative Mode</h3>
                     <p className="text-morandi-subtext text-sm">Describe your vision in the sidebar to generate high-fidelity concepts.</p>
                 </div>
            )}

            {processing.error && (
                <div className="absolute inset-0 bg-white/80 backdrop-blur-md flex items-center justify-center z-50 animate-fade-in">
                    <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md text-center border border-red-100 relative">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 bg-red-50 text-red-500`}>
                             <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                        </div>
                        
                        <h3 className="text-gray-800 font-bold mb-2">Process Failed</h3>
                        <p className="text-gray-600 text-sm mb-6 leading-relaxed">{processing.error}</p>
                        
                        <div className="flex gap-3 justify-center">
                            <button onClick={() => setProcessing(p => ({...p, error: null}))} className="px-6 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-semibold transition-colors">Dismiss</button>
                            <button onClick={handleRetry} className="px-6 py-2.5 bg-morandi-text hover:bg-morandi-text/90 text-white rounded-lg text-sm font-semibold transition-colors shadow-lg flex items-center gap-2">Retry</button>
                        </div>
                    </div>
                </div>
            )}

            <div className="w-full h-full max-w-6xl flex items-center justify-center relative">
                {(mode === AppMode.RESTORATION || mode === AppMode.VECTORIZATION) && originalImage && !processing.isProcessing && (
                    <div className="relative w-full h-full flex items-center justify-center">
                        {displayImage ? (
                            <div className="relative w-full h-full">
                                {/* For Vectorization, just show image, otherwise Slider */}
                                {mode === AppMode.VECTORIZATION ? (
                                    <div className="w-full h-full flex items-center justify-center p-8">
                                         <img src={displayImage} alt="Vectorized" className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl shadow-morandi-text/10 bg-white/50" />
                                    </div>
                                ) : (
                                    <ComparisonSlider originalImage={originalImage} restoredImage={displayImage} className="shadow-2xl shadow-morandi-text/10" />
                                )}

                                <div className="absolute inset-0 pointer-events-none">
                                    <AtlasOverlay 
                                        atlas={semanticAtlas} 
                                        report={validationReport}
                                        isVisible={showAtlas && mode === AppMode.RESTORATION} 
                                        imgRef={imgRef} 
                                    />
                                </div>
                                {/* Hidden ref image to calculate true displayed dimensions for the overlay if needed */}
                                <img 
                                    ref={imgRef} 
                                    src={displayImage} 
                                    className="absolute inset-0 w-full h-full object-contain opacity-0 pointer-events-none" 
                                    alt="ref" 
                                />
                            </div>
                        ) : (
                            <div className="relative h-full w-full flex items-center justify-center p-8">
                                <img ref={imgRef} src={originalImage} alt="Original" className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl shadow-morandi-text/10" />
                                <AtlasOverlay atlas={semanticAtlas} report={validationReport} isVisible={showAtlas} imgRef={imgRef} />
                            </div>
                        )}
                    </div>
                )}
                {mode === AppMode.INPAINTING && originalImage && !processing.isProcessing && (
                    <CanvasEditor ref={canvasRef} imageSrc={originalImage} brushSize={config.brushSize} maskBlendMode={config.maskBlendMode} className="w-full h-full shadow-2xl shadow-morandi-text/10 bg-gray-100 rounded-2xl border border-white" />
                )}
                {mode === AppMode.GENERATION && displayImage && !processing.isProcessing && (
                    <img src={displayImage} alt="Generated" className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl shadow-morandi-text/10" />
                )}
            </div>
        </div>
      </div>
    </div>
  );
};

export default App;
