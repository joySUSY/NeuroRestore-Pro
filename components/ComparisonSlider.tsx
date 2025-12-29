import React, { useState, useRef, useEffect, useCallback } from 'react';

interface ComparisonSliderProps {
  originalImage: string;
  restoredImage: string;
  className?: string;
}

const ComparisonSlider: React.FC<ComparisonSliderProps> = ({ originalImage, restoredImage, className }) => {
  const [isResizing, setIsResizing] = useState(false);
  const [position, setPosition] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback(() => setIsResizing(true), []);
  const handleMouseUp = useCallback(() => setIsResizing(false), []);
  
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing || !containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percent = Math.max(0, Math.min((x / rect.width) * 100, 100));
    
    setPosition(percent);
  }, [isResizing]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isResizing || !containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const touch = e.touches[0];
    const x = Math.max(0, Math.min(touch.clientX - rect.left, rect.width));
    const percent = Math.max(0, Math.min((x / rect.width) * 100, 100));
    
    setPosition(percent);
  }, [isResizing]);

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleTouchMove);
    document.addEventListener('touchend', handleMouseUp);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp, handleTouchMove]);

  return (
    <div 
      ref={containerRef} 
      className={`relative w-full h-full select-none overflow-hidden rounded-xl border border-gray-700 bg-gray-900 ${className}`}
      style={{ touchAction: 'none' }}
    >
      {/* Restored Image (Background) */}
      <img
        src={restoredImage}
        alt="Restored"
        className="absolute top-0 left-0 w-full h-full object-contain"
        draggable={false}
      />

      {/* Original Image (Foreground - Clipped) */}
      <div 
        className="absolute top-0 left-0 h-full overflow-hidden border-r-2 border-white/50 shadow-[0_0_20px_rgba(0,0,0,0.5)]"
        style={{ width: `${position}%` }}
      >
        <div className="relative w-full h-full">
            {/* 
               CRITICAL FIX: 
               We need the image inside the clipped div to be the exact same size/scale as the background image 
               so they overlap perfectly.
               Since the parent container determines size, we set this img to match the parent's full width.
               We use `min-width` to force it to fill the parent container's width, 
               even though its container is clipped.
             */
            }
             <img
              src={originalImage}
              alt="Original"
              className="absolute top-0 left-0 max-w-none h-full object-contain"
              style={{ 
                  width: containerRef.current ? `${containerRef.current.clientWidth}px` : '100%' 
              }}
              draggable={false}
            />
        </div>
      </div>

      {/* Slider Handle */}
      <div
        className="absolute top-0 bottom-0 w-10 cursor-ew-resize flex items-center justify-center group z-10"
        style={{ left: `calc(${position}% - 20px)` }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleMouseDown}
      >
        <div className="w-0.5 h-full bg-white shadow-[0_0_10px_rgba(0,0,0,0.5)] group-hover:bg-cyan-400 transition-colors" />
        <div className="absolute w-8 h-8 rounded-full bg-white/90 shadow-lg flex items-center justify-center backdrop-blur-sm group-hover:scale-110 transition-transform">
          <svg className="w-5 h-5 text-gray-800" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" transform="rotate(90 12 12)" />
          </svg>
        </div>
      </div>

      {/* Labels */}
      <div className="absolute top-4 left-4 px-2 py-1 bg-black/60 backdrop-blur-md rounded text-xs font-mono text-white pointer-events-none">
        ORIGINAL
      </div>
      <div className="absolute top-4 right-4 px-2 py-1 bg-cyan-900/60 backdrop-blur-md rounded text-xs font-mono text-cyan-200 pointer-events-none">
        NEURO-RESTORED
      </div>
    </div>
  );
};

export default ComparisonSlider;
