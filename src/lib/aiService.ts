import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { supabase } from './supabase';

// Set worker source for pdfjs
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export interface GeminiResponse {
  text: string;
  modelUsed: string;
  versionUsed: string;
}

export interface GeminiOptions {
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
  systemInstruction?: string;
  retryCount?: number;
}

function getApiKeyList(apiKey: string): string[] {
  if (!apiKey) return [];
  return apiKey.split(/[\n,;\s]+/).map(k => k.trim()).filter(Boolean);
}

function selectApiKey(apiKey: string): string {
  const keys = getApiKeyList(apiKey);
  if (keys.length === 0) return '';
  const randomIndex = Math.floor(Math.random() * keys.length);
  return keys[randomIndex];
}

/**
 * ฟังก์ชันส่วนกลางสำหรับการเรียกใช้ Gemini API พร้อมระบบหมุนเวียน Model และ Error Handling
 */
export async function callGeminiAPI(
  prompt: string, 
  apiKey: string, 
  options: GeminiOptions = {}
): Promise<GeminiResponse> {
  const {
    temperature = 0.7,
    maxOutputTokens = 2048,
    responseMimeType = "text/plain",
    systemInstruction,
    retryCount = 3
  } = options;

  // ดึงแนวปฏิบัติเฉพาะของโรงเรียน (Custom SOP) มาพ่วงใน System Instruction
  let finalSystemInstruction = systemInstruction || '';
  try {
    const { data: settingsData } = await supabase.from('settings').select('custom_sop').maybeSingle();
    if (settingsData?.custom_sop && settingsData.custom_sop.trim() !== '') {
      finalSystemInstruction = finalSystemInstruction 
        ? `${finalSystemInstruction}\n\n[แนวปฏิบัติและข้อกำหนดพิเศษของโรงเรียน (SOP)]:\n${settingsData.custom_sop}`
        : settingsData.custom_sop;
    }
  } catch (e) {
    console.error("Error fetching custom_sop for Gemini API:", e);
  }

  const keys = getApiKeyList(apiKey);
  if (keys.length === 0) throw new Error("กรุณาตั้งค่า Gemini API Key");

  // คำนวณรอบที่ลองให้ครอบคลุมทุกคีย์จากทุกบัญชีที่ผู้ใช้กรอก
  const totalAttempts = Math.max(keys.length * 2, retryCount, 4);

  let modelsToTry = await getAvailableModels(keys[0]);
  if (modelsToTry.length === 0) {
    modelsToTry = [
      "gemini-3.5-flash",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-3.5-flash-lite",
      "gemini-2.5-flash-lite",
      "gemini-flash-lite-latest"
    ];
  }

  const apiVersions = ["v1beta"];
  let lastError: any = null;

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    // หมุนเวียนคีย์ตามลำดับเพื่อกระจายโควตาข้ามบัญชีอย่างแท้จริง
    const currentKey = keys[attempt % keys.length];

    let shouldSwitchKey = false;

    for (const modelName of modelsToTry) {
      if (shouldSwitchKey) break;

      for (const version of apiVersions) {
        try {
          const url = `https://generativelanguage.googleapis.com/${version}/models/${modelName}:generateContent?key=${currentKey}`;
          
          const body: any = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature,
              maxOutputTokens,
              responseMimeType
            }
          };

          if (finalSystemInstruction) {
            body.systemInstruction = {
              parts: [{ text: finalSystemInstruction }]
            };
          }

          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });

          const data = await response.json();
          
          if (response.ok) {
            const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            if (aiText) {
              return {
                text: aiText,
                modelUsed: modelName,
                versionUsed: version
              };
            }
          } else {
            lastError = data.error || { message: `HTTP ${response.status}` };
            if (response.status === 429) {
              console.warn(`[GEMINI 429] Rate limit/quota reached for ${modelName} on key ${currentKey.slice(0, 8)}..., switching to next account key...`);
              shouldSwitchKey = true;
              break; 
            }
          }
        } catch (err: any) {
          lastError = err;
        }
      }
    }

    if (attempt < totalAttempts - 1 && !shouldSwitchKey) {
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }

  const errorMsg = lastError?.message || lastError || "Unknown error";
  throw new Error(`AI ไม่สามารถประมวลผลได้: ${errorMsg}`);
}

/**
 * ตัดบริบท (Context) ให้ไม่เกินขีดจำกัดเพื่อประหยัด Token และป้องกัน AI สับสน
 */
export function truncateContext(context: string, maxChars: number = 15000): string {
  if (context.length <= maxChars) return context;
  return context.substring(0, maxChars) + "\n... (ข้อมูลถูกตัดเพื่อความกระชับ) ...";
}

export async function extractProjectsFromKnowledge(apiKey: string, academicYear: string = '2569') {
  try {
    // 1. ใช้ Hybrid Search (Vector + Text) เพื่อดึงข้อมูลโครงการให้ครอบคลุมที่สุด
    const vectorQuery = `รายการโครงการและงบประมาณของปีการศึกษา ${academicYear}`;
    const vectorMatches = await searchKnowledge(vectorQuery, apiKey, 25);
    const filteredVector = (vectorMatches || []).filter((vm: any) => 
      !vm.document_name?.includes('ระเบียบ') && 
      !vm.document_name?.includes('คู่มือ')
    );
    
    const thaiYear = academicYear.replace(/0/g, '๐').replace(/1/g, '๑').replace(/2/g, '๒').replace(/3/g, '๓').replace(/4/g, '๔').replace(/5/g, '๕').replace(/6/g, '๖').replace(/7/g, '๗').replace(/8/g, '๘').replace(/9/g, '๙');
    const { data: textMatches } = await supabase
      .from('school_knowledge')
      .select('document_name, chunk_text')
      .not('document_name', 'ilike', '%ระเบียบ%')
      .not('document_name', 'ilike', '%คู่มือ%')
      .or(`chunk_text.ilike.%โครงการ%,chunk_text.ilike.%งบประมาณ%,chunk_text.ilike.%${academicYear}%,chunk_text.ilike.%${thaiYear}%`)
      .limit(60);

    const allMatches = [...filteredVector, ...(textMatches || [])];
    const uniqueChunks = allMatches.filter((v, i, a) => a.findIndex(t => (t.chunk_text === v.chunk_text)) === i);
    
    if (uniqueChunks.length === 0) return [];

    const context = uniqueChunks.map(m => `[ไฟล์: ${m.document_name}]\n${m.chunk_text}`).join('\n---\n');

    // 2. ระบบหมุนเวียน Model และ API Version เพื่อความเสถียร
    let modelsToTry = await getAvailableModels(apiKey);
    if (modelsToTry.length === 0) {
      modelsToTry = [
        "gemini-3.5-flash",
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "gemini-3.5-flash-lite",
        "gemini-2.5-flash-lite",
        "gemini-flash-lite-latest"
      ];
    }
    const apiVersions = ["v1beta"];
    const keys = getApiKeyList(apiKey);
    if (keys.length === 0) return [];

    const prompt = `ภารกิจ: คุณเป็นผู้เชี่ยวชาญด้านงานพัสดุและงบประมาณโรงเรียน หน้าที่ของคุณคือสกัด "รายชื่อโครงการ" และ "วงเงินงบประมาณที่ได้รับ" จากข้อมูลที่พบในคลังความรู้ โดยเน้นเฉพาะปีการศึกษา ${academicYear}
            
    ข้อมูลจากคลังความรู้:
    ${context}
    
    กฎเหล็ก:
    1. ตอบกลับเป็น JSON Array ของ Object เท่านั้น ห้ามมีคำอธิบายอื่น
    2. ฟิลด์ที่ต้องมี: project_name (ชื่อโครงการ), planned_amount (จำนวนเงินเป็นตัวเลข), budget_type (แหล่งเงิน เช่น งบอุดหนุน, งบรายได้)
    3. หากเป็นตัวเลขไทย ให้แปลงเป็นเลขอารบิก
    4. ห้ามใส่หน่วย "บาท" หรือเครื่องหมายคอมม่าใน planned_amount
    5. สกัดเฉพาะโครงการที่มีการระบุวงเงินชัดเจนเท่านั้น
    
    รูปแบบคำตอบ:
    [{"project_name": "...", "planned_amount": 0, "budget_type": "..."}]`;

    const maxAttempts = 3;
    let lastError: any = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const currentKey = keys[(attempt + Math.floor(Math.random() * keys.length)) % keys.length];

      for (const modelName of modelsToTry) {
        for (const version of apiVersions) {
          try {
            const url = `https://generativelanguage.googleapis.com/${version}/models/${modelName}:generateContent?key=${currentKey}`;
            const response = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { 
                  response_mime_type: "application/json",
                  temperature: 0.1
                }
              })
            });

            if (response.ok) {
              const data = await response.json();
              let aiText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
              if (!aiText) continue;

              aiText = aiText.replace(/```json/g, '').replace(/```/g, '').trim();
              const parsed = JSON.parse(aiText);
              return Array.isArray(parsed) ? parsed : [];
            } else {
              const data = await response.json();
              lastError = data.error || { message: `HTTP ${response.status}` };
            }
          } catch (err) {
            lastError = err;
            console.warn(`Extraction failed with ${modelName} ${version}:`, err);
          }
        }
      }
      if (attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    
    return [];
  } catch (err) {
    console.error('Project extraction overall error:', err);
    return [];
  }
}

export async function extractTextFromPdf(pdfBuffer: ArrayBuffer): Promise<string> {
  try {
    const bufferCopy = pdfBuffer.slice(0);
    const loadingTask = pdfjsLib.getDocument({ data: bufferCopy });
    const pdf = await loadingTask.promise;
    let fullText = '';

    const numPages = Math.min(pdf.numPages, 5);
    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      fullText += pageText + '\n';
    }

    return fullText;
  } catch (err) {
    console.error('Text extraction error:', err);
    return "";
  }
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function getAvailableModels(apiKey: string): Promise<string[]> {
  const keys = getApiKeyList(apiKey);
  if (keys.length === 0) return [];
  
  // โมเดลหลักทางการของ Google Gemini API ที่เสถียรและโควตาสูงสุดสำหรับสกัดข้อความและ OCR (Flash family)
  const RECOMMENDED_MODELS = [
    'gemini-3.5-flash',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-3.5-flash-lite',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-3.8-flash',
    'gemini-3.1-flash-lite'
  ];
  
  for (const key of keys) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
      if (response.ok) {
        const data = await response.json();
        const apiModels: string[] = (data.models || [])
          .filter((m: any) => {
            const name = (m.name || '').replace('models/', '').toLowerCase();
            const methods: string[] = m.supportedGenerationMethods || [];
            // ต้องรองรับ generateContent สำหรับสร้างข้อความ
            if (!methods.includes('generateContent')) return false;
            // กรองโมเดลเฉพาะทาง เช่น tts, audio, image, vision, realtime, embedding ออกทั้งหมด
            if (name.includes('tts') || name.includes('audio') || name.includes('image') || 
                name.includes('vision') || name.includes('realtime') || name.includes('embedding') ||
                name.includes('custom') || name.includes('robotics')) {
              return false;
            }
            return name.startsWith('gemini');
          })
          .map((m: any) => m.name.replace('models/', ''));
        
        // คัดกรองเฉพาะโมเดลแนะนำที่มีอยู่ในสิทธิ์การใช้งาน
        const available = RECOMMENDED_MODELS.filter(m => apiModels.includes(m));
        if (available.length > 0) {
          return available;
        }

        // หากไม่มีตัวแนะนำเลย ให้เลือกเฉพาะตัวที่รองรับ generateContent
        if (apiModels.length > 0) {
          return apiModels.slice(0, 3);
        }
      }
    } catch (e) {
      console.error(`List models error with key ${key.slice(0, 8)}...:`, e);
    }
  }
  return RECOMMENDED_MODELS;
}

export interface DocumentInfo {
  summary: string;
  doc_number?: string;
  doc_date?: string;
  from_agency?: string;
  subject?: string;
  urgency?: string;
  action_deadline?: string;
  suggested_assignee_dept?: string;
}

export async function summarizeDocument(pdfBuffer: ArrayBuffer, apiKey?: string): Promise<DocumentInfo> {
  const extractedText = await extractTextFromPdf(pdfBuffer);
  const hasExtractedText = extractedText.trim().length > 100;

  if (apiKey) {
    const keys = getApiKeyList(apiKey);
    if (keys.length > 0) {
      let modelsToTry = await getAvailableModels(apiKey);
      if (modelsToTry.length === 0) {
        modelsToTry = [
          "gemini-3.5-flash",
          "gemini-2.5-flash",
          "gemini-2.0-flash",
          "gemini-3.5-flash-lite",
          "gemini-2.5-flash-lite",
          "gemini-flash-lite-latest"
        ];
      }

      const apiVersions = ["v1beta"];

      const prompt = `คุณคือผู้ช่วยงานสารบรรณโรงเรียน จงวิเคราะห์หนังสือราชการนี้และสกัดข้อมูลออกมาเป็น JSON format เท่านั้น โดยมีฟิลด์ดังนี้:
      {
        "doc_number": "เลขที่หนังสือที่ปรากฏในต้นฉบับ เช่น ศธ 04xxx/xxx หรือ ที่ 29/2569",
        "doc_date": "วันที่ในหนังสือต้นฉบับในรูปแบบ YYYY-MM-DD (ค.ศ.)",
        "from_agency": "ชื่อหน่วยงานเจ้าของหนังสือ/ผู้ส่ง",
        "subject": "ชื่อเรื่องของหนังสือ",
        "urgency": "ปกติ หรือ ด่วน หรือ ด่วนมาก หรือ ด่วนที่สุด",
        "summary": "สรุปสาระสำคัญสั้นๆ 1-2 ประโยค ระบุวัตถุประสงค์ เจตนา และสิ่งที่ต้องดำเนินการ (ห้ามตอบว่าไม่มีเนื้อหา ให้สรุปจากเจตนาของเรื่องเสมอ)",
        "action_deadline": "วันที่ต้องส่งงาน/วันจัดกิจกรรม/หมดเขต ในรูปแบบ YYYY-MM-DD (ค.ศ.) หากไม่พบให้ใส่ null",
        "suggested_assignee_dept": "ฝ่ายที่ควรรับผิดชอบ เช่น งานวิชาการ, งานบริหารงานบุคคล, งานงบประมาณและแผน, งานบริหารทั่วไป, กิจการนักเรียน"
      }
      ตอบกลับเฉพาะ JSON ล้วนๆ ห้ามมีข้อความอื่นนอก JSON`;

      const maxAttempts = 3;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const currentKey = keys[(attempt + Math.floor(Math.random() * keys.length)) % keys.length];

        for (const modelName of modelsToTry) {
          for (const version of apiVersions) {
            try {
              const url = `https://generativelanguage.googleapis.com/${version}/models/${modelName}:generateContent?key=${currentKey}`;
              
              let contents: any[] = [];
              if (hasExtractedText) {
                contents = [{ parts: [{ text: `${prompt}\n\nเนื้อหาหนังสือ:\n${extractedText}` }] }];
              } else {
                const base64Pdf = toBase64(pdfBuffer);
                contents = [{
                  parts: [
                    { inline_data: { mime_type: "application/pdf", data: base64Pdf } },
                    { text: prompt }
                  ]
                }];
              }

              const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                  contents,
                  generationConfig: { response_mime_type: "application/json" }
                })
              });

              if (response.ok) {
                const data = await response.json();
                const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
                if (aiText) {
                  try {
                    return JSON.parse(aiText);
                  } catch (parseErr) {
                    console.warn('AI returned non-JSON, trying to fix...', aiText);
                    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
                    if (jsonMatch) return JSON.parse(jsonMatch[0]);
                  }
                }
              }
            } catch (err: any) {
              // Silent fail
            }
          }
        }
        if (attempt < maxAttempts - 1) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        }
      }
    }
  }

  if (extractedText.trim().length > 0) {
    const cleanText = extractedText.replace(/\s+/g, ' ').trim();
    return { summary: cleanText.slice(0, 150) + (cleanText.length > 150 ? '...' : '') };
  }

  return { summary: 'ไม่สามารถสรุปเนื้อหาได้' };
}

export async function generateAIDraft(prompt: string, apiKey?: string): Promise<string> {
  if (!apiKey) {
    const { data } = await supabase.from('settings').select('gemini_api_key').maybeSingle();
    apiKey = data?.gemini_api_key;
  }

  if (!apiKey) throw new Error('กรุณาตั้งค่า Gemini API Key ในหน้าตั้งค่าระบบก่อนใช้งาน AI');

  const keys = getApiKeyList(apiKey);
  if (keys.length === 0) throw new Error('กรุณาตั้งค่า Gemini API Key ในหน้าตั้งค่าระบบก่อนใช้งาน AI');

  let modelsToTry = await getAvailableModels(apiKey);
  if (modelsToTry.length === 0) {
    modelsToTry = [
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
      "gemini-1.5-flash",
      "gemini-1.5-pro"
    ];
  }

  const apiVersions = ["v1beta", "v1"];
  const maxAttempts = 3;
  let lastError: any = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const currentKey = keys[(attempt + Math.floor(Math.random() * keys.length)) % keys.length];

    for (const modelName of modelsToTry) {
      for (const version of apiVersions) {
        try {
          const url = `https://generativelanguage.googleapis.com/${version}/models/${modelName}:generateContent?key=${currentKey}`;
          
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 2048,
              }
            })
          });

          const data = await response.json();
          if (response.ok) {
            return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
          } else {
            lastError = data.error || { message: `HTTP ${response.status}` };
          }
        } catch (err) {
          lastError = err;
        }
      }
    }
    if (attempt < maxAttempts - 1) {
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
  }

  const errorMsg = lastError?.message || lastError || "Unknown error";
  throw new Error(`AI ไม่สามารถร่างข้อความได้ในขณะนี้: ${errorMsg}`);
}

export async function generateEmbedding(
  text: string, 
  apiKey: string, 
  retries = 5, 
  delay = 2000
): Promise<number[]> {
  const candidateModels = ["models/text-embedding-004", "text-embedding-004"];
  const versions = ['v1beta'];
  const keys = getApiKeyList(apiKey);
  if (keys.length === 0) throw new Error("กรุณาตั้งค่า Gemini API Key");
  let lastError = "";

  for (let attempt = 0; attempt < retries; attempt++) {
    // หมุนเวียนคีย์ตามความพยายามเพื่อหลีกเลี่ยง Rate Limit
    const currentKey = keys[(attempt + Math.floor(Math.random() * keys.length)) % keys.length];
    
    for (const targetModel of candidateModels) {
      for (const version of versions) {
        try {
          const url = `https://generativelanguage.googleapis.com/${version}/${targetModel.startsWith('models/') ? targetModel : `models/${targetModel}`}:embedContent?key=${currentKey}`;
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: targetModel.startsWith('models/') ? targetModel : `models/${targetModel}`,
              content: { parts: [{ text }] }
            })
          });

          const data = await response.json();
          if (response.ok && data.embedding?.values) {
            return data.embedding.values;
          }

        lastError = data.error?.message || 'Unknown error';
        
        const isRateLimit = response.status === 429 || 
          lastError.toLowerCase().includes('quota') || 
          lastError.toLowerCase().includes('rate limit') ||
          lastError.toLowerCase().includes('resource');
          
        if (isRateLimit && attempt < retries - 1) {
          console.warn(`Rate limit on embedding. Retrying with next key in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 1.5;
          break; // Break the version loop to start next retry attempt
        }
      } catch (err: any) {
        lastError = err.message || String(err);
      }
    }
  }
}

  console.error('Embedding error after retries:', lastError);
  throw new Error(`ไม่พบโมเดลสร้างความรู้ที่รองรับ: ${lastError}`);
}

export async function processDocumentToKnowledge(
  pdfBuffer: ArrayBuffer, 
  fileName: string, 
  apiKey: string,
  onProgress?: (current: number, total: number) => void
) {
  const bufferCopy = pdfBuffer.slice(0);
  const loadingTask = pdfjsLib.getDocument({ data: bufferCopy });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;

  const chunks = [];
  const chunkSize = 1000;
  const chunkOverlap = 200;

  // 1. สกัดข้อความและแบ่ง Chunk
  for (let i = 1; i <= totalPages; i++) {
    try {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      
      let start = 0;
      while (start < pageText.length) {
        const end = start + chunkSize;
        const text = pageText.substring(start, end).trim();
        if (text.length > 10) {
          chunks.push({ text, page_number: i });
        }
        start += (chunkSize - chunkOverlap);
      }
      if (onProgress) onProgress(i, totalPages);
    } catch (e) {
      console.warn(`Error reading page ${i}:`, e);
    }
  }

  // Fallback: หากไม่พบข้อความ (อาจเป็นไฟล์สแกน) ให้ใช้ Gemini OCR แบบทีละหน้า
  if (chunks.length === 0) {
    try {
      // 1. ค้นหาโมเดล Vision ที่รองรับจริง (อัปเดตให้รองรับรุ่นใหม่)
      let visionModel = "gemini-3.5-flash"; 
      try {
        const models = await getAvailableModels(apiKey);
        const found = models.find(name => name.includes('3.5-flash') || name.includes('2.5-flash') || name.includes('2.0-flash'));
        if (found) visionModel = found;
      } catch (e) {
        console.warn("OCR: Failed to list models, using default...");
      }

      const keys = getApiKeyList(apiKey);
      if (keys.length === 0) throw new Error("กรุณาตั้งค่า Gemini API Key");

      // 2. ประมวลผลทีละ 1 หน้า เพื่อความเสถียรสูงสุด (รองรับโควตา 15 RPM)
      const apiVersions = ["v1beta"];
      
      for (let p = 1; p <= totalPages; p++) {
        let successPage = false;
        let retryCount = 0;
        const maxRetries = Math.max(5, keys.length * 2);

        // หน่วงเวลา 5 วินาที
        if (p > 1) await new Promise(r => setTimeout(r, 5000));

        while (!successPage && retryCount < maxRetries) {
          try {
            const page = await pdf.getPage(p);
            const viewport = page.getViewport({ scale: 1.0 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            
            await page.render({ canvasContext: context!, viewport, canvas }).promise;
            const base64Image = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
            
            let pageResponseText = "";
            let pageSuccess = false;
            let lastPageError = "";

            // หมุนเวียนคีย์ในแต่ละรอบความพยายามของหน้าปัจจุบัน
            const currentKey = keys[(retryCount + p - 1) % keys.length];

            for (const version of apiVersions) {
              if (pageSuccess) break;
              try {
                const url = `https://generativelanguage.googleapis.com/${version}/models/${visionModel}:generateContent?key=${currentKey}`;
                const response = await fetch(url, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    contents: [{
                      parts: [
                        { inline_data: { mime_type: "image/jpeg", data: base64Image } },
                        { text: `จงสกัดข้อความภาษาไทยทั้งหมดจากรูปภาพหน้านี้ (หน้า ${p}) ออกมาเป็น Plain Text ห้ามสรุปความ` }
                      ]
                    }]
                  })
                });

                const resData = await response.json();
                if (response.ok) {
                  pageResponseText = resData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
                  pageSuccess = true;
                } else {
                  lastPageError = resData.error?.message || `HTTP ${response.status}`;
                  if (response.status === 429) {
                    throw new Error('429');
                  }
                }
              } catch (e: any) {
                lastPageError = e.message || String(e);
                if (e.message === '429') throw e;
              }
            }

            if (pageSuccess && pageResponseText.length > 5) {
              let start = 0;
              while (start < pageResponseText.length) {
                const end = start + chunkSize;
                const chunk = pageResponseText.substring(start, end).trim();
                if (chunk.length > 5) {
                  chunks.push({ text: chunk, page_number: p });
                }
                start += (chunkSize - chunkOverlap);
              }
              successPage = true;
            } else {
              throw new Error(lastPageError || "ไม่สามารถสกัดข้อความจากภาพได้");
            }
          } catch (err: any) {
            retryCount++;
            if (retryCount >= maxRetries) throw err;
            if (err.message === '429') {
              const backoffDelay = Math.min(60000, 3000 * Math.pow(2, retryCount - 1) + Math.random() * 1000);
              if (keys.length > 1) {
                console.warn(`OCR: Rate limit 429 hit. Swapping key. Retrying page ${p} in ${Math.round(backoffDelay / 1000)}s (Attempt ${retryCount}/${maxRetries})...`);
                await new Promise(r => setTimeout(r, backoffDelay));
              } else {
                console.warn(`OCR: Rate limit 429 hit. Retrying page ${p} in 60s...`);
                await new Promise(r => setTimeout(r, 60000));
              }
            } else {
              await new Promise(r => setTimeout(r, 3000));
            }
          }
        }
        if (onProgress) onProgress(p, totalPages);
      }
    } catch (ocrErr: any) {
      console.error('OCR Fallback failed:', ocrErr);
      throw new Error(`ระบบ OCR ขัดข้อง: ${ocrErr.message}`);
    }
  }

  if (chunks.length === 0) throw new Error('ไม่พบเนื้อหาที่เป็นข้อความในไฟล์นี้');

  // 2. ดึง User ครั้งเดียว
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('กรุณาเข้าสู่ระบบก่อนดำเนินการ');

  // 3. บันทึก
  const batchSize = 2;
  let successCount = 0;
  let lastError = "";

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const promises = batch.map(async (chunk) => {
      try {
        const embedding = await generateEmbedding(chunk.text, apiKey);
        const { error } = await supabase.from('school_knowledge').insert([{
          document_name: fileName,
          page_number: chunk.page_number,
          chunk_text: chunk.text,
          embedding: embedding,
          created_by: user.id
        }]);
        if (!error) successCount++;
        else lastError = error.message;
      } catch (err: any) { lastError = err.message; }
    });
    await Promise.all(promises);
    await new Promise(r => setTimeout(r, 1000));
  }

  if (successCount === 0) throw new Error(`ไม่สามารถจดจำข้อมูลได้: ${lastError}`);
  return successCount;
}

export function extractThaiKeywords(text: string): string[] {
  if (!text) return [];
  // ลบคำเชื่อม คำฟุ่มเฟือย ภาษาพูด
  let cleaned = text.replace(/(ขอดู|ขออ่าน|ขอรายละเอียด|ขอไฟล์|ขอหนังสือ|ขอเอกสาร|ขอข้อมูล|ขอ|ดู|หนังสือ|เรื่อง|รายละเอียด|แนวทาง|เกี่ยวกับการ|เกี่ยวกับ|การดำเนินการ|ตาม|ของ|ใน|ล่าสุด|ประจำปี|ครับ|ค่ะ|ด้วย|หน่อย)/g, ' ').trim();
  
  const keywords = new Set<string>();
  const parts = cleaned.split(/[\s,，.、?？!！]+/g).filter(w => w.length >= 2);
  
  parts.forEach(part => {
    keywords.add(part);
    // สำหรับประโยคภาษาไทยยาวๆ ที่ไม่มีเว้นวรรค แตกท่อนคำสำคัญ 4-8 อักขระ
    if (part.length > 10) {
      for (let i = 0; i <= part.length - 5; i += 4) {
        const chunk = part.substring(i, i + 6);
        if (chunk.length >= 4) keywords.add(chunk);
      }
    }
  });

  return Array.from(keywords).filter(w => w.length >= 3);
}

export async function searchKnowledge(query: string, apiKey: string, limit: number = 10) {
  try {
    // 1. ค้นหาแบบ Vector (Semantic Search)
    let vectorMatches: any[] = [];
    try {
      const queryEmbedding = await generateEmbedding(query, apiKey);
      if (queryEmbedding && queryEmbedding.length > 0) {
        const { data } = await supabase.rpc('match_knowledge', {
          query_embedding: queryEmbedding,
          match_threshold: 0.10, // ปรับ threshold ผ่อนคลายลงให้ค้นหาได้กว้างขึ้น
          match_count: limit
        });
        vectorMatches = data || [];
      }
    } catch (embErr) {
      console.warn('[SEARCH KNOWLEDGE] Vector embedding warning, falling back to keyword search:', embErr);
    }

    // 2. ค้นหาแบบ Keyword (สกัดคำสำคัญภาษาไทย)
    const extractedKw = extractThaiKeywords(query);
    const rawKeywords = query.split(/[\s,，.、?？!！]+/g).filter(w => w.length >= 2);
    const keywords = new Set<string>([...extractedKw, ...rawKeywords]);
    
    rawKeywords.forEach(kw => {
      if (kw.includes('/')) {
        keywords.add(kw.replace(/\//g, '_'));
        keywords.add(kw.split('/')[0]);
      }
      if (kw.includes('_')) {
        keywords.add(kw.replace(/_/g, '/'));
      }
    });

    let textMatches: any[] = [];
    if (keywords.size > 0) {
      const kwArray = Array.from(keywords).slice(0, 15);
      const orFilters = kwArray.map(kw => `chunk_text.ilike.%${kw}%,document_name.ilike.%${kw}%`).join(',');
      const { data } = await supabase
        .from('school_knowledge')
        .select('id, document_name, page_number, chunk_text')
        .or(orFilters)
        .limit(limit * 2);
      textMatches = data || [];
    }

    // 3. รวมผลลัพธ์และให้คะแนน
    const combined = [...(vectorMatches || []), ...textMatches.map(tm => ({ ...tm, similarity: 0.95 }))];
    const unique = combined.filter((v, i, a) => a.findIndex(t => (t.chunk_text === v.chunk_text)) === i);
    
    return unique.sort((a, b) => (b.similarity || 0) - (a.similarity || 0)).slice(0, limit);
    
  } catch (err) {
    console.error('Knowledge search error:', err);
    return [];
  }
}

export async function extractTextFromImage(imageBuffer: ArrayBuffer, apiKey: string): Promise<string> {
  try {
    const base64Image = toBase64(imageBuffer);
    const keys = getApiKeyList(apiKey);
    if (keys.length === 0) throw new Error("กรุณาตั้งค่า Gemini API Key");

    const maxAttempts = 3;
    let lastError: any = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const currentKey = keys[(attempt + Math.floor(Math.random() * keys.length)) % keys.length];
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${currentKey}`;
      
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { inline_data: { mime_type: "image/jpeg", data: base64Image } },
                { text: "สกัดข้อความทั้งหมดจากภาพนี้ออกมาเป็นข้อความธรรมดา (Plain Text) หากเป็นหนังสือราชการให้คงรูปแบบลำดับเนื้อหาไว้" }
              ]
            }]
          })
        });

        const data = await response.json();
        if (response.ok) {
          return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
        } else {
          lastError = data.error?.message || `HTTP ${response.status}`;
        }
      } catch (err) {
        lastError = err;
      }
      if (attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    console.error('Image OCR error:', lastError);
    return "";
  } catch (err) {
    console.error('Image OCR overall error:', err);
    return "";
  }
}

export async function processPrivateDocumentToKnowledge(
  pdfBuffer: ArrayBuffer,
  fileName: string,
  fileId: string,
  teacherId: string,
  apiKey: string,
  onProgress?: (current: number, total: number) => void
): Promise<number> {
  const bufferCopy = pdfBuffer.slice(0);
  const loadingTask = pdfjsLib.getDocument({ data: bufferCopy });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;

  const chunks = [];
  const chunkSize = 1000;
  const chunkOverlap = 200;

  // 1. สกัดข้อความและแบ่ง Chunk
  for (let i = 1; i <= totalPages; i++) {
    try {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      
      let start = 0;
      while (start < pageText.length) {
        const end = start + chunkSize;
        const text = pageText.substring(start, end).trim();
        if (text.length > 10) {
          chunks.push({ text, page_number: i });
        }
        start += (chunkSize - chunkOverlap);
      }
      if (onProgress) onProgress(i, totalPages);
    } catch (e) {
      console.warn(`Private: Error reading page ${i}:`, e);
    }
  }

  // Fallback OCR (หากไม่พบข้อความดึงออกมาเลย เช่น สแกน PDF)
  if (chunks.length === 0) {
    try {
      let visionModel = "gemini-3.5-flash";
      try {
        const models = await getAvailableModels(apiKey);
        const found = models.find(name => name.includes('3.5-flash') || name.includes('2.5-flash') || name.includes('2.0-flash'));
        if (found) visionModel = found;
      } catch (e) {
        console.warn("Private OCR: Failed to list models, using default...");
      }

      const keys = getApiKeyList(apiKey);
      if (keys.length === 0) throw new Error("กรุณาตั้งค่า Gemini API Key");

      const apiVersions = ["v1beta"];
      for (let p = 1; p <= totalPages; p++) {
        let successPage = false;
        let retryCount = 0;
        const maxRetries = Math.max(5, keys.length * 2);

        if (p > 1) await new Promise(r => setTimeout(r, 5000));

        while (!successPage && retryCount < maxRetries) {
          try {
            const page = await pdf.getPage(p);
            const viewport = page.getViewport({ scale: 1.0 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            
            await page.render({ canvasContext: context!, viewport, canvas }).promise;
            const base64Image = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
            
            let pageResponseText = "";
            let pageSuccess = false;
            let lastPageError = "";

            // หมุนเวียนคีย์ในแต่ละรอบความพยายามของหน้าปัจจุบัน
            const currentKey = keys[(retryCount + p - 1) % keys.length];

            for (const version of apiVersions) {
              if (pageSuccess) break;
              try {
                const url = `https://generativelanguage.googleapis.com/${version}/models/${visionModel}:generateContent?key=${currentKey}`;
                const response = await fetch(url, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    contents: [{
                      parts: [
                        { inline_data: { mime_type: "image/jpeg", data: base64Image } },
                        { text: `จงสกัดข้อความภาษาไทยทั้งหมดจากรูปภาพหน้านี้ (หน้า ${p}) ออกมาเป็น Plain Text ห้ามสรุปความ` }
                      ]
                    }]
                  })
                });

                const resData = await response.json();
                if (response.ok) {
                  pageResponseText = resData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
                  pageSuccess = true;
                } else {
                  lastPageError = resData.error?.message || `HTTP ${response.status}`;
                  if (response.status === 429) {
                    throw new Error('429');
                  }
                }
              } catch (e: any) {
                lastPageError = e.message || String(e);
                if (e.message === '429') throw e;
              }
            }

            if (pageSuccess && pageResponseText.length > 5) {
              let start = 0;
              while (start < pageResponseText.length) {
                const end = start + chunkSize;
                const chunk = pageResponseText.substring(start, end).trim();
                if (chunk.length > 5) {
                  chunks.push({ text: chunk, page_number: p });
                }
                start += (chunkSize - chunkOverlap);
              }
              successPage = true;
            } else {
              throw new Error(lastPageError || "ไม่สามารถสกัดข้อความจากภาพได้");
            }
          } catch (err: any) {
            retryCount++;
            if (retryCount >= maxRetries) throw err;
            if (err.message === '429') {
              const backoffDelay = Math.min(60000, 3000 * Math.pow(2, retryCount - 1) + Math.random() * 1000);
              if (keys.length > 1) {
                console.warn(`Private OCR: Rate limit 429 hit. Swapping key. Retrying page ${p} in ${Math.round(backoffDelay / 1000)}s (Attempt ${retryCount}/${maxRetries})...`);
                await new Promise(r => setTimeout(r, backoffDelay));
              } else {
                console.warn(`Private OCR: Rate limit 429 hit. Retrying page ${p} in 60s...`);
                await new Promise(r => setTimeout(r, 60000));
              }
            } else {
              await new Promise(r => setTimeout(r, 3000));
            }
          }
        }
        if (onProgress) onProgress(p, totalPages);
      }
    } catch (ocrErr: any) {
      console.error('Private OCR Fallback failed:', ocrErr);
      throw new Error(`ระบบ OCR ขัดข้อง: ${ocrErr.message}`);
    }
  }

  if (chunks.length === 0) throw new Error('ไม่พบเนื้อหาที่เป็นข้อความในไฟล์ส่วนตัวนี้');

  // 2. บันทึกลงตาราง ai_private_knowledge_chunks
  const batchSize = 2;
  let successCount = 0;
  let lastError = "";

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const promises = batch.map(async (chunk) => {
      try {
        const embedding = await generateEmbedding(chunk.text, apiKey);
        const { error } = await supabase.from('ai_private_knowledge_chunks').insert([{
          file_id: fileId,
          teacher_id: teacherId,
          page_number: chunk.page_number,
          chunk_text: chunk.text,
          embedding: embedding
        }]);
        if (!error) successCount++;
        else lastError = error.message;
      } catch (err: any) {
        lastError = err.message;
      }
    });
    await Promise.all(promises);
    await new Promise(r => setTimeout(r, 1000));
  }

  if (successCount === 0) throw new Error(`ไม่สามารถจดจำข้อมูลคลังส่วนตัวได้: ${lastError}`);
  return successCount;
}

export async function searchPrivateKnowledge(
  query: string,
  teacherId: string,
  apiKey: string,
  limit: number = 10
) {
  try {
    // 0. ดึงรายชื่อไฟล์ทั้งหมดของครูท่านนี้เพื่อทำ Map แปลง file_id เป็นชื่อไฟล์ในภายหลัง
    const { data: fileList } = await supabase
      .from('ai_knowledge_base')
      .select('id, file_name')
      .eq('teacher_id', teacherId);
    const fileMap = new Map(fileList?.map(f => [f.id, f.file_name]) || []);

    // 1. ค้นหาแบบ Vector (Semantic Search)
    let vectorMatches: any[] = [];
    try {
      const queryEmbedding = await generateEmbedding(query, apiKey);
      if (queryEmbedding && queryEmbedding.length > 0) {
        const { data: vMatches, error: rpcErr } = await supabase.rpc('match_private_knowledge', {
          query_embedding: queryEmbedding,
          match_threshold: 0.15,
          match_count: limit,
          p_teacher_id: teacherId
        });

        if (rpcErr) {
          console.warn('match_private_knowledge RPC Warning:', rpcErr.message);
        } else {
          vectorMatches = vMatches || [];
        }
      }
    } catch (embErr) {
      console.warn('[SEARCH PRIVATE KNOWLEDGE] Vector embedding warning, falling back to keywords:', embErr);
    }

    // 2. ค้นหาแบบ Keyword Search
    const rawKeywords = query.split(/[\s,，.、?？!！]+/g).filter(w => w.length >= 2);
    const keywords = new Set<string>(rawKeywords);
    
    rawKeywords.forEach(kw => {
      if (kw.includes('/')) {
        keywords.add(kw.replace(/\//g, '_'));
        keywords.add(kw.split('/')[0]);
      }
      if (kw.includes('_')) {
        keywords.add(kw.replace(/_/g, '/'));
      }
    });

    let textMatches: any[] = [];
    if (keywords.size > 0) {
      const kwArray = Array.from(keywords);
      const orFilters = kwArray.map(kw => `chunk_text.ilike.%${kw}%`).join(',');
      const { data, error: kwErr } = await supabase
        .from('ai_private_knowledge_chunks')
        .select('id, file_id, page_number, chunk_text')
        .eq('teacher_id', teacherId)
        .or(orFilters)
        .limit(limit);
      
      if (kwErr) {
        console.error('Private Keyword Search Error:', kwErr.message);
      }
      textMatches = data || [];
    }

    // 3. รวมผลลัพธ์และจัดเรียงตามความคล้ายคลึง
    const combined = [
      ...(vectorMatches || []).map((vm: any) => ({
        id: vm.id,
        file_id: vm.file_id,
        document_name: fileMap.get(vm.file_id) || 'ไฟล์ส่วนตัว',
        page_number: vm.page_number,
        chunk_text: vm.chunk_text,
        similarity: vm.similarity
      })),
      ...textMatches.map(tm => ({
        id: tm.id,
        file_id: tm.file_id,
        document_name: fileMap.get(tm.file_id) || 'ไฟล์ส่วนตัว',
        page_number: tm.page_number,
        chunk_text: tm.chunk_text,
        similarity: 0.95
      }))
    ];

    const unique = combined.filter((v, i, a) => a.findIndex(t => t.chunk_text === v.chunk_text) === i);
    
    return unique.sort((a, b) => (b.similarity || 0) - (a.similarity || 0)).slice(0, limit);
  } catch (err) {
    console.error('Private Knowledge search error:', err);
    return [];
  }
}
