import React, { useState, useEffect, useCallback } from 'react';

interface LayerPanelProps {
  svgDataUrl: string;
  onUpdateView: (newSvgDataUrl: string) => void;
  className?: string;
}

interface LayerState {
  id: string;
  name: string;
  isVisible: boolean;
  hasContent: boolean;
  count: number;
}

const LayerPanel: React.FC<LayerPanelProps> = ({ svgDataUrl, onUpdateView, className }) => {
  const [layers, setLayers] = useState<LayerState[]>([
    { id: 'layer_text', name: 'Text & Typography', isVisible: true, hasContent: false, count: 0 },
    { id: 'layer_graphics', name: 'Graphics & Subjects', isVisible: true, hasContent: false, count: 0 },
    { id: 'layer_background', name: 'Background', isVisible: true, hasContent: false, count: 0 },
  ]);
  const [svgContent, setSvgContent] = useState<string>('');

  // Initial Parse
  useEffect(() => {
    try {
      const base64 = svgDataUrl.split(',')[1];
      const decoded = decodeURIComponent(escape(atob(base64)));
      setSvgContent(decoded);

      const parser = new DOMParser();
      const doc = parser.parseFromString(decoded, "image/svg+xml");

      setLayers(prev => prev.map(layer => {
          const element = doc.getElementById(layer.id);
          const childrenCount = element ? element.children.length : 0;
          return {
              ...layer,
              hasContent: !!element,
              count: childrenCount,
              isVisible: true // Reset visibility on new load
          };
      }));
    } catch (e) {
      console.error("Failed to parse SVG for layers", e);
    }
  }, [svgDataUrl]);

  // Update SVG when visibility changes
  const updateVisibility = useCallback((newLayers: LayerState[]) => {
      try {
          const parser = new DOMParser();
          const doc = parser.parseFromString(svgContent, "image/svg+xml");
          
          newLayers.forEach(layer => {
              const el = doc.getElementById(layer.id);
              if (el) {
                  if (layer.isVisible) {
                      el.removeAttribute('display');
                  } else {
                      el.setAttribute('display', 'none');
                  }
              }
          });

          const serializer = new XMLSerializer();
          const newSvg = serializer.serializeToString(doc);
          const newBase64 = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(newSvg)))}`;
          
          onUpdateView(newBase64);
      } catch (e) {
          console.error("Failed to update layer visibility", e);
      }
  }, [svgContent, onUpdateView]);

  const toggleLayer = (id: string) => {
      const updatedLayers = layers.map(l => l.id === id ? { ...l, isVisible: !l.isVisible } : l);
      setLayers(updatedLayers);
      updateVisibility(updatedLayers);
  };

  const handleDownload = (mode: 'MERGED' | 'TEXT_ONLY' | 'NO_BG') => {
      // Create a temporary SVG based on download mode
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgContent, "image/svg+xml");

      if (mode === 'TEXT_ONLY') {
          ['layer_graphics', 'layer_background'].forEach(id => {
              const el = doc.getElementById(id);
              if (el) el.remove();
          });
      } else if (mode === 'NO_BG') {
           const el = doc.getElementById('layer_background');
           if (el) el.remove();
      }
      // MERGED is just the full SVG (or current view? Let's assume full strict export for specific buttons)

      const serializer = new XMLSerializer();
      const finalSvg = serializer.serializeToString(doc);
      const blob = new Blob([finalSvg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `smart_export_${mode.toLowerCase()}_${Date.now()}.svg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
  };

  return (
    <div className={`bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-4 w-64 backdrop-blur-md ${className}`}>
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            Smart Layers
        </h3>

        <div className="space-y-2 mb-4">
            {layers.map(layer => (
                <div key={layer.id} className={`flex items-center justify-between p-2 rounded ${layer.hasContent ? 'bg-gray-800' : 'bg-gray-800/30 opacity-50'}`}>
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={() => layer.hasContent && toggleLayer(layer.id)}
                            disabled={!layer.hasContent}
                            className={`focus:outline-none transition-colors ${layer.isVisible ? 'text-cyan-400' : 'text-gray-600'}`}
                        >
                            {layer.isVisible ? (
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                            ) : (
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                            )}
                        </button>
                        <span className="text-xs text-gray-300 font-medium">{layer.name}</span>
                    </div>
                    {layer.hasContent && (
                        <span className="text-[9px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded-full">{layer.count}</span>
                    )}
                </div>
            ))}
        </div>

        <div className="border-t border-gray-800 pt-3 space-y-2">
            <h4 className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-1">Asset Export</h4>
            <button 
                onClick={() => handleDownload('TEXT_ONLY')}
                disabled={!layers.find(l => l.id === 'layer_text')?.hasContent}
                className="w-full flex items-center justify-between px-3 py-2 bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <span>Export Text Only</span>
                <svg className="w-3 h-3 text-cyan-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            </button>
            <button 
                onClick={() => handleDownload('NO_BG')}
                className="w-full flex items-center justify-between px-3 py-2 bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 rounded transition-colors"
            >
                <span>Export Without BG</span>
                <svg className="w-3 h-3 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            </button>
             <button 
                onClick={() => handleDownload('MERGED')}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-cyan-900/30 hover:bg-cyan-900/50 text-xs text-cyan-300 border border-cyan-900/50 rounded transition-colors"
            >
                <span>Download Merged SVG</span>
            </button>
        </div>
    </div>
  );
};

export default LayerPanel;
