import React, { useState, useEffect } from 'react';
import { AppMode, ImageType, Resolution, AspectRatio, RestorationConfig, MaskBlendMode, ColorStyle } from '../types';

interface ControlPanelProps {
  config: RestorationConfig;
  setConfig: React.Dispatch<React.SetStateAction<RestorationConfig>>;
  onProcess: () => void;
  isProcessing: boolean;
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  disabled?: boolean;
  // Inpainting actions
  onExpand?: (direction: 'all') => void;
  onClearMask?: () => void;
  // Palette actions
  dominantColors?: string[];
  onColorRemix?: (oldColor: string, newColor: string) => void;
  // New Swarm Toggle
  useSwarm?: boolean;
  setUseSwarm?: (val: boolean) => void;
}

const ControlPanel: React.FC<ControlPanelProps> = ({ 
  config, 
  setConfig, 
  onProcess, 
  isProcessing,
  mode,
  setMode,
  disabled,
  onExpand,
  onClearMask,
  dominantColors,
  onColorRemix,
  useSwarm,
  setUseSwarm
}) => {
  
  // --- Tooltip State ---
  const [tooltip, setTooltip] = useState<string | null>(null);

  const handleChange = (key: keyof RestorationConfig, value: any) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };
  
  const handlePhysicsChange = (key: keyof RestorationConfig['physics'], value: boolean) => {
      setConfig(prev => ({ ...prev, physics: { ...prev.physics, [key]: value } }));
  };

  // Helper for Segmented Control
  const SegmentButton = ({ label, active, onClick, extraClass = "", tooltipText }: { label: string, active: boolean, onClick: () => void, extraClass?: string, tooltipText: string }) => (
    <button 
        onClick={onClick}
        onMouseEnter={() => setTooltip(tooltipText)}
        onMouseLeave={() => setTooltip(null)}
        className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all duration-300 ease-[cubic-bezier(0.25,0.8,0.25,1)] ${
            active 
            ? 'bg-morandi-dark text-white shadow-soft transform scale-100' 
            : 'text-gray-500 hover:bg-black/5 hover:text-gray-700'
        } ${extraClass}`}
    >
        {label}
    </button>
  );

  return (
    <div className="flex flex-col h-full glass-panel w-96 p-8 overflow-y-auto rounded-r-3xl border-r border-morandi-glassBorder/50 shadow-glass z-10 relative">
      
      {/* Header */}
      <div className="mb-10 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-morandi-blue to-morandi-green flex items-center justify-center shadow-lg text-white">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
            </svg>
        </div>
        <div>
            <h1 className="text-xl font-bold text-morandi-dark tracking-tight">
            NeuroRestore
            </h1>
            <p className="text-[10px] text-gray-500 font-medium tracking-wide uppercase">AI Forensic Engine</p>
        </div>
      </div>

      <div className="space-y-8">
        
        {/* Mode Selector - iOS Segmented Control */}
        <div className="p-1.5 bg-gray-100/50 rounded-xl flex flex-wrap gap-1 shadow-inner-light">
            <SegmentButton label="Restore" active={mode === AppMode.RESTORATION} onClick={() => setMode(AppMode.RESTORATION)} tooltipText="Enhance, Upscale & De-noise Photos/Docs." />
            <SegmentButton label="Edit" active={mode === AppMode.INPAINTING} onClick={() => setMode(AppMode.INPAINTING)} tooltipText="Smart Inpainting & Object Removal." />
            <SegmentButton label="Vector" active={mode === AppMode.VECTORIZATION} onClick={() => setMode(AppMode.VECTORIZATION)} tooltipText="Convert Raster to Scalable SVG." />
            <SegmentButton label="Text" active={mode === AppMode.EXTRACT_TEXT} onClick={() => setMode(AppMode.EXTRACT_TEXT)} tooltipText="Extract Text as Transparent Overlay." />
            <SegmentButton label="Create" active={mode === AppMode.GENERATION} onClick={() => setMode(AppMode.GENERATION)} extraClass="w-full mt-1" tooltipText="Generate new images from prompts." />
        </div>

        {/* --- DYNAMIC CONTROLS --- */}
        <div className="space-y-6 animate-fade-in">
            
            {/* SWARM INTELLIGENCE TOGGLE */}
            {(mode === AppMode.RESTORATION || mode === AppMode.VECTORIZATION) && setUseSwarm && (
                <div 
                    onClick={() => setUseSwarm(!useSwarm)}
                    className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between group ${useSwarm ? 'bg-indigo-900 border-indigo-500 shadow-lg' : 'bg-white border-gray-200'}`}
                    onMouseEnter={() => setTooltip("Activate 3-Agent Swarm: Scout, Auditor, Restorer.")}
                    onMouseLeave={() => setTooltip(null)}
                >
                    <div>
                        <div className={`text-xs font-bold uppercase tracking-wider ${useSwarm ? 'text-indigo-200' : 'text-gray-500'}`}>
                            Swarm Intelligence
                        </div>
                        <div className={`text-[10px] font-medium mt-1 ${useSwarm ? 'text-indigo-100' : 'text-gray-400'}`}>
                            {useSwarm ? 'Active: Scout + Auditor + Restorer' : 'Standard Pipeline'}
                        </div>
                    </div>
                    <div className={`w-10 h-6 rounded-full p-1 transition-colors relative ${useSwarm ? 'bg-indigo-500' : 'bg-gray-200'}`}>
                        <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${useSwarm ? 'translate-x-4' : 'translate-x-0'}`} />
                    </div>
                </div>
            )}

            {/* PHYSICS CORE - NEW ADVANCED ALGORITHMS */}
            {(mode === AppMode.RESTORATION || mode === AppMode.VECTORIZATION) && (
                <div className="p-5 bg-orange-50/50 rounded-2xl border border-orange-100 shadow-soft space-y-4">
                     <h3 className="text-xs font-bold text-orange-800 uppercase tracking-wider flex items-center gap-2">
                         <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                         Physics Core
                     </h3>
                     
                     <div className="space-y-3">
                         {/* DocTr Toggle */}
                         <div className="flex items-center justify-between">
                            <span className="text-[10px] font-medium text-gray-600">3D Dewarping (DocTr)</span>
                            <button 
                                onClick={() => handlePhysicsChange('enableDewarping', !config.physics.enableDewarping)}
                                className={`w-8 h-4 rounded-full p-0.5 transition-colors ${config.physics.enableDewarping ? 'bg-orange-500' : 'bg-gray-200'}`}
                            >
                                <div className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${config.physics.enableDewarping ? 'translate-x-4' : 'translate-x-0'}`} />
                            </button>
                         </div>

                         {/* Intrinsic Toggle (Restoration Only) */}
                         {mode === AppMode.RESTORATION && (
                             <div className="flex items-center justify-between">
                                <span className="text-[10px] font-medium text-gray-600">Intrinsic Albedo (PIDNet)</span>
                                <button 
                                    onClick={() => handlePhysicsChange('enableIntrinsic', !config.physics.enableIntrinsic)}
                                    className={`w-8 h-4 rounded-full p-0.5 transition-colors ${config.physics.enableIntrinsic ? 'bg-orange-500' : 'bg-gray-200'}`}
                                >
                                    <div className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${config.physics.enableIntrinsic ? 'translate-x-4' : 'translate-x-0'}`} />
                                </button>
                             </div>
                         )}

                         {/* DiffVG Toggle (Vector Only) */}
                         {mode === AppMode.VECTORIZATION && (
                             <div className="flex items-center justify-between">
                                <span className="text-[10px] font-medium text-gray-600">DiffVG Fitting (Opt)</span>
                                <button 
                                    onClick={() => handlePhysicsChange('enableDiffVG', !config.physics.enableDiffVG)}
                                    className={`w-8 h-4 rounded-full p-0.5 transition-colors ${config.physics.enableDiffVG ? 'bg-orange-500' : 'bg-gray-200'}`}
                                >
                                    <div className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${config.physics.enableDiffVG ? 'translate-x-4' : 'translate-x-0'}`} />
                                </button>
                             </div>
                         )}
                     </div>
                </div>
            )}

            {/* LIVE PALETTE REMIXER (VECTOR MODE) */}
            {mode === AppMode.VECTORIZATION && dominantColors && dominantColors.length > 0 && (
                <div className="p-5 bg-white rounded-2xl border border-gray-200 shadow-soft space-y-3">
                     <div className="flex items-center justify-between">
                         <h3 className="text-xs font-bold text-morandi-dark uppercase tracking-wider flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                            Live Palette
                         </h3>
                         <span className="text-[9px] text-gray-400">Tap to Remix</span>
                     </div>
                     <div className="flex flex-wrap gap-2">
                        {dominantColors.map((color, idx) => (
                            <div key={`${color}-${idx}`} className="relative group">
                                <label 
                                    className="w-8 h-8 rounded-full shadow-sm border border-black/10 cursor-pointer block hover:scale-110 transition-transform"
                                    style={{ backgroundColor: color }}
                                    onMouseEnter={() => setTooltip(`Remix color ${color}`)}
                                    onMouseLeave={() => setTooltip(null)}
                                >
                                    <input 
                                        type="color" 
                                        className="opacity-0 w-0 h-0 absolute"
                                        value={color}
                                        onChange={(e) => onColorRemix?.(color, e.target.value)}
                                    />
                                </label>
                            </div>
                        ))}
                     </div>
                </div>
            )}

            {/* RESTORATION - SOURCE TYPE */}
            {mode === AppMode.RESTORATION && (
                <div className="space-y-4">
                    <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Enhancement</h3>
                     <div className="flex bg-white/50 rounded-xl p-1 shadow-inner-light">
                        {(['OFF', 'BALANCED', 'MAX'] as const).map((level) => (
                             <button 
                                key={level}
                                onClick={() => handleChange('detailEnhancement', level)}
                                className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg transition-all ${
                                    config.detailEnhancement === level
                                    ? 'bg-white text-morandi-dark shadow-sm'
                                    : 'text-gray-400 hover:text-gray-600'
                                }`}
                                onMouseEnter={() => setTooltip(level === 'OFF' ? "No artificial sharpening" : level === 'BALANCED' ? "Smart edge recovery" : "Aggressive detail reconstruction")}
                                onMouseLeave={() => setTooltip(null)}
                             >
                                 {level}
                             </button>
                        ))}
                    </div>
                </div>
            )}

            {/* GENERATION / EDITING COMMON CONFIG */}
            {(mode === AppMode.GENERATION || mode === AppMode.RESTORATION || mode === AppMode.INPAINTING) && (
                <div className="space-y-4">
                     {/* Resolution */}
                     <div className="flex justify-between items-center mb-1">
                         <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Output Quality</h3>
                     </div>
                     <div className="grid grid-cols-3 gap-2">
                        {Object.values(Resolution).map((res) => (
                            <button
                                key={res}
                                onClick={() => handleChange('resolution', res)}
                                className={`py-2 rounded-lg text-[10px] font-bold border transition-all ${
                                    config.resolution === res
                                    ? 'bg-white border-morandi-dark text-morandi-dark shadow-sm'
                                    : 'bg-transparent border-gray-200 text-gray-400'
                                }`}
                            >
                                {res}
                            </button>
                        ))}
                     </div>
                </div>
            )}
            
            {/* Custom Prompt Input */}
            <div>
                 <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                    {mode === AppMode.GENERATION ? 'Creative Prompt' : 'Refinement Instruction'}
                 </h3>
                 <textarea 
                    value={config.customPrompt}
                    onChange={(e) => handleChange('customPrompt', e.target.value)}
                    placeholder={mode === AppMode.GENERATION ? "Describe the image you want to create..." : "e.g., 'Make the text sharper', 'Remove coffee stain'..."}
                    className="w-full h-24 p-3 bg-white/50 rounded-xl border border-gray-200 text-xs text-morandi-dark focus:outline-none focus:bg-white focus:border-morandi-blue focus:ring-1 focus:ring-morandi-blue transition-all resize-none placeholder:text-gray-400"
                 />
            </div>

        </div>

        {/* Footer Actions */}
        <div className="pt-4 border-t border-gray-200/50">
             <button 
                onClick={onProcess}
                disabled={isProcessing || disabled}
                className={`w-full py-4 rounded-xl text-sm font-bold tracking-wide shadow-lg transition-all transform hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2 ${
                    isProcessing || disabled
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none'
                    : 'bg-morandi-dark text-white hover:bg-black hover:shadow-xl'
                }`}
             >
                 {isProcessing ? (
                     <>
                        <svg className="animate-spin h-4 w-4 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Processing...</span>
                     </>
                 ) : (
                     <>
                        <span>
                            {mode === AppMode.RESTORATION ? (useSwarm ? 'Run Swarm Restore' : 'Enhance Image') : 
                             mode === AppMode.INPAINTING ? 'Fill Selected Area' :
                             mode === AppMode.VECTORIZATION ? (useSwarm ? 'Run Swarm Vector' : 'Vectorize') :
                             mode === AppMode.EXTRACT_TEXT ? 'Extract Text' :
                             'Generate'}
                        </span>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                     </>
                 )}
             </button>
             
             {/* Tooltip Footer */}
             <div className="mt-3 h-4 flex items-center justify-center">
                 {tooltip && (
                     <span className="text-[10px] text-morandi-blue font-medium animate-fade-in">{tooltip}</span>
                 )}
             </div>
        </div>

      </div>
    </div>
  );
};

export default ControlPanel;
