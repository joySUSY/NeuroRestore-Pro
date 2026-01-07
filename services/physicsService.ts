
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { AgentResponse, AgentStatus, InkType, PaperType } from "../types";
import { GEMINI_CONFIG, executeSafe, getClient, downscaleImage } from "./geminiService";

/**
 * ALGORITHM 1: DETERMINISTIC GEOMETRIC DEWARPING (Neuro-Symbolic)
 * Strategy: "Don't Draw. Calculate."
 * 
 * FIX: Added strict area check to prevent cropping to small regions (like stamps).
 * FIX: Added strict prohibition on matplotlib.
 */
export const geometricUnwarp = async (base64Image: string, mimeType: string): Promise<AgentResponse<string>> => {
    const ai = getClient();
    const model = GEMINI_CONFIG.LOGIC_MODEL; 

    // Downscale for code generation context
    const optimizedBase64 = await downscaleImage(base64Image, mimeType, 1024, 0.9);

    const prompt = `
    ACT AS A COMPUTER VISION ENGINEER (OpenCV 6.0 Specialist).
    TASK: Write and Execute Python code to perform 4-Point Perspective Transform (Dewarping).
    
    CRITICAL RESTRICTIONS:
    - **NO PLOTS**: Do not use 'matplotlib'.
    - **NO CROPPING**: Only warp if the detected document covers > 40% of the image area.
    
    ALGORITHM:
    1. Load 'image_file'.
    2. Convert to Grayscale -> GaussianBlur(5x5) -> Canny Edge Detection.
    3. Find Contours (cv2.RETR_LIST). Sort by area (descending).
    
    4. **SAFETY CHECK**:
       - Get largest contour 'c'.
       - Calculate area = cv2.contourArea(c).
       - Image Area = width * height.
       - IF area < (0.4 * Image Area):
            # Abort dewarp to prevent accidental cropping of small elements.
            cv2.imwrite('result.png', img)
            exit()
    
    5. Approximate contour to polygon. IF 4 points found:
       - Order points.
       - Warp Perspective.
       - Save 'result.png'.
    
    6. ELSE:
       - Save original 'result.png'.
    
    INPUT: An image file is available.
    OUTPUT: Execute code and save result.
    `;

    try {
        const response = await executeSafe<GenerateContentResponse>(async () => {
            return ai.models.generateContent({
                model,
                contents: { parts: [{ inlineData: { mimeType, data: optimizedBase64 } }, { text: prompt }] },
                config: {
                    tools: [{ codeExecution: {} }],
                    thinkingConfig: { thinkingBudget: GEMINI_CONFIG.THINKING_BUDGET },
                    systemInstruction: GEMINI_CONFIG.SYSTEM_INSTRUCTION
                }
            });
        });
        
        const parts = response.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
            if (part.inlineData && part.inlineData.mimeType.startsWith('image/')) {
                 return { 
                     status: AgentStatus.SUCCESS, 
                     data: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`, 
                     message: "Geometric Dewarping (Calculated)" 
                 };
            }
        }

        console.warn("Dewarping: Code executed but returned no image. Assuming no changes needed.");
        return { status: AgentStatus.NO_OP, data: `data:${mimeType};base64,${base64Image}`, message: "Dewarping: No bounds detected" };

    } catch (e: any) {
        console.warn(`Dewarping Code Execution Failed [${e.message}], falling back to Neural Simulation.`, e);
        return geometricUnwarpNeural(base64Image, mimeType);
    }
};

const geometricUnwarpNeural = async (base64Image: string, mimeType: string): Promise<AgentResponse<string>> => {
    const ai = getClient();
    const model = GEMINI_CONFIG.VISION_MODEL; 
    const prompt = `Fix perspective. Flatten this document to a top-down view. Keep resolution high.`;
    
    try {
        const response = await executeSafe<GenerateContentResponse>(async () => {
            return ai.models.generateContent({
                model,
                contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: prompt }] },
                config: { 
                    imageConfig: { imageSize: "2K", aspectRatio: "1:1" },
                    systemInstruction: GEMINI_CONFIG.SYSTEM_INSTRUCTION
                }
            });
        });

        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) return { status: AgentStatus.SUCCESS, data: `data:image/png;base64,${part.inlineData.data}`, message: "Dewarping (Neural Fallback)" };
        }
    } catch (e) { /* ignore */ }
    return { status: AgentStatus.ERROR, data: null, message: "Dewarping Failed" };
};

/**
 * ALGORITHM 2: INTRINSIC DECOMPOSITION
 * 
 * FIX: Strictly forbid plotting libraries to prevent "Original/Illumination" side-by-sides.
 * FIX: Enforce output format.
 */
export const intrinsicDecomposition = async (base64Image: string, mimeType: string): Promise<AgentResponse<string>> => {
    const ai = getClient();
    const model = GEMINI_CONFIG.LOGIC_MODEL; 

    // Downscale to prevent payload error
    const optimizedBase64 = await downscaleImage(base64Image, mimeType, 1024, 0.9);

    const prompt = `
    ACT AS A PHYSICS ENGINE.
    TASK: Perform Intrinsic Image Decomposition (Shadow Removal) using Python OpenCV.
    
    CRITICAL PROHIBITION:
    - **NO PLOTS**: Do not use 'matplotlib'. Do not create subplots.
    - **NO DEBUG OUTPUT**: Only return the final corrected image.
    
    ALGORITHM:
    1. Load image (cv2).
    2. Estimate Illumination (L) using Morphological Closing (dilate with large kernel ~50x50) + MedianBlur.
    3. Recover Reflectance (R) = I / L. (Use float32 division).
    4. Clip and Normalize R to 0-255.
    5. Save 'result.png' (R).
    
    INPUT: Image provided.
    OUTPUT: Save 'result.png'.
    `;

    try {
        const response = await executeSafe<GenerateContentResponse>(async () => {
            return ai.models.generateContent({
                model,
                contents: { parts: [{ inlineData: { mimeType, data: optimizedBase64 } }, { text: prompt }] },
                config: {
                    tools: [{ codeExecution: {} }],
                    thinkingConfig: { thinkingBudget: GEMINI_CONFIG.THINKING_BUDGET },
                    systemInstruction: GEMINI_CONFIG.SYSTEM_INSTRUCTION
                }
            });
        });

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

const intrinsicDecompositionNeural = async (base64Image: string, mimeType: string): Promise<AgentResponse<string>> => {
    const ai = getClient();
    const model = GEMINI_CONFIG.VISION_MODEL; 
    const prompt = `Remove shadows. Output only the flat text/paper color (Albedo). High fidelity.`;
    
    try {
        const response = await executeSafe<GenerateContentResponse>(async () => {
            return ai.models.generateContent({
                model,
                contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: prompt }] },
                config: { 
                    imageConfig: { imageSize: "2K", aspectRatio: "1:1" },
                    systemInstruction: GEMINI_CONFIG.SYSTEM_INSTRUCTION
                }
            });
        });
        
        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) return { status: AgentStatus.SUCCESS, data: `data:image/png;base64,${part.inlineData.data}`, message: "Lighting (Neural Fallback)" };
        }
    } catch (e) { /* ignore */ }
    return { status: AgentStatus.ERROR, data: null, message: "Lighting Failed" };
};

// ... existing helpers ...
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
            const imgOrig = new Image();
            imgOrig.src = `data:image/png;base64,${originalBase64}`;
            await new Promise((r, j) => { imgOrig.onload = r; imgOrig.onerror = j; });

            const width = imgOrig.width;
            const height = imgOrig.height;

            const genPngUrl = await renderSvgToBitmap(generatedSvgDataUrl, width, height);
            if (!genPngUrl) { resolve({ heatmap: "", loss: 0 }); return; }

            const imgGen = new Image();
            imgGen.src = genPngUrl;
            await new Promise((r, j) => { imgGen.onload = r; imgGen.onerror = j; });

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if(!ctx) { resolve({ heatmap: "", loss: 0 }); return; }

            ctx.drawImage(imgOrig, 0, 0, width, height);
            const dataOrig = ctx.getImageData(0, 0, width, height).data;

            ctx.clearRect(0,0, width, height);
            ctx.drawImage(imgGen, 0, 0, width, height);
            const dataGen = ctx.getImageData(0, 0, width, height).data;

            const heatmapData = ctx.createImageData(width, height);
            const dataHeat = heatmapData.data;

            let totalDiff = 0;
            let pixelCount = 0;

            for (let i = 0; i < dataOrig.length; i += 4) {
                const rDiff = Math.abs(dataOrig[i] - dataGen[i]);
                const gDiff = Math.abs(dataOrig[i+1] - dataGen[i+1]);
                const bDiff = Math.abs(dataOrig[i+2] - dataGen[i+2]);
                const diff = (rDiff + gDiff + bDiff) / 3;

                totalDiff += diff;
                pixelCount++;

                if (diff > 25) {
                    dataHeat[i] = 255;   // R
                    dataHeat[i+1] = 0;   // G
                    dataHeat[i+2] = 0;   // B
                    dataHeat[i+3] = Math.min(255, diff * 3); 
                } else {
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
    const model = GEMINI_CONFIG.LOGIC_MODEL; 
    
    // Optimization: Downscale heatmap context image
    const optimizedBase64 = await downscaleImage(originalBase64, originalMime, 1024, 0.9);

    const prompt = `
    ACT AS A DIFFERENTIABLE VECTOR GRAPHICS (DiffVG) OPTIMIZER.
    TASK: Perform one step of Simulated Gradient Descent to minimize the Geometric Loss.
    
    INPUTS:
    1. **Ground Truth**: Original Image.
    2. **Current State**: SVG Code.
    3. **Gradient Signal**: Residual Heatmap (Red = High Loss).
    
    OPTIMIZATION STEP:
    - Target the RED regions in the heatmap.
    - Adjust Bezier control points to better fit the ink boundaries.
    - Maintain G2 Continuity on curves.
    
    OUTPUT: Refined SVG Code.
    `;

    try {
        const response = await executeSafe<GenerateContentResponse>(async () => {
            return ai.models.generateContent({
                model,
                contents: { 
                    parts: [
                        { inlineData: { mimeType: originalMime, data: optimizedBase64 } },
                        { inlineData: { mimeType: "image/png", data: heatmapBase64 } },
                        { text: `CURRENT SVG CODE:\n${currentSvgCode}\n\n${prompt}` }
                    ] 
                },
                config: { 
                    temperature: GEMINI_CONFIG.TEMP_LOGIC, 
                    maxOutputTokens: GEMINI_CONFIG.MAX_OUTPUT_TOKENS, 
                    thinkingConfig: { thinkingBudget: GEMINI_CONFIG.THINKING_BUDGET }, 
                    systemInstruction: GEMINI_CONFIG.SYSTEM_INSTRUCTION
                }
            });
        });

        let svgCode = response.text || "";
        svgCode = svgCode.replace(/```xml/g, '').replace(/```svg/g, '').replace(/```/g, '').trim();
        const svgStart = svgCode.indexOf('<svg');
        if (svgStart === -1) return currentSvgCode; 
        svgCode = svgCode.substring(svgStart);
        
        return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgCode)))}`;

    } catch (error: any) {
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
