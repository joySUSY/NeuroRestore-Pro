import { GoogleGenAI, Type } from "@google/genai";
import ColorThief from "colorthief";
import { AppMode, ImageType, RestorationConfig, AnalysisResult, Resolution, AspectRatio, ColorStyle, PhysicsConfig } from "../types";

// --- INTERFACES ---

interface TextOverlay {
    text: string;
    // BBox in 0-1000 scale [ymin, xmin, ymax, xmax]
    bbox: [number, number, number, number]; 
    style: {
        fontFamily: 'serif' | 'sans-serif' | 'monospace' | 'cursive' | 'display';
        fontWeight: string; // "bold" or "normal"
        fontStyle: string; // "italic" or "normal"
        color: string; // HEX
        fontSize?: number; // Estimated pt size
    };
    type: 'content' | 'watermark' | 'background_pattern' | 'handwriting';
    confidence?: number; // 0-1
    logicCorrected?: boolean; // New: If AI fixed math/logic errors
    imageRef?: string; // New: Base64 data for handwriting clips
}

// --- HELPER FUNCTIONS ---

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
  return "Arial, Helvetica, sans-serif"; // Default
};

/**
 * Robust JSON Cleaner
 * Extracts JSON from Markdown code blocks or arbitrary text wrapping.
 */
export const cleanRawJson = (text: string): string => {
    if (!text) return "{}";
    
    // 1. Remove Markdown Code Blocks
    let clean = text.replace(/```json/gi, '').replace(/```/g, '').trim();

    // 2. Find JSON Start (first { or [)
    const firstBrace = clean.indexOf('{');
    const firstBracket = clean.indexOf('[');
    let start = -1;
    if (firstBrace > -1 && firstBracket > -1) start = Math.min(firstBrace, firstBracket);
    else if (firstBrace > -1) start = firstBrace;
    else if (firstBracket > -1) start = firstBracket;
    
    if (start > -1) clean = clean.substring(start);

    // 3. Find JSON End (last } or ])
    const lastBrace = clean.lastIndexOf('}');
    const lastBracket = clean.lastIndexOf(']');
    let end = -1;
    if (lastBrace > -1 && lastBracket > -1) end = Math.max(lastBrace, lastBracket);
    else if (lastBrace > -1) end = lastBrace;
    else if (lastBracket > -1) end = lastBracket;

    if (end > -1) clean = clean.substring(0, end + 1);

    return clean;
};

// --- HANDWRITING EXTRACTION HELPER ---
const cropAndThreshold = async (base64Image: string, mimeType: string, bbox: number[], originalWidth: number, originalHeight: number): Promise<string> => {
    return new Promise((resolve) => {
        if (typeof window === 'undefined') { resolve(""); return; }
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            // Gemini bbox is 0-1000 scale [ymin, xmin, ymax, xmax]
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
            
            // Apply Thresholding (Remove paper, keep ink)
            const imageData = ctx.getImageData(0, 0, w, h);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                // Calculate Luminance
                const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
                
                // If light (paper background), make transparent
                if (avg > 180) { 
                    data[i + 3] = 0; 
                } else {
                    // Enhance Ink: Make it darker and fully opaque
                    data[i] = Math.max(0, data[i] - 40);
                    data[i+1] = Math.max(0, data[i+1] - 40);
                    data[i+2] = Math.max(0, data[i+2] - 40);
                    data[i+3] = 255; 
                }
            }
            ctx.putImageData(imageData, 0, 0);
            resolve(canvas.toDataURL());
        };
        // Ensure we load the full original image
        img.src = `data:${mimeType};base64,${base64Image}`; 
    });
};

// --- ARTIFACT FILTERING ---
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

const getClient = () => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) throw new Error("API Key is missing in environment variables.");
    return new GoogleGenAI({ apiKey });
};

const getClosestAspectRatio = async (base64: string, mimeType: string): Promise<string> => {
    const { ratio } = await getImageDimensions(base64, mimeType);
    const supported = [
        { val: "1:1", ratio: 1.0 }, { val: "3:4", ratio: 3/4 }, 
        { val: "4:3", ratio: 4/3 }, { val: "9:16", ratio: 9/16 }, { val: "16:9", ratio: 16/9 }, 
    ];
    return supported.reduce((prev, curr) => (Math.abs(curr.ratio - ratio) < Math.abs(prev.ratio - ratio) ? curr : prev)).val;
};

const getEnhancementInstruction = (level: 'OFF' | 'BALANCED' | 'MAX') => {
    if (level === 'BALANCED') {
        return "INTELLIGENT DETAIL ENHANCEMENT: Sharpen edges and textures without introducing artifacts or unnatural smoothing. Prioritize preserving fine details present in the original image.";
    } else if (level === 'MAX') {
        return "HYPER-REALISTIC SHARPENING: Aggressively recover sub-pixel details using 'Frequency Separation'. Make text vector-sharp. Strictly suppress 'ringing' artifacts (halos) around high-contrast edges.";
    }
    return "NATURAL DETAIL PRESERVATION: Retain original fine texture and grain. Do not apply artificial smoothing or synthetic sharpening.";
};

// 1. Image Analysis
export const analyzeImageIssues = async (base64Image: string, mimeType: string): Promise<AnalysisResult> => {
    const ai = getClient();
    const model = "gemini-3-pro-preview"; 
    const preciseColorsPromise = getDominantColors(base64Image, mimeType);

    const prompt = `
    Analyze this image specifically for restoration and enhancement purposes.
    Classify the image type: 'DOCUMENT', 'DIGITAL_ART', or 'PHOTO'.
    
    CRITICAL ANALYSIS FOR SCANNED MEDIA:
    1. **Halftone/Screen Detection:** Detect periodic halftone dot patterns (CMYK rosettes), screen tones, or Moiré patterns.
    2. **Z-Axis Structure:** Identify background layers (watermarks, patterns) vs foreground content.
    3. **Text Legibility:** Assess if text is blurred, faded, or has broken strokes.
    4. **Watermark Detection:** Identify any repeated background text (e.g. "VOID", "COPY", "DRAFT").

    Return a JSON object with specific focus on whether 'descreening' is required and detecting watermarks.
    `;

    try {
        const [response, preciseColors] = await Promise.all([
            ai.models.generateContent({
                model,
                contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: prompt }] },
                config: {
                    responseMimeType: "application/json",
                    maxOutputTokens: 8192,
                    thinkingConfig: { thinkingBudget: 8192 },
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
                            detectedWatermarks: { type: Type.ARRAY, items: { type: Type.STRING } }
                        }
                    }
                }
            }),
            preciseColorsPromise
        ]);

        let text = cleanRawJson(response.text || "{}");
        const result = JSON.parse(text) as AnalysisResult;
        if (preciseColors.length > 0) result.dominantColors = preciseColors;
        return result;

    } catch (error: any) {
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

// 2. Image Restoration
export const restoreOrEditImage = async (
    base64Image: string, 
    mimeType: string, 
    config: RestorationConfig,
    analysis?: AnalysisResult
): Promise<string> => {
    const ai = getClient();
    const model = "gemini-3-pro-image-preview";

    const { width, height } = await getImageDimensions(base64Image, mimeType);
    let targetAspectRatio = config.aspectRatio === AspectRatio.ORIGINAL ? await getClosestAspectRatio(base64Image, mimeType) : config.aspectRatio as string;
    if (config.aspectRatio === AspectRatio.WIDE_21_9) targetAspectRatio = "16:9";

    const enhancementInstruction = getEnhancementInstruction(config.detailEnhancement);
    const descreenNeeded = analysis?.requiresDescreening ? "CRITICAL: REMOVE HALFTONE DOTS (DESCREEN)." : "";
    const watermarks = analysis?.detectedWatermarks || [];
    
    // PHYSICS CORE CONTEXT
    const intrinsicPrompt = config.physics.enableIntrinsic 
        ? "**PHYSICS CONSTRAINT:** You are receiving a pre-decomposed ALBEDO map. Do not add artificial lighting or shadows. Maintain the 'flat' intrinsic look."
        : "";

    const negativeConstraint = watermarks.length > 0 
        ? `*** NEGATIVE CONSTRAINT (WATERMARKS) ***\nDetected Background Text: [${watermarks.join(', ')}]. INSTRUCTION: Do NOT sharpen or enhance these specific words.`
        : "";

    const prompt = `
    Task: Restore and upscale this image.
    INPUT CONTEXT: Type: ${analysis?.detectedType || 'Unknown'}. ${descreenNeeded}
    Original Dimensions: ${width}x${height}
    ${intrinsicPrompt}
    ${negativeConstraint}
    
    *** STRICT GEOMETRIC LOCK ***
    1. **PIXEL-PERFECT REGISTRATION:** Output must align EXACTLY with input.
    2. **STRICT ASPECT RATIO:** The input dimensions are ${width}x${height}. Preserve ratio.

    VISUAL REQUIREMENTS:
    1. **Sharpness**: Vector-sharp edges for Layer 3 (Ink).
    2. **Clean**: Remove paper noise.
    3. **Texture**: ${enhancementInstruction}
    
    USER: ${config.customPrompt || 'Restore clarity.'}
    `;

    try {
        const response = await ai.models.generateContent({
            model,
            contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: prompt }] },
            config: {
                imageConfig: { imageSize: config.resolution as any, aspectRatio: targetAspectRatio as any }
            }
        });
        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
        }
        throw new Error("No image data received.");
    } catch (error: any) {
        throw new Error(error.message || "Failed to restore image.");
    }
};

// 3. Image Inpainting
export const inpaintImage = async (
    base64Image: string, 
    mimeType: string, 
    config: RestorationConfig
): Promise<string> => {
    const ai = getClient();
    const model = "gemini-3-pro-image-preview"; 
    const { width, height } = await getImageDimensions(base64Image, mimeType);
    let targetAspectRatio = config.aspectRatio === AspectRatio.ORIGINAL ? await getClosestAspectRatio(base64Image, mimeType) : config.aspectRatio as string;
    const enhancementInstruction = getEnhancementInstruction(config.detailEnhancement);

    const systemInstruction = `
    ROLE: Intelligent Image Editor.
    LOGIC: Mask Detection (Red) -> Context Analysis -> Texture Synthesis.
    CRITICAL DESCREENING DIRECTIVE: Match the *descreened* (smooth) look of the original.
    DETAIL: ${enhancementInstruction}
    USER REQUEST: "${config.customPrompt || "Seamlessly fill the area."}"
    `;

    try {
        const response = await ai.models.generateContent({
            model,
            contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: `${systemInstruction}\n\nCOMMAND: Perform inpainting.` }] },
            config: { imageConfig: { imageSize: config.resolution as any, aspectRatio: targetAspectRatio as any } }
        });
        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
        }
        throw new Error("No image data received.");
    } catch (error: any) {
        throw new Error(error.message || "Failed to edit image.");
    }
};

// 4. Image Generation
export const generateNewImage = async (prompt: string, config: RestorationConfig): Promise<string> => {
    const ai = getClient();
    const model = "gemini-3-pro-image-preview"; 
    let targetAspectRatio = config.aspectRatio === AspectRatio.ORIGINAL ? "1:1" : config.aspectRatio as string;
    if (config.aspectRatio === AspectRatio.WIDE_21_9) targetAspectRatio = "16:9";
    const finalPrompt = `${prompt}\n\nQUALITY SETTINGS:\n${getEnhancementInstruction(config.detailEnhancement)}`;

    try {
        const response = await ai.models.generateContent({
            model,
            contents: { parts: [{ text: finalPrompt }] },
            config: { imageConfig: { imageSize: config.resolution as any, aspectRatio: targetAspectRatio as any } }
        });
        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
        }
        throw new Error("No image generated.");
    } catch (error: any) {
        throw new Error(error.message || "Failed to generate image.");
    }
};

// 5. Vectorization (SVG Generation) - UPGRADED TO DIFFVG SIMULATION
export const vectorizeImage = async (
    base64Image: string, 
    mimeType: string,
    config: RestorationConfig,
    palette?: string[]
): Promise<string> => {
    const ai = getClient();
    const model = "gemini-3-pro-preview"; 
    const { width, height } = await getImageDimensions(base64Image, mimeType);

    const detailPrompt = config.vectorDetail === 'LOW' ? "Minimalist." : config.vectorDetail === 'HIGH' ? "High fidelity." : "Standard trace.";
    let colorPrompt = config.vectorColor === 'BLACK_WHITE' ? "Grayscale." : "Full color.";
    if (config.vectorColor === 'COLOR' && palette && palette.length > 0) {
        colorPrompt = `STRICT COLOR QUANTIZATION: Use ONLY these Hex colors: [${palette.join(', ')}]`;
    }

    // ALGORITHM 3: DiffVG (Differentiable Vector Graphics) Prompting
    const diffVGPrompt = config.physics.enableDiffVG 
        ? `
        *** ALGORITHMIC MODE: DiffVG (Differentiable Vector Graphics) ***
        Instead of hallucinating shapes, perform an "Optimization" routine:
        1. Initialize Bezier curves along high-contrast edges.
        2. Conceptually compute Pixel L2 Loss between the curve and the raster edge.
        3. Adjust Control Points to minimize this loss.
        4. OUTPUT: Precision SVG with minimized fitting error.
        ` 
        : "";

    const prompt = `
    ACT AS A SENIOR VECTOR GRAPHICS ENGINEER.
    Task: Convert Raster -> SVG.
    Dimensions: ${width}x${height} (Use exact viewBox).
    
    CRITICAL SPATIAL RULE:
    - **ABSOLUTE ASPECT RATIO PRESERVATION:** The output SVG MUST use this exact viewBox: viewBox="0 0 ${width} ${height}".
    - Do not alter the coordinate space.
    - All elements must be positioned exactly where they are in the original image.

    Z-AXIS FILTERING:
    - Ignore Layer 1 (Watermarks, Paper Grain).
    - Trace Layer 2 (Forms) and Layer 3 (Ink).
    
    ${diffVGPrompt}

    Specs:
    - ${detailPrompt}
    - ${colorPrompt}
    - Group by ID: layer_background, layer_graphics, layer_text.
    
    Output: Raw XML String <svg...>.
    `;

    try {
        const response = await ai.models.generateContent({
            model,
            contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: prompt }] },
            config: { 
                temperature: 0.2, 
                maxOutputTokens: 32768, 
                thinkingConfig: { thinkingBudget: 32768 } // MAXIMIZED thinking budget for optimization
            }
        });

        let svgCode = response.text || "";
        svgCode = svgCode.replace(/```xml/g, '').replace(/```svg/g, '').replace(/```/g, '').trim();
        const svgStart = svgCode.indexOf('<svg');
        if (svgStart === -1) throw new Error("Invalid SVG output");
        svgCode = svgCode.substring(svgStart);
        if (!svgCode.trim().endsWith('</svg>')) throw new Error("SVG_TRUNCATED");

        return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgCode)))}`;
    } catch (error: any) {
        if (error.message === "SVG_TRUNCATED") throw error;
        throw new Error("Failed to vectorize.");
    }
};

// 6. Text Extraction
export const extractText = async (
    base64Image: string, 
    mimeType: string
): Promise<string> => {
    const ai = getClient();
    const model = "gemini-3-pro-preview"; 
    const { width, height } = await getImageDimensions(base64Image, mimeType);

    const prompt = `
    TASK: Semantic Text Extraction with Z-Axis Layering & Logic Validation.
    Analyze this image and extract text elements.
    Input Dimensions: ${width}x${height}.
    
    *** STRICT ASPECT RATIO RULE ***
    - Coordinates (bbox) MUST correspond to the original ${width}x${height} grid.
    - Do not normalize coordinates to a different ratio.

    *** Z-AXIS LAYER SEPARATION ***
    Mentally separate the image into 3 layers:
    - **Layer 1 (Bottom):** Background Watermarks (e.g., "VOID", "COPY", "Security"). -> Tag as 'watermark'.
    - **Layer 2 (Middle):** Pre-printed labels. -> Tag as 'content'.
    - **Layer 3 (Top):** Hand-filled Ink, Stamps. -> Tag as 'content'.
    
    *** LOGICAL CONSISTENCY CHECK (REASONING MODE) ***
    1. If this is a financial document (Invoice, Receipt):
       - Check if Quantity * Unit Price = Line Total.
       - Check if Subtotals sum to Final Total.
    2. AUTO-CORRECTION:
       - If OCR reads "700.00" but logic dictates "100.00" (e.g. 10 x 10), output "100.00".
       - Set "logicCorrected": true.
       - Use CODE EXECUTION to verify the math if unsure.
    3. HANDWRITING DETECTION:
       - If a field is a Signature or handwritten note, tag type as 'handwriting'.

    INSTRUCTION:
    Return a JSON array of text objects.
    - 'text': The content string.
    - 'bbox': [ymin, xmin, ymax, xmax] (0-1000 scale).
    - 'type': 'content' | 'watermark' | 'background_pattern' | 'handwriting'.
    - 'logicCorrected': boolean (optional, true if AI fixed logic errors).
    - 'style': Visual attributes.
    `;

    try {
        const response = await ai.models.generateContent({
            model,
            contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: prompt }] },
            config: {
                tools: [{codeExecution: {}}], 
                responseMimeType: "application/json",
                maxOutputTokens: 16384,
                thinkingConfig: { thinkingBudget: 16384 },
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
                                    fontFamily: { type: Type.STRING, enum: ['serif', 'sans-serif', 'monospace', 'cursive', 'display'] },
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
        });

        const jsonStr = cleanRawJson(response.text || "[]");
        const rawOverlays = JSON.parse(jsonStr) as TextOverlay[];
        const filteredOverlays = filterArtifacts(rawOverlays);
        const enrichedOverlays = await Promise.all(filteredOverlays.map(async (item) => {
            if (item.type === 'handwriting') {
                try {
                    const clip = await cropAndThreshold(base64Image, mimeType, item.bbox, width, height);
                    return { ...item, imageRef: clip };
                } catch (e) {
                    console.warn("Failed to extract handwriting clip", e);
                    return item; 
                }
            }
            return item;
        }));
        return generateSVGLayer(enrichedOverlays, width, height);

    } catch (error: any) {
        console.error("Text extraction failed:", error);
        throw new Error(error.message || "Failed to extract text.");
    }
};
