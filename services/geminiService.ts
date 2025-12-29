import { GoogleGenAI, Type } from "@google/genai";
import { AppMode, ImageType, RestorationConfig, AnalysisResult, Resolution, AspectRatio, ColorStyle } from "../types";

// Helper to convert File to Base64
export const fileToGenerativePart = async (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      // Remove data url prefix (e.g. "data:image/jpeg;base64,")
      const base64Data = base64String.split(',')[1];
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const getClient = () => {
    // API Key must be handled via process.env.API_KEY as per instructions
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
        throw new Error("API Key is missing in environment variables.");
    }
    return new GoogleGenAI({ apiKey });
};

// Calculate closest supported aspect ratio for ORIGINAL mode
const getClosestAspectRatio = async (base64: string, mimeType: string): Promise<string> => {
    return new Promise((resolve) => {
        if (typeof window === 'undefined') {
             resolve("1:1");
             return;
        }
        const img = new Image();
        img.onload = () => {
            const ratio = img.width / img.height;
            const supported = [
                { val: "1:1", ratio: 1.0 },
                { val: "3:4", ratio: 3/4 }, 
                { val: "4:3", ratio: 4/3 }, 
                { val: "9:16", ratio: 9/16 }, 
                { val: "16:9", ratio: 16/9 }, 
            ];
            
            // Find closest
            const closest = supported.reduce((prev, curr) => {
                return (Math.abs(curr.ratio - ratio) < Math.abs(prev.ratio - ratio) ? curr : prev);
            });
            
            console.log(`Original Ratio: ${ratio.toFixed(2)}, Closest Supported: ${closest.val}`);
            resolve(closest.val);
        };
        img.onerror = () => resolve("1:1");
        img.src = `data:${mimeType};base64,${base64}`;
    });
};


// 1. Image Analysis using Gemini 3 Pro (Thinking)
export const analyzeImageIssues = async (base64Image: string, mimeType: string): Promise<AnalysisResult> => {
    const ai = getClient();
    
    // Using gemini-3-pro-preview for deep reasoning about image quality
    const model = "gemini-3-pro-preview"; 

    const prompt = `
    Analyze this image specifically for restoration and enhancement purposes.
    Classify the image type: 'DOCUMENT', 'DIGITAL_ART', or 'PHOTO'.
    
    CRITICAL ANALYSIS FOR SCANNED MEDIA:
    1. **Halftone/Screen Detection:** Detailed checking for visible printing dots (CMYK rosettes), halftone patterns, or "screen tones" common in comics and magazines.
    2. **Moire Interference:** Check for wave-like interference patterns caused by scanning printed matte.
    3. **Color Cast:** Identify if there is a yellow/blue aging cast or scanner light bleed.
    4. **Text Legibility:** Assess if text is blurred, faded, or has broken strokes.
    5. **Physical Damage:** Look for scratches, tears, creases, or staple holes.

    Return a JSON object with specific focus on whether 'descreening' is required to remove print dots.
    Include a concise 'description' (max 20 words) summarizing the visual state and defects.
    `;

    try {
        const response = await ai.models.generateContent({
            model,
            contents: {
                parts: [
                    { inlineData: { mimeType, data: base64Image } },
                    { text: prompt }
                ]
            },
            config: {
                responseMimeType: "application/json",
                maxOutputTokens: 8192,
                thinkingConfig: { thinkingBudget: 1024 }, 
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        issues: { type: Type.ARRAY, items: { type: Type.STRING } },
                        suggestedFixes: { type: Type.ARRAY, items: { type: Type.STRING } },
                        rawAnalysis: { type: Type.STRING },
                        description: { type: Type.STRING },
                        colorProfile: { type: Type.STRING },
                        detectedType: { 
                            type: Type.STRING, 
                            enum: ['DOCUMENT', 'DIGITAL_ART', 'PHOTO'] 
                        },
                        detectedMaterial: { type: Type.STRING },
                        requiresDescreening: { type: Type.BOOLEAN, description: "True if halftone dots or moire patterns are detected and need removal." }
                    }
                }
            }
        });

        let text = response.text;
        if (!text) throw new Error("No analysis returned");

        text = text.trim();
        if (text.startsWith("```json")) {
            text = text.replace(/^```json\s*/, "").replace(/\s*```$/, "");
        } else if (text.startsWith("```")) {
            text = text.replace(/^```\s*/, "").replace(/\s*```$/, "");
        }

        return JSON.parse(text) as AnalysisResult;

    } catch (error: any) {
        console.error("Analysis failed:", error);
        return {
            issues: ["Analysis failed"],
            suggestedFixes: ["Manual restoration"],
            rawAnalysis: "Auto-analysis unavailable.",
            description: "Analysis failed. Proceeding with standard restoration.",
            colorProfile: "Standard",
            detectedType: ImageType.DOCUMENT,
            detectedMaterial: "Unknown",
            requiresDescreening: false
        };
    }
};

// 2. Image Restoration/Editing using Gemini 3 Pro Image Preview
export const restoreOrEditImage = async (
    base64Image: string, 
    mimeType: string, 
    config: RestorationConfig,
    analysis?: AnalysisResult
): Promise<string> => {
    const ai = getClient();
    const model = "gemini-3-pro-image-preview";

    let targetAspectRatio = config.aspectRatio as string;
    if (config.aspectRatio === AspectRatio.ORIGINAL) {
         targetAspectRatio = await getClosestAspectRatio(base64Image, mimeType);
    } else if (config.aspectRatio === AspectRatio.WIDE_21_9) {
         targetAspectRatio = "16:9"; 
    }

    // Prepare Color Logic Instruction based on config
    let colorInstruction = "";
    switch (config.colorStyle) {
        case ColorStyle.TRUE_TONE: colorInstruction = "STRICT FIDELITY. Do not darken image. Sample exact hues from source."; break;
        case ColorStyle.HIGH_CONTRAST: colorInstruction = "DOCUMENT MODE. Whiten background significantly. Darken ink to #000000. Maximize readability."; break;
        case ColorStyle.VIBRANT_HDR: colorInstruction = "ART MODE. Boost Vibrance. Open shadows. Enhance micro-contrast."; break;
        case ColorStyle.BLACK_WHITE: colorInstruction = "GRAYSCALE. Remove all color noise. Focus on luminance and shading."; break;
        case ColorStyle.VINTAGE_WARM: colorInstruction = "VINTAGE. Enhance sepia/cream tones. Keep paper texture but remove damage."; break;
        case ColorStyle.COOL_TONE: colorInstruction = "MODERN. Shift white balance to cool/neutral. Sterile look."; break;
    }

    // Prepare Content Parts (Input Image + Optional Reference Image)
    const parts: any[] = [
        { inlineData: { mimeType, data: base64Image } }
    ];

    let referenceInstruction = "";
    if (config.referenceImage) {
        // Extract data and mime from Data URL
        const matches = config.referenceImage.match(/^data:(.+);base64,(.+)$/);
        if (matches && matches.length === 3) {
            const refMime = matches[1];
            const refData = matches[2];
            parts.push({ inlineData: { mimeType: refMime, data: refData } });
            
            referenceInstruction = `
            PHASE 0: STYLE ALIGNMENT (REFERENCE ACTIVE)
            - The SECOND image provided is a "Style Reference".
            - You must extract the color palette, shading technique, paper texture, and line weight from this Reference Image.
            - Apply these stylistic attributes to the FIRST image (the source) during the restoration process.
            - Ensure consistency in atmosphere and mood. This is critical for comic/manga consistency.
            `;
        }
    }

    // --- ALGORITHMIC SYSTEM PROMPT ---
    let systemInstruction = `
    You are an advanced AI Image Restoration Engine specialized in Scanned Documents, Digital Art, and Vector Graphics.
    Your goal is to "RE-RENDER" the image to ${config.resolution}, 300 DPI+ quality, not just "filter" it.
    
    DETECTED MATERIAL: "${analysis?.detectedMaterial || 'Standard Paper'}".
    REQUIRES DESCREENING: ${analysis?.requiresDescreening ? "YES - CRITICAL" : "NO"}.

    GLOBAL PROCESSING PIPELINE (STRICT ORDER):
    
    ${referenceInstruction}

    PHASE 1: CRITICAL DESCREENING & MOIRÉ ELIMINATION (SCANNED MEDIA)
    - **Trigger:** When processing images identified as scans of printed materials (comics, magazines, graphic designs with halftone patterns), you must first detect periodic halftone dot patterns.
    - **Action:** DO NOT SHARPEN THESE DOTS. Instead, apply a 'Descreening' process that intelligently blends/melts these halftone dots into smooth, continuous color fields, effectively removing the underlying print screen while preserving the intended colors and shapes.
    - **Interference Removal:** Actively eliminate Moiré patterns and visual interference generated by the scanning process (FFT Notch Filter simulation).
    - **Timing:** This descreening must occur BEFORE any primary edge sharpening or detail synthesis to avoid amplifying unwanted print artifacts.

    PHASE 2: FREQUENCY SEPARATION RESTORATION
    - **Layer A (Low Frequency - Color/Tone):** 
      - Smooth out paper grain and ISO noise.
      - Fix "Color Banding" by applying dithering or gradient smoothing.
      - **Color Logic:** ${colorInstruction}
    - **Layer B (High Frequency - Detail/Structure):**
      - Sharpen ONLY the "structural edges" (ink lines, text outlines).
      - Do NOT sharpen the noise or the paper texture.
      - **Micro-Contrast:** Enhance the local contrast of faint pencil/ink lines to make them "pop" against the background.

    PHASE 3: VECTOR TOPOLOGY & RECONSTRUCTION (The "Art" Logic)
    - **G2 Continuity:** When repairing broken lines (scratches/fading), use "Vector Splines" logic. Predict the curvature trajectory and connect lines smoothly.
    - **Stroke Modulation:** For comics/art, preserve the "thick-to-thin" tapering of ink strokes. Do not make lines uniform width if they were originally dynamic.
    - **Texture Synthesis:** If a region is missing (e.g., a hole), synthesize the missing texture based on the surrounding pattern (e.g., canvas weave or paper grain), but DO NOT introduce mechanical noise.

    PHASE 4: SEMANTIC TEXT RESTORATION (US ENGLISH ONLY)
    - **OCR-Guided Re-rendering:** Treat text regions not as pixels, but as "Font Geometry".
    - **Glyph Definition:** Reconstruct stems, serifs, bowls, and counters with mathematical precision.
    - **Anti-Hallucination:** Only restore text that is legible. If a word is ambiguous, sharpen the shapes but DO NOT invent new letters. Use US English morphology cues.
    - **Kerning:** Ensure distinct separation between characters.

    PHASE 5: DYNAMIC RANGE & OUTPUT OPTIMIZATION
    - **Black Point Compensation:** Ensure black ink is true #000000 (or near it) to remove the "grey wash" of scanning.
    - **White Point Correction:** If it's a document, push the paper background towards pure white #FFFFFF (unless Vintage style is requested).
    - **Gamut Mapping:** Ensure colors are vibrant but within printable range (no neon artifacting).

    PHASE 6: REFLEXION & SELF-CORRECTION LOOP (FINAL QUALITY CONTROL)
    Before finalizing the output, perform a self-assessment comparing your generated 'semantic skeleton' with the original image:
    1. **Text Hallucination Check:** Verify that no new text strokes or gibberish characters have been invented in text regions.
    2. **Noise Smoothing Check:** Ensure flat color areas (backgrounds) are free of unsmoothed high-frequency noise or grain.
    3. **Feature Alignment:** Confirm key features (eye corners, logo points, geometric intersections) align perfectly with the source topology.
    4. **Correction:** If discrepancies are found, RE-GENERATE the affected regions to match the source truth before outputting.

    USER INSTRUCTION: ${config.customPrompt || 'Restore this image to high fidelity.'}
    `;

    // Add Prompt Text to parts (Including system instruction to avoid 500 errors with image models)
    parts.push({ text: `${systemInstruction}\n\nCOMMAND: Execute Forensic Restoration Pipeline.` });

    try {
        const response = await ai.models.generateContent({
            model,
            contents: { parts }, // Pass array of parts
            config: {
                // systemInstruction is removed from config to prevent backend 500 errors on image models
                imageConfig: {
                    imageSize: config.resolution as any,
                    aspectRatio: targetAspectRatio as any
                }
            }
        });

        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) {
                return `data:image/png;base64,${part.inlineData.data}`;
            }
        }
        throw new Error("No image data received.");

    } catch (error: any) {
        console.error("Restoration failed:", error);
        throw new Error(error.message || "Failed to restore image.");
    }
};

// 3. Image Inpainting/Outpainting
export const inpaintImage = async (
    base64Image: string, 
    mimeType: string, 
    config: RestorationConfig
): Promise<string> => {
    const ai = getClient();
    const model = "gemini-3-pro-image-preview"; 

    let targetAspectRatio = config.aspectRatio === AspectRatio.ORIGINAL 
         ? await getClosestAspectRatio(base64Image, mimeType)
         : config.aspectRatio as string;

    const systemInstruction = `
    ROLE: Intelligent Image Editor (Inpaint/Outpaint).
    
    LOGIC:
    1. MASK DETECTION: Red transparent areas are INPAINT ZONES. Transparent/White borders are OUTPAINT ZONES.
    2. CONTEXT AWARENESS: Use "Frequency Separation" logic to match the texture/grain of the new area with the existing image.
    3. TOPOLOGY: If lines cross the mask, use G2 Continuity to connect them smoothly.
    
    USER REQUEST: "${config.customPrompt || "Seamlessly fill the area."}"
    `;

    try {
        const response = await ai.models.generateContent({
            model,
            contents: {
                parts: [
                    { inlineData: { mimeType, data: base64Image } },
                    { text: `${systemInstruction}\n\nCOMMAND: Perform inpainting/outpainting.` }
                ]
            },
            config: {
                // systemInstruction moved to prompt
                imageConfig: {
                    imageSize: config.resolution as any,
                    aspectRatio: targetAspectRatio as any
                }
            }
        });

        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) {
                return `data:image/png;base64,${part.inlineData.data}`;
            }
        }
        throw new Error("No image data received.");

    } catch (error: any) {
        console.error("Inpainting failed:", error);
        throw new Error(error.message || "Failed to edit image.");
    }
};


// 4. Image Generation (New Creation)
export const generateNewImage = async (prompt: string, config: RestorationConfig): Promise<string> => {
    const ai = getClient();
    const model = "gemini-3-pro-image-preview"; 

    let targetAspectRatio = config.aspectRatio === AspectRatio.ORIGINAL 
        ? "1:1" 
        : config.aspectRatio as string;

    if (config.aspectRatio === AspectRatio.WIDE_21_9) targetAspectRatio = "16:9";

    try {
        const response = await ai.models.generateContent({
            model,
            contents: { parts: [{ text: prompt }] },
            config: {
                imageConfig: {
                    imageSize: config.resolution as any,
                    aspectRatio: targetAspectRatio as any
                }
            }
        });

        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) {
                return `data:image/png;base64,${part.inlineData.data}`;
            }
        }
        throw new Error("No image generated.");
    } catch (error: any) {
        console.error("Generation failed:", error);
        throw new Error(error.message || "Failed to generate image.");
    }
};

// 5. Vectorization (SVG Generation) - The "True Vectorization" dimension
export const vectorizeImage = async (
    base64Image: string, 
    mimeType: string,
    config: RestorationConfig
): Promise<string> => {
    const ai = getClient();
    // Using 1.5 Pro because it's better at coding/text output than image-preview models
    const model = "gemini-1.5-pro"; 

    const detailPrompt = config.vectorDetail === 'LOW' 
        ? "Minimalist, iconic style. Use fewest possible paths. Abstract shapes."
        : config.vectorDetail === 'HIGH' 
            ? "High fidelity. Detailed paths. Capture intricate curves and texture variations using layered opacities." 
            : "Standard vector trace. Balance detail with clean topology.";

    const colorPrompt = config.vectorColor === 'BLACK_WHITE'
        ? "Grayscale/Monochrome only. Use black fills and strokes."
        : "Full color preservation. Sample palette from source.";

    const prompt = `
    Role: Senior Vector Graphics Engineer.
    Task: Convert the input raster image into high-quality SVG code.
    
    CRITICAL PRE-PROCESSING: DESCREENING & MOIRÉ ELIMINATION
    If the image is a scan of printed material (comics, magazines) containing halftone dots:
    1. DETECT periodic dot patterns.
    2. SIMULATE 'Descreening': Mentally blend these dots into smooth color fields.
    3. TRACE the smoothed fields, NOT the individual dots.
    4. Eliminate Moiré patterns to prevent distorted vector topology.

    OBJECTIVE:
    Perform "True Vectorization". Do not just embed the image in an SVG tag.
    You must trace the visual elements using <path>, <rect>, <circle>, and <polygon> tags.
    
    SPECIFICATIONS:
    1. **Topology:** ${detailPrompt}
    2. **Color Mode:** ${colorPrompt}
    3. **Optimization:** Minimize node count. Use Bezier curves (C/S/Q commands) for smooth transitions. Avoid jagged "auto-trace" artifacts.
    4. **Grouping:** Use <g> tags to group semantic elements (e.g., <g id="text">, <g id="background">).
    
    OUTPUT FORMAT:
    Return ONLY the raw XML string for the SVG. Do not use Markdown code blocks.
    The SVG must have a viewBox matching the approximate aspect ratio of the image.
    `;

    try {
        const response = await ai.models.generateContent({
            model,
            contents: {
                parts: [
                    { inlineData: { mimeType, data: base64Image } },
                    { text: prompt }
                ]
            },
            config: {
                temperature: 0.2, // Low temperature for code precision
                maxOutputTokens: 8192
            }
        });

        let svgCode = response.text;
        
        if (!svgCode) throw new Error("No SVG code generated.");

        // Cleanup Markdown if present
        svgCode = svgCode.replace(/```xml/g, '').replace(/```svg/g, '').replace(/```/g, '').trim();

        // Validate it starts with <svg
        const svgStart = svgCode.indexOf('<svg');
        if (svgStart === -1) throw new Error("Invalid SVG output");
        svgCode = svgCode.substring(svgStart);

        // Convert SVG string to Data URL so it plays nice with our existing image components
        const base64Svg = btoa(unescape(encodeURIComponent(svgCode)));
        return `data:image/svg+xml;base64,${base64Svg}`;

    } catch (error: any) {
        console.error("Vectorization failed:", error);
        throw new Error(error.message || "Failed to vectorize image.");
    }
};