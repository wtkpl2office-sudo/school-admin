import { createClient } from '@supabase/supabase-js';
import { waitUntil } from '@vercel/functions';

declare const process: any;

/** HTML escape ป้องกัน Error ใน Telegram HTML mode */
function escapeHtml(str: string): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** แปลงเลขไทย → เลขอารบิก เพื่อ standardize เลขที่หนังสือก่อนบันทึกทุกครั้ง */
function toArabicNumerals(str: string): string {
  if (!str) return str;
  return str.replace(/[๐-๙]/g, d => '๐๑๒๓๔๕๖๗๘๙'.indexOf(d).toString());
}

/** Helper: แปลง URL ของ Google Drive ให้เป็น Direct Download Link สำหรับดาวน์โหลด Binary */
function getDirectDownloadUrl(url: string): string {
  if (!url) return '';
  if (url.includes('drive.google.com')) {
    const match1 = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    const match2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    const fileId = match1?.[1] || match2?.[1];
    if (fileId) {
      return `https://drive.google.com/uc?export=download&id=${fileId}`;
    }
  }
  return url;
}

function getSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment variables.');
  }
  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

/** ฟังก์ชันเรียก Gemini API พร้อม Fallback โมเดลที่ถูกต้องและเร็วที่สุด */
async function callGemini(
  system: string, 
  user: string, 
  apiKey: string, 
  inlineImageData?: { mimeType: string, data: string }
): Promise<string> {
  // รองรับโมเดลทางการของ Google Gemini ล่าสุดตามลำดับความสามารถและความเร็ว
  const models = [
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash",
    "gemini-1.5-pro"
  ];
  
  for (const model of models) {
    try {
      const parts: any[] = [];
      if (inlineImageData) {
        parts.push({
          inlineData: {
            mimeType: inlineImageData.mimeType,
            data: inlineImageData.data
          }
        });
      }
      parts.push({ text: user });

      // กำหนด Timeout 8 วินาทีต่อคำขอ เพื่อไม่ให้ Serverless Function ค้าง
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ parts }],
          generationConfig: { 
            temperature: 0.1, 
            maxOutputTokens: 2500,
            responseMimeType: "application/json"
          }
        })
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json() as any;
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return text;
      }
    } catch (e) {
      console.warn(`[OCR PROCESS] Gemini error on model ${model}:`, e);
    }
  }
  return "";
}

/** ฟังก์ชันส่ง Telegram Message พร้อม fallback plain text เมื่อ entity parse error */
async function sendTelegramMessage(botToken: string, chatId: number | string, text: string, replyMarkup?: any) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.substring(0, 4000),
        parse_mode: 'HTML',
        reply_markup: replyMarkup
      }),
    });

    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      // หากเกิด HTML parse error ให้ส่งแบบ Clean Plain text ทันที
      if (err?.description?.includes("can't parse entities")) {
        const cleanText = text.replace(/<[^>]+>/g, '').substring(0, 4000);
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: cleanText,
            reply_markup: replyMarkup
          }),
        });
      }
    }
  } catch (tgErr) {
    console.warn('[OCR PROCESS] Telegram send warning:', tgErr);
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

export default async function handler(req: any, res?: any): Promise<any> {
  const sendJson = (status: number, data: any) => {
    if (res && typeof res.status === 'function') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      return res.status(status).json(data);
    }
    return new Response(JSON.stringify(data), { 
      status, 
      headers: corsHeaders 
    });
  };

  // 1. รองรับ CORS Preflight
  if (req.method === 'OPTIONS') {
    if (res && typeof res.status === 'function') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      return res.status(204).end();
    }
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return sendJson(405, { message: 'Method not allowed' });
  }

  // 2. Parse Request Body แบบ Universal
  let body: any = {};
  try {
    if (req.body && typeof req.body === 'object') {
      body = req.body;
    } else if (typeof req.json === 'function') {
      body = await req.json();
    } else if (typeof req.body === 'string') {
      body = JSON.parse(req.body);
    }
  } catch (e) {
    console.warn('[OCR PROCESS] Body parsing warning:', e);
    body = {};
  }

  const processTask = async () => {
    const { docId, fileUrl, silent = false } = body || {};
    if (!docId || !fileUrl) return;

    let supabase: any = null;
    let botToken: string | undefined = undefined;

    try {
      supabase = getSupabase();

      // 1. ดึงข้อมูล Settings & Teachers (Rule C: ไม่ระบุ school_id)
      const { data: settings } = await supabase
        .from('settings')
        .select('school_name, telegram_bot_token, telegram_group_id, gemini_api_key, ai_cowork_api_key, current_academic_year, google_vision_api_key')
        .limit(1)
        .maybeSingle();

      if (!settings) return;
      const rawApiKey = settings.ai_cowork_api_key || settings.gemini_api_key || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
      const apiKey = rawApiKey.split(',')[0].trim();
      botToken = settings.telegram_bot_token;

      // ดึงรายชื่อครูเพื่อแมตช์ผู้รับมอบหมาย
      const { data: teachers } = await supabase
        .from('teachers')
        .select('id, prefix, first_name, last_name, position, department')
        .eq('status', 'active');

      const teachersListStr = (teachers || []).map((t: any) =>
        `- ${t.prefix || ''}${t.first_name} ${t.last_name} (ฝ่าย: ${t.department || 'ไม่ระบุ'})`
      ).join('\n');

      // 2. ดาวน์โหลดไฟล์เอกสารเพื่อนำมาทำ OCR (พร้อม Timeout 7 วินาที)
      let inlineImageData: { mimeType: string, data: string } | undefined = undefined;
      const directDownloadUrl = getDirectDownloadUrl(fileUrl);
      
      const fileController = new AbortController();
      const fileTimeout = setTimeout(() => fileController.abort(), 7000);

      const fileRes = await fetch(directDownloadUrl, { signal: fileController.signal });
      clearTimeout(fileTimeout);

      if (!fileRes.ok) {
        console.error('[OCR PROCESS] Failed to download document binary');
        return;
      }

      const arrayBuffer = await fileRes.arrayBuffer();
      const base64Data = Buffer.from(arrayBuffer).toString('base64');
      const isPdf = fileUrl.toLowerCase().endsWith('.pdf') || (fileRes.headers.get('content-type') || '').includes('pdf');
      const mimeType = isPdf ? 'application/pdf' : 'image/jpeg';
      inlineImageData = { mimeType, data: base64Data };

      // 3. Single-Pass Multimodal Extraction: สกัดทั้ง Text ฉบับเต็ม และ Metadata JSON ในรอบเดียว!
      const systemPrompt = `คุณคือผู้เชี่ยวชาญสารบรรณอิเล็กทรอนิกส์และ OCR เอกสารราชการไทย
หน้าที่ของคุณคืออ่านเอกสารที่ได้รับ และตอบกลับเป็น JSON เท่านั้น โดยมีโครงสร้างดังนี้:
{
  "extracted_text": "เนื้อหาทั้งหมดที่อ่านได้จากเอกสาร (รักษารูปแบบ Markdown และหัวข้อ)",
  "doc_number": "เลขที่หนังสือของผู้ส่ง เช่น ศธ 04225/2666 หรือ ที่ 29/2569 (ถ้าไม่มีให้ใส่ null)",
  "subject": "ชื่อเรื่องของหนังสือ (สกัดจาก 'เรื่อง:' หรือสาระสำคัญ ห้ามใช้ชื่อหน่วยงานหรือหัวกระดาษ)",
  "from_agency": "ชื่อหน่วยงานผู้ส่ง (สกัดจาก 'จาก:' หรือหัวจดหมาย)",
  "doc_date": "วันที่หนังสือในรูปแบบ YYYY-MM-DD (ถ้าไม่ทราบให้ใส่ null)",
  "urgency": "ปกติ หรือ ด่วน หรือ ด่วนมาก หรือ ด่วนที่สุด",
  "summary": "สรุปสาระสำคัญของหนังสือ 1-2 ประโยค ระบุวัตถุประสงค์และสิ่งที่ต้องดำเนินการ",
  "action_deadline": "วันที่ต้องส่งงาน/หมดเขต ในรูปแบบ YYYY-MM-DDTHH:mm:ssZ (ถ้าไม่มีใส่ null)",
  "suggested_assignee_name": "ชื่อ-นามสกุลครูจากรายชื่อที่เหมาะสมที่สุดในการรับผิดชอบงานนี้",
  "suggested_assignee_dept": "ฝ่ายที่ควรรับผิดชอบ เช่น งานวิชาการ, งานบริหารงานบุคคล, งานงบประมาณและแผน, งานบริหารทั่วไป, กิจการนักเรียน"
}

รายชื่อครูและบุคลากรในโรงเรียนสำหรับพิจารณา:
${teachersListStr}
`;

      const userPrompt = "โปรดอ่านเอกสารฉบับนี้ แล้วสกัดข้อมูลสำคัญทั้งหมดตามโครงสร้าง JSON ที่กำหนดอย่างละเอียดถูกต้อง";
      const aiResponseJson = await callGemini(systemPrompt, userPrompt, apiKey, inlineImageData);

      let parsedInfo: any = {};
      try {
        const jsonMatch = aiResponseJson.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsedInfo = JSON.parse(jsonMatch[0]);
      } catch (e) {
        console.error('[OCR PROCESS] JSON parse error:', e);
      }

      const extractedText = parsedInfo.extracted_text || '';

      // Phase 2: Fuzzy Matching หาครูที่ตรงจาก suggested_assignee_name / dept
      let matchedTeacher: any = null;
      if (teachers && teachers.length > 0) {
        const suggestedName = (parsedInfo.suggested_assignee_name || '').toLowerCase().trim();
        const suggestedDept = (parsedInfo.suggested_assignee_dept || '').toLowerCase().trim();

        if (suggestedName) {
          matchedTeacher = teachers.find((t: any) => {
            const firstName = (t.first_name || '').toLowerCase();
            const lastName = (t.last_name || '').toLowerCase();
            const fullName = `${t.prefix || ''}${t.first_name} ${t.last_name}`.toLowerCase();
            return fullName.includes(suggestedName) ||
                   suggestedName.includes(firstName) ||
                   suggestedName.includes(lastName);
          }) || null;
        }

        if (!matchedTeacher && suggestedDept) {
          matchedTeacher = teachers.find((t: any) => {
            const dept = (t.department || '').toLowerCase();
            return dept && (suggestedDept.includes(dept) || dept.includes(suggestedDept));
          }) || null;
        }
      }

      // 4. ดึงข้อมูลเดิมของ incoming_docs
      const { data: currentDoc } = await supabase.from('incoming_docs')
        .select('remark, subject, from_agency, doc_number').eq('id', docId).single();
      
      let existingRemarkObj: any = {};
      if (currentDoc?.remark) {
        try {
          existingRemarkObj = typeof currentDoc.remark === 'string' && currentDoc.remark.startsWith('{') 
            ? JSON.parse(currentDoc.remark) 
            : { summary_text: currentDoc.remark };
        } catch (e) {
          existingRemarkObj = { summary_text: currentDoc.remark };
        }
      }

      // เก็บเลขที่หนังสือผู้ส่ง และสรุป AI อย่างปลอดภัย
      if (parsedInfo.doc_number) {
        const arabicDocNum = toArabicNumerals(parsedInfo.doc_number);
        if (!existingRemarkObj.sender_doc_number) {
          existingRemarkObj.sender_doc_number = arabicDocNum;
        } else {
          existingRemarkObj.ocr_doc_number = arabicDocNum;
        }
      }

      if (parsedInfo.summary) {
        existingRemarkObj.ai_summary = parsedInfo.summary;
        if (!existingRemarkObj.proposal_summary) {
          existingRemarkObj.proposal_summary = parsedInfo.summary;
        }
      }

      const updatePayload: any = {
        extracted_text: extractedText,
        auto_processed_at: new Date().toISOString(),
        ai_status: 'success',
        remark: JSON.stringify(existingRemarkObj)
      };

      if (parsedInfo.subject && (!currentDoc?.subject || currentDoc.subject === 'หนังสือรับ' || currentDoc.subject === '-' || currentDoc.subject === '')) {
        updatePayload.subject = parsedInfo.subject;
      }
      if (parsedInfo.from_agency && (!currentDoc?.from_agency || currentDoc.from_agency === '-' || currentDoc.from_agency === '')) {
        updatePayload.from_agency = parsedInfo.from_agency;
      }
      if (parsedInfo.doc_date) updatePayload.doc_date = parsedInfo.doc_date;
      if (parsedInfo.urgency) updatePayload.urgency = parsedInfo.urgency;
      if (parsedInfo.action_deadline) updatePayload.action_deadline = parsedInfo.action_deadline;
      if (matchedTeacher) updatePayload.suggested_assignee_id = matchedTeacher.id;

      await supabase
        .from('incoming_docs')
        .update(updatePayload)
        .eq('id', docId);

      // 5. บันทึกเข้า RAG Knowledge Base (`school_knowledge`) แบบ Batch Upsert ในคราวเดียว!
      if (extractedText) {
        const docSubject = parsedInfo.subject || currentDoc?.subject || 'หนังสือรับ';
        const chunkSize = 1500;
        const knowledgeRows = [];

        for (let i = 0; i < extractedText.length; i += chunkSize) {
          knowledgeRows.push({
            document_name: `[หนังสือรับ] ${docSubject} (ส่วน ${Math.floor(i / chunkSize) + 1})`,
            chunk_text: extractedText.substring(i, i + chunkSize),
            source_doc_id: docId,
            source_type: 'incoming_doc'
          });
        }

        if (knowledgeRows.length > 0) {
          await supabase.from('school_knowledge').upsert(knowledgeRows, { onConflict: 'document_name' });
        }
      }

      // 6. แจ้งเตือนเข้า Telegram ผอ. / กลุ่ม (ข้ามเมื่อ silent = true เพื่อไม่ให้แจ้งเตือนซ้ำ)
      if (botToken && !silent) {
        let aiConfidence = 0;
        if (parsedInfo.doc_number) aiConfidence++;
        if (parsedInfo.subject) aiConfidence++;
        if (parsedInfo.summary) aiConfidence++;
        if (parsedInfo.action_deadline) aiConfidence++;
        if (matchedTeacher) aiConfidence++;
        const totalFields = 5;

        const suggestedTeacherName = matchedTeacher
          ? `${matchedTeacher.prefix || ''}${matchedTeacher.first_name} ${matchedTeacher.last_name}`
          : '';

        const displaySubject = updatePayload.subject || currentDoc?.subject || parsedInfo.subject || 'ไม่ระบุ';
        const proposalSummary = existingRemarkObj.proposal_summary || '';

        let notifyMsg = `📄 <b>สแกนอ่านหนังสือรับสำเร็จเรียบร้อย!</b>\n\n`;
        notifyMsg += `📌 <b>เลขรับที่:</b> <code>${escapeHtml(currentDoc?.doc_number || '-')}</code>\n`;
        notifyMsg += `<b>เรื่อง:</b> ${escapeHtml(displaySubject)}\n`;
        notifyMsg += `<b>เลขที่หนังสือ (ผู้ส่ง):</b> ${escapeHtml(toArabicNumerals(parsedInfo.doc_number || '') || '-')}\n`;
        
        if (proposalSummary) {
          notifyMsg += `📝 <b>เนื้อหาที่เสนอ:</b> ${escapeHtml(proposalSummary)}\n`;
        }
        notifyMsg += `\n`;
        notifyMsg += `<b>สรุปสาระสำคัญ (AI):</b> ${parsedInfo.summary ? `"${escapeHtml(parsedInfo.summary)}"` : '<i>(วิเคราะห์ไม่ได้)</i>'}\n`;
        
        if (parsedInfo.action_deadline) {
          const deadlineDate = new Date(parsedInfo.action_deadline).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
          notifyMsg += `⏰ <b>กำหนดการดำเนินการ:</b> <u>${deadlineDate}</u>\n`;
        } else {
          notifyMsg += `⏰ <b>กำหนดการดำเนินการ:</b> <i>(ไม่พบในเอกสาร)</i>\n`;
        }

        if (suggestedTeacherName) {
          notifyMsg += `🧑‍🏫 <b>ครูผู้รับงานที่ AI แนะนำ:</b> <b>${escapeHtml(suggestedTeacherName)}</b>\n`;
        } else if (parsedInfo.suggested_assignee_dept) {
          notifyMsg += `🧑‍🏫 <b>ครูผู้รับงานที่ AI แนะนำ:</b> <i>(ฝ่ายที่ควรรับ: ${escapeHtml(parsedInfo.suggested_assignee_dept)})</i>\n`;
        } else {
          notifyMsg += `🧑‍🏫 <b>ครูผู้รับงานที่ AI แนะนำ:</b> <i>(กรุณาเลือกด้วยตนเอง)</i>\n`;
        }
        notifyMsg += `\n🤖 <i>AI วิเคราะห์ได้ ${aiConfidence}/${totalFields} ฟิลด์</i>`;

        const inlineButtons: any[] = [];
        if (matchedTeacher) {
          inlineButtons.push([{
            text: `✅ มอบหมาย ${suggestedTeacherName} ทันที`,
            callback_data: `action=sm_asg&id=${docId}`
          }]);
        }
        inlineButtons.push([{
          text: `✍️ เลือกครูท่านอื่น / ระบุคำสั่งเอง`,
          callback_data: `action=start_assign&id=${docId}`
        }]);

        // ส่งให้ ผอ. ส่วนตัว
        const { data: directors } = await supabase.from('profiles').select('telegram_chat_id').eq('role', 'director');
        if (directors) {
          for (const dir of directors) {
            if (dir.telegram_chat_id) {
              await sendTelegramMessage(botToken, dir.telegram_chat_id, notifyMsg, { inline_keyboard: inlineButtons });
            }
          }
        }

        // Rule B: ส่งเข้ากลุ่มเสนอหนังสือ
        const rawGroupId = settings.telegram_group_id || '';
        const proposalGroupId = rawGroupId.split('|')[1]?.trim() || rawGroupId.split('|')[0]?.trim();
        if (proposalGroupId) {
          await sendTelegramMessage(botToken, proposalGroupId, notifyMsg, { inline_keyboard: inlineButtons });
        }
      }

    } catch (err: any) {
      console.error('[OCR PROCESS ERROR]', err);
      try {
        await supabase.from('incoming_docs').update({ ai_status: 'failed' }).eq('id', docId);
        if (botToken && !silent) {
          const { data: admins } = await supabase.from('profiles').select('telegram_chat_id').in('role', ['admin', 'director']);
          if (admins) {
            for (const adm of admins) {
              if (adm.telegram_chat_id) {
                const alertMsg = `⚠️ <b>แจ้งเตือนข้อผิดพลาด OCR</b>\n\nเกิดข้อผิดพลาดขณะวิเคราะห์เอกสาร ID: <code>${docId}</code>\n❌ <b>รายละเอียด:</b> ${escapeHtml(err.message || 'Unknown error')}`;
                await sendTelegramMessage(botToken, parseInt(adm.telegram_chat_id), alertMsg);
              }
            }
          }
        }
      } catch (alertErr) {
        console.error('[OCR ALERT ERROR]', alertErr);
      }
    }
  };

  try {
    waitUntil(processTask());
  } catch (waitUntilErr) {
    console.warn('[OCR PROCESS] waitUntil fallback:', waitUntilErr);
    processTask().catch(e => console.error('[DETACHED OCR TASK ERROR]', e));
  }

  return sendJson(200, {
    ok: true,
    message: 'เริ่มต้นประมวลผล OCR และความจำ RAG เรียบร้อยแล้ว'
  });
}


