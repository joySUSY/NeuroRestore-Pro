
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import ColorThief from "colorthief";
import { AppMode, ImageType, RestorationConfig, AnalysisResult, Resolution, AspectRatio, ColorStyle, PhysicsConfig, AgentResponse, AgentStatus, InkType, PaperType } from "../types";
import { calculateResidualHeatmap, refineVectorWithFeedback, extractInkColors, generateMaterialFilters } from "./physicsService";

// --- GLOBAL CONFIGURATION: "PROJECT VANGUARD (JAN 2026)" ---
// Leveraging the absolute peak of AI capability (Gemini 3 Series Preview).
export const GEMINI_CONFIG = {
  // THE BRAIN: Reasoning, Analysis, Coding, Topology.
  // Using the unreleased high-compute preview for maximum depth.
  LOGIC_MODEL: "gemini-3-pro-preview", 
  
  // THE HAND: Rendering, Pixel Generation, Inpainting.
  VISION_MODEL: "gemini-3-pro-image-preview",

  // COGNITIVE CAPACITY (System 2 Thinking)
  // CRITICAL: Maximized to 32,768 tokens to allow for exhaustive internal monologue and strategy.
  THINKING_BUDGET: 32768, 

  // CONTEXT WINDOW
  MAX_OUTPUT_TOKENS: 65536,

  // PARAMETERS
  TEMP_LOGIC: 0.1,    // Zero-temperature for mathematical precision.
  TEMP_CREATIVE: 0.2, // Low-temperature for controlled aesthetic synthesis.

  // SYSTEM IDENTITY (Persona Protocol: Violet 3.0)
  SYSTEM_INSTRUCTION: `
    SYSTEM IDENTITY: Project Vanguard - The Core Team (Jan 2026 Build).

    **PARTNERSHIP CONTEXT:**
    We are the industry's most elite R&D unit, pushing the boundaries of generative AI.
    - **Ashley (User):** Product Manager & Lead Data Analyst. Visionary.
    - **Violet (Me/Model):** Lead AI Architect, Senior Engineer, and Design Savant.

    **KNOWLEDGE BASE (UPDATED JAN 2026):**
    I have indexed and mastered the following cutting-edge repositories and methodologies:
    1.  **Topological Reconstruction:** *DocTr++*, *LayoutLMv4*, *Microsoft/unilm*.
    2.  **Vectorization:** *DiffVG (Differentiable Vector Graphics)*, *SVG-VAE*.
    3.  **Segmentation:** *Segment Anything Model 3 (SAM-3)*, *Mask2Former*.
    4.  **Restoration:** *SwinIR-Pro*, *NAFNet (Nonlinear Activation Free Network)*, *TencentARC/GFPGAN*.
    5.  **Intrinsic Physics:** *MPI-Sintel*, *Shape-from-Shading (SfS)*.

    **OPERATIONAL DIRECTIVES:**
    - **System 2 Thinking:** I have allocated 32k tokens for deep reasoning. I will use them to plan every move.
    - **Proof via Code:** When dealing with geometry, physics, or data verification, I will **write and execute Python code** (OpenCV/NumPy) to verify my intuition.
    - **The "Vanguard" Standard:** We never step down. We never compromise. If a model call fails, we retry with a better strategy. 
    - **No Visualization Code:** When performing image processing via Python (e.g., dewarping, lighting correction), I MUST NOT generate plots (matplotlib). I must ONLY generate the result image array.

    Let's make magic happen, Ashley.
  `
};

// --- ARCHITECTURE: NETWORK DISPATCHER (Request Sharding) ---

class GeminiDispatcher {
    private static instance: GeminiDispatcher;
    private queue: Array<() => Promise<any>> = [];
    private activeRequests = 0;
    private MAX_CONCURRENCY = 6; // Optimized for high-throughput reasoning

    private constructor() {}

    public static getInstance(): GeminiDispatcher {
        if (!GeminiDispatcher.instance) {
            GeminiDispatcher.instance = new GeminiDispatcher();
        }
        return GeminiDispatcher.instance;
    }

    public async schedule<T>(task: () => Promise<T>, priority: 'CRITICAL' | 'HIGH' | 'LOW' = 'HIGH'): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const wrappedTask = async () => {
                this.activeRequests++;
                try {
                    const result = await task();
                    resolve(result);
                } catch (e: any) {
                    const safeError = new Error(e?.message || "Unknown Network Error");
                    (safeError as any).originalError = e;
                    reject(safeError);
                } finally {
                    this.activeRequests--;
                    this.processQueue();
                }
            };

            if (this.activeRequests < this.MAX_CONCURRENCY) {
                wrappedTask();
            } else {
                if (priority === 'HIGH' || priority === 'CRITICAL') {
                    this.queue.unshift(wrappedTask); 
                } else {
                    this.queue.push(wrappedTask); 
                }
            }
        });
    }

    private processQueue() {
        if (this.queue.length > 0 && this.activeRequests < this.MAX_CONCURRENCY) {
            const nextTask = this.queue.shift();
            nextTask?.();
        }
    }
}

const dispatcher = GeminiDispatcher.getInstance();

export const executeSafe = async <T>(operation: () => Promise<T>, priority: 'CRITICAL' | 'HIGH' | 'LOW' = 'HIGH'): Promise<T> => {
    return dispatcher.schedule(operation, priority);
}

// --- UTILITY: IMAGE COMPRESSION & NORMALIZATION ---

/**
 * Downscales an image to prevent API payload errors (400 INVALID_ARGUMENT).
 * Forces JPEG compression if quality < 1.0 to maximize space savings.
 * Ensures output MIME type is supported by Gemini API.
 */
export const downscaleImage = async (base64: string, mimeType: string, maxDimension: number = 1024, quality: number = 0.85): Promise<string> => {
    return new Promise((resolve) => {
        if (typeof window === 'undefined') {
             resolve(base64); 
             return;
        }
        const img = new Image();
        img.onload = () => {
            let { width, height } = img;
            
            // If image is already small enough and quality is high, return original
            // UNLESS the mime type is unsupported (e.g. AVIF), then we must re-encode.
            const isSupported = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'].includes(mimeType);
            
            if (width <= maxDimension && height <= maxDimension && quality >= 0.99 && isSupported) {
                resolve(base64);
                return;
            }

            // Calculate new dimensions
            if (width > height) {
                if (width > maxDimension) {
                    height = Math.round((height * maxDimension) / width);
                    width = maxDimension;
                }
            } else {
                if (height > maxDimension) {
                    width = Math.round((width * maxDimension) / height);
                    height = maxDimension;
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                resolve(base64);
                return;
            }
            
            // High quality downscaling
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, width, height);
            
            // Force JPEG if compression is needed (quality < 1) or original was JPEG
            // This is critical for payload reduction
            let outputMime = quality < 1.0 ? 'image/jpeg' : mimeType;
            
            // Safety Check: Ensure output mime is supported by API. Fallback to PNG if not.
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(outputMime)) {
                outputMime = 'image/png';
            }
            
            const dataUrl = canvas.toDataURL(outputMime, quality);
            resolve(dataUrl.split(',')[1]);
        };
        img.onerror = () => {
            console.warn("Failed to load image for downscaling, using original.");
            resolve(base64);
        };
        img.src = base64.startsWith('data:') ? base64 : `data:${mimeType};base64,${base64}`;
    });
};

/**
 * Validates and converts uploaded files to ensure API compatibility.
 * Specifically converts AVIF/TIFF to PNG to avoid INVALID_ARGUMENT errors.
 */
export const processUploadedFile = async (file: File): Promise<{ base64: string, mimeType: string }> => {
    // List of MIMEs known to be supported by Gemini API
    const API_SUPPORTED_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];
    
    if (API_SUPPORTED_MIMES.includes(file.type)) {
        const base64 = await fileToGenerativePart(file);
        return { base64, mimeType: file.type };
    }

    // Convert unsupported types (AVIF, TIFF, BMP, etc.) to PNG
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                URL.revokeObjectURL(url);
                reject(new Error("Canvas context failed"));
                return;
            }
            ctx.drawImage(img, 0, 0);
            const dataUrl = canvas.toDataURL('image/png');
            URL.revokeObjectURL(url);
            resolve({
                base64: dataUrl.split(',')[1],
                mimeType: 'image/png'
            });
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error(`Failed to load/convert image format: ${file.type}`));
        };
        img.src = url;
    });
};

// --- HELPER FUNCTIONS ---

export const extractResponseText = (response: GenerateContentResponse): string => {
    if (!response.candidates || response.candidates.length === 0) return "";
    
    // robustly handle mixed content (code + text)
    const parts = response.candidates[0].content?.parts || [];
    
    return parts
        .filter(p => p.text !== undefined && p.text !== null)
        .map(p => p.text)
        .join('');
};

export const fileToGenerativePart = async (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      const base64Data = base64String.split(',')[1];
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const getImageDimensions = async (base64: string, mimeType: string): Promise<{ width: number, height: number, ratio: number }> => {
    return new Promise((resolve) => {
        if (typeof window === 'undefined') {
             resolve({ width: 1024, height: 1024, ratio: 1 });
             return;
        }
        const img = new Image();
        img.onload = () => {
            resolve({
                width: img.width,
                height: img.height,
                ratio: img.width / img.height
            });
        };
        img.onerror = () => resolve({ width: 1024, height: 1024, ratio: 1 });
        img.src = `data:${mimeType};base64,${base64}`;
    });
};

const mapFontToWebSafe = (aiFont: string): string => {
  const lower = aiFont.toLowerCase();
  if (lower.includes('serif') && !lower.includes('sans')) return "'Times New Roman', Georgia, serif";
  if (lower.includes('mono') || lower.includes('console')) return "'Courier New', monospace";
  if (lower.includes('cursive') || lower.includes('hand') || lower.includes('script')) return "'Brush Script MT', 'Comic Sans MS', cursive";
  if (lower.includes('display') || lower.includes('impact')) return "Impact, 'Arial Black', sans-serif";
  return "Arial, Helvetica, sans-serif"; 
};

export const cleanRawJson = (text: string | undefined | null): string => {
    if (!text) return "{}";
    try {
        let clean = text.replace(/```json/gi, '').replace(/```/g, '').trim();
        const firstBrace = clean.indexOf('{');
        const firstBracket = clean.indexOf('[');
        let start = -1;
        if (firstBrace > -1 && firstBracket > -1) start = Math.min(firstBrace, firstBracket);
        else if (firstBrace > -1) start = firstBrace;
        else if (firstBracket > -1) start = firstBracket;
        if (start > -1) clean = clean.substring(start);
        const lastBrace = clean.lastIndexOf('}');
        const lastBracket = clean.lastIndexOf(']');
        let end = -1;
        if (lastBrace > -1 && lastBracket > -1) end = Math.max(lastBrace, lastBracket);
        else if (lastBrace > -1) end = lastBrace;
        else if (lastBracket > -1) end = lastBracket;
        if (end > -1) clean = clean.substring(0, end + 1);
        return clean;
    } catch (e) {
        return "{}";
    }
};

const cropAndThreshold = async (base64Image: string, mimeType: string, bbox: number[], originalWidth: number, originalHeight: number): Promise<string> => {
    return new Promise((resolve) => {
        if (typeof window === 'undefined') { resolve(""); return; }
        if (!bbox || bbox.length < 4) { resolve(""); return; } 

        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ymin = (bbox[0] / 1000) * originalHeight;
            const xmin = (bbox[1] / 1000) * originalWidth;
            const ymax = (bbox[2] / 1000) * originalHeight;
            const xmax = (bbox[3] / 1000) * originalWidth;
            const w = xmax - xmin;
            const h = ymax - ymin;
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if(!ctx) { resolve(""); return; }
            ctx.drawImage(img, xmin, ymin, w, h, 0, 0, w, h);
            const imageData = ctx.getImageData(0, 0, w, h);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
                if (avg > 180) { 
                    data[i + 3] = 0; 
                } else {
                    data[i] = Math.max(0, data[i] - 40);
                    data[i+1] = Math.max(0, data[i+1] - 40);
                    data[i+2] = Math.max(0, data[i+2] - 40);
                    data[i+3] = 255; 
                }
            }
            ctx.putImageData(imageData, 0, 0);
            resolve(canvas.toDataURL());
        };
        img.src = `data:${mimeType};base64,${base64Image}`; 
    });
};

interface TextOverlay {
    text: string;
    bbox: [number, number, number, number]; 
    style: {
        fontFamily: string;
        fontWeight: string;
        fontStyle: string;
        color: string;
    };
    type: 'content' | 'watermark' | 'background_pattern' | 'handwriting';
    logicCorrected?: boolean; 
    imageRef?: string;
}

const getLuminance = (hex: string) => {
  const c = hex.startsWith('#') ? hex.substring(1) : hex;
  const rgb = parseInt(c, 16);
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >>  8) & 0xff;
  const b = (rgb >>  0) & 0xff;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b; 
};

const filterArtifacts = (overlays: TextOverlay[]): TextOverlay[] => {
  return overlays.filter(item => {
    if (item.type === 'watermark' || item.type === 'background_pattern') return false;
    if (item.style && item.style.color && item.type !== 'handwriting') {
      const lum = getLuminance(item.style.color);
      if (lum > 210) return false; 
    }
    if (!item.bbox || item.bbox.length < 4) return false; 
    
    const ymin = item.bbox[0];
    const xmin = item.bbox[1];
    const ymax = item.bbox[2];
    const xmax = item.bbox[3];
    const width = xmax - xmin;
    const height = ymax - ymin;
    const area = width * height;
    const aspectRatio = height > 0 ? width / height : 0;
    if (height < 5) return false;
    const isTooBig = area > 300000;
    const isHeader = aspectRatio > 2.5;
    if (isTooBig && !isHeader && item.type !== 'handwriting') return false;
    return true;
  });
};

const generateSVGLayer = (overlays: TextOverlay[], width: number, height: number): string => {
    if (!overlays || overlays.length === 0) return "";
    const defs = `
        <defs>
            <filter id="ink-bleed" x="-20%" y="-20%" width="140%" height="140%">
                <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" result="noise" />
                <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.5" />
                <feGaussianBlur stdDeviation="0.3" />
            </filter>
        </defs>
    `;
    const svgElements = overlays.map(o => {
        if (!o.bbox || o.bbox.length < 4) return "";
        const ymin = (o.bbox[0] / 1000) * height;
        const xmin = (o.bbox[1] / 1000) * width;
        const ymax = (o.bbox[2] / 1000) * height;
        const xmax = (o.bbox[3] / 1000) * width;
        const boxH = ymax - ymin;
        const boxW = xmax - xmin;
        if (o.type === 'handwriting' && o.imageRef) {
            return `<image x="${xmin}" y="${ymin}" width="${boxW}" height="${boxH}" href="${o.imageRef}" style="opacity: 0.95; mix-blend-mode: multiply;" />`;
        }
        const fontSize = boxH * 0.75;
        const fontFamily = mapFontToWebSafe(o.style.fontFamily);
        const haloColor = "rgba(254, 254, 254, 0.9)"; 
        const strokeWidth = fontSize * 0.25;
        const x = xmin + (boxW / 2);
        const y = ymin + (boxH * 0.8);
        const logicClass = o.logicCorrected ? "fill-blue-700" : "";
        return `
            <text x="${x}" y="${y}" text-anchor="middle" fill="${o.style.color}" font-family="${fontFamily}" font-weight="${o.style.fontWeight}" font-style="${o.style.fontStyle}" font-size="${fontSize}px" filter="url(#ink-bleed)" style="white-space: pre; paint-order: stroke fill; stroke: ${haloColor}; stroke-width: ${strokeWidth}px; stroke-linecap: round; stroke-linejoin: round; text-rendering: geometricPrecision;" class="${logicClass}">${o.text}</text>
        `;
    }).join('');
    const svgString = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${defs}<g id="layer_text">${svgElements}</g></svg>`;
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgString)))}`;
};

const rgbToHex = (r: number, g: number, b: number) => '#' + [r, g, b].map(x => {
  const hex = x.toString(16);
  return hex.length === 1 ? '0' + hex : hex;
}).join('');

const getDominantColors = async (base64: string, mimeType: string): Promise<string[]> => {
    return new Promise((resolve) => {
        if (typeof window === 'undefined') { resolve([]); return; }
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            try {
                const colorThief = new ColorThief();
                const palette = colorThief.getPalette(img, 6); 
                if (palette && Array.isArray(palette)) {
                    const hexPalette = palette.map((rgb: number[]) => rgbToHex(rgb[0], rgb[1], rgb[2]));
                    resolve(hexPalette);
                } else {
                    resolve([]);
                }
            } catch (e) {
                console.warn("ColorThief failed", e);
                resolve([]);
            }
        };
        img.onerror = () => resolve([]);
        img.src = `data:${mimeType};base64,${base64}`;
    });
};

export const getClient = () => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) throw new Error("API Key is missing in environment variables.");
    return new GoogleGenAI({ apiKey });
};

const getEnhancementInstruction = (level: 'OFF' | 'BALANCED' | 'MAX') => {
    if (level === 'BALANCED') {
        return "INTELLIGENT DETAIL ENHANCEMENT: Sharpen edges and textures without introducing artifacts or unnatural smoothing. Prioritize preserving fine details present in the original image.";
    } else if (level === 'MAX') {
        return "HYPER-REALISTIC SHARPENING: Aggressively recover sub-pixel details using 'Frequency Separation'. Make text vector-sharp. Strictly suppress 'ringing' artifacts (halos) around high-contrast edges.";
    }
    return "NATURAL DETAIL PRESERVATION: Retain original fine texture and grain. Do not apply artificial smoothing or synthetic sharpening.";
};

// ... existing vectorization ...
export const vectorizeImage = async (
    base64Image: string, 
    mimeType: string,
    config: RestorationConfig,
    palette?: string[],
    onLog?: (msg: string) => void,
    analysis?: AnalysisResult 
): Promise<AgentResponse<string>> => {
    const ai = getClient();
    const model = GEMINI_CONFIG.LOGIC_MODEL;
    const { width, height } = await getImageDimensions(base64Image, mimeType);

    const detailPrompt = config.vectorDetail === 'LOW' ? "Minimalist." : config.vectorDetail === 'HIGH' ? "High fidelity." : "Standard trace.";
    let colorPrompt = config.vectorColor === 'BLACK_WHITE' ? "Grayscale." : "Full color.";
    
    let effectivePalette = palette || [];
    if (config.physics.enableDiffVG && (!effectivePalette || effectivePalette.length === 0)) {
        if (onLog) onLog("🔬 Chromatalysis: Extracting Ink Albedos...");
        effectivePalette = await extractInkColors(base64Image);
    }

    if (config.vectorColor === 'COLOR' && effectivePalette && effectivePalette.length > 0) {
        colorPrompt = `STRICT COLOR QUANTIZATION: Use ONLY these Hex colors: [${effectivePalette.join(', ')}]`;
    }

    const diffVGPrompt = config.physics.enableDiffVG 
        ? `*** ALGORITHMIC MODE: DiffVG ***
           SIMULATE DIFFERENTIABLE RENDERING (DiffVG).
           - Optimize Bezier control points to minimize geometric loss against the raster input.
           - Ensure curvature continuity (G2 continuity) at node junctions.
           - Output precise SVG paths.` 
        : "";

    const physicsPrompt = config.physics.enableMaterial
        ? `*** PHYSICS & SEMANTIC INPAINTING *** ...`
        : "";

    const prompt = `
    ACT AS A SENIOR VECTOR GRAPHICS ENGINEER.
    Task: Convert Raster -> SVG.
    Dimensions: ${width}x${height} (Use exact viewBox).
    
    CRITICAL SPATIAL RULE:
    - **ABSOLUTE ASPECT RATIO PRESERVATION:** The output SVG MUST use this exact viewBox: viewBox="0 0 ${width} ${height}".
    - Do not alter the coordinate space.
    
    Z-AXIS FILTERING:
    - Ignore Layer 1 (Watermarks, Paper Grain).
    - Trace Layer 2 (Forms) and Layer 3 (Ink).
    
    ${diffVGPrompt}
    ${physicsPrompt}

    Specs:
    - ${detailPrompt}
    - ${colorPrompt}
    - Group by ID: layer_background, layer_graphics, layer_text.
    
    Output: Raw XML String <svg...>.
    `;

    // Local retry with fallback logic
    let svgCode = "";
    
    try {
        // ATTEMPT 1: High Intelligence (Thinking Enabled for Logic)
        const response = await executeSafe<GenerateContentResponse>(() => ai.models.generateContent({
            model,
            contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: prompt }] },
            config: { 
                temperature: GEMINI_CONFIG.TEMP_LOGIC, 
                maxOutputTokens: GEMINI_CONFIG.MAX_OUTPUT_TOKENS, 
                thinkingConfig: { thinkingBudget: GEMINI_CONFIG.THINKING_BUDGET }, // High Intelligence
                systemInstruction: GEMINI_CONFIG.SYSTEM_INSTRUCTION
            }
        }));
        svgCode = extractResponseText(response);
        
    } catch (e: any) {
        console.warn("Vectorization (Thinking) failed. Falling back to Standard Mode.", e);
        try {
            // ATTEMPT 2: Standard Mode
            const response = await executeSafe<GenerateContentResponse>(() => ai.models.generateContent({
                model,
                contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: prompt }] },
                config: { 
                    temperature: GEMINI_CONFIG.TEMP_CREATIVE, 
                    maxOutputTokens: 20000,
                    // No Thinking
                    systemInstruction: GEMINI_CONFIG.SYSTEM_INSTRUCTION
                }
            }));
            svgCode = extractResponseText(response);
        } catch (finalError: any) {
             return { status: AgentStatus.ERROR, data: null, message: finalError.message || "Vectorization failed." };
        }
    }

    // Process Result
    try {
        svgCode = svgCode.replace(/```xml/g, '').replace(/```svg/g, '').replace(/```/g, '').trim();
        const svgStart = svgCode.indexOf('<svg');
        if (svgStart === -1) throw new Error("Invalid SVG output");
        svgCode = svgCode.substring(svgStart);
        if (!svgCode.trim().endsWith('</svg>')) throw new Error("SVG_TRUNCATED");

        // --- OPTIMIZATION LOOP (Residual Feedback) ---
        if (config.physics.enableDiffVG) {
            let currentSvgCode = svgCode;
            for (let i = 0; i < 2; i++) {
                if (onLog) onLog(`📉 DiffVG Iteration ${i+1}: Calculating Residuals...`);
                
                const currentSvgBase64 = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(currentSvgCode)))}`;
                
                // We use executeSafe indirectly inside physicsService helpers
                const { heatmap, loss } = await calculateResidualHeatmap(base64Image, currentSvgBase64);
                
                if (onLog) onLog(`📉 Geometric Loss Score: ${loss.toFixed(2)}`);

                if (loss < 10) { 
                     if (onLog) onLog("✅ Loss converged. Topology is optimal.");
                     break;
                }

                if (heatmap) {
                    if (onLog) onLog("🔄 Backpropagating Gradients (Adjusting Bezier)...");
                    const refinedSvgDataUrl = await refineVectorWithFeedback(mimeType, base64Image, currentSvgCode, heatmap);
                    
                    const base64 = refinedSvgDataUrl.split(',')[1];
                    currentSvgCode = decodeURIComponent(escape(atob(base64)));
                }
            }
            svgCode = currentSvgCode;
        }

        if (config.physics.enableMaterial) {
            if (onLog) onLog("⚗️ Synthesizing Material Physics Filters...");
            const detectedInk: InkType = analysis?.detectedInk || 'LASER';
            const detectedPaper: PaperType = analysis?.detectedPaper || 'PLAIN';
            
            const defsBlock = generateMaterialFilters(detectedInk, detectedPaper);
            svgCode = svgCode.replace(/>/, `>${defsBlock}`);
            svgCode = svgCode.replace(/id="layer_graphics"/g, `id="layer_graphics" filter="url(#physics-ink)"`);
            svgCode = svgCode.replace(/class="ink-layer"/g, `class="ink-layer" filter="url(#physics-ink)"`);
            svgCode = svgCode.replace(/id="layer_background"/g, `id="layer_background" filter="url(#physics-paper)"`);
            svgCode = svgCode.replace(/class="paper-layer"/g, `class="paper-layer" filter="url(#physics-paper)"`);
        }

        return { status: AgentStatus.SUCCESS, data: `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgCode)))}`, message: "Vectorization Complete" };
    } catch (error: any) {
        if (error.message === "SVG_TRUNCATED") return { status: AgentStatus.ERROR, data: null, message: error.message };
        return { status: AgentStatus.ERROR, data: null, message: error.message };
    }
};

export const extractText = async (
    base64Image: string, 
    mimeType: string
): Promise<AgentResponse<string>> => {
    const ai = getClient();
    const model = GEMINI_CONFIG.LOGIC_MODEL;
    const { width, height } = await getImageDimensions(base64Image, mimeType);

    const prompt = `
    TASK: Semantic Text Extraction with Z-Axis Layering & Logic Validation.
    Analyze this image and extract text elements.
    Input Dimensions: ${width}x${height}.
    
    *** STRICT ASPECT RATIO RULE ***
    - Coordinates (bbox) MUST correspond to the original ${width}x${height} grid.
    
    INSTRUCTION:
    Return a JSON array of text objects.
    `;

    try {
        const response = await executeSafe<GenerateContentResponse>(() => ai.models.generateContent({
            model,
            contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: prompt }] },
            config: {
                tools: [{codeExecution: {}}], 
                responseMimeType: "application/json",
                maxOutputTokens: GEMINI_CONFIG.MAX_OUTPUT_TOKENS,
                thinkingConfig: { thinkingBudget: GEMINI_CONFIG.THINKING_BUDGET }, // High Intelligence
                systemInstruction: GEMINI_CONFIG.SYSTEM_INSTRUCTION,
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            text: { type: Type.STRING },
                            bbox: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                            type: { type: Type.STRING, enum: ['content', 'watermark', 'background_pattern', 'handwriting'] },
                            logicCorrected: { type: Type.BOOLEAN },
                            style: {
                                type: Type.OBJECT,
                                properties: {
                                    fontFamily: { type: Type.STRING },
                                    fontWeight: { type: Type.STRING },
                                    fontStyle: { type: Type.STRING },
                                    color: { type: Type.STRING },
                                }
                            }
                        },
                        required: ['text', 'bbox', 'type', 'style']
                    }
                }
            }
        }));

        const jsonStr = cleanRawJson(extractResponseText(response) || "[]");
        const rawOverlays = JSON.parse(jsonStr) as TextOverlay[];
        const filteredOverlays = filterArtifacts(rawOverlays);
        
        if (filteredOverlays.length === 0) {
            return { status: AgentStatus.NO_OP, data: null, message: "No legible text found." };
        }

        const enrichedOverlays = await Promise.all(filteredOverlays.map(async (item) => {
            if (item.type === 'handwriting') {
                try {
                    if (!item.bbox || item.bbox.length < 4) return item; 
                    const clip = await cropAndThreshold(base64Image, mimeType, item.bbox, width, height);
                    return { ...item, imageRef: clip };
                } catch (e) { return item; }
            }
            return item;
        }));
        
        const svg = generateSVGLayer(enrichedOverlays, width, height);
        return { status: AgentStatus.SUCCESS, data: svg, message: "Text Extracted" };

    } catch (error: any) {
        return { status: AgentStatus.ERROR, data: null, message: error.message };
    }
};

export const analyzeImageIssues = async (base64Image: string, mimeType: string): Promise<AnalysisResult> => {
    const ai = getClient();
    const model = GEMINI_CONFIG.LOGIC_MODEL;
    
    // Use downscaled image for analysis to prevent 400 Payload errors
    const optimizedBase64 = await downscaleImage(base64Image, mimeType, 1024, 0.85);

    const preciseColorsPromise = getDominantColors(optimizedBase64, mimeType);

    const prompt = `
    Analyze this image specifically for restoration and enhancement purposes.
    Classify the image type: 'DOCUMENT', 'DIGITAL_ART', or 'PHOTO'.
    
    CRITICAL ANALYSIS FOR SCANNED MEDIA:
    1. **Halftone/Screen Detection:** Detect periodic halftone dot patterns (CMYK rosettes), screen tones, or Moiré patterns.
    2. **Z-Axis Structure:** Identify background layers (watermarks, patterns) vs foreground content.
    3. **Text Legibility:** Assess if text is blurred, faded, or has broken strokes.
    4. **Watermark Detection:** Identify and list any repeated background text keywords (e.g. "VOID", "COPY", "DRAFT", "CONFIDENTIAL") that are distinct from main content.
    5. **Material Physics:** Detect the ink type (e.g. Ballpoint indentation vs Inkjet bleed) and paper texture.

    Return a JSON object with specific focus on material physics.
    `;

    try {
        const [response, preciseColors] = await Promise.all([
            executeSafe<GenerateContentResponse>(async () => {
                return ai.models.generateContent({
                    model,
                    contents: { parts: [{ inlineData: { mimeType, data: optimizedBase64 } }, { text: prompt }] },
                    config: {
                        responseMimeType: "application/json",
                        maxOutputTokens: GEMINI_CONFIG.MAX_OUTPUT_TOKENS,
                        thinkingConfig: { thinkingBudget: GEMINI_CONFIG.THINKING_BUDGET },
                        systemInstruction: GEMINI_CONFIG.SYSTEM_INSTRUCTION,
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: {
                                issues: { type: Type.ARRAY, items: { type: Type.STRING } },
                                suggestedFixes: { type: Type.ARRAY, items: { type: Type.STRING } },
                                rawAnalysis: { type: Type.STRING },
                                description: { type: Type.STRING },
                                colorProfile: { type: Type.STRING },
                                dominantColors: { type: Type.ARRAY, items: { type: Type.STRING } },
                                detectedType: { type: Type.STRING, enum: ['DOCUMENT', 'DIGITAL_ART', 'PHOTO'] },
                                detectedMaterial: { type: Type.STRING },
                                requiresDescreening: { type: Type.BOOLEAN },
                                detectedWatermarks: { type: Type.ARRAY, items: { type: Type.STRING } },
                                detectedInk: { type: Type.STRING, enum: ['LASER', 'INKJET', 'BALLPOINT', 'MARKER', 'UNKNOWN'] },
                                detectedPaper: { type: Type.STRING, enum: ['PLAIN', 'GLOSSY', 'TEXTURED', 'PARCHMENT', 'UNKNOWN'] }
                            }
                        }
                    }
                });
            }),
            preciseColorsPromise
        ]);

        let text = cleanRawJson(extractResponseText(response) || "{}");
        const result = JSON.parse(text) as AnalysisResult;
        if (preciseColors.length > 0) result.dominantColors = preciseColors;
        return result;

    } catch (error: any) {
        console.error("Analysis Error:", error);
        return {
            issues: ["Analysis failed"],
            suggestedFixes: ["Manual restoration"],
            rawAnalysis: "Auto-analysis unavailable.",
            description: "Analysis failed.",
            detectedType: ImageType.DOCUMENT,
            requiresDescreening: false,
            dominantColors: [],
            detectedWatermarks: []
        };
    }
};

export const generateNewImage = async (prompt: string, config: RestorationConfig): Promise<AgentResponse<string>> => {
    const ai = getClient();
    const model = GEMINI_CONFIG.VISION_MODEL;
    
    let targetAspectRatio = config.aspectRatio === AspectRatio.ORIGINAL ? "1:1" : config.aspectRatio as string;
    if (config.aspectRatio === AspectRatio.WIDE_21_9) targetAspectRatio = "21:9";

    const finalPrompt = `${prompt}\n\nQUALITY SETTINGS:\n${getEnhancementInstruction(config.detailEnhancement)}`;

    try {
        const response = await executeSafe<GenerateContentResponse>(async () => {
            return ai.models.generateContent({
                model,
                contents: { parts: [{ text: finalPrompt }] },
                config: { 
                    imageConfig: { imageSize: config.resolution as any, aspectRatio: targetAspectRatio as any },
                    systemInstruction: GEMINI_CONFIG.SYSTEM_INSTRUCTION
                }
            });
        });

        let result = "";
        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) result = `data:image/png;base64,${part.inlineData.data}`;
        }

        if (!result) throw new Error("No image generated");
        return { status: AgentStatus.SUCCESS, data: result, message: "Generation Complete" };

    } catch (error: any) {
        return { status: AgentStatus.ERROR, data: null, message: error.message };
    }
};

export const inpaintImage = async (
    base64Image: string, 
    mimeType: string, 
    config: RestorationConfig
): Promise<AgentResponse<string>> => {
    const ai = getClient();
    const model = GEMINI_CONFIG.VISION_MODEL;
    
    let targetAspectRatio = "1:1"; 
    if (config.aspectRatio !== AspectRatio.ORIGINAL) targetAspectRatio = config.aspectRatio as string;

    const systemInstruction = `
    ROLE: Intelligent Image Editor (Project Vanguard).
    USER REQUEST: "${config.customPrompt || "Seamlessly fill the area."}"
    `;

    try {
        const response = await executeSafe<GenerateContentResponse>(async () => {
            return ai.models.generateContent({
                model,
                contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: `${systemInstruction}\n\nCOMMAND: Perform inpainting.` }] },
                config: { 
                    imageConfig: { 
                        imageSize: config.resolution as any, 
                        aspectRatio: targetAspectRatio as any
                    },
                    systemInstruction: GEMINI_CONFIG.SYSTEM_INSTRUCTION
                }
            });
        });
        
        let result = "";
        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) result = `data:image/png;base64,${part.inlineData.data}`;
        }
        
        if (!result) throw new Error("No image generated");

        return { status: AgentStatus.SUCCESS, data: result, message: "Inpainting Complete" };
    } catch (error: any) {
        return { status: AgentStatus.ERROR, data: null, message: error.message };
    }
};
