
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
    { id: 'layer_text', name: 'Typography', isVisible: true, hasContent: false, count: 0 },
    { id: 'layer_graphics', name: 'Graphics', isVisible: true, hasContent: false, count: 0 },
    { id: 'layer_background', name: 'Background', isVisible: true, hasContent: false, count: 0 },
  ]);
  const [svgContent, setSvgContent] = useState<string>('');

  useEffect(() => {
    // DEFENSIVE CHECK: Ensure we are actually parsing an SVG
    if (!svgDataUrl || !svgDataUrl.startsWith('data:image/svg+xml')) {
        return; 
    }

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

      const serializer = new XMLSerializer();
      const finalSvg = serializer.serializeToString(doc);
      const blob = new Blob([finalSvg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `neuro_export_${mode.toLowerCase()}_${Date.now()}.svg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
  };

  return (
    <div className={`glass-panel rounded-2xl p-5 w-64 shadow-glass ${className}`}>
        <h3 className="text-[10px] font-bold text-morandi-overlay uppercase tracking-wider mb-4 flex items-center gap-2">
            Layers
        </h3>

        <div className="space-y-2 mb-6">
            {layers.map(layer => (
                <div key={layer.id} className={`flex items-center justify-between p-3 rounded-xl transition-all ${layer.hasContent ? 'bg-white/50 border border-white' : 'bg-morandi-surface0/30 opacity-40'}`}>
                    <div className="flex items-center gap-3">
                        <button 
                            onClick={() => layer.hasContent && toggleLayer(layer.id)}
                            disabled={!layer.hasContent}
                            className={`w-4 h-4 rounded-md border flex items-center justify-center transition-colors focus:outline-none ${
                                layer.isVisible 
                                ? 'bg-morandi-text border-morandi-text text-white' 
                                : 'bg-transparent border-morandi-overlay'
                            }`}
                        >
                            {layer.isVisible && <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                        </button>
                        <span className="text-xs font-semibold text-morandi-text">{layer.name}</span>
                    </div>
                    {layer.hasContent && (
                        <span className="text-[9px] bg-white text-morandi-overlay px-1.5 py-0.5 rounded-full border border-morandi-surface1 font-medium">{layer.count}</span>
                    )}
                </div>
            ))}
        </div>

        <div className="border-t border-morandi-surface1 pt-4 space-y-2">
            <h4 className="text-[9px] font-bold text-morandi-overlay uppercase tracking-widest mb-1">Export Actions</h4>
            <div className="grid grid-cols-2 gap-2">
                <button 
                    onClick={() => handleDownload('TEXT_ONLY')}
                    disabled={!layers.find(l => l.id === 'layer_text')?.hasContent}
                    className="flex items-center justify-center px-3 py-2 bg-white/70 hover:bg-white text-[10px] font-medium text-morandi-text rounded-lg transition-all border border-transparent hover:border-morandi-surface1 disabled:opacity-50"
                >
                    Text Only
                </button>
                <button 
                    onClick={() => handleDownload('NO_BG')}
                    className="flex items-center justify-center px-3 py-2 bg-white/70 hover:bg-white text-[10px] font-medium text-morandi-text rounded-lg transition-all border border-transparent hover:border-morandi-surface1"
                >
                    No BG
                </button>
            </div>
             <button 
                onClick={() => handleDownload('MERGED')}
                className="w-full mt-2 flex items-center justify-center gap-2 px-3 py-2.5 bg-morandi-blue/10 hover:bg-morandi-blue/20 text-xs text-morandi-text font-semibold rounded-lg transition-colors border border-morandi-blue/20"
            >
                Download SVG
            </button>
        </div>
    </div>
  );
};

export default LayerPanel;
