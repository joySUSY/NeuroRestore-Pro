
import React, { useState, useRef, useEffect, useCallback } from 'react';

interface ComparisonSliderProps {
  originalImage: string;
  restoredImage: string;
  className?: string;
}

type ViewMode = 'SLIDER' | 'LOUPE';

const ComparisonSlider: React.FC<ComparisonSliderProps> = ({ originalImage, restoredImage, className }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('SLIDER');
  const [isResizing, setIsResizing] = useState(false);
  const [position, setPosition] = useState(50); // For Slider
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 }); // For Loupe
  const [showLoupe, setShowLoupe] = useState(false); // For Loupe hover state
  const [tilt, setTilt] = useState({ x: 0, y: 0 }); // For 3D Tilt Effect
  
  const containerRef = useRef<HTMLDivElement>(null);

  // --- Keyboard Shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'l') {
        setViewMode(prev => prev === 'SLIDER' ? 'LOUPE' : 'SLIDER');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // --- Slider Logic ---
  const handleMouseDown = useCallback(() => setIsResizing(true), []);
  const handleMouseUp = useCallback(() => setIsResizing(false), []);
  
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

    // Calculate Holographic Tilt (Rotate X/Y)
    const normX = (e.clientX - rect.left) / rect.width;
    const normY = (e.clientY - rect.top) / rect.height;
    
    setTilt({
        x: (0.5 - normY) * 6, // Tilt X
        y: (normX - 0.5) * 6  // Tilt Y
    });

    if (viewMode === 'SLIDER' && isResizing) {
        const percent = Math.max(0, Math.min((x / rect.width) * 100, 100));
        setPosition(percent);
    } else if (viewMode === 'LOUPE') {
        setCursorPos({ x, y });
    }
  }, [isResizing, viewMode]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!containerRef.current) return;
    if (e.touches.length === 0) return; // Safety check

    const rect = containerRef.current.getBoundingClientRect();
    const touch = e.touches[0];
    const x = Math.max(0, Math.min(touch.clientX - rect.left, rect.width));
    
    if (viewMode === 'SLIDER' && isResizing) {
        const percent = Math.max(0, Math.min((x / rect.width) * 100, 100));
        setPosition(percent);
    } 
  }, [isResizing, viewMode]);

  // Reset tilt on leave
  const handleMouseLeave = useCallback(() => {
      setTilt({ x: 0, y: 0 });
      setShowLoupe(false);
  }, []);

  // --- Event Listeners ---
  useEffect(() => {
    if(isResizing) {
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.addEventListener('touchmove', handleTouchMove);
        document.addEventListener('touchend', handleMouseUp);
    }
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleMouseUp);
    };
  }, [isResizing, handleMouseMove, handleMouseUp, handleTouchMove]);

  return (
    <div 
      ref={containerRef} 
      className={`relative w-full h-full select-none rounded-3xl bg-gray-100 group perspective-1000 ${className}`} 
      style={{ 
          perspective: '1200px',
          touchAction: 'none' 
      }}
      onMouseEnter={() => setShowLoupe(true)}
      onMouseLeave={handleMouseLeave}
      onMouseMove={(e) => !isResizing && handleMouseMove(e.nativeEvent)} 
    >
      
      {/* 3D Container Wrapper */}
      <div 
        className="relative w-full h-full transition-transform duration-100 ease-out overflow-hidden rounded-3xl shadow-2xl"
        style={{
            transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) scale(1.02)`,
            transformStyle: 'preserve-3d'
        }}
      >
        
        {/* Glossy Sheen Overlay */}
        <div 
            className="absolute inset-0 pointer-events-none z-50 bg-gradient-to-tr from-transparent via-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"
            style={{
                transform: `translateX(${tilt.y * -4}%) translateY(${tilt.x * -4}%)` // Sheen moves opposite to tilt
            }}
        />

        {/* --- RENDER MODES --- */}
      
        {viewMode === 'SLIDER' ? (
            <>
                {/* Restored Image (Background) */}
                <img
                    src={restoredImage}
                    alt="Restored"
                    className="absolute top-0 left-0 w-full h-full object-contain"
                    draggable={false}
                />
                
                {/* Original Image (Foreground - Clipped) */}
                <div 
                    className="absolute top-0 left-0 h-full overflow-hidden border-r border-white/80 shadow-[0_0_30px_rgba(0,0,0,0.15)] z-10"
                    style={{ width: `${position}%` }}
                >
                    <div className="relative w-full h-full">
                        <img
                            src={originalImage}
                            alt="Original"
                            className="absolute top-0 left-0 max-w-none h-full object-contain filter grayscale-[30%] opacity-90"
                            style={{ 
                                width: containerRef.current ? `${containerRef.current.clientWidth}px` : '100%',
                            }}
                            draggable={false}
                        />
                    </div>
                </div>
                {/* Slider Handle */}
                <div
                    className="absolute top-0 bottom-0 w-12 cursor-ew-resize flex items-center justify-center group/handle z-20"
                    style={{ left: `calc(${position}% - 24px)` }}
                    onMouseDown={handleMouseDown}
                    onTouchStart={handleMouseDown}
                >
                    <div className="absolute w-8 h-8 rounded-full bg-white/40 backdrop-blur-md border border-white/60 shadow-lg flex items-center justify-center transition-transform group-hover/handle:scale-110">
                    <div className="w-1.5 h-1.5 rounded-full bg-white shadow-sm"></div>
                    </div>
                </div>
                {/* Labels */}
                <div className="absolute top-6 left-6 px-3 py-1.5 bg-white/80 backdrop-blur rounded-full text-[10px] font-bold tracking-widest text-gray-500 shadow-sm pointer-events-none uppercase z-30 transform translate-z-10">
                    Original
                </div>
                <div className="absolute top-6 right-6 px-3 py-1.5 bg-morandi-dark/90 backdrop-blur rounded-full text-[10px] font-bold tracking-widest text-white shadow-lg pointer-events-none uppercase z-30 transform translate-z-10">
                    NeuroRestore
                </div>
            </>
        ) : (
            <>
                {/* Base: Original Image */}
                <div className="w-full h-full flex items-center justify-center bg-gray-50">
                    <img
                        src={originalImage}
                        alt="Original"
                        className="w-full h-full object-contain opacity-40 grayscale-[80%]"
                        draggable={false}
                    />
                </div>

                {/* Loupe Lens */}
                {showLoupe && (
                    <div 
                        className="absolute w-56 h-56 rounded-full shadow-2xl overflow-hidden z-20 pointer-events-none ring-4 ring-white/50 backdrop-blur-sm"
                        style={{
                            left: cursorPos.x - 112,
                            top: cursorPos.y - 112,
                            // Glass reflection gradient on top of content
                        }}
                    >
                        {/* The Magnified Content */}
                        <div 
                            className="absolute inset-0 w-full h-full bg-white"
                            style={{
                                backgroundImage: `url(${restoredImage})`,
                                backgroundRepeat: 'no-repeat',
                                // 2.5x Zoom calculation
                                backgroundSize: `${(containerRef.current?.clientWidth || 0) * 2.5}px ${(containerRef.current?.clientHeight || 0) * 2.5}px`,
                                backgroundPosition: `-${cursorPos.x * 2.5 - 112}px -${cursorPos.y * 2.5 - 112}px`
                            }}
                        />
                        
                        {/* Lens Flare / Glass Reflection Overlay */}
                        <div className="absolute inset-0 bg-gradient-to-tr from-white/10 via-transparent to-black/10 rounded-full pointer-events-none" />
                        <div className="absolute top-4 right-8 w-8 h-4 bg-white/30 rounded-full blur-md transform -rotate-45" />

                        {/* Crosshair */}
                        <div className="absolute inset-0 flex items-center justify-center opacity-40">
                            <div className="w-4 h-0.5 bg-morandi-dark/80"></div>
                            <div className="h-4 w-0.5 bg-morandi-dark/80 absolute"></div>
                        </div>
                    </div>
                )}
                
                <div className="absolute top-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/70 backdrop-blur rounded-full text-white text-[10px] font-bold shadow-lg pointer-events-none flex items-center gap-2">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" /></svg>
                    Loupe Mode (2.5x)
                </div>
            </>
        )}
      </div>

      {/* --- TOGGLE CONTROLS --- */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex bg-white/80 backdrop-blur p-1 rounded-xl shadow-lg border border-white/50 z-30 hover:scale-105 transition-transform">
          <button 
            onClick={() => setViewMode('SLIDER')}
            className={`p-2 rounded-lg transition-all ${viewMode === 'SLIDER' ? 'bg-morandi-dark text-white shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
            title="Slider View"
          >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
          </button>
          <button 
            onClick={() => setViewMode('LOUPE')}
            className={`p-2 rounded-lg transition-all ${viewMode === 'LOUPE' ? 'bg-morandi-dark text-white shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
            title="Loupe View (Press L)"
          >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </button>
      </div>

    </div>
  );
};

export default ComparisonSlider;
