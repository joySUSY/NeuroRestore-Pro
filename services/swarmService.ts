
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { cleanRawJson, GEMINI_CONFIG, executeSafe, getClient, extractResponseText, downscaleImage } from "./geminiService";
import { AgentResponse, AgentStatus, ScoutResult, AuditResult } from "../types";
import { geometricUnwarp, intrinsicDecomposition } from "./physicsService";
import { renderPDSR } from "./restorationService";

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

// Helper to verify integrity (e.g., prevent debug plots)
const verifyImageIntegrity = async (originalBase64: string, candidateBase64: string): Promise<boolean> => {
    if (typeof window === 'undefined') return true;
    try {
        const getDims = (b64: string): Promise<{w:number, h:number}> => new Promise(resolve => {
            const i = new Image();
            i.onload = () => resolve({w: i.width, h: i.height});
            i.onerror = () => resolve({w: 100, h: 100});
            i.src = `data:image/png;base64,${b64}`;
        });
        
        const [orig, cand] = await Promise.all([getDims(originalBase64), getDims(candidateBase64)]);
        
        const r1 = orig.w / orig.h;
        const r2 = cand.w / cand.h;
        
        // If aspect ratio shifts dramatically (e.g., > 1.0 difference), it's likely a side-by-side plot
        if (Math.abs(r1 - r2) > 1.0) return false;
        
        return true;
    } catch { return true; }
};

// --- MODULE A: THE SCOUT ---
export const scoutLayout = async (base64Image: string, mimeType: string): Promise<AgentResponse<ScoutResult>> => {
    const ai = getClient();
    const model = GEMINI_CONFIG.LOGIC_MODEL;
    
    // Scout only needs structural data, 1024px is plenty.
    const optimizedBase64 = await downscaleImage(base64Image, mimeType, 1024);

    const prompt = `
    ROLE: The Scout (Project Vanguard - Jan 2026).
    TASK: Analyze document topology using GESTALT PRINCIPLES and *LayoutLMv4* logic.
    
    THINKING PROCESS:
    1. **Topology Mapping (3D)**: Estimate Paper Plane (flat/curled).
    2. **Gestalt Grouping**: Group semantic blocks.
    3. **Damage Detection**: Scan for tears/holes.
    
    OUTPUT: Strict JSON matching schema.
    `;

    const schemaConfig = {
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
    };

    try {
        const response = await executeSafe<GenerateContentResponse>(async () => {
            return ai.models.generateContent({
                model,
                contents: { parts: [{ inlineData: { mimeType, data: optimizedBase64 } }, { text: prompt }] },
                config: {
                    responseMimeType: "application/json",
                    maxOutputTokens: GEMINI_CONFIG.MAX_OUTPUT_TOKENS,
                    thinkingConfig: { thinkingBudget: GEMINI_CONFIG.THINKING_BUDGET },
                    systemInstruction: GEMINI_CONFIG.SYSTEM_INSTRUCTION,
                    responseSchema: schemaConfig
                }
            });
        }, 'CRITICAL');

        const json = cleanRawJson(extractResponseText(response) || "{}");
        const data = JSON.parse(json) as ScoutResult;
        return { status: AgentStatus.SUCCESS, data, message: "Scout Analysis Complete" };

    } catch (e: any) {
        return { status: AgentStatus.ERROR, data: null, message: e.message || "Scout failed" };
    }
};

// --- MODULE B: THE AUDITOR ---
export const auditAndExtract = async (base64Image: string, mimeType: string, scoutData: ScoutResult): Promise<AgentResponse<AuditResult>> => {
    const ai = getClient();
    const model = GEMINI_CONFIG.LOGIC_MODEL;

    if (scoutData.documentType === 'ART' || scoutData.documentType === 'PHOTO') {
         return { 
             status: AgentStatus.NO_OP, 
             data: { verifiedData: {}, verificationLog: [], mathCorrections: [] }, 
             message: "Auditor skipped (Not a document)" 
         };
    }

    // Auditor needs to read text, so we keep resolution reasonably high but capped
    const optimizedBase64 = await downscaleImage(base64Image, mimeType, 1536);

    const prompt = `
    ROLE: The Auditor (Project Vanguard - Forensic Logic Engine).
    CONTEXT: Scout identified this as ${scoutData.documentType}.
    TASK: Data Extraction & Ontological Reconciliation.
    OUTPUT: JSON Object.
    `;

    try {
        const response = await executeSafe<GenerateContentResponse>(async () => {
            return ai.models.generateContent({
                model,
                contents: { parts: [{ inlineData: { mimeType, data: optimizedBase64 } }, { text: prompt }] },
                config: {
                    tools: [
                        { googleSearch: {} },
                        { codeExecution: {} }
                    ], 
                    maxOutputTokens: GEMINI_CONFIG.MAX_OUTPUT_TOKENS, 
                    thinkingConfig: { thinkingBudget: GEMINI_CONFIG.THINKING_BUDGET },
                    systemInstruction: GEMINI_CONFIG.SYSTEM_INSTRUCTION
                }
            });
        }, 'CRITICAL');

        const text = extractResponseText(response) || "{}";
        const json = cleanRawJson(text);
        let rawResult: any = {};
        try {
            rawResult = JSON.parse(json);
        } catch (e) {
            console.warn("Auditor JSON parse failed, returning raw text as log");
            rawResult = { verificationLog: [text] };
        }

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

// --- ORCHESTRATION ---
export const processDocumentWithSwarm = async (
    base64Image: string, 
    mimeType: string, 
    width: number, 
    height: number, 
    onLog: (msg: string) => void,
    checkCancelled?: () => boolean
): Promise<AgentResponse<string>> => {
    
    // 1. SCOUT (Violet Perception)
    onLog("🚀 Scout (Vanguard): Scanning Topology & Gestalt Grouping...");
    const scoutRes = await scoutLayout(base64Image, mimeType);
    if (checkCancelled && checkCancelled()) return { status: AgentStatus.NO_OP, data: null, message: "Cancelled" };
    
    if (scoutRes.status === AgentStatus.ERROR) {
        onLog("⚠️ Scout failed. Falling back to Blind Restoration.");
    }
    const scoutData = scoutRes.data || { documentType: 'UNKNOWN', regions: { header: [], content: [], footer: [], damage_detected: false }, description: "" };

    // 2. THE PHYSICIST (Violet Code)
    onLog("📐 The Physicist (Vanguard): Calculating Geometric Unwarp via OpenCV...");
    let processedBase64 = base64Image;
    
    // 2a. Geometric Dewarping
    const dewarpRes = await geometricUnwarp(processedBase64, mimeType);
    if (dewarpRes.status === AgentStatus.SUCCESS && dewarpRes.data) {
        const candidate = dewarpRes.data.split(',')[1];
        if (await verifyImageIntegrity(processedBase64, candidate)) {
             processedBase64 = candidate;
             onLog("✅ Geometry: Perspective Corrected via Python.");
        } else {
             onLog("⚠️ Geometry: Result discarded (Plot detected).");
        }
    } else {
        onLog("ℹ️ Geometry: No correction needed or Code Failed.");
    }
    
    if (checkCancelled && checkCancelled()) return { status: AgentStatus.NO_OP, data: null, message: "Cancelled" };

    // 2b. Intrinsic Decomposition (Lighting)
    onLog("💡 The Physicist (Vanguard): Decomposing Intrinsic Lighting...");
    const lightingRes = await intrinsicDecomposition(processedBase64, mimeType);
    if (lightingRes.status === AgentStatus.SUCCESS && lightingRes.data) {
        const candidate = lightingRes.data.split(',')[1];
        if (await verifyImageIntegrity(processedBase64, candidate)) {
            processedBase64 = candidate;
            onLog("✅ Lighting: Shadow layer removed via Python.");
        } else {
            onLog("⚠️ Lighting: Result discarded (Plot detected).");
        }
    }

    if (checkCancelled && checkCancelled()) return { status: AgentStatus.NO_OP, data: null, message: "Cancelled" };

    // 3. AUDITOR (Violet Verification)
    onLog("🧠 Auditor (Vanguard): Running Ontological Reconciliation...");
    const auditRes = await auditAndExtract(processedBase64, mimeType, scoutData);
    if (checkCancelled && checkCancelled()) return { status: AgentStatus.NO_OP, data: null, message: "Cancelled" };

    const auditData = auditRes.data || { verifiedData: {}, verificationLog: [], mathCorrections: [], watermarks: [] };

    // 4. RESTORER (Ashley Texture Specialist) - Note: In Vanguard protocol, Restorer uses renderPDSR
    onLog("🎨 The Calligrapher (Vanguard): Semantic Texture Refinement...");
    // We import renderPDSR from restorationService and use it here with an empty/basic atlas if needed
    // In a full flow, we should reuse the semantic atlas built in perceptionService if available, 
    // but here we are in Swarm mode. For simplicity, we create a transient atlas based on Audit Data.
    
    const transientAtlas: any = {
        globalPhysics: { paperWhitePoint: '#FFFFFF', noiseProfile: 'CLEAN', blurKernel: 'NONE', lightingCondition: 'FLAT' },
        regions: [], // In a real scenario, map auditData.verifiedData to regions
        degradationScore: 0
    };

    // However, to align with the "Calligrapher" upgrade, we use the powerful renderPDSR function
    const restorerRes = await renderPDSR(processedBase64, mimeType, width, height, transientAtlas, {
        // Construct a temporary config aligned with defaults or pass from app
        imageType: 'DOCUMENT' as any,
        customPrompt: '',
        resolution: '4K' as any,
        aspectRatio: 'ORIGINAL' as any,
        colorStyle: 'TRUE_TONE' as any,
        detailEnhancement: 'MAX',
        brushSize: 40,
        maskBlendMode: 'add',
        vectorDetail: 'MEDIUM',
        vectorColor: 'COLOR',
        pdsr: { enableTextPriors: true, enableTextureTransfer: true, enableSemanticRepair: true },
        physics: { enableDewarping: true, enableIntrinsic: true, enableDiffVG: true, enableMaterial: true }
    });
    
    return restorerRes;
};
