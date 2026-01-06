
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { AgentResponse, AgentStatus, InkType, PaperType } from "../types";
import { GEMINI_CONFIG } from "./geminiService";

const getClient = () => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) throw new Error("API Key missing");
    return new GoogleGenAI({ apiKey });
};

// --- UTILITIES ---

const withRetry = async <T>(operation: () => Promise<T>, retries = 3, delay = 1000): Promise<T> => {
    try {
        return await operation();
    } catch (error: any) {
        const code = error.status || error.code;
        if ((code === 500 || code === 503 || code === 429) && retries > 0) {
            console.warn(`[PhysicsService] Error ${code}. Retrying in ${delay}ms... (${retries} attempts left)`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return withRetry(operation, retries - 1, delay * 2);
        }
        throw error;
    }
};

/**
 * ALGORITHM 1: DETERMINISTIC GEOMETRIC DEWARPING (Neuro-Symbolic)
 * Strategy: "Don't Draw. Calculate."
 * 1. AI writes Python Code to find contours (cv2).
 * 2. AI executes Code to get Perspective Transform Matrix.
 * 3. AI warps the image mathematically.
 */
export const geometricUnwarp = async (base64Image: string, mimeType: string): Promise<AgentResponse<string>> => {
    const ai = getClient();
    // Use LOGIC model for coding, it is smarter at python than Vision model
    const model = GEMINI_CONFIG.LOGIC_MODEL; 

    const prompt = `
    ACT AS A COMPUTER VISION ENGINEER (OpenCV Expert).
    TASK: Write and Execute Python code to perform 4-Point Perspective Transform (Dewarping).
    
    ALGORITHM:
    1. Load the input image.
    2. Convert to Grayscale -> GaussianBlur(5x5) -> Canny Edge Detection.
    3. Find Contours (cv2.RETR_LIST). Sort by area. Take the largest one.
    4. Approximate the contour to a polygon (approxPolyDP).
    5. IF the polygon has 4 points:
       - Order points: top-left, top-right, bottom-right, bottom-left.
       - Calculate new width/height (max euclidean distance).
       - Construct destination points array (0,0) to (w,h).
       - Apply 'cv2.getPerspectiveTransform' and 'cv2.warpPerspective'.
    6. ELSE (if no clear document found):
       - Return the original image unmodified.
    
    INPUT: An image file is available in the context.
    OUTPUT: Display the processed image result.
    `;

    try {
        const response = await withRetry<GenerateContentResponse>(() => ai.models.generateContent({
            model,
            contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: prompt }] },
            config: {
                tools: [{ codeExecution: {} }], // ENABLE SANDBOX
                responseMimeType: "application/json", 
                // We don't use responseSchema here because code execution returns complex artifacts
                thinkingConfig: { thinkingBudget: GEMINI_CONFIG.THINKING_BUDGET } // Plan the code before writing
            }
        }));
        
        // Scan for Image Artifacts in the Execution Result
        // The structure usually is: candidates[0].content.parts[] -> one part contains executableCode, next contains codeExecutionResult
        const parts = response.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
            // Check output of code execution
            if (part.executableCode) continue; // This is the script itself
            
            // Direct check for generated images in the response parts
            if (part.inlineData && part.inlineData.mimeType.startsWith('image/')) {
                 return { 
                     status: AgentStatus.SUCCESS, 
                     data: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`, 
                     message: "Geometric Dewarping (Calculated)" 
                 };
            }
        }

        // Fallback: If code ran but didn't return an image (e.g., printed "No contour found")
        console.warn("Dewarping: Code executed but returned no image. Assuming no changes needed.");
        return { status: AgentStatus.NO_OP, data: `data:${mimeType};base64,${base64Image}`, message: "Dewarping: No bounds detected" };

    } catch (e: any) {
        console.warn(`Dewarping Code Execution Failed [${e.message}], falling back to Neural Simulation.`, e);
        // FALLBACK TO NEURAL SIMULATION (Old Method) if Sandbox fails
        return geometricUnwarpNeural(base64Image, mimeType);
    }
};

/**
 * FALLBACK: NEURAL DEWARPING (Visual Approximation)
 * Used only if Python Sandbox fails.
 */
const geometricUnwarpNeural = async (base64Image: string, mimeType: string): Promise<AgentResponse<string>> => {
    const ai = getClient();
    const model = GEMINI_CONFIG.VISION_MODEL; 
    const prompt = `Fix perspective. Flatten this document to a top-down view. Keep resolution high.`;
    
    try {
        const response = await ai.models.generateContent({
            model,
            contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: prompt }] },
            config: { imageConfig: { imageSize: "2K", aspectRatio: "1:1" } }
        });
        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) return { status: AgentStatus.SUCCESS, data: `data:image/png;base64,${part.inlineData.data}`, message: "Dewarping (Neural Fallback)" };
        }
    } catch (e) { /* ignore */ }
    return { status: AgentStatus.ERROR, data: null, message: "Dewarping Failed" };
};

/**
 * ALGORITHM 2: INTRINSIC DECOMPOSITION (Division Normalization)
 * Strategy: Estimate background via Morphological Closing and divide.
 * I = R * L  =>  R = I / L
 */
export const intrinsicDecomposition = async (base64Image: string, mimeType: string): Promise<AgentResponse<string>> => {
    const ai = getClient();
    const model = GEMINI_CONFIG.LOGIC_MODEL; 

    const prompt = `
    ACT AS A PHYSICS ENGINE.
    TASK: Perform Intrinsic Image Decomposition (Shadow Removal) using Python OpenCV.
    
    THEORY:
    We assume the image I = Reflectance (R) * Illumination (L).
    We want to recover R.
    
    ALGORITHM:
    1. Load image. Convert to Grayscale.
    2. Estimate Illumination (L):
       - Use 'cv2.dilate' with a large kernel (e.g., 50x50) to remove text features.
       - Use 'cv2.medianBlur' to smooth the illumination map.
    3. Recover Reflectance (R):
       - R = I / L (Division Normalization).
       - Note: Use float32 for division to avoid clipping, then scale back to 0-255.
    4. Normalize Contrast (CLAHE or MinMax).
    
    INPUT: Image provided.
    OUTPUT: Display the flattened (albedo) image.
    `;

    try {
        const response = await withRetry<GenerateContentResponse>(() => ai.models.generateContent({
            model,
            contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: prompt }] },
            config: {
                tools: [{ codeExecution: {} }], // ENABLE SANDBOX
                thinkingConfig: { thinkingBudget: GEMINI_CONFIG.THINKING_BUDGET }
            }
        }));

        const parts = response.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
            if (part.inlineData && part.inlineData.mimeType.startsWith('image/')) {
                 return { 
                     status: AgentStatus.SUCCESS, 
                     data: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`, 
                     message: "Lighting Correction (Calculated)" 
                 };
            }
        }
        
        console.warn("Lighting: Code executed but returned no image.");
        return { status: AgentStatus.NO_OP, data: `data:${mimeType};base64,${base64Image}`, message: "Lighting: No changes" };

    } catch (e: any) {
        console.warn(`Lighting Code Execution Failed, falling back to Neural Simulation.`, e);
        return intrinsicDecompositionNeural(base64Image, mimeType);
    }
};

/**
 * FALLBACK: NEURAL DECOMPOSITION
 */
const intrinsicDecompositionNeural = async (base64Image: string, mimeType: string): Promise<AgentResponse<string>> => {
    const ai = getClient();
    const model = GEMINI_CONFIG.VISION_MODEL; 
    const prompt = `Remove shadows. Output only the flat text/paper color (Albedo). High fidelity.`;
    
    try {
        const response = await ai.models.generateContent({
            model,
            contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: prompt }] },
            config: { imageConfig: { imageSize: "2K", aspectRatio: "1:1" } }
        });
        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) return { status: AgentStatus.SUCCESS, data: `data:image/png;base64,${part.inlineData.data}`, message: "Lighting (Neural Fallback)" };
        }
    } catch (e) { /* ignore */ }
    return { status: AgentStatus.ERROR, data: null, message: "Lighting Failed" };
};

// ... existing helpers ...
// Helper: Render SVG Data URL to Bitmap Data URL (PNG)
const renderSvgToBitmap = async (svgDataUrl: string, width: number, height: number): Promise<string> => {
    return new Promise((resolve) => {
        if (typeof window === 'undefined') { resolve(''); return; }
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) { resolve(''); return; }
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => resolve('');
        img.src = svgDataUrl;
    });
};

export const calculateResidualHeatmap = async (originalBase64: string, generatedSvgDataUrl: string): Promise<{ heatmap: string, loss: number }> => {
    if (typeof window === 'undefined') return { heatmap: "", loss: 0 };
    
    return new Promise(async (resolve) => {
        try {
            // 1. Load Original
            const imgOrig = new Image();
            imgOrig.src = `data:image/png;base64,${originalBase64}`;
            await new Promise((r, j) => { imgOrig.onload = r; imgOrig.onerror = j; });

            const width = imgOrig.width;
            const height = imgOrig.height;

            // 2. Render Generated SVG to Bitmap
            const genPngUrl = await renderSvgToBitmap(generatedSvgDataUrl, width, height);
            if (!genPngUrl) { resolve({ heatmap: "", loss: 0 }); return; }

            const imgGen = new Image();
            imgGen.src = genPngUrl;
            await new Promise((r, j) => { imgGen.onload = r; imgGen.onerror = j; });

            // 3. Compare Pixels
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if(!ctx) { resolve({ heatmap: "", loss: 0 }); return; }

            // Get Data Orig
            ctx.drawImage(imgOrig, 0, 0, width, height);
            const dataOrig = ctx.getImageData(0, 0, width, height).data;

            // Get Data Gen
            ctx.clearRect(0,0, width, height);
            ctx.drawImage(imgGen, 0, 0, width, height);
            const dataGen = ctx.getImageData(0, 0, width, height).data;

            // Create Heatmap
            const heatmapData = ctx.createImageData(width, height);
            const dataHeat = heatmapData.data;

            let totalDiff = 0;
            let pixelCount = 0;

            for (let i = 0; i < dataOrig.length; i += 4) {
                // Euclidean Distance in RGB
                const rDiff = Math.abs(dataOrig[i] - dataGen[i]);
                const gDiff = Math.abs(dataOrig[i+1] - dataGen[i+1]);
                const bDiff = Math.abs(dataOrig[i+2] - dataGen[i+2]);
                const diff = (rDiff + gDiff + bDiff) / 3;

                totalDiff += diff;
                pixelCount++;

                // Threshold for "Error" visualization (DiffVG Gradient Signal)
                if (diff > 25) {
                    // Draw RED for Error
                    dataHeat[i] = 255;   // R
                    dataHeat[i+1] = 0;   // G
                    dataHeat[i+2] = 0;   // B
                    dataHeat[i+3] = Math.min(255, diff * 3); // Alpha based on magnitude
                } else {
                    // Transparent for Match (Zero Loss)
                    dataHeat[i+3] = 0; 
                }
            }

            ctx.putImageData(heatmapData, 0, 0);
            const avgLoss = totalDiff / (pixelCount || 1);

            resolve({ 
                heatmap: canvas.toDataURL('image/png').split(',')[1], 
                loss: avgLoss 
            });

        } catch (e) {
            console.error("Residual calculation failed", e);
            resolve({ heatmap: "", loss: 0 });
        }
    });
};

export const refineVectorWithFeedback = async (
    originalMime: string,
    originalBase64: string, 
    currentSvgCode: string, 
    heatmapBase64: string
): Promise<string> => {
    const ai = getClient();
    const model = GEMINI_CONFIG.LOGIC_MODEL; // High Reasoning Model

    const prompt = `
    ACT AS A DIFFERENTIABLE VECTOR GRAPHICS (DiffVG) OPTIMIZER.
    
    INPUT:
    1. **Original Raster Image** (Ground Truth).
    2. **Current SVG Code** (Current State).
    3. **Residual Heatmap** (Gradient Signal). RED pixels indicate high geometric loss (mismatch).
    
    TASK: Perform one step of Simulated Gradient Descent to minimize the Geometric Loss.
    
    INSTRUCTION:
    - Look at the **Residual Heatmap**. The RED areas are where your current curves do not align with the ink.
    - **Adjust the Bezier Control Points** in the SVG code for paths corresponding to the RED regions.
    - **Backpropagate Error**: Move the curves towards the ink in the Original Image.
    - Do NOT change paths that are already correct (Transparent regions in heatmap).
    - Maintain strict specific colors if provided previously.
    
    OUTPUT: The Refined SVG Code ONLY.
    `;

    try {
        const response = await withRetry<GenerateContentResponse>(() => ai.models.generateContent({
            model,
            contents: { 
                parts: [
                    { inlineData: { mimeType: originalMime, data: originalBase64 } },
                    { inlineData: { mimeType: "image/png", data: heatmapBase64 } },
                    { text: `CURRENT SVG CODE:\n${currentSvgCode}\n\n${prompt}` }
                ] 
            },
            config: { 
                temperature: GEMINI_CONFIG.TEMP_LOGIC, // Low temp for precision
                maxOutputTokens: GEMINI_CONFIG.MAX_OUTPUT_TOKENS, 
                thinkingConfig: { thinkingBudget: GEMINI_CONFIG.THINKING_BUDGET } // High Intelligence
            }
        }));

        let svgCode = response.text || "";
        svgCode = svgCode.replace(/```xml/g, '').replace(/```svg/g, '').replace(/```/g, '').trim();
        const svgStart = svgCode.indexOf('<svg');
        if (svgStart === -1) return currentSvgCode; // Fail gracefully
        svgCode = svgCode.substring(svgStart);
        
        return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgCode)))}`;

    } catch (error: any) {
        console.warn(`Refinement step failed [${error.status || error.code || 'Unknown'}], proceeding with original.`, error);
        return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(currentSvgCode)))}`;
    }
};

export const extractInkColors = async (base64Image: string): Promise<string[]> => {
    if (typeof window === 'undefined') return [];
    
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const w = Math.min(img.width, 256);
            const h = Math.min(img.height, 256);
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) { resolve([]); return; }
            
            ctx.drawImage(img, 0, 0, w, h);
            const data = ctx.getImageData(0, 0, w, h).data;
            const colorCounts: Record<string, number> = {};
            
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i+1];
                const b = data[i+2];
                const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                if (lum > 220) continue; 
                const rQ = Math.round(r / 8) * 8;
                const gQ = Math.round(g / 8) * 8;
                const bQ = Math.round(b / 8) * 8;
                const key = `${rQ},${gQ},${bQ}`;
                colorCounts[key] = (colorCounts[key] || 0) + 1;
            }

            const sorted = Object.entries(colorCounts).sort((a, b) => b[1] - a[1]);
            const topColors = sorted.slice(0, 5).map(([key]) => {
                const [r, g, b] = key.split(',').map(Number);
                return '#' + [r, g, b].map(x => {
                    const hex = x.toString(16);
                    return hex.length === 1 ? '0' + hex : hex;
                }).join('');
            });
            resolve(topColors);
        };
        img.onerror = () => resolve([]);
        img.src = `data:image/png;base64,${base64Image}`;
    });
};

export const generateMaterialFilters = (
    inkType: InkType, 
    paperType: PaperType
): string => {
    // ... (Filter generation logic remains the same, strictly aesthetic/deterministic)
    let inkFilter = "";
    if (inkType === 'INKJET' || inkType === 'MARKER') {
        inkFilter = `
            <filter id="physics-ink" x="-20%" y="-20%" width="140%" height="140%">
                <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" result="noise"/>
                <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.2" xChannelSelector="R" yChannelSelector="G"/>
                <feGaussianBlur stdDeviation="0.4" />
            </filter>
        `;
    } else if (inkType === 'BALLPOINT') {
        inkFilter = `
            <filter id="physics-ink" x="-20%" y="-20%" width="140%" height="140%">
                <feTurbulence type="turbulence" baseFrequency="0.5" numOctaves="2" result="noise"/>
                <feDisplacementMap in="SourceGraphic" in2="noise" scale="0.8" />
                <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.9 0" />
            </filter>
        `;
    } else {
        inkFilter = `
            <filter id="physics-ink">
                <feGaussianBlur stdDeviation="0.15" />
            </filter>
        `;
    }

    let paperFilter = "";
    if (paperType === 'TEXTURED' || paperType === 'PARCHMENT') {
        paperFilter = `
            <filter id="physics-paper">
                <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="5" result="noise"/>
                <feDiffuseLighting in="noise" lighting-color="#ffffff" surfaceScale="1.5">
                    <feDistantLight azimuth="45" elevation="60" />
                </feDiffuseLighting>
                <feComposite operator="arithmetic" k1="1" k2="0" k3="0" k4="0" in="SourceGraphic" />
            </filter>
        `;
    } else {
        paperFilter = `
             <filter id="physics-paper">
                <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" result="noise"/>
                <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.05 0" in="noise" result="faintNoise"/>
                <feComposite operator="in" in="faintNoise" in2="SourceGraphic" />
                <feBlend mode="multiply" in="faintNoise" in2="SourceGraphic" />
            </filter>
        `;
    }

    return `
        <defs>
            ${inkFilter}
            ${paperFilter}
        </defs>
    `;
};
