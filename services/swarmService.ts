
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { cleanRawJson, GEMINI_CONFIG } from "./geminiService";
import { AgentResponse, AgentStatus, ScoutResult, AuditResult } from "../types";

// --- CONFIGURATION ---
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
            console.warn(`[SwarmService] Error ${code}. Retrying in ${delay}ms... (${retries} attempts left)`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return withRetry(operation, retries - 1, delay * 2);
        }
        throw error;
    }
};

const getClosestAspectRatio = (width: number, height: number): string => {
    const ratio = width / height;
    const supported = [
        { val: "1:1", ratio: 1.0 }, { val: "3:4", ratio: 0.75 }, { val: "4:3", ratio: 1.333 }, 
        { val: "9:16", ratio: 0.5625 }, { val: "16:9", ratio: 1.7778 },
        { val: "2:3", ratio: 0.666 }, { val: "3:2", ratio: 1.5 },
        { val: "4:5", ratio: 0.8 }, { val: "5:4", ratio: 1.25 },
        { val: "21:9", ratio: 2.333 }
    ];
    return supported.reduce((prev, curr) => 
        Math.abs(curr.ratio - ratio) < Math.abs(prev.ratio - ratio) ? curr : prev
    ).val;
};

// --- MODULE A: THE SCOUT (Gemini 3 Pro Logic) ---
export const scoutLayout = async (base64Image: string, mimeType: string): Promise<AgentResponse<ScoutResult>> => {
    const ai = getClient();
    const model = GEMINI_CONFIG.LOGIC_MODEL;
    
    const prompt = `
    ROLE: The Scout (High-Fidelity Perception Engine).
    TASK: Analyze this document topology with Mathematical Precision.
    
    THINKING PROCESS:
    1. **Topology Mapping**: Identify the physical boundaries of Header, Content, and Footer. 
       - Distinguish between "Ink Content" and "Paper Edge".
    2. **Damage Detection**: Scan for tears, holes, coffee stains, burns, or creases.
       - Return bounding boxes ONLY for physical damage, not for content.
    
    OUTPUT: Strict JSON.
    `;

    try {
        const response = await withRetry<GenerateContentResponse>(() => ai.models.generateContent({
            model,
            contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: prompt }] },
            config: {
                responseMimeType: "application/json",
                maxOutputTokens: GEMINI_CONFIG.MAX_OUTPUT_TOKENS,
                thinkingConfig: { thinkingBudget: GEMINI_CONFIG.THINKING_BUDGET }, // High Intelligence
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
        }));

        const json = cleanRawJson(response.text || "{}");
        const data = JSON.parse(json) as ScoutResult;
        return { status: AgentStatus.SUCCESS, data, message: "Scout Analysis Complete" };

    } catch (e: any) {
        return { status: AgentStatus.ERROR, data: null, message: e.message || "Scout failed" };
    }
};

// --- MODULE B: THE AUDITOR (Gemini 3 Pro Logic + Tools) ---
export const auditAndExtract = async (base64Image: string, mimeType: string, scoutData: ScoutResult): Promise<AgentResponse<AuditResult>> => {
    const ai = getClient();
    const model = GEMINI_CONFIG.LOGIC_MODEL;

    // IDLE STATE CHECK: If Scout says it's just "ART", Auditor might skip
    if (scoutData.documentType === 'ART' || scoutData.documentType === 'PHOTO') {
         return { 
             status: AgentStatus.NO_OP, 
             data: { verifiedData: {}, verificationLog: [], mathCorrections: [] }, 
             message: "Auditor skipped (Not a document)" 
         };
    }

    const prompt = `
    ROLE: The Auditor (Forensic Logic Engine).
    CONTEXT: Scout identified this as ${scoutData.documentType}.
    
    TASK:
    1. **Data Extraction**: Extract all visible text from the document.
    2. **Grounding & Truth Verification (Google Search)**: Check entities (Addresses, Company Names) against real-world data.
    3. **Mathematical Verification (Code Execution)**: Check numbers. Sum line items. Verify totals.
    4. **Watermark Detection**: List distinct words that act as background noise.

    OUTPUT: JSON Object.
    `;

    try {
        const response = await withRetry<GenerateContentResponse>(() => ai.models.generateContent({
            model,
            contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: prompt }] },
            config: {
                tools: [
                    { googleSearch: {} },
                    { codeExecution: {} }
                ], 
                responseMimeType: "application/json",
                maxOutputTokens: GEMINI_CONFIG.MAX_OUTPUT_TOKENS, 
                thinkingConfig: { thinkingBudget: GEMINI_CONFIG.THINKING_BUDGET }, // High Intelligence
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        verifiedData: { type: Type.STRING },
                        verificationLog: { type: Type.ARRAY, items: { type: Type.STRING } },
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
                        },
                        watermarks: { type: Type.ARRAY, items: { type: Type.STRING } }
                    }
                }
            }
        }));

        const json = cleanRawJson(response.text || "{}");
        const rawResult = JSON.parse(json);

        let cleanVerifiedData = {};
        try {
            if (typeof rawResult.verifiedData === 'string') {
                cleanVerifiedData = JSON.parse(cleanRawJson(rawResult.verifiedData));
            } else {
                cleanVerifiedData = rawResult.verifiedData || {};
            }
        } catch (e) {
            cleanVerifiedData = { raw: rawResult.verifiedData };
        }

        const result: AuditResult = {
            verifiedData: cleanVerifiedData,
            verificationLog: rawResult.verificationLog || [],
            mathCorrections: rawResult.mathCorrections || [],
            groundingMetadata: response.candidates?.[0]?.groundingMetadata,
            watermarks: rawResult.watermarks || []
        };
        
        return { status: AgentStatus.SUCCESS, data: result, message: "Audit Complete" };

    } catch (e: any) {
        return { status: AgentStatus.ERROR, data: null, message: e.message || "Auditor failed" };
    }
};

// --- MODULE C: THE RESTORER (Gemini 3 Pro Vision) ---
export const renderHighDefRaster = async (
    base64Image: string, 
    mimeType: string, 
    width: number, 
    height: number, 
    auditData: AuditResult
): Promise<AgentResponse<string>> => {
    const ai = getClient();
    const model = GEMINI_CONFIG.VISION_MODEL;

    // 1. Determine Corrections from Auditor
    let correctionPrompt = "";
    if (auditData.mathCorrections && auditData.mathCorrections.length > 0) {
        correctionPrompt += "\n*** CRITICAL LOGIC CORRECTIONS ***\n";
        auditData.mathCorrections.forEach(c => {
            correctionPrompt += `- CHANGE VISUAL TEXT "${c.original}" TO "${c.corrected}" (Reason: ${c.note})\n`;
        });
    }

    const watermarks = auditData.watermarks || [];
    const negativeConstraint = watermarks.length > 0 
        ? `
    *** NEGATIVE CONSTRAINT (WATERMARKS) ***
    Detected Background Text: [${watermarks.join(', ')}]
    INSTRUCTION: Fade these words into the background texture.
    `
        : "";

    const dataSummary = JSON.stringify(auditData.verifiedData).slice(0, 4000); // Increased Context Window allows larger summary

    const targetAspectRatio = getClosestAspectRatio(width, height);

    const prompt = `
    ROLE: The Restorer (Neural High-Bitrate Engine).
    TASK: Perform a 4K Generative Upscale & Restoration of this image.
    
    INPUT DATA TRUTH:
    ${dataSummary}

    ${correctionPrompt}

    ${negativeConstraint}
    
    VISUAL QUALITY STANDARDS:
    1. **Lossless Fidelity**: Output at maximum bitrate.
    2. **Intelligent Repair**: Heal any tears, stains, or holes.
    3. **Typographic Reconstruction**: Re-render all text to be vector-sharp.
    4. **Lighting**: Normalize lighting.
    
    OUTPUT: A single high-quality PNG image.
    `;

    try {
        const response = await withRetry<GenerateContentResponse>(() => ai.models.generateContent({
            model,
            contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: prompt }] },
            config: {
                imageConfig: { 
                    imageSize: "4K",
                    aspectRatio: targetAspectRatio as any
                }
                // Vision models do not support Thinking Config yet
            }
        }));

        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) return { status: AgentStatus.SUCCESS, data: `data:image/png;base64,${part.inlineData.data}`, message: "Restoration Complete" };
        }
        return { status: AgentStatus.ERROR, data: null, message: "No image generated" };

    } catch (e: any) {
        return { status: AgentStatus.ERROR, data: null, message: e.message || "Restoration failed" };
    }
};

// --- ORCHESTRATION ---
export const processDocumentWithSwarm = async (
    base64Image: string, 
    mimeType: string, 
    width: number, 
    height: number, 
    onLog: (msg: string) => void,
    checkCancelled?: () => boolean
): Promise<AgentResponse<string>> => {
    
    // 1. SCOUT
    onLog("🚀 Scout (Pro): Scanning Topology...");
    const scoutRes = await scoutLayout(base64Image, mimeType);
    if (checkCancelled && checkCancelled()) return { status: AgentStatus.NO_OP, data: null, message: "Cancelled" };
    
    if (scoutRes.status === AgentStatus.ERROR) {
        onLog("⚠️ Scout failed. Falling back to Blind Restoration.");
        // Continue with minimal data to avoid full crash
    }
    const scoutData = scoutRes.data || { documentType: 'UNKNOWN', regions: { header: [], content: [], footer: [], damage_detected: false }, description: "" };

    // 2. AUDITOR
    onLog("🧠 Auditor (Vision Pro): Verifying Logic & Grounding...");
    const auditRes = await auditAndExtract(base64Image, mimeType, scoutData);
    if (checkCancelled && checkCancelled()) return { status: AgentStatus.NO_OP, data: null, message: "Cancelled" };

    if (auditRes.status === AgentStatus.NO_OP) {
        onLog("ℹ️ Auditor skipped (Not required for this type).");
    }
    const auditData = auditRes.data || { verifiedData: {}, verificationLog: [], mathCorrections: [], watermarks: [] };

    // 3. RESTORER
    onLog("🎨 Restorer (Pro Image): Generative 4K Reconstruction...");
    const restorerRes = await renderHighDefRaster(base64Image, mimeType, width, height, auditData);
    
    return restorerRes;
};
