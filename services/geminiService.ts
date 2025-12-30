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
        case ColorStyle.TRUE_TONE: colorInstruction = "STRICT FIDELITY: Maintain exact source hues, no color shifting."; break;
        case ColorStyle.HIGH_CONTRAST: colorInstruction = "DOCUMENT MODE: Pure white background, pure black text. High contrast."; break;
        case ColorStyle.VIBRANT_HDR: colorInstruction = "VIBRANT ART: Enhanced saturation, deep blacks, bright highlights."; break;
        case ColorStyle.BLACK_WHITE: colorInstruction = "MONOCHROME: Grayscale only. No color noise."; break;
        case ColorStyle.VINTAGE_WARM: colorInstruction = "VINTAGE: Warm sepia tones, cream paper texture."; break;
        case ColorStyle.COOL_TONE: colorInstruction = "MODERN: Cool white balance, sterile and clean look."; break;
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
            
            referenceInstruction = `Use the second image as a STYLE REFERENCE for color and line weight.`;
        }
    }

    const materialDesc = analysis?.detectedMaterial || 'Standard Media';
    const descreenNeeded = analysis?.requiresDescreening ? "CRITICAL: REMOVE HALFTONE DOTS (DESCREEN)." : "";

    // --- ALGORITHMIC PROMPT (SIMPLIFIED FOR IMAGE MODEL) ---
    // Image models react better to visual descriptions of the *outcome* rather than procedural "phases".
    const prompt = `
    Task: Restore and upscale this image to high fidelity (${config.resolution}).
    
    INPUT CONTEXT:
    - Type: ${analysis?.detectedType || 'Unknown'}
    - Material: ${materialDesc}
    - ${descreenNeeded}
    ${referenceInstruction}

    CRITICAL DESCREENING DIRECTIVE:
    For scans of printed materials (comics, magazines), you MUST first detect periodic halftone dot patterns, apply a 'Descreening' process to blend these dots into smooth color fields, and actively eliminate Moiré patterns. This descreening must occur BEFORE any primary edge sharpening or detail synthesis to prevent amplifying print artifacts.

    VISUAL REQUIREMENTS (THE OUTPUT MUST BE):
    1. **Sharp & Defined**: Text and linework must be vector-sharp. No blur.
    2. **Descreened & Smooth**: Completely remove any printing dots, moiré patterns, or halftone screens. The image should look like a direct digital export, not a scan.
    3. **Clean**: Remove paper grain, dust, scratches, and ISO noise.
    4. **Color Style**: ${colorInstruction}
    5. **Topology**: Fix broken lines or faded ink. Connect disconnected strokes.
    
    USER INSTRUCTION: ${config.customPrompt || 'Restore clarity and original detail.'}
    `;

    // Add Prompt Text to parts
    parts.push({ text: prompt });

    try {
        const response = await ai.models.generateContent({
            model,
            contents: { parts }, // Pass array of parts
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
        throw new Error("No image data received from Gemini.");

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
    ACT AS A REVERSE-ENGINEERING DESIGN TOOL & TOPOLOGY ENGINE.
    Task: Convert this raster image into an EDITABLE, CLEAN SVG (Scalable Vector Graphics).

    CRITICAL PIPELINE ORDER (STRICTLY FOLLOW):

    1. **Pre-Processing (Scans):** 
       - If the image contains halftone dots (print scan), mentally apply 'Descreening'.
       - Blend the dots into solid color fields.
       - TRACE the smoothed fields, NOT the individual dots.
       - Eliminate Moiré patterns.

    2. **Text Recognition (OCR-to-SVG):** 
       - **Do NOT trace text as <path> outlines.**
       - DETECT all legible text.
       - Use real <text x="..." y="..." font-family="..." font-size="..." fill="...">Content</text> elements.
       - **Font Matching:** Map to closest generic web-safe family: 'sans-serif' (Arial-like), 'serif' (Times-like), 'monospace' (Courier-like).
       - Detect attributes: font-weight (bold) and font-style (italic).

    3. **Shape Abstraction:**
       - Convert geometric objects to primitives: <rect>, <circle>, <ellipse>, <line>, <polygon> where possible.
       - Only use <path> for organic, non-geometric curves.

    4. **Organization & Layering (CRITICAL):**
       - You MUST group elements into these specific ID categories for asset separation:
         - <g id="layer_background"> for all background shapes, fills, and noise patterns.
         - <g id="layer_graphics"> for main subject, icons, lines, and artistic elements.
         - <g id="layer_text"> for all text elements.
       - If a category is empty, omit the group.

    SPECIFICATIONS:
    - **Topology:** ${detailPrompt}
    - **Color Mode:** ${colorPrompt}
    - **Optimization:** Minimize node count. Use Bezier curves (C/S/Q commands).

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

// 6. Text Extraction (Transparent SVG)
export const extractText = async (
    base64Image: string, 
    mimeType: string
): Promise<string> => {
    const ai = getClient();
    const model = "gemini-1.5-pro"; 

    const prompt = `
    ACT AS A STRICT OCR-TO-VECTOR ENGINE.
    Task: Extract ONLY the textual elements from this image into a clean, transparent SVG.
    
    CRITICAL RULES:
    1. **BACKGROUND:** MUST BE TRANSPARENT. Do not include any background <rect> or fill.
    2. **CONTENT:** Only Include text elements using <text> tags. Exclude all lines, boxes, images, illustrations, and noise.
    3. **PRECISE POSITION:** The text must be in the exact (x,y) coordinates as the original image to act as an overlay.
    4. **FONT & STYLE:** Match font-family, size, weight, and COLOR from the source image.
       - If the text is black ink on a document, output black text.
       - If the text is colored design, output colored text.
    5. **GROUPING:** Group text by logical blocks <g id="layer_text">.

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
                temperature: 0.1, // Very low temp for strict OCR adherence
                maxOutputTokens: 8192
            }
        });

        let svgCode = response.text;
        
        if (!svgCode) throw new Error("No SVG code generated.");

        // Cleanup Markdown
        svgCode = svgCode.replace(/```xml/g, '').replace(/```svg/g, '').replace(/```/g, '').trim();

        const svgStart = svgCode.indexOf('<svg');
        if (svgStart === -1) throw new Error("Invalid SVG output");
        svgCode = svgCode.substring(svgStart);

        const base64Svg = btoa(unescape(encodeURIComponent(svgCode)));
        return `data:image/svg+xml;base64,${base64Svg}`;

    } catch (error: any) {
        console.error("Text extraction failed:", error);
        throw new Error(error.message || "Failed to extract text.");
    }
};