import React from 'react';
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
  onClearMask
}) => {
  
  const handleChange = (key: keyof RestorationConfig, value: any) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const handleReferenceUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          const reader = new FileReader();
          reader.onloadend = () => {
              handleChange('referenceImage', reader.result as string);
          };
          reader.readAsDataURL(file);
      }
  };

  return (
    <div className="flex flex-col h-full bg-gray-850 border-l border-gray-750 w-80 p-6 overflow-y-auto">
      <div className="mb-8">
        <h1 className="text-xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
          NeuroRestore Pro
        </h1>
        <p className="text-xs text-gray-400 mt-1">AI-Powered Forensic Restoration</p>
      </div>

      <div className="space-y-6">
        
        {/* Mode Selector */}
        <div className="grid grid-cols-2 gap-1 p-1 bg-gray-900 rounded-lg text-xs font-medium">
            <button 
                onClick={() => setMode(AppMode.RESTORATION)}
                className={`py-2 rounded-md transition-colors ${mode === AppMode.RESTORATION ? 'bg-gray-700 text-white shadow' : 'text-gray-500 hover:text-gray-300'}`}
            >
                Restore
            </button>
            <button 
                onClick={() => setMode(AppMode.INPAINTING)}
                className={`py-2 rounded-md transition-colors ${mode === AppMode.INPAINTING ? 'bg-gray-700 text-white shadow' : 'text-gray-500 hover:text-gray-300'}`}
            >
                Inpaint
            </button>
            <button 
                onClick={() => setMode(AppMode.VECTORIZATION)}
                className={`py-2 rounded-md transition-colors ${mode === AppMode.VECTORIZATION ? 'bg-purple-900/50 text-purple-200 border border-purple-500/30 shadow' : 'text-gray-500 hover:text-gray-300'}`}
            >
                Vectorize
            </button>
             <button 
                onClick={() => setMode(AppMode.EXTRACT_TEXT)}
                className={`py-2 rounded-md transition-colors ${mode === AppMode.EXTRACT_TEXT ? 'bg-green-900/50 text-green-200 border border-green-500/30 shadow' : 'text-gray-500 hover:text-gray-300'}`}
            >
                Extract Text
            </button>
             <button 
                onClick={() => setMode(AppMode.GENERATION)}
                className={`col-span-2 py-2 rounded-md transition-colors ${mode === AppMode.GENERATION ? 'bg-gray-700 text-white shadow' : 'text-gray-500 hover:text-gray-300'}`}
            >
                Create New
            </button>
        </div>

        {/* --- INPAINTING SPECIFIC CONTROLS --- */}
        {mode === AppMode.INPAINTING && (
            <div className="p-4 bg-gray-900/50 rounded-lg border border-gray-800 space-y-4">
                <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider">Canvas Tools</h3>
                
                {/* Brush Size */}
                <div>
                   <label className="flex justify-between text-xs text-gray-400 mb-2">
                       <span>Brush Size</span>
                       <span>{config.brushSize}px</span>
                   </label>
                   <input 
                      type="range" 
                      min="10" 
                      max="100" 
                      value={config.brushSize} 
                      onChange={(e) => handleChange('brushSize', parseInt(e.target.value))}
                      className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                   />
                </div>

                {/* Mask Blending Mode */}
                <div>
                  <label className="block text-xs font-mono text-gray-400 mb-2 uppercase tracking-wider">Brush Mode</label>
                  <div className="grid grid-cols-3 gap-1">
                      {(['add', 'subtract', 'intersect'] as MaskBlendMode[]).map((blend) => (
                          <button
                            key={blend}
                            onClick={() => handleChange('maskBlendMode', blend)}
                            className={`py-1.5 px-2 rounded text-[10px] font-medium uppercase border transition-colors ${
                                config.maskBlendMode === blend 
                                ? 'bg-cyan-900/30 border-cyan-500 text-cyan-200' 
                                : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
                            }`}
                          >
                              {blend}
                          </button>
                      ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-800/50">
                    <button 
                       onClick={onClearMask}
                       className="px-2 py-2 bg-gray-800 hover:bg-red-900/30 text-gray-300 hover:text-red-300 rounded text-xs border border-gray-700 transition-colors"
                    >
                        Clear Mask
                    </button>
                    <button 
                       onClick={() => onExpand?.('all')}
                       className="px-2 py-2 bg-gray-800 hover:bg-cyan-900/30 text-gray-300 hover:text-cyan-300 rounded text-xs border border-gray-700 transition-colors flex items-center justify-center gap-1"
                    >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                        </svg>
                        Outpaint
                    </button>
                </div>
            </div>
        )}

        {/* --- VECTORIZATION SPECIFIC CONTROLS --- */}
        {(mode === AppMode.VECTORIZATION) && (
            <div className="p-4 bg-purple-900/20 rounded-lg border border-purple-500/20 space-y-4">
                 <h3 className="text-xs font-bold text-purple-400 uppercase tracking-wider">Vector Settings</h3>
                 
                 <div>
                    <label className="block text-xs font-mono text-gray-400 mb-2 uppercase tracking-wider">Complexity</label>
                    <div className="flex rounded-md shadow-sm" role="group">
                        {(['LOW', 'MEDIUM', 'HIGH'] as const).map((level) => (
                             <button 
                                key={level}
                                onClick={() => handleChange('vectorDetail', level)}
                                className={`flex-1 px-2 py-2 text-[10px] font-medium border first:rounded-l-md last:rounded-r-md ${
                                    config.vectorDetail === level
                                    ? 'bg-purple-600 text-white border-purple-600'
                                    : 'bg-gray-800 text-gray-400 border-gray-600 hover:bg-gray-700'
                                }`}
                             >
                                 {level}
                             </button>
                        ))}
                    </div>
                 </div>

                 <div>
                    <label className="block text-xs font-mono text-gray-400 mb-2 uppercase tracking-wider">Color Mode</label>
                    <div className="flex gap-2">
                        <button
                            onClick={() => handleChange('vectorColor', 'COLOR')}
                            className={`flex-1 py-2 rounded border text-xs ${config.vectorColor === 'COLOR' ? 'bg-purple-600/50 border-purple-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400'}`}
                        >
                            Full Color
                        </button>
                        <button
                            onClick={() => handleChange('vectorColor', 'BLACK_WHITE')}
                            className={`flex-1 py-2 rounded border text-xs ${config.vectorColor === 'BLACK_WHITE' ? 'bg-purple-600/50 border-purple-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400'}`}
                        >
                            B&W
                        </button>
                    </div>
                 </div>
                 <p className="text-[10px] text-purple-300/60 leading-tight">
                     Best for Logos, Icons, and simple Illustrations. Generates SVG code.
                 </p>
            </div>
        )}

        {/* --- EXTRACT TEXT INFO --- */}
        {mode === AppMode.EXTRACT_TEXT && (
             <div className="p-4 bg-green-900/20 rounded-lg border border-green-500/20 space-y-4">
                 <h3 className="text-xs font-bold text-green-400 uppercase tracking-wider">Extraction Engine</h3>
                 <p className="text-[10px] text-green-300/80 leading-tight">
                     Removes background and extracts only textual elements as a transparent SVG. Ideal for overlaying translated text or grabbing logo types.
                 </p>
             </div>
        )}

        {/* Content Type (Only Restore) */}
        {mode === AppMode.RESTORATION && (
            <div>
            <label className="block text-xs font-mono text-gray-400 mb-2 uppercase tracking-wider">Source Type</label>
            <div className="grid grid-cols-2 gap-2">
                <button
                onClick={() => handleChange('imageType', ImageType.DOCUMENT)}
                className={`px-3 py-2 rounded border text-sm text-left transition-all ${
                    config.imageType === ImageType.DOCUMENT
                    ? 'border-cyan-500 bg-cyan-900/20 text-cyan-100'
                    : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600'
                }`}
                >
                <span className="block font-semibold">Document</span>
                <span className="text-xs opacity-70">Scan, OCR, Text</span>
                </button>
                <button
                onClick={() => handleChange('imageType', ImageType.DIGITAL_ART)}
                className={`px-3 py-2 rounded border text-sm text-left transition-all ${
                    config.imageType === ImageType.DIGITAL_ART
                    ? 'border-purple-500 bg-purple-900/20 text-purple-100'
                    : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600'
                }`}
                >
                <span className="block font-semibold">Digital Art</span>
                <span className="text-xs opacity-70">Comic, Vector</span>
                </button>
            </div>
            </div>
        )}

        {/* Reference Image (Restoration Only) */}
        {mode === AppMode.RESTORATION && (
            <div className="p-3 bg-gray-900/30 rounded border border-gray-700/50">
                <label className="block text-xs font-mono text-gray-400 mb-2 uppercase tracking-wider flex justify-between items-center">
                    <span>Style Reference</span>
                    <span className="text-[10px] text-gray-600 bg-gray-800 px-1 rounded">OPTIONAL</span>
                </label>
                
                {config.referenceImage ? (
                    <div className="relative group">
                        <img 
                            src={config.referenceImage} 
                            alt="Reference" 
                            className="w-full h-16 object-cover rounded border border-gray-600 opacity-80 group-hover:opacity-100 transition-opacity" 
                        />
                        <button 
                            onClick={() => handleChange('referenceImage', undefined)}
                            className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 hover:bg-red-600 transition-colors"
                        >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                        <div className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/70 text-[10px] text-white rounded pointer-events-none">
                            Active
                        </div>
                    </div>
                ) : (
                    <label className="flex flex-col items-center justify-center w-full h-16 border border-dashed border-gray-700 rounded cursor-pointer hover:bg-gray-800 hover:border-gray-500 transition-colors">
                        <svg className="w-5 h-5 text-gray-500 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                        </svg>
                        <span className="text-[10px] text-gray-500">Upload Reference</span>
                        <input type="file" className="hidden" accept="image/*" onChange={handleReferenceUpload} />
                    </label>
                )}
            </div>
        )}

        {/* Color Correction Style (Restore Only) */}
        {mode === AppMode.RESTORATION && (
             <div>
             <label className="block text-xs font-mono text-gray-400 mb-2 uppercase tracking-wider">Color Correction</label>
             <select 
               value={config.colorStyle}
               onChange={(e) => handleChange('colorStyle', e.target.value)}
               className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
             >
               <option value={ColorStyle.TRUE_TONE}>True Tone (Strict Fidelity)</option>
               <option value={ColorStyle.HIGH_CONTRAST}>High Contrast (Doc Clean)</option>
               <option value={ColorStyle.VIBRANT_HDR}>Vibrant HDR (Art)</option>
               <option value={ColorStyle.BLACK_WHITE}>Black & White</option>
               <option value={ColorStyle.VINTAGE_WARM}>Vintage Warm</option>
               <option value={ColorStyle.COOL_TONE}>Cool / Modern</option>
             </select>
           </div>
        )}

        {/* Output Resolution - Hide for Vector/Extract modes */}
        {mode !== AppMode.VECTORIZATION && mode !== AppMode.EXTRACT_TEXT && (
            <div>
            <label className="block text-xs font-mono text-gray-400 mb-2 uppercase tracking-wider">Target Resolution</label>
            <select 
                value={config.resolution}
                onChange={(e) => handleChange('resolution', e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
            >
                {Object.values(Resolution).map(res => (
                <option key={res} value={res}>{res} Ultra HD</option>
                ))}
            </select>
            </div>
        )}

        {/* Aspect Ratio */}
        {mode !== AppMode.EXTRACT_TEXT && (
            <div>
            <label className="block text-xs font-mono text-gray-400 mb-2 uppercase tracking-wider">Aspect Ratio</label>
            <select 
                value={config.aspectRatio}
                onChange={(e) => handleChange('aspectRatio', e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
            >
                <option value={AspectRatio.ORIGINAL}>Original (Match Source)</option>
                {Object.values(AspectRatio)
                .filter(r => r !== AspectRatio.ORIGINAL)
                .map(ratio => (
                <option key={ratio} value={ratio}>{ratio}</option>
                ))}
            </select>
            {mode === AppMode.INPAINTING && (
                <p className="text-[10px] text-gray-500 mt-1">Aspect ratio determined by Canvas.</p>
            )}
            </div>
        )}

        {/* Text Prompt */}
        {mode !== AppMode.VECTORIZATION && mode !== AppMode.EXTRACT_TEXT && (
            <div>
            <label className="block text-xs font-mono text-gray-400 mb-2 uppercase tracking-wider">
                {mode === AppMode.RESTORATION ? 'Edit / Instructions' : (mode === AppMode.INPAINTING ? 'Edit Instruction' : 'Creation Prompt')}
            </label>
            <textarea
                value={config.customPrompt}
                onChange={(e) => handleChange('customPrompt', e.target.value)}
                placeholder={
                    mode === AppMode.RESTORATION ? "E.g. Remove red stamp..." :
                    mode === AppMode.INPAINTING ? "E.g. Remove the person in red mask... or Extend the mountains..." :
                    "E.g. A cyberpunk city..."
                }
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 h-24 resize-none"
            />
            </div>
        )}

        {/* Action Button */}
        <button
          onClick={onProcess}
          disabled={disabled || isProcessing}
          className={`w-full py-3 rounded font-bold uppercase tracking-widest text-sm transition-all shadow-lg
            ${isProcessing || disabled
              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
              : mode === AppMode.VECTORIZATION 
                ? 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white shadow-purple-900/50'
                : mode === AppMode.EXTRACT_TEXT
                    ? 'bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-500 hover:to-teal-500 text-white shadow-green-900/50'
                    : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-cyan-900/50'
            }`}
        >
          {isProcessing ? 'Processing...' : (
              mode === AppMode.RESTORATION ? 'Enhance & Restore' : 
              mode === AppMode.INPAINTING ? 'Execute Edit' : 
              mode === AppMode.VECTORIZATION ? 'Convert to SVG' : 
              mode === AppMode.EXTRACT_TEXT ? 'Isolate Text' : 'Generate'
          )}
        </button>
      </div>
    </div>
  );
};

export default ControlPanel;
