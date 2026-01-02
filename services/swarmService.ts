import { GoogleGenAI, Type } from "@google/genai";
import { fileToGenerativePart } from "./geminiService";

// --- CONFIGURATION ---
const getClient = () => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) throw new Error("API Key missing");
    return new GoogleGenAI({ apiKey });
};

// --- HELPERS ---
const getClosestAspectRatio = (width: number, height: number): string => {
    const ratio = width / height;
    const supported = [
        { val: "1:1", ratio: 1.0 },
        { val: "3:4", ratio: 0.75 },
        { val: "4:3", ratio: 1.33 },
        { val: "9:16", ratio: 0.5625 },
        { val: "16:9", ratio: 1.7778 },
    ];
    // Find closest ratio
    return supported.reduce((prev, curr) => 
        Math.abs(curr.ratio - ratio) < Math.abs(prev.ratio - ratio) ? curr : prev
    ).val;
};

// --- TYPES ---

export interface ScoutResult {
    documentType: string;
    regions: {
        header: number[]; // [y, x, y, x]
        content: number[];
        footer: number[];
        damage_detected: boolean;
        damage_bbox?: number[];
    };
    description: string;
}

export interface AuditResult {
    verifiedData: any;
    verificationLog: string[];
    groundingMetadata?: any;
    mathCorrections: { original: string, corrected: string, note: string }[];
}

// --- MODULE A: THE SCOUT (Gemini 3 Pro) ---
// Goal: High-Fidelity Perception.
export const scoutLayout = async (base64Image: string, mimeType: string): Promise<ScoutResult> => {
    const ai = getClient();
    const model = "gemini-3-pro-preview"; // Upgraded to Pro
    
    const prompt = `
    ROLE: The Scout (High-Fidelity Perception Engine).
    TASK: Analyze this document topology.
    
    1. Identify the Bounding Boxes (0-1000 scale) for: Header, Main Content, Footer.
    2. Detect Surface Damage: Are there tears, holes, coffee stains, or burns?
    
    OUTPUT: Strict JSON.
    `;

    const response = await ai.models.generateContent({
        model,
        contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: prompt }] },
        config: {
            responseMimeType: "application/json",
            maxOutputTokens: 8192,
            thinkingConfig: { thinkingBudget: 2048 },
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    documentType: { type: Type.STRING },
                    regions: {
                        type: Type.OBJECT,
                        properties: {
                            header: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                            content: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                            footer: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                            damage_detected: { type: Type.BOOLEAN },
                            damage_bbox: { type: Type.ARRAY, items: { type: Type.NUMBER } }
                        }
                    },
                    description: { type: Type.STRING }
                }
            }
        }
    });

    const json = response.text || "{}";
    return JSON.parse(json) as ScoutResult;
};

// --- MODULE B: THE AUDITOR (Gemini 3 Vision Pro) ---
// Goal: Visual Reasoning, Logic, Grounding. 
export const auditAndExtract = async (base64Image: string, mimeType: string, scoutData: ScoutResult): Promise<AuditResult> => {
    const ai = getClient();
    const model = "gemini-3-pro-preview"; 

    const prompt = `
    ROLE: The Auditor (Forensic Logic Engine).
    CONTEXT: Scout identified this as ${scoutData.documentType}.
    
    TASK:
    1. **Data Extraction**: Extract all visible text from the document.
    
    2. **Grounding & Truth Verification (Google Search)**:
       - IF a Company Name, Address, or Famous Entity appears: SEARCH VERIFY IT.
       - IF OCR reads "123 Mian St" but Search confirms "123 Main St", CORRECT THE TYPO.
       - FLAG this as a grounding correction.

    3. **Mathematical Verification (Code Execution)**:
       - IF this contains a table of numbers (Invoice, Financials):
       - **WRITE AND EXECUTE PYTHON CODE** to sum the columns and check line item multiplication.
       - Formula: Qty * UnitPrice == LineTotal? 
       - Formula: Sum(LineTotals) == Subtotal?
       - IF Image says "Total: $500" but Python calculates "$505", TRUST THE PYTHON.
       - FLAG this as a logic correction.

    OUTPUT: JSON Object.
    IMPORTANT: Since the document structure is dynamic, return 'verifiedData' as a STRINGIFIED JSON string.
    `;

    const response = await ai.models.generateContent({
        model,
        contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: prompt }] },
        config: {
            // HIGH INTELLIGENCE CONFIGURATION
            tools: [
                { googleSearch: {} },    // Verify Real World Facts
                { codeExecution: {} }    // Verify Math/Logic
            ], 
            responseMimeType: "application/json",
            maxOutputTokens: 32768, // Increased to accommodate high thinking
            thinkingConfig: { thinkingBudget: 16384 }, // EXTREME THOUGHT BUDGET (System 2)
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    verifiedData: { type: Type.STRING, description: "The clean, structured content extracted from the document, serialized as a JSON string." },
                    verificationLog: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Log of thoughts, search results, and code execution outputs" },
                    mathCorrections: { 
                        type: Type.ARRAY, 
                        items: { 
                            type: Type.OBJECT,
                            properties: {
                                original: { type: Type.STRING },
                                corrected: { type: Type.STRING },
                                note: { type: Type.STRING }
                            }
                        } 
                    }
                }
            }
        }
    });

    const json = response.text || "{}";
    const rawResult = JSON.parse(json);

    // Hydrate the serialized verifiedData
    let cleanVerifiedData = {};
    try {
        if (typeof rawResult.verifiedData === 'string') {
            cleanVerifiedData = JSON.parse(rawResult.verifiedData);
        } else {
            cleanVerifiedData = rawResult.verifiedData || {};
        }
    } catch (e) {
        console.warn("Failed to parse verifiedData string", e);
        cleanVerifiedData = { raw: rawResult.verifiedData };
    }

    const result: AuditResult = {
        verifiedData: cleanVerifiedData,
        verificationLog: rawResult.verificationLog || [],
        mathCorrections: rawResult.mathCorrections || [],
        groundingMetadata: response.candidates?.[0]?.groundingMetadata
    };
    
    return result;
};

// --- MODULE C: THE RESTORER (Gemini 3 Pro Image) ---
// Goal: 4K High-Bitrate Raster Reconstruction. Replaces the SVG Architect.
export const renderHighDefRaster = async (
    base64Image: string, 
    mimeType: string, 
    width: number, 
    height: number, 
    auditData: AuditResult
): Promise<string> => {
    const ai = getClient();
    const model = "gemini-3-pro-image-preview";

    // 1. Determine Corrections from Auditor
    let correctionPrompt = "";
    if (auditData.mathCorrections && auditData.mathCorrections.length > 0) {
        correctionPrompt += "\n*** CRITICAL LOGIC CORRECTIONS ***\nThe following text errors were detected via Logic Verification. You MUST render the CORRECTED value:\n";
        auditData.mathCorrections.forEach(c => {
            correctionPrompt += `- CHANGE VISUAL TEXT "${c.original}" TO "${c.corrected}" (Reason: ${c.note})\n`;
        });
    }

    // 2. Formatting Grounded Data for the Prompt
    const dataSummary = JSON.stringify(auditData.verifiedData).slice(0, 2000); // Truncate to avoid context limit if massive

    // 3. Aspect Ratio Logic
    const targetRatio = getClosestAspectRatio(width, height);

    const prompt = `
    ROLE: The Restorer (Neural High-Bitrate Engine).
    TASK: Perform a 4K Generative Upscale & Restoration of this image.
    
    INPUT DATA TRUTH:
    ${dataSummary}

    ${correctionPrompt}
    
    VISUAL QUALITY STANDARDS:
    1. **Lossless Fidelity**: Output at maximum bitrate. Texture should be hyper-realistic (paper grain, ink sheen).
    2. **Intelligent Repair**: Heal any tears, stains, or holes identified by the Scout.
    3. **Typographic Reconstruction**: Re-render all text to be vector-sharp.
       - IF the original text is blurry but the Input Data Truth says "100.00", render "100.00" clearly.
       - Do NOT hallucinate new text. Stick to the Input Data Truth.
    4. **Lighting**: Normalize lighting. Remove scanner glare.
    
    OUTPUT: A single high-quality PNG image.
    `;

    const response = await ai.models.generateContent({
        model,
        contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: prompt }] },
        config: {
            imageConfig: { 
                imageSize: "4K",
                aspectRatio: targetRatio as any
            }
        }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
    }
    throw new Error("Failed to render raster image.");
};

// --- ORCHESTRATION ---
export const processDocumentWithSwarm = async (base64Image: string, mimeType: string, width: number, height: number, onLog: (msg: string) => void): Promise<string> => {
    
    // 1. SCOUT
    onLog("🚀 Scout (Pro): Scanning Topology...");
    const scoutResult = await scoutLayout(base64Image, mimeType);
    console.log("Scout Data:", scoutResult);

    // 2. AUDITOR
    onLog("🧠 Auditor (Vision Pro): Verifying Logic & Grounding...");
    const auditResult = await auditAndExtract(base64Image, mimeType, scoutResult);
    console.log("Audit Data:", auditResult);

    // 3. RESTORER (Replaces Architect)
    onLog("🎨 Restorer (Pro Image): Generative 4K Reconstruction...");
    // We pass the Original Image + The Intelligence (Audit Result) to the final image generator
    const finalImage = await renderHighDefRaster(base64Image, mimeType, width, height, auditResult);

    return finalImage;
};