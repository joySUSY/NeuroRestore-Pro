import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { AgentResponse, AgentStatus, InkType, PaperType } from "../types";

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

// DUPLICATED Helper (Dependency-free): Get Aspect Ratio
const getClosestAspectRatio = async (base64: string, mimeType: string): Promise<string> => {
    return new Promise((resolve) => {
        if (typeof window === 'undefined') { resolve("1:1"); return; }
        const img = new Image();
        img.onload = () => {
            const ratio = img.width / img.height;
            const supported = [
                { val: "1:1", ratio: 1.0 }, { val: "3:4", ratio: 0.75 }, { val: "4:3", ratio: 1.333 }, 
                { val: "9:16", ratio: 0.5625 }, { val: "16:9", ratio: 1.7778 },
                { val: "2:3", ratio: 0.666 }, { val: "3:2", ratio: 1.5 },
                { val: "4:5", ratio: 0.8 }, { val: "5:4", ratio: 1.25 },
                { val: "21:9", ratio: 2.333 }
            ];
            const closest = supported.reduce((prev, curr) => 
                Math.abs(curr.ratio - ratio) < Math.abs(prev.ratio - ratio) ? curr : prev
            );
            resolve(closest.val);
        };
        img.onerror = () => resolve("1:1");
        img.src = `data:${mimeType};base64,${base64}`;
    });
};

/**
 * ALGORITHM 1: 3D GEOMETRIC DEWARPING (DocTr Simulation)
 */
export const geometricUnwarp = async (base64Image: string, mimeType: string): Promise<AgentResponse<string>> => {
    const ai = getClient();
    const model = "gemini-3-pro-image-preview";
    const targetAspectRatio = await getClosestAspectRatio(base64Image, mimeType);

    const prompt = `
    ACT AS A GEOMETRIC RECTIFICATION ENGINE (DocTr).
    
    INPUT: A distorted, warped, or curled document image.
    TASK: Perform 3D Mesh Unrolling to flatten the document into a perfect 2D plane.
    
    ALGORITHMIC STEPS:
    1. **Mesh Prediction:** Estimate the 3D surface flow of the paper. Detect Z-axis curvature.
    2. **Unrolling:** Mathematically "unroll" the mesh to flatten page curls.
    3. **Perspective Correction:** Rectify the camera angle to a top-down orthogonal view (Flatbed Scanner View).
    4. **Resampling:** Map original pixels to the new rectified coordinates.

    CONSTRAINTS:
    - DO NOT change the content, text, or font.
    - DO NOT perform color correction yet.
    - OUTPUT: The raw, flattened image data.
    `;

    try {
        const response = await withRetry<GenerateContentResponse>(() => ai.models.generateContent({
            model,
            contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: prompt }] },
            config: {
                imageConfig: { 
                    imageSize: "2K",
                    aspectRatio: targetAspectRatio as any
                } 
            }
        }));
        
        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) return { status: AgentStatus.SUCCESS, data: `data:image/png;base64,${part.inlineData.data}`, message: "Dewarping Complete" };
        }
        return { status: AgentStatus.NO_OP, data: `data:${mimeType};base64,${base64Image}`, message: "Dewarping skipped (No change)" };
    } catch (e: any) {
        console.warn(`Dewarping failed [${e.status || e.code || 'Unknown'}], proceeding with original.`, e);
        return { status: AgentStatus.ERROR, data: `data:${mimeType};base64,${base64Image}`, message: "Dewarping Failed" };
    }
};

/**
 * ALGORITHM 2: INTRINSIC IMAGE DECOMPOSITION (PIDNet Simulation)
 */
export const intrinsicDecomposition = async (base64Image: string, mimeType: string): Promise<AgentResponse<string>> => {
    const ai = getClient();
    const model = "gemini-3-pro-image-preview";
    const targetAspectRatio = await getClosestAspectRatio(base64Image, mimeType);

    const prompt = `
    ACT AS A PHYSICS-BASED RENDERING ENGINE.
    TASK: Perform Intrinsic Image Decomposition.
    
    THEORY:
    Image (I) = Reflectance (R) * Shading (S).
    
    INSTRUCTION:
    1. **Decompose** the input image into Reflectance (Albedo) and Shading maps.
    2. **Discard** the Shading map (S). This removes all shadows, uneven lighting, scanner glare, and paper crease shadows.
    3. **Output** ONLY the Reflectance map (R).
    
    VISUAL GOAL:
    - The output should look like the raw material color (Flat Albedo).
    - Text should be pure ink color (e.g. #000000) on pure paper color (e.g. #FFFFFF).
    - No lighting gradients. No shadows.
    `;

    try {
        const response = await withRetry<GenerateContentResponse>(() => ai.models.generateContent({
            model,
            contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: prompt }] },
            config: {
                imageConfig: { 
                    imageSize: "2K",
                    aspectRatio: targetAspectRatio as any
                }
            }
        }));

        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) return { status: AgentStatus.SUCCESS, data: `data:image/png;base64,${part.inlineData.data}`, message: "Intrinsic Decomp Complete" };
        }
        return { status: AgentStatus.NO_OP, data: `data:${mimeType};base64,${base64Image}`, message: "Decomposition skipped" };
    } catch (e: any) {
        console.warn(`Intrinsic decomposition failed [${e.status || e.code || 'Unknown'}], proceeding with original.`, e);
        return { status: AgentStatus.ERROR, data: `data:${mimeType};base64,${base64Image}`, message: "Decomposition Failed" };
    }
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
    const model = "gemini-3-pro-preview"; 

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
                temperature: 0.1, // Low temp for precision
                maxOutputTokens: 65536, 
                thinkingConfig: { thinkingBudget: 32768 } // Max thinking budget
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