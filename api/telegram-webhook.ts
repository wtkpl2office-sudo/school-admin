declare const process: any;
import { createClient } from '@supabase/supabase-js';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fs from 'fs';
import path from 'path';
import { waitUntil } from '@vercel/functions';

// ============================================================
// Telegram Bot Webhook API
// รับ Webhook จาก Telegram เพื่อผูกบัญชีครูรายบุคคลและตอบกลับทั่วไป
// URL Webhook: https://your-domain.vercel.app/api/telegram-webhook?school_id=uuid
// ============================================================

/** ส่งข้อความกลับหาผู้ใช้ทาง Telegram Bot API */
async function sendTelegramMessage(botToken: string, chatId: number, text: string, replyMarkup?: any) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  
  // Telegram จำกัดข้อความสูงสุด 4096 ตัวอักษร หากยาวเกินให้ตัดแบ่งเป็นส่วนๆ เพื่อความปลอดภัย
  if (text && text.length > 4000) {
    const chunks: string[] = [];
    let temp = text;
    while (temp.length > 0) {
      if (temp.length <= 4000) {
        chunks.push(temp);
        break;
      }
      let chunk = temp.substring(0, 4000);
      const lastNewLine = chunk.lastIndexOf('\n');
      if (lastNewLine > 3000) {
        chunk = temp.substring(0, lastNewLine);
      }
      chunks.push(chunk);
      temp = temp.substring(chunk.length);
    }
    
    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      const chunkText = chunks[i] + (isLast ? '' : '\n\n<b>(มีต่อ...)</b>');
      await sendTelegramMessageSingle(botToken, chatId, chunkText, isLast ? replyMarkup : undefined);
    }
    return;
  }

  return sendTelegramMessageSingle(botToken, chatId, text, replyMarkup);
}

/** ฟังก์ชันสำหรับส่งข้อความเดี่ยวของ Telegram พร้อม retry 429 และ fallback plain text */
async function sendTelegramMessageSingle(botToken: string, chatId: number, text: string, replyMarkup?: any, attempt = 1): Promise<any> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as any;
      console.error(`[TELEGRAM SEND MESSAGE ERROR] HTTP ${resp.status}`, err);

      // กรณี Rate Limit 429: ถ้า retry_after สั้น (<= 5 วิ) ให้รอแล้วลองส่งใหม่อัตโนมัติ
      if (resp.status === 429 && attempt <= 2) {
        const retryAfter = Number(err?.parameters?.retry_after || 3);
        if (retryAfter <= 5) {
          console.warn(`[TELEGRAM WEBHOOK] Rate limit 429 encountered, waiting ${retryAfter}s before retry (attempt ${attempt})...`);
          await new Promise(r => setTimeout(r, (retryAfter * 1000) + 300));
          return sendTelegramMessageSingle(botToken, chatId, text, replyMarkup, attempt + 1);
        } else {
          console.warn(`[TELEGRAM WEBHOOK] Rate limit 429 cooldown is too long (${retryAfter}s), skipping retry to prevent timeout.`);
        }
      }

      // กรณี BUTTON_DATA_INVALID หรือ BUTTON_URL_INVALID: ส่งซ้ำโดยตัดปุ่มที่มีปัญหาออก เพื่อไม่ให้ข้อความแจ้งเตือนตกหล่น
      if (err?.description && (err.description.includes('BUTTON_DATA_INVALID') || err.description.includes('BUTTON_URL_INVALID')) && replyMarkup) {
        console.warn('[TELEGRAM FALLBACK] Invalid button markup detected, retrying without replyMarkup...');
        return sendTelegramMessageSingle(botToken, chatId, text, undefined, attempt + 1);
      }

      // หากพังเพราะ HTML formatting ให้ถอยกลับไปส่งแบบข้อความทั่วไป (Plain Text)
      if (err?.description && (err.description.includes('entities') || err.description.includes('HTML') || err.description.includes('bad request'))) {
        console.warn('[TELEGRAM FALLBACK] Sending plain text message because HTML parsing failed');
        const plainText = text.replace(/<\/?[^>]+(>|$)/g, ""); // ล้าง HTML Tags ออก
        return fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: plainText,
            reply_markup: replyMarkup
          }),
        });
      }
    }
    return resp;
  } catch (fetchErr) {
    console.error('[TELEGRAM FETCH EXCEPTION]', fetchErr);
    return null;
  }
}

/** ป้องกัน Telegram HTML injection: แปลงสัญลักษณ์พิเศษให้ปลอดภัยก่อนแทรกใน parse_mode HTML */
function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** แปลงรูปแบบวันที่เป็น DD-MM-YYYY (พ.ศ.) เช่น 27-08-2569 */
function toDMYString(dateInput?: string | null): string {
  if (!dateInput) return '-';
  try {
    const clean = String(dateInput).trim();
    if (!clean) return '-';
    const match = clean.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = match[2].padStart(2, '0');
      const day = match[3].padStart(2, '0');
      const thaiYear = year < 2400 ? year + 543 : year;
      return `${day}-${month}-${thaiYear}`;
    }
    const d = new Date(clean.includes('T') ? clean : `${clean}T00:00:00+07:00`);
    if (isNaN(d.getTime())) return clean;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear() < 2400 ? d.getFullYear() + 543 : d.getFullYear();
    return `${day}-${month}-${year}`;
  } catch {
    return dateInput;
  }
}

/** อัปโหลดไฟล์จาก Telegram (Photo/Document) ไปยัง Google Drive (และ Supabase Storage เป็นส่วนสำรอง) */
async function uploadTelegramFileToSupabase(botToken: string, fileId: string, customExt?: string, supabase?: any, settings?: any): Promise<string> {
  try {
    const resFile = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
    const dataFile = await resFile.json() as any;
    if (!dataFile?.ok || !dataFile?.result?.file_path) return '';

    const filePath = dataFile.result.file_path;
    const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

    const fileRes = await fetch(downloadUrl);
    if (!fileRes.ok) return downloadUrl;
    const arrayBuffer = await fileRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const ext = customExt || filePath.split('.').pop() || 'jpg';
    const filename = `รายงาน_Telegram_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.${ext}`;
    const contentType = fileRes.headers.get('content-type') || (ext === 'pdf' ? 'application/pdf' : 'image/jpeg');

    // 1. พยายามอัปโหลดไป Google Drive ผ่าน Google Apps Script (GAS) ก่อน
    const gasUrl = settings?.gas_url || process.env.VITE_GAS_URL || 'https://script.google.com/macros/s/AKfycbzvITJ2HwYAB3tlDDbnjv52b97goxigd2KzNGSIu3jfnlNIpZyNB4hC2nCg_0lxek9E/exec';
    if (gasUrl) {
      try {
        const gasRes = await fetch(gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            folder: 'reports',
            filename: filename,
            mimeType: contentType,
            base64: buffer.toString('base64'),
            year: new Date().getFullYear() + 543
          })
        });
        const gasResult = await gasRes.json() as any;
        if (gasResult?.status === 'success' && gasResult?.url) {
          return gasResult.url;
        }
      } catch (gasErr) {
        console.warn('[TELEGRAM GAS UPLOAD FALLBACK]', gasErr);
      }
    }

    // 2. หาก Google Drive อัปโหลดไม่ผ่าน ให้สำรองไปที่ Supabase Storage
    if (supabase) {
      const storagePath = `report_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${ext}`;
      const { data, error } = await supabase.storage
        .from('reports')
        .upload(storagePath, buffer, { contentType, upsert: true });

      if (!error && data) {
        const { data: pubData } = supabase.storage.from('reports').getPublicUrl(data.path);
        return pubData.publicUrl;
      }
    }

    return downloadUrl;
  } catch (err) {
    console.error('[TELEGRAM FILE UPLOAD ERROR]', err);
    return '';
  }
}

/** เรียกใช้งานโมเดล Gemini API สำหรับโต้ตอบบทสนทนา */
async function callGemini(system: string, user: string, apiKey: string): Promise<string> {
  const models = ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash", "gemini-flash-latest"];
  for (const model of models) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: system }]
          },
          contents: [{
            parts: [{ text: user }]
          }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048
          }
        })
      });
      if (res.ok) {
        const data = await res.json() as any;
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          console.log(`[TELEGRAM WEBHOOK] Gemini model ${model} success!`);
          return text;
        }
      } else {
        const errData = await res.json() as any;
        console.error(`[TELEGRAM WEBHOOK] Error with model ${model}:`, JSON.stringify(errData));
      }
    } catch (e) {
      console.error(`[TELEGRAM WEBHOOK] Gemini error with model ${model}:`, e);
    }
  }
  return "";
}

/** คำนวณหาเลขลำดับถัดไปอย่างแม่นยำสำหรับ Telegram Webhook */
async function getAccurateNextSeqInWebhook(
  supabase: any,
  tableName: 'incoming_docs' | 'outgoing_docs' | 'memos' | 'orders',
  docYear: number,
  startingSeq: number = 1
): Promise<number> {
  try {
    let numberColumn = 'doc_number';
    if (tableName === 'memos') numberColumn = 'memo_number';
    if (tableName === 'orders') numberColumn = 'order_number';

    const { data: docs } = await supabase
      .from(tableName)
      .select(`doc_sequence, ${numberColumn}`)
      .eq('doc_year', docYear);

    let maxNum = 0;

    if (docs && docs.length > 0) {
      docs.forEach((item: any) => {
        if (item.doc_sequence !== null && item.doc_sequence !== undefined) {
          const seqVal = Number(item.doc_sequence);
          if (!isNaN(seqVal) && seqVal > maxNum) maxNum = seqVal;
        }

        const strVal = item[numberColumn];
        if (strVal && typeof strVal === 'string') {
          const matches = strVal.match(/(\d+)/g);
          if (matches && matches.length > 0) {
            matches.forEach((numStr: string) => {
              const parsed = parseInt(numStr, 10);
              if (!isNaN(parsed) && parsed !== docYear && parsed < 2000) {
                if (parsed > maxNum) maxNum = parsed;
              }
            });
          }
        }
      });
    }

    const nextSeq = maxNum + 1;
    return Math.max(nextSeq, startingSeq > 0 ? startingSeq : 1);
  } catch (e) {
    return Math.max(1, startingSeq);
  }
}

/** แยกชั้นเรียนจากข้อความ เช่น ป.1, อ.2 */
function extractClassLevel(text: string): string | null {
  const cleaned = text.replace(/\s+/g, '');
  const pMatch = cleaned.match(/(ป|ประถม|ประถมศึกษา|ประถมศึกษาปีที่)\.?([1-6])/);
  if (pMatch) return `ป.${pMatch[2]}`;
  const aMatch = cleaned.match(/(อ|อนุบาล|อนุบาลปีที่)\.?([2-3])/);
  if (aMatch) return `อ.${aMatch[2]}`;
  return null;
}

// ── Helper: แปลง file_url + attachment_urls เป็นลิงก์สำหรับ AI context ────────
function formatDocLinks(doc: any): string {
  const links: string[] = [];
  if (doc.file_url) {
    links.push(`📄 <a href="${doc.file_url}">ดาวน์โหลดหนังสือนำส่งหลัก</a>`);
  }
  if (doc.attachment_urls) {
    try {
      const atts: string[] = typeof doc.attachment_urls === 'string'
        ? JSON.parse(doc.attachment_urls)
        : (Array.isArray(doc.attachment_urls) ? doc.attachment_urls : []);
      atts.forEach((url: string, i: number) => {
        if (url) links.push(`📎 <a href="${url}">ไฟล์แนบ ${i + 1}</a>`);
      });
    } catch { /* ignore */ }
  }
  return links.length > 0 ? `[ลิงก์เอกสาร: ${links.join(' | ')}]` : '';
}

function extractDocSearchWord(message: string): string {
  if (!message) return '';
  let msg = message.toLowerCase();

  // ลบคำนำหน้าเรื่องและเลขที่
  const prefixWords = [
    'ขอดูหนังสือ', 'ขอรายละเอียดหนังสือเรื่อง', 'ขอรายละเอียดหนังสือ', 'ขอรายละเอียด', 'รายละเอียดหนังสือ', 'รายละเอียด', 'ข้อมูลหนังสือ', 'ข้อมูลเอกสาร',
    'หนังสือเลขที่รับ', 'เลขที่รับหนังสือ', 'เลขที่รับ', 'เลขรับที่', 'เลขรับ', 'หนังสือเลขที่', 'เลขที่', 'เลข', 'เรื่อง'
  ];
  
  prefixWords.forEach(p => {
    msg = msg.replace(new RegExp(p, 'g'), ' ');
  });

  const commonWords = [
    'ชบา', 'น้องชบา', 'บอท',
    'ใครรับผิดชอบ', 'ผู้รับผิดชอบ', 'รับผิดชอบ', 'มอบหมายให้ใคร', 'มอบหมายงาน', 'มอบหมาย', 'ส่งให้ใคร', 'ให้ใคร', 'ของใคร', 'ใคร', 'คนไหน', 'ท่านใด', 'ทำหน้าที่',
    'ขอไฟล์แนบ', 'ขอเอกสารแนบ', 'ขอลิงก์', 'ขอลิงค์', 'ขอไฟล์', 'ดาวน์โหลด', 'ขอดู', 'ขออ่าน',
    'หนังสือรับที่', 'หนังสือส่งที่', 'คำสั่งที่', 'บันทึกที่', 'จดหมายที่', 'ฉบับที่', 'เรื่องที่',
    'หนังสือรับ', 'หนังสือส่ง', 'หนังสือเข้า', 'หนังสือออก', 'บันทึกข้อความ',
    'เอกสารรับ', 'เอกสารส่ง', 'ไฟล์แนบ', 'เอกสารแนบ', 'ไฟล์รับ', 'ไฟล์ส่ง',
    'ไฟล์คำสั่ง', 'ไฟล์บันทึก', 'คำสั่ง', 'ใบสั่ง', 'บันทึก', 'เมโม่', 'memo', 'โหลด',
    'แนวทางการดำเนินการตาม', 'แนวทางการดำเนินการ', 'แนวทาง',
    'ของ', 'ฉบับ', 'เรื่อง', 'ขอ', 'มี', 'ส่ง', 'ล่าสุด', 'ใหม่ล่าสุด', 'ย้อนหลัง', 'เก่า', 'ใหม่', 'รับ'
  ];
  
  commonWords.forEach(w => {
    msg = msg.replace(new RegExp(w, 'g'), ' ');
  });

  const suffixes = ['หน่อย', 'ครับ', 'ค่ะ', 'นะ', 'นะคะ', 'ด้วย', 'ที', 'หน่อยครับ', 'หน่อยค่ะ', 'หน่อยนะ', 'หน่อยนะคะ', 'ด้วยครับ', 'ด้วยค่ะ', 'ซิ', 'สิ', 'จ๊ะ', 'จ้า'];
  suffixes.forEach(s => {
    msg = msg.replace(new RegExp(s + '$', 'g'), '');
    msg = msg.replace(new RegExp('\\s+' + s, 'g'), '');
  });

  const keywordResult = msg.trim();
  const skipWords = ['วันนี้', 'ล่าสุด', 'ใหม่ล่าสุด', 'ย้อนหลัง', 'เก่า', 'ใหม่', 'ชบา', 'น้องชบา', 'บอท', 'ขอ'];
  if (skipWords.includes(keywordResult) || keywordResult.length < 1) {
    return '';
  }
  return keywordResult;
}

function buildThaiDocOrFilter(searchWord: string, numberCol: string = 'doc_number'): string {
  if (!searchWord) return '';
  const terms = new Set<string>();
  terms.add(searchWord);

  const isNumeric = /^\d+$/.test(searchWord.trim());

  if (searchWord.length > 8) {
    for (let i = 0; i <= searchWord.length - 4; i += 4) {
      const sub = searchWord.substring(i, i + 6);
      if (sub.length >= 4) terms.add(sub);
    }
  }

  const termArr = Array.from(terms).slice(0, 6);
  const filters: string[] = [];

  // เพิ่ม doc_sequence.eq ครั้งเดียว (ไม่ซ้ำซ้อนใน loop)
  if (isNumeric) {
    filters.push(`doc_sequence.eq.${searchWord.trim()}`);
  }

  termArr.forEach(t => {
    filters.push(`subject.ilike.%${t}%`, `${numberCol}.ilike.%${t}%`);
  });

  return filters.join(',');
}

/** ซิงค์ประวัติการออก/จองเลขเข้าสู่ระบบออกเลขกลาง (Unified Numbering Engine) ป้องกันเลขชนกัน */
async function syncUnifiedAllocation(
  supabase: any,
  seriesCode: string,
  docYear: number,
  sequenceNum: number,
  formattedNum: string,
  title: string,
  userName: string,
  tableName: string
) {
  try {
    await supabase.from('document_number_allocations').insert([{
      series_code: seriesCode,
      doc_year: docYear,
      sequence_number: sequenceNum,
      formatted_number: formattedNum,
      status: 'reserved',
      title: title,
      requested_by_name: userName || 'Telegram User',
      channel: 'telegram',
      document_table: tableName
    }]);
    await supabase.from('document_number_counters').upsert({
      series_code: seriesCode,
      doc_year: docYear,
      last_sequence: sequenceNum,
      updated_at: new Date().toISOString()
    });
  } catch (syncErr) {
    console.log('[TELEGRAM NUMBER SYNC NON-BLOCKING]', syncErr);
  }
}

/** Smart Data Fetch — ดึงข้อมูลจริงจากฐานข้อมูลตามหมวดคำถาม (เทียบเท่า LINE Bot) */
async function smartFetchContext(message: string, currentYear: string, supabase: any, schoolId?: string, profileLinked?: any): Promise<string> {
  const msg = message.toLowerCase();
  const targetClass = extractClassLevel(message);

  const rules = [
    {
      keys: ['สรุปสารบรรณ', 'สรุปงานสารบรรณ', 'สถิติสารบรรณ', 'รายงานประจำปี', 'สรุปประจำปี', 'งานสารบรรณปีนี้', 'สถิติหนังสือ', 'ภาระงานครู', 'งานครู', 'สรุปงานปี', 'สถิติงาน'],
      fetch: async () => {
        const year = parseInt(currentYear, 10) || new Date().getFullYear() + 543;
        try {
          const [incRes, memoRes, outRes, ordRes, workloadRes] = await Promise.all([
            supabase.from('incoming_docs').select('id', { count: 'exact', head: true }).or(`doc_year.eq.${year}`),
            supabase.from('memos').select('id', { count: 'exact', head: true }).or(`doc_year.eq.${year}`),
            supabase.from('outgoing_docs').select('id', { count: 'exact', head: true }).or(`doc_year.eq.${year}`),
            supabase.from('orders').select('id', { count: 'exact', head: true }).or(`doc_year.eq.${year}`),
            supabase.rpc('get_staff_workload_summary', { p_doc_year: year })
          ]);

          const incomingCount = incRes.count || 0;
          const memoCount = memoRes.count || 0;
          const outgoingCount = outRes.count || 0;
          const orderCount = ordRes.count || 0;
          const totalCount = incomingCount + memoCount + outgoingCount + orderCount;
          const workload = workloadRes.data || [];

          return `📊 สถิติรายงานสรุปงานสารบรรณ ประจำปี พ.ศ. ${year}:
- ๑. ทะเบียนหนังสือรับ (หนังสือเข้า): ${incomingCount} เรื่อง
- ๒. ทะเบียนบันทึกข้อความ: ${memoCount} ฉบับ
- ๓. ทะเบียนหนังสือส่ง (หนังสือออก): ${outgoingCount} เรื่อง
- ๔. ทะเบียนคำสั่งโรงเรียน: ${orderCount} ฉบับ
- รวมงานสารบรรณที่ดำเนินการทั้งสิ้น: ${totalCount} รายการ
ข้อมูลสรุปการกระจายภาระงานครูและบุคลากร (จำแนกตามรายบุคคล): ${JSON.stringify(workload.slice(0, 15))}`;
        } catch (err: any) {
          return `สถิติงานสารบรรณปี ${year} (ข้อมูลเบื้องต้น): ไม่สามารถประมวลผลสถิติแบบละเอียดได้ในขณะนี้`;
        }
      }
    },
    {
      keys: ['ค้างเกษียณ', 'รอเกษียณ', 'ยังไม่ได้เกษียณ', 'ยังไม่เกษียณ', 'ผอ. ยังไม่ได้ทำ', 'ผอ. ยังไม่สั่ง', 'ค้างผอ', 'หนังสือค้าง', 'รอสั่งการ', 'ค้างสั่งการ'],
      fetch: async () => {
        // 🛡️ Security Guard: ตรวจสอบสิทธิ์ ผอ. หรือ แอดมิน เท่านั้น
        if (profileLinked?.role !== 'director' && profileLinked?.role !== 'admin') {
          return 'ผู้สอบถามไม่มีสิทธิ์เข้าถึงข้อมูลหนังสือรอเกษียณของผู้อำนวยการ (สงวนสิทธิ์เฉพาะผู้อำนวยการและผู้ดูแลระบบ)';
        }

        let query = supabase.from('incoming_docs').select('id, doc_sequence, doc_number, subject, from_agency, doc_date, urgency, status, file_url, attachment_urls');
        if (schoolId) query = query;
        query = query.eq('status', 'pending');
        // Fix: ใช้ doc_sequence แทน doc_date เพราะ doc_date บางฝนบันทึกเป็น พ.ศ. บางเป็น ค.ศ. ทำให้ sort ผิด
        const { data } = await query.order('doc_sequence', { ascending: false }).limit(5);
        
        // ดึงจำนวนทั้งหมดเพื่อนำไปโชว์ในคำตอบ
        const { count } = await supabase
          .from('incoming_docs')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending');
          
        return `ข้อมูลหนังสือรับที่ยังค้างเสนอผู้อำนวยการเกษียณสั่งการ (สถานะ pending) (แสดง 5 เล่มล่าสุด จากค้างทั้งหมด ${count || 0} เล่ม): ${JSON.stringify(data)}`;
      }
    },
    {
      keys: ['งานค้าง', 'งานค้างของฉัน', 'งานของฉัน', 'งานที่ยังไม่ได้ส่ง', 'ยังไม่ได้รายงาน', 'งานที่มอบหมายค้าง', 'งานมอบหมายค้าง', 'รายงานผล', 'ส่งรายงาน', 'ส่งงาน'],
      fetch: async () => {
        if (!profileLinked || !profileLinked.email) return 'ไม่มีข้อมูลโปรไฟล์ผู้ใช้สำหรับสืบค้นงานค้างส่วนบุคคล';
        const { data: teacher } = await supabase.from('teachers').select('id').eq('email', profileLinked.email).maybeSingle();
        if (!teacher) return 'ไม่พบข้อมูลครูที่เชื่อมโยงกับบัญชี Telegram นี้';

        const { data: pendingAssigns } = await supabase
          .from('doc_assignments')
          .select('id, instruction, status, created_at, incoming_docs(doc_number, subject, file_url, attachment_urls)')
          .eq('assignee_id', teacher.id)
          .in('status', ['pending', 'acknowledged'])
          .order('created_at', { ascending: false });

        return `รายการงานมอบหมายที่ยังค้างการรายงานผล/ครูยังทำไม่เสร็จ (สถานะ pending หรือ acknowledged) ของครูผู้สอบถาม: ${JSON.stringify(pendingAssigns)}`;
      }
    },
    {
      keys: ['รายชื่อครู', 'บุคลากร', 'เบอร์โทรครู', 'ข้อมูลครู', 'ครูทั้งหมด', 'ครูเวร', 'เวรยาม'],
      fetch: async () => {
        let teachersQuery = supabase.from('teachers').select('id, prefix, first_name, last_name, position, department, phone, email, status');
        if (schoolId) teachersQuery = teachersQuery;
        let { data: teachers } = await teachersQuery;
        if (!teachers || teachers.length === 0) {
          let profilesQuery = supabase.from('profiles').select('id, display_name, email, role, status');
          if (schoolId) profilesQuery = profilesQuery;
          const { data: profiles } = await profilesQuery;
          if (profiles && profiles.length > 0) {
            teachers = profiles.map((p: any) => ({
              id: p.id, prefix: '', first_name: p.display_name || p.email?.split('@')[0], last_name: '',
              position: p.role === 'admin' ? 'ผู้ดูแลระบบ' : p.role === 'director' ? 'ผู้อำนวยการ' : 'ครู',
              department: 'ทั่วไป', phone: '', email: p.email, status: p.status
            }));
          }
        }
        const { data: duties } = await supabase.from('teacher_duties').select('duty_day, duty_type, teacher_id');
        return `รายชื่อครูและบุคลากร: ${JSON.stringify(teachers)}\nข้อมูลเวรประจำวัน: ${JSON.stringify(duties)}`;
      }
    },
    {
      keys: ['เด็กในเขต', 'เขตบริการ', 'พฐ.03', 'ทร.14', 'ทะเบียนเด็ก'],
      fetch: async () => {
        let sasQuery = supabase.from('service_area_students').select('prefix, first_name, last_name, gender, birth_date, moo, sub_district');
        if (schoolId) sasQuery = sasQuery;
        const { data } = await sasQuery.limit(60);
        return `ข้อมูลทะเบียนเด็กในเขตพื้นที่บริการ (ทร.14 / พฐ.03): ${JSON.stringify(data)}`;
      }
    },
    {
      keys: ['โครงการ', 'งบประมาณ', 'งบ', 'เงินงบ', 'สถิติ', 'สรุป', 'ผลสัมฤทธิ์', 'จัดซื้อจัดจ้าง', 'ซื้อจ้าง'],
      fetch: async () => {
        let projQuery = supabase.from('school_projects').select('project_name, planned_amount, spent_amount, status, budget_allocations(budget_type, category_name)').eq('academic_year', currentYear);
        let budgQuery = supabase.from('budget_allocations').select('id, budget_type, category_name, amount, spent_amount, remaining_amount').eq('academic_year', currentYear);
        let procQuery = supabase.from('procurement_projects').select('project_name, total_amount, status, procurement_type').eq('academic_year', currentYear);
        if (schoolId) { projQuery = projQuery; budgQuery = budgQuery; procQuery = procQuery; }
        const { data: projects } = await projQuery;
        const { data: budget } = await budgQuery;
        const { data: procurement } = await procQuery;
        const totalAllocated = budget?.reduce((sum: number, b: any) => sum + (b.amount || 0), 0) || 0;
        const totalSpent = budget?.reduce((sum: number, b: any) => sum + (b.spent_amount || 0), 0) || 0;
        const totalRemaining = budget?.reduce((sum: number, b: any) => sum + (b.remaining_amount || 0), 0) || 0;
        return `สถิติสรุปงบประมาณ ปี ${currentYear}:\n- ยอดงบรวม: ${totalAllocated.toLocaleString()} บาท\n- ใช้ไป: ${totalSpent.toLocaleString()} บาท\n- คงเหลือ: ${totalRemaining.toLocaleString()} บาท\nข้อมูลโครงการ: ${JSON.stringify(projects)}\nข้อมูลงบ: ${JSON.stringify(budget)}\nข้อมูลจัดซื้อจัดจ้าง: ${JSON.stringify(procurement)}`;
      }
    },
    {
      keys: ['หนังสือรับ', 'จดหมาย', 'เอกสารรับ', 'หนังสือเข้า', 'ไฟล์แนบ', 'เอกสารแนบ', 'แนบ', 'ไฟล์รับ'],
      fetch: async () => {
        const searchWord = extractDocSearchWord(message);
        let query = supabase.from('incoming_docs').select('id, doc_sequence, status, doc_number, subject, from_agency, doc_date, urgency, remark, file_url, attachment_urls, doc_assignments(instruction, status, teachers(prefix, first_name, last_name))');
        if (schoolId) query = query;

        const filterStr = buildThaiDocOrFilter(searchWord, 'doc_number');
        if (filterStr) query = query.or(filterStr);
        // Fix: สั่งตาม doc_sequence เพราะเป็นตัวเลขที่เชื่อถือได้ ไม่สับสนเรื่องปี ค.ศ./ พ.ศ. ใน doc_date
        let { data } = await query.order('doc_sequence', { ascending: false }).limit(5);

        // Fallback: ถ้าไม่พบผลลัพธ์ด้วยคำค้นยาว ให้ทดลองค้นแบบคำย่อย 6 อักขระแรก
        if ((!data || data.length === 0) && searchWord.length > 5) {
          const subKw = searchWord.substring(0, 6);
          let fbQuery = supabase.from('incoming_docs').select('id, doc_sequence, status, doc_number, subject, from_agency, doc_date, urgency, remark, file_url, attachment_urls, doc_assignments(instruction, status, teachers(prefix, first_name, last_name))')
            .or(`subject.ilike.%${subKw}%,doc_number.ilike.%${subKw}%`);
          if (schoolId) fbQuery = fbQuery;
          const { data: fbData } = await fbQuery.order('doc_sequence', { ascending: false }).limit(5);
          if (fbData && fbData.length > 0) data = fbData;
        }

        const docsWithLinks = (data || []).map((d: any) => ({ ...d, _links: formatDocLinks(d) }));
        return `ข้อมูลหนังสือรับล่าสุด (รวมข้อมูลการมอบหมายงานด้วย): ${JSON.stringify(docsWithLinks)}`;
      }
    },
    {
      keys: ['หนังสือส่ง', 'เอกสารส่ง', 'หนังสือออก', 'ไฟล์ส่ง'],
      fetch: async () => {
        const searchWord = extractDocSearchWord(message);
        let query = supabase.from('outgoing_docs').select('doc_sequence, doc_number, subject, to_agency, doc_date, urgency, remark, file_url');
        if (schoolId) query = query;
        if (searchWord.length > 0) query = query.or(`subject.ilike.%${searchWord}%,doc_number.ilike.%${searchWord}%`);
        // Fix: สั่งตาม doc_sequence เพื่อหลีกปัญหาปีปะปนใน doc_date
        const { data } = await query.order('doc_sequence', { ascending: false }).limit(5);
        const outWithLinks = (data || []).map((d: any) => ({ ...d, _links: formatDocLinks(d) }));
        return `ข้อมูลหนังสือส่งล่าสุด: ${JSON.stringify(outWithLinks)}`;
      }
    },
    {
      keys: ['คำสั่ง', 'ใบสั่ง', 'ไฟล์คำสั่ง'],
      fetch: async () => {
        const searchWord = extractDocSearchWord(message);
        let query = supabase.from('orders').select('doc_sequence, order_number, subject, issuer, order_date, remark, file_url');
        if (schoolId) query = query;
        if (searchWord.length > 0) query = query.or(`subject.ilike.%${searchWord}%,order_number.ilike.%${searchWord}%`);
        // Fix: สั่งตาม doc_sequence เพื่อหลีกปัญหาปีปะปนใน order_date
        const { data } = await query.order('doc_sequence', { ascending: false }).limit(5);
        const ordWithLinks = (data || []).map((d: any) => ({ ...d, _links: formatDocLinks(d) }));
        return `ข้อมูลคำสั่งล่าสุด: ${JSON.stringify(ordWithLinks)}`;
      }
    },
    {
      keys: ['บันทึก', 'เมโม่', 'memo', 'บันทึกข้อความ', 'ไฟล์บันทึก'],
      fetch: async () => {
        const searchWord = extractDocSearchWord(message);
        let query = supabase.from('memos').select('doc_sequence, memo_number, subject, requester, memo_date, urgency, remark, file_url');
        if (schoolId) query = query;
        if (searchWord.length > 0) query = query.or(`subject.ilike.%${searchWord}%,memo_number.ilike.%${searchWord}%`);
        // Fix: สั่งตาม doc_sequence เพื่อหลีกปัญหาปีปะปนใน memo_date
        const { data } = await query.order('doc_sequence', { ascending: false }).limit(5);
        const memoWithLinks = (data || []).map((d: any) => ({ ...d, _links: formatDocLinks(d) }));
        return `ข้อมูลบันทึกข้อความล่าสุด: ${JSON.stringify(memoWithLinks)}`;
      }
    },
    {
      keys: ['ค่าไฟ', 'ไฟฟ้า', 'ค่าน้ำ', 'ประปา', 'โทรศัพท์', 'เน็ต', 'อินเทอร์เน็ต', 'สาธารณูปโภค', 'บิล'],
      fetch: async () => {
        let query = supabase.from('utilities').select('*').eq('academic_year', currentYear);
        if (schoolId) query = query;
        const types: string[] = [];
        if (msg.includes('ค่าไฟ') || msg.includes('ไฟฟ้า')) types.push('electricity');
        if (msg.includes('ค่าน้ำ') || msg.includes('ประปา')) types.push('water');
        if (msg.includes('โทรศัพท์')) types.push('telephone');
        if (msg.includes('เน็ต') || msg.includes('อินเทอร์เน็ต')) types.push('internet');
        if (types.length > 0) query = query.in('type', types);
        const { data } = await query.order('bill_date', { ascending: false }).limit(20);
        return `ข้อมูลค่าสาธารณูปโภค ปี ${currentYear}: ${JSON.stringify(data)}`;
      }
    },
    {
      keys: ['เช็คชื่อ', 'ขาด', 'ลา', 'มาสาย', 'เข้าเรียน'],
      fetch: async () => {
        let attQuery = supabase.from('attendance').select('date, class_level, summary, recorded_at');
        if (schoolId) attQuery = attQuery;
        const { data } = await attQuery.order('date', { ascending: false }).limit(5);
        return `ข้อมูลการเช็คชื่อเข้าเรียนล่าสุด: ${JSON.stringify(data)}`;
      }
    },
    {
      keys: ['พัสดุ', 'จัดซื้อ', 'จัดจ้าง', 'การจ้าง', 'สัญญา', 'ผู้ขาย', 'ผู้รับจ้าง', 'ตรวจรับ', 'กรรมการ'],
      fetch: async () => {
        let procQuery2 = supabase.from('procurement_projects').select('project_name, academic_year, method, procurement_type, total_amount, status, ref_doc_number, contract_number, committee_json, vendor_info, school_projects(project_name)').eq('academic_year', currentYear);
        if (schoolId) procQuery2 = procQuery2;
        const { data: projects } = await procQuery2.limit(10);
        return `ข้อมูลจัดซื้อจัดจ้าง ปี ${currentYear}: ${JSON.stringify(projects)}`;
      }
    },
    {
      keys: ['ห้องสมุด', 'ยืมหนังสือ', 'คืนหนังสือ', 'ยืม-คืน', 'หนังสือห้องสมุด'],
      fetch: async () => {
        let booksQuery = supabase.from('library_books').select('id, book_id, title, category, author, available_qty, status');
        let borrowQuery = supabase.from('library_borrow').select('borrow_date, borrower_name, return_date, status, library_books(book_id, title, category)');
        if (schoolId) { booksQuery = booksQuery; borrowQuery = borrowQuery; }
        const { data: books } = await booksQuery.limit(15);
        const { data: borrow } = await borrowQuery.order('borrow_date', { ascending: false }).limit(10);
        return `หนังสือในห้องสมุด: ${JSON.stringify(books)}\nประวัติยืม-คืน: ${JSON.stringify(borrow)}`;
      }
    },
    {
      keys: ['มอบหมาย', 'งานมอบหมาย', 'ติดตามงาน', 'สั่งงาน', 'มอบหมายงาน', 'งานของฉัน', 'งานค้าง', 'รายงานผล', 'ส่งงาน', 'ภารกิจ', 'เช็คงาน', 'งาน'],
      fetch: async () => {
        let daQuery = supabase.from('doc_assignments').select('id, instruction, status, reported_at, staff_report, incoming_docs(doc_number, subject), teachers:assignee_id(prefix, first_name, last_name)');
        if (schoolId) daQuery = daQuery;
        const { data } = await daQuery.order('created_at', { ascending: false }).limit(10);
        return `ข้อมูลการมอบหมายงาน: ${JSON.stringify(data)}`;
      }
    },
    {
      keys: ['การตั้งค่า', 'โรงเรียน', 'ผู้อำนวยการ', 'ที่อยู่โรงเรียน', 'ข้อมูลโรงเรียน'],
      fetch: async () => {
        let settingsQuery = supabase.from('settings').select('school_name, school_address, director_name, current_academic_year, current_term, phone_number, local_gov_name');
        if (schoolId) settingsQuery = settingsQuery;
        const { data } = await settingsQuery.limit(1).maybeSingle();
        return `ข้อมูลโรงเรียน: ${JSON.stringify(data)}`;
      }
    },
    {
      keys: ['นักเรียน', 'กี่คน', 'รายชื่อ', 'รายนาม', 'เด็กนักเรียน', 'ชั้นเรียน'],
      fetch: async () => {
        if (msg.includes('ครู') || msg.includes('โครงการ') || msg.includes('จัดซื้อ') || msg.includes('พัสดุ') || msg.includes('ห้องสมุด')) return "";
        if (targetClass) {
          const prefix = targetClass.startsWith('ป') ? 'ป' : 'อ';
          const levelNum = targetClass.split('.')[1];
          let query = supabase.from('students').select('prefix, first_name, last_name, class_level, room, gender').eq('academic_year', currentYear).in('graduation_status', ['ปกติ', 'กำลังศึกษา']);
          if (schoolId) query = query;
          if (prefix === 'ป') { query = query.or(`class_level.eq.${targetClass},class_level.ilike.ป%${levelNum}%`); }
          else { query = query.or(`class_level.eq.${targetClass},class_level.ilike.อ%${levelNum}%`); }
          const { data } = await query.order('room', { ascending: true }).order('first_name', { ascending: true });
          if (data && data.length > 0) {
            const listText = data.map((s: any, idx: number) => `${idx + 1}. ${s.prefix || ''}${s.first_name} ${s.last_name} ${s.room ? `(ห้อง ${s.room})` : ''}`).join('\n');
            return `รายชื่อนักเรียนชั้น ${targetClass} ปี ${currentYear} (รวม ${data.length} คน):\n${listText}`;
          }
          return `ไม่พบข้อมูลรายชื่อนักเรียนชั้น ${targetClass} สำหรับปี ${currentYear}`;
        } else {
          let studQuery = supabase.from('students').select('class_level, gender, religion').eq('academic_year', currentYear).in('graduation_status', ['ปกติ', 'กำลังศึกษา']);
          if (schoolId) studQuery = studQuery;
          const { data: allStudents } = await studQuery;
          if (allStudents && allStudents.length > 0) {
            const counts: Record<string, number> = {}; const genders: Record<string, number> = {};
            (allStudents as any[]).forEach((s: any) => { counts[s.class_level || 'ไม่ระบุ'] = (counts[s.class_level || 'ไม่ระบุ'] || 0) + 1; genders[s.gender || 'ไม่ระบุ'] = (genders[s.gender || 'ไม่ระบุ'] || 0) + 1; });
            const summaryStr = Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0], 'th')).map(([lvl, num]) => `- ${lvl}: ${num} คน`).join('\n');
            const genderStr = Object.entries(genders).map(([g, num]) => `- ${g}: ${num} คน`).join('\n');
            return `[สถิตินักเรียนปี ${currentYear}]:\nรวม: ${allStudents.length} คน\nแยกชั้น:\n${summaryStr}\nแยกเพศ:\n${genderStr}`;
          }
          let studQuery2 = supabase.from('students').select('*', { count: 'exact', head: true }).eq('academic_year', currentYear).in('graduation_status', ['ปกติ', 'กำลังศึกษา']);
          if (schoolId) studQuery2 = studQuery2;
          const { count } = await studQuery2;
          return `จำนวนนักเรียนปี ${currentYear}: ${count} คน`;
        }
      }
    },
    {
      keys: ['แผนการสอน', 'ส่งแผน', 'แผนสอน', 'ตรวจแผน'],
      fetch: async () => {
        let lpQuery = supabase.from('lesson_plans').select('title, subject_code, subject_name, class_level, term, status, academic_comments, director_comments, created_at, profiles(display_name)');
        if (schoolId) lpQuery = lpQuery;
        const { data } = await lpQuery;
        if (data && data.length > 0) {
          const listText = data.map((p: any, idx: number) => {
            const statusMap: Record<string, string> = { 'Draft': 'แบบร่าง', 'Pending_Academic': 'รอวิชาการตรวจ', 'Rejected_by_Academic': 'วิชาการส่งแก้ไข', 'Pending_Director': 'เสนอ ผอ. อนุมัติ', 'Rejected_by_Director': 'ผอ. ส่งแก้ไข', 'Approved': 'อนุมัติแล้ว 🟢' };
            return `${idx + 1}. "${p.title}" (${p.subject_code} ${p.subject_name} ชั้น ${p.class_level}) สถานะ: ${statusMap[p.status] || p.status} ครู: ${p.profiles?.display_name || '-'}`;
          }).join('\n');
          return `สถานะแผนการสอน:\n${listText}`;
        }
        return `ยังไม่มีข้อมูลแผนการสอนในระบบ`;
      }
    }
  ];

  for (const rule of rules) {
    if (rule.keys.some(key => msg.includes(key))) {
      try {
        const result = await rule.fetch();
        if (result) return result;
      } catch (err) {
        console.error(`[TELEGRAM WEBHOOK] Error in smartFetchContext for keys ${rule.keys[0]}:`, err);
      }
    }
  }

  // Fallback: ค้นหาใน school_knowledge (RAG)
  try {
    const cleanWord = extractDocSearchWord(message);
    const searchTarget = cleanWord || message;

    // สร้างคำสำคัญย่อย (Sub-keywords) 3-8 ตัวอักษร สำหรับประโยคภาษาไทยยาว
    const subTerms: string[] = [searchTarget];
    if (searchTarget.length > 8) {
      for (let i = 0; i <= searchTarget.length - 4; i += 4) {
        const sub = searchTarget.substring(i, i + 6);
        if (sub.length >= 4) subTerms.push(sub);
      }
    }

    const uniqueTerms = Array.from(new Set(subTerms)).slice(0, 6);
    const orFilters = uniqueTerms.map(t => `chunk_text.ilike.%${t}%,document_name.ilike.%${t}%`).join(',');

    let skQuery = supabase.from('school_knowledge').select('document_name, chunk_text').or(orFilters);
    if (schoolId) skQuery = skQuery;
    const { data: knowledge } = await skQuery.limit(5);
    if (knowledge && knowledge.length > 0) {
      return "ข้อมูลจากคลังความรู้โรงเรียน:\n" + knowledge.map((k: any) => `[ไฟล์: ${k.document_name}] ${k.chunk_text}`).join('\n');
    }
  } catch (err) { console.error('[TELEGRAM WEBHOOK RAG ERROR]', err); }

  return "";
}

/** แปลงข้อมูล Context JSON ให้อยู่ในรูปแบบรายการภาษาไทยที่อ่านง่าย ป้องกันการหลุดของ Raw JSON 100% */
function formatContextDataForHumans(contextData: string): string {
  if (!contextData) return '';

  // สกัด JSON Array จาก contextData
  const jsonMatch = contextData.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (!jsonMatch) {
    // ถ้าไม่ใช่ JSON Array ให้ตัดเครื่องหมาย bracket/quote/backslash ออกเพื่อความสะอาด
    return escapeHtml(contextData.replace(/[{}[\]"\\]/g, '').trim());
  }

  try {
    const items: any[] = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(items) || items.length === 0) {
      return 'ขณะนี้ไม่พบรายการข้อมูลที่ค้างอยู่ในระบบค่ะ 🌸';
    }

    // กรณีที่ 1: รายการหนังสือรับเข้า (incoming_docs)
    if (items[0].subject && (items[0].doc_number !== undefined || items[0].from_agency !== undefined || items[0].doc_sequence !== undefined)) {
      let output = `📬 <b>รายการหนังสือจากฐานข้อมูล (${items.length} ฉบับ):</b>\n━━━━━━━━━━━━━━━━━━━━\n\n`;
      items.forEach((item, idx) => {
        const uBadge = item.urgency === 'ด่วนที่สุด' ? '🔴 [ด่วนที่สุด]' : item.urgency === 'ด่วนมาก' ? '🟠 [ด่วนมาก]' : item.urgency === 'ด่วน' ? '🟡 [ด่วน]' : '🟢 [ปกติ]';
        output += `${idx + 1}. ${uBadge} <b>เรื่อง:</b> ${escapeHtml(item.subject || '-')}\n`;
        output += `   • <b>เลขรับ:</b> <code>${escapeHtml(String(item.doc_number || item.doc_sequence || '-'))}</code> | <b>จาก:</b> ${escapeHtml(item.from_agency || '-')}\n`;
        if (item.file_url) {
          output += `   📄 <a href="${item.file_url}">เปิดดูเอกสาร</a>\n`;
        }
        output += `\n`;
      });
      return output.trim();
    }

    // กรณีที่ 2: รายการภาระงานครู (doc_assignments)
    if (items[0].instruction || items[0].incoming_docs) {
      let output = `📋 <b>รายการงานที่ได้รับมอบหมาย (${items.length} งาน):</b>\n━━━━━━━━━━━━━━━━━━━━\n\n`;
      items.forEach((item, idx) => {
        const doc = item.incoming_docs || {};
        output += `${idx + 1}. <b>เรื่อง:</b> ${escapeHtml(doc.subject || '-')}\n`;
        output += `   • <b>คำสั่งการ:</b> <i>"${escapeHtml(item.instruction || 'โปรดดำเนินการ')}"</i>\n`;
        if (doc.file_url) {
          output += `   📄 <a href="${doc.file_url}">ดูเอกสาร</a>\n`;
        }
        output += `\n`;
      });
      return output.trim();
    }

    // กรณีที่ 3: รายชื่อครู/บุคลากร (teachers)
    if (items[0].first_name && (items[0].phone !== undefined || items[0].department !== undefined || items[0].position !== undefined)) {
      let output = `🧑‍🏫 <b>ข้อมูลบุคลากร (${items.length} ท่าน):</b>\n━━━━━━━━━━━━━━━━━━━━\n\n`;
      items.forEach((t, idx) => {
        output += `${idx + 1}. <b>${escapeHtml(t.prefix || '')}${escapeHtml(t.first_name)} ${escapeHtml(t.last_name || '')}</b>\n`;
        if (t.position) output += `   • <b>ตำแหน่ง:</b> ${escapeHtml(t.position)}\n`;
        if (t.phone) output += `   • <b>เบอร์โทร:</b> <code>${escapeHtml(t.phone)}</code>\n`;
        output += `\n`;
      });
      return output.trim();
    }

    // กรณีทั่วไป: แสดง key-value ที่สำคัญ
    return items.map((it, i) => `${i + 1}. ` + Object.entries(it)
      .filter(([k]) => !['id', 'created_at', 'updated_at', 'raw_data'].includes(k))
      .map(([k, v]) => `<b>${escapeHtml(k)}:</b> ${escapeHtml(String(v))}`).join(' | ')
    ).join('\n\n');

  } catch {
    return escapeHtml(contextData.replace(/[{}[\]"\\]/g, '').trim());
  }
}

/** สร้างปุ่ม Inline Keyboard จาก Context Data อัตโนมัติ เพื่อรองรับทั้งโหมด AI และ Fallback */
function buildReplyMarkupFromContext(contextData: string, cleanedText: string, profileLinked: any): any {
  if (!contextData) return undefined;
  const isReportIntent = ['งานค้าง', 'งานของฉัน', 'ยังไม่ได้ส่ง', 'ยังไม่ได้รายงาน', 'งานที่มอบหมายค้าง', 'รายงานผล', 'ส่งรายงาน', 'ส่งงาน'].some(k => cleanedText.includes(k));
  const inlineKeyboard: any[] = [];
  const addedDocIds = new Set<string>();

  // 1. ค้นหา ID หนังสือรับทั้งหมดใน contextData เพื่อสร้างปุ่มดูเอกสาร / เกษียณสั่งการ
  const docMatches = contextData.match(/"id":"([a-f0-9-]{36})"/g);
  if (docMatches) {
    for (const match of docMatches) {
      const idMatch = match.match(/"id":"([a-f0-9-]{36})"/);
      if (idMatch && idMatch[1] && !addedDocIds.has(idMatch[1])) {
        const docId = idMatch[1];
        addedDocIds.add(docId);

        const docBlockMatch = contextData.match(new RegExp(`\\{[^{}]*?"id"\\s*:\\s*"${docId}"[^{}]*?\\}`));
        if (docBlockMatch && docBlockMatch[0]) {
          let docNum = '';
          let status = '';
          let fileUrl = '';
          let attachmentUrls: string[] = [];

          const numMatch = docBlockMatch[0].match(/"doc_number":"(.*?)"/);
          if (numMatch && numMatch[1]) docNum = numMatch[1];

          const statusMatch = docBlockMatch[0].match(/"status":"(.*?)"/);
          if (statusMatch && statusMatch[1]) status = statusMatch[1];

          const fileMatch = docBlockMatch[0].match(/"file_url":"(.*?)"/);
          if (fileMatch && fileMatch[1]) fileUrl = fileMatch[1];

          const attachMatch = docBlockMatch[0].match(/"attachment_urls":(\[.*?\])/);
          if (attachMatch && attachMatch[1]) {
            try {
              attachmentUrls = JSON.parse(attachMatch[1]);
            } catch (e) {}
          }

          const rowButtons: any[] = [];
          if (fileUrl) {
            rowButtons.push({ text: `📄 ดูต้นฉบับ ${docNum ? `(${docNum})` : ''}`, url: fileUrl });
          }

          if (attachmentUrls && attachmentUrls.length > 0) {
            attachmentUrls.forEach((url, idx) => {
              if (url && (url.startsWith('http') || url.startsWith('https'))) {
                rowButtons.push({ text: `📎 แนบ ${idx + 1}`, url: url });
              }
            });
          }

          if (rowButtons.length > 0) {
            inlineKeyboard.push(rowButtons);
          }

          if ((profileLinked?.role === 'director' || profileLinked?.role === 'admin') && status === 'pending' && !isReportIntent) {
            inlineKeyboard.push([
              { text: `✍️ เกษียณสั่งการหนังสือ เลขที่ ${docNum || ''}`, callback_data: `action=start_assign&id=${docId}` }
            ]);
          }
        }
      }
    }
  }

  // 2. ค้นหา ID ของการมอบหมายงาน (doc_assignments) เพื่อสร้างปุ่มรายงานผล
  const assignSectionMatch = contextData.match(/ข้อมูลการมอบหมายงาน:\s*(\[.*\])/s) || contextData.match(/รายการงานมอบหมาย.*?:\s*(\[.*\])/s);
  const assignSectionText = assignSectionMatch ? assignSectionMatch[1] : '';

  if (assignSectionText) {
    try {
      const assignments: any[] = JSON.parse(assignSectionText);
      const addedAssignIds = new Set<string>();

      for (const assign of assignments) {
        if (!assign?.id || addedAssignIds.has(assign.id)) continue;
        if (assign.status !== 'acknowledged' && assign.status !== 'pending') continue;

        addedAssignIds.add(assign.id);
        const docNum = assign.incoming_docs?.doc_number || '';

        inlineKeyboard.push([
          { text: `📝 รายงานผลงาน ${docNum ? `เลขที่ ${docNum}` : ''}`.trim(), callback_data: `action=report&id=${assign.id}` }
        ]);
      }
    } catch (parseErr) {
      console.error('[TELEGRAM BOT] Failed to parse assignment section:', parseErr);
    }
  }

  return inlineKeyboard.length > 0 ? { inline_keyboard: inlineKeyboard } : undefined;
}

function wrapThaiText(text: string, maxWidth: number, font: any, fontSize: number) {
  if (!text) return [];
  const segments = text.split(/(\s+)/);
  const lines = [];
  let currentLine = '';

  for (const segment of segments) {
    const testLine = currentLine + segment;
    const lineWidth = font.widthOfTextAtSize(testLine, fontSize);
    if (lineWidth > maxWidth && currentLine !== '') {
      lines.push(currentLine);
      currentLine = segment;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

async function applyStampsOnServer(
  pdfBuffer: ArrayBuffer,
  directorData: {
    order: string;
    signer: string;
    date: string;
    position?: string;
    signatureUrl?: string;
    pageNumber?: number;
  }
) {
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    pdfDoc.registerFontkit(fontkit);

    let fontBytes: ArrayBuffer;
    try {
      const fontB64Path = path.join(process.cwd(), 'font.b64');
      const localFontPath = path.join(process.cwd(), 'public', 'fonts', 'THSarabunNew.ttf');
      const localDistFontPath = path.join(process.cwd(), 'dist', 'fonts', 'THSarabunNew.ttf');
      const rootFontPath = path.join(process.cwd(), 'THSarabunNew.ttf');

      if (fs.existsSync(localFontPath)) {
        const buffer = fs.readFileSync(localFontPath);
        fontBytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      } else if (fs.existsSync(localDistFontPath)) {
        const buffer = fs.readFileSync(localDistFontPath);
        fontBytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      } else if (fs.existsSync(fontB64Path)) {
        const b64Str = fs.readFileSync(fontB64Path, 'utf-8');
        const buf = Buffer.from(b64Str.trim(), 'base64');
        fontBytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      } else if (fs.existsSync(rootFontPath)) {
        const buffer = fs.readFileSync(rootFontPath);
        fontBytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      } else {
        const remoteFontUrl = process.env.VERCEL_URL 
          ? `https://${process.env.VERCEL_URL}/fonts/THSarabunNew.ttf` 
          : 'https://cdn.jsdelivr.net/gh/lazywasabi/thai-web-fonts@master/fonts/THSarabunNew/THSarabunNew.ttf';
        const res = await fetch(remoteFontUrl);
        if (!res.ok) throw new Error(`Failed to fetch remote font from ${remoteFontUrl}: status ${res.status}`);
        fontBytes = await res.arrayBuffer();
      }
    } catch (err) {
      console.error('Error loading local/preferred font, falling back to remote network fetch:', err);
      const fallbackFontUrl = process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}/fonts/THSarabunNew.ttf` 
        : 'https://cdn.jsdelivr.net/gh/lazywasabi/thai-web-fonts@master/fonts/THSarabunNew/THSarabunNew.ttf';
      const res = await fetch(fallbackFontUrl);
      if (!res.ok) throw new Error(`Remote network backup fetch failed: status ${res.status}`);
      fontBytes = await res.arrayBuffer();
    }

    const customFont = await pdfDoc.embedFont(fontBytes);
    const pages = pdfDoc.getPages();
    const pageCount = pages.length;

    const requestedPage = directorData.pageNumber || 1;
    const pageIndex = Math.min(Math.max(requestedPage - 1, 0), pageCount - 1);
    const targetPage = pages[pageIndex];

    const { width } = targetPage.getSize();
    const stampColor = rgb(0.1, 0.2, 0.7);
    const fontSize = 15;
    const receiptBoxWidth = 140;
    const rightMargin = 30;
    const startX = width - receiptBoxWidth - rightMargin;
    const effectiveWidth = receiptBoxWidth;
    const dirY = 140;

    targetPage.drawText(`คำสั่ง / การปฏิบัติ`, {
      x: startX,
      y: dirY + 115,
      size: fontSize + 1,
      font: customFont,
      color: stampColor,
    });

    const orderLines = wrapThaiText(directorData.order, effectiveWidth, customFont, fontSize);
    let dCurrentY = dirY + 98;
    for (const line of orderLines) {
      targetPage.drawText(line, { x: startX, y: dCurrentY, size: fontSize, font: customFont, color: stampColor });
      dCurrentY -= 18;
    }

    const dirSignerY = dCurrentY - 35;

    if (directorData.signatureUrl) {
      try {
        const sigRes = await fetch(directorData.signatureUrl);
        if (sigRes.ok) {
          const sigBytes = await sigRes.arrayBuffer();
          const isPng = directorData.signatureUrl.toLowerCase().includes('.png') || directorData.signatureUrl.toLowerCase().includes('image/png');
          const sigImage = isPng ? await pdfDoc.embedPng(sigBytes) : await pdfDoc.embedJpg(sigBytes);
          const sigDims = sigImage.scale(0.50);
          targetPage.drawImage(sigImage, {
            x: startX + 60,
            y: dirSignerY + 10,
            width: sigDims.width,
            height: sigDims.height,
          });
        }
      } catch (imgErr) { console.error('Server PDF Signature image embed error:', imgErr); }
    }

    targetPage.drawText(`(ลงชื่อ) ........................................`, { x: startX - 10, y: dirSignerY, size: fontSize, font: customFont, color: stampColor });
    targetPage.drawText(`(${directorData.signer})`, { x: startX + 15, y: dirSignerY - 17, size: fontSize, font: customFont, color: stampColor });

    if (directorData.position) {
      targetPage.drawText(`${directorData.position}`, { x: startX - 5, y: dirSignerY - 34, size: fontSize, font: customFont, color: stampColor });
    }

    const dateObj = new Date(directorData.date);
    const thDay = dateObj.getDate();
    const thMonthAbbr = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."][dateObj.getMonth()];
    const thYear = dateObj.getFullYear() + 543;
    const thDateStr = `${thDay}/${thMonthAbbr}/${thYear}`;

    const thNumerals = ['๐', '๑', '๒', '๓', '๔', '๕', '๖', '๗', '๘', '๙'];
    const thaiFormattedDate = thDateStr.replace(/[0-9]/g, (digit) => thNumerals[parseInt(digit)]);

    targetPage.drawText(`วันที่: ${thaiFormattedDate}`, {
      x: startX + 20,
      y: dirSignerY - (directorData.position ? 51 : 34),
      size: fontSize,
      font: customFont,
      color: stampColor,
    });

    const pdfBytes = await pdfDoc.save();
    return pdfBytes;
  } catch (err: any) {
    console.error('applyStampsOnServer error:', err);
    throw err;
  }
}

/** ฟังก์ชันดำเนินการส่งต่องานให้ครูท่านอื่นเฉพาะบุคคล (1-on-1 ไม่ส่งเข้ากลุ่มกลาง) */
async function executeForwardAssignment(
  assignId: string,
  targetTeacherId: string,
  customInstruction: string | null,
  botToken: string,
  senderChatId: number,
  senderProfile: any,
  supabase: any
) {
  try {
    // 1. ดึงข้อมูลงานเดิม และหนังสือรับ
    const { data: oldAssign, error: fetchErr } = await supabase
      .from('doc_assignments')
      .select('*, incoming_docs(*), teachers:assignee_id(prefix, first_name, last_name)')
      .eq('id', assignId)
      .single();

    if (fetchErr || !oldAssign || !oldAssign.incoming_docs) {
      await sendTelegramMessage(botToken, senderChatId, '❌ ไม่พบข้อมูลงานมอบหมายเดิมในระบบค่ะ');
      return;
    }

    const { data: targetTeacher } = await supabase
      .from('teachers')
      .select('*')
      .eq('id', targetTeacherId)
      .single();

    if (!targetTeacher) {
      await sendTelegramMessage(botToken, senderChatId, '❌ ไม่พบข้อมูลคุณครูปลายทางในระบบค่ะ');
      return;
    }

    // ชื่อครูผู้ส่งต่อ
    const senderName = senderProfile?.display_name || 
      (oldAssign.teachers ? `${oldAssign.teachers.prefix || ''}${oldAssign.teachers.first_name} ${oldAssign.teachers.last_name}` : 'คุณครู');

    // คำสั่งการส่งต่อ
    const finalInstruction = customInstruction && customInstruction.trim() !== ''
      ? `[ส่งต่อจาก ${senderName}]: ${customInstruction.trim()}`
      : `[ส่งต่อจาก ${senderName}]: ${oldAssign.instruction || 'โปรดดำเนินการตามหนังสือฉบับนี้'}`;

    // 2. สร้าง record การมอบหมายงานใหม่ใน doc_assignments ให้ครูปลายทาง
    const { data: newAssign, error: insertErr } = await supabase
      .from('doc_assignments')
      .insert({
        doc_id: oldAssign.doc_id,
        assignee_id: targetTeacherId,
        instruction: finalInstruction,
        status: 'pending'
      })
      .select()
      .single();

    if (insertErr || !newAssign) {
      console.error('[FWD ASSIGN ERROR]', insertErr);
      await sendTelegramMessage(botToken, senderChatId, '❌ เกิดข้อผิดพลาดในการบันทึกการส่งต่องาน กรุณาลองใหม่อีกครั้งค่ะ');
      return;
    }

    const targetName = `${targetTeacher.prefix || ''}${targetTeacher.first_name} ${targetTeacher.last_name}`;
    const doc = oldAssign.incoming_docs;

    // 3. ดึง telegram_chat_id ของครูปลายทางจาก teachers หรือ profiles (ส่งตรงเฉพาะบุคคล ไม่ส่งเข้ากลุ่มกลาง)
    let targetChatId = targetTeacher.telegram_chat_id;
    if (!targetChatId && targetTeacher.email) {
      const { data: targetProfile } = await supabase
        .from('profiles')
        .select('telegram_chat_id')
        .eq('email', targetTeacher.email)
        .maybeSingle();
      if (targetProfile?.telegram_chat_id) {
        targetChatId = targetProfile.telegram_chat_id;
      }
    }

    if (!targetChatId && targetTeacher.first_name) {
      const { data: matchedProfile } = await supabase
        .from('profiles')
        .select('telegram_chat_id')
        .ilike('display_name', `%${targetTeacher.first_name.trim()}%`)
        .maybeSingle();
      if (matchedProfile?.telegram_chat_id) {
        targetChatId = matchedProfile.telegram_chat_id;
      }
    }

    const docButtons: any[] = [];
    if (doc.file_url && (doc.file_url.startsWith('http://') || doc.file_url.startsWith('https://'))) {
      docButtons.push({ text: '📄 ดูเอกสารสั่งการ', url: doc.file_url });
    }

    const fwdMarkup = {
      inline_keyboard: [
        ...(docButtons.length > 0 ? [docButtons] : []),
        [
          { text: '✅ รับทราบงาน', callback_data: `action=acknowledge&id=${newAssign.id}` }
        ],
        [
          { text: '↪️ ส่งต่อเฉพาะบุคคล', callback_data: `action=fwd_start&id=${newAssign.id}` },
          { text: '📢 ประชาสัมพันธ์ลงกลุ่มกลาง', callback_data: `action=bc_grp&id=${newAssign.id}` }
        ]
      ]
    };

    let fwdPersonalMsg = `📬 <b>มีงานส่งต่อถึงคุณครูค่ะ (เฉพาะบุคคล)</b>\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    fwdPersonalMsg += `• <b>เรื่อง</b>: ${escapeHtml(doc.subject || '-')}\n`;
    fwdPersonalMsg += `• <b>เลขที่รับ</b>: <code>${escapeHtml(doc.doc_number || '-')}</code>\n`;
    fwdPersonalMsg += `• <b>จากหน่วยงาน</b>: ${escapeHtml(doc.from_agency || '-')}\n`;
    fwdPersonalMsg += `• <b>ส่งต่อโดย</b>: <b>${escapeHtml(senderName)}</b>\n`;
    fwdPersonalMsg += `• <b>คำสั่งการ/แนวทาง</b>: ${escapeHtml(finalInstruction)}\n\n`;
    if (doc.action_deadline) {
      const dlStr = new Date(doc.action_deadline).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
      fwdPersonalMsg += `⏰ <b>กำหนดส่ง/จัดงาน</b>: <u>${dlStr}</u>\n\n`;
    }
    if (doc.file_url) {
      fwdPersonalMsg += `📄 <a href="${doc.file_url}">เปิดดูต้นฉบับเอกสารสั่งการ</a>`;
    }

    let sentDirect = false;
    if (targetChatId) {
      await sendTelegramMessage(botToken, parseInt(String(targetChatId), 10), fwdPersonalMsg, fwdMarkup);
      sentDirect = true;
    }

    // 4. แจ้งยืนยันกลับครูผู้ส่งต่อ (ในแชทส่วนตัว ไม่ส่งเข้ากลุ่มกลางเด็ดขาด)
    const notifySenderMsg = sentDirect
      ? `✅ <b>ส่งต่องานเรียบร้อยแล้วค่ะ!</b>\n\nส่งต่องานเรื่อง "<b>${escapeHtml(doc.subject)}</b>" ให้คุณครู <b>${escapeHtml(targetName)}</b> ทาง Telegram ส่วนบุคคลเรียบร้อยแล้วค่ะ 🌸\n<i>(ระบบส่งตรงเฉพาะบุคคล ไม่ส่งเข้ากลุ่มกลางตามคำสั่ง)</i>`
      : `✅ <b>ส่งต่องานเรียบร้อยแล้วค่ะ!</b>\n\nบันทึกส่งต่องานเรื่อง "<b>${escapeHtml(doc.subject)}</b>" ให้คุณครู <b>${escapeHtml(targetName)}</b> ในระบบสารบรรณเรียบร้อยแล้วค่ะ 🌸\n<i>(คุณครูปลายทางยังไม่ได้ผูก Telegram จึงบันทึกมอบหมายงานบนระบบสารบรรณเว็บไซต์ให้โดยตรงค่ะ)</i>`;

    await sendTelegramMessage(botToken, senderChatId, notifySenderMsg);

  } catch (err: any) {
    console.error('executeForwardAssignment error:', err);
    await sendTelegramMessage(botToken, senderChatId, `❌ เกิดข้อผิดพลาดในการส่งต่องาน: ${err.message || 'Unknown error'}`);
  }
}

async function executeDocAssignment(
  docId: string,
  teacherId: string,
  instruction: string,
  botToken: string,
  chatId: number,
  profile: any,
  supabase: any
) {
  try {
    const { data: doc } = await supabase
      .from('incoming_docs')
      .select('*')
      .eq('id', docId)
      .single();

    if (!doc) {
      await sendTelegramMessage(botToken, chatId, '❌ ไม่พบข้อมูลหนังสือรับชิ้นนี้ในระบบค่ะ');
      return;
    }

    const { data: teacher } = await supabase
      .from('teachers')
      .select('*')
      .eq('id', teacherId)
      .single();

    if (!teacher) {
      await sendTelegramMessage(botToken, chatId, '❌ ไม่พบข้อมูลคุณครูในระบบค่ะ');
      return;
    }

    let proposalStampPage = 1;
    if (doc.remark) {
      try {
        const extra = typeof doc.remark === 'object' ? doc.remark : JSON.parse(doc.remark);
        if (extra && extra.stamp_page) proposalStampPage = parseInt(extra.stamp_page) || 1;
      } catch (e) {}
    }

    const { data: settings } = await supabase
      .from('settings')
      .select('school_name, director_name, director_signature_url')
      .limit(1)
      .maybeSingle();

    const schoolLabel = settings?.school_name 
      ? (settings.school_name.startsWith('โรงเรียน') ? settings.school_name : `โรงเรียน${settings.school_name}`)
      : '';
    const directorPosition = schoolLabel ? `ผู้อำนวยการ${schoolLabel}` : 'ผู้อำนวยการโรงเรียน';

    let finalFileUrl = doc.file_url;
    if (doc.file_url && doc.file_url.includes('supabase.co') && doc.file_url.toLowerCase().includes('.pdf')) {
      try {
        const fileRes = await fetch(doc.file_url);
        if (fileRes.ok) {
          const pdfBuffer = await fileRes.arrayBuffer();
          const stampedBytes = await applyStampsOnServer(pdfBuffer, {
            order: instruction,
            signer: settings?.director_name || profile.display_name || 'ผู้อำนวยการโรงเรียน',
            position: directorPosition,
            date: new Date().toISOString().split('T')[0],
            signatureUrl: settings?.director_signature_url || profile.signature_url,
            pageNumber: proposalStampPage
          });

          const pathSegments = doc.file_url.split('/');
          const fileName = pathSegments[pathSegments.length - 1].split('?')[0];

          await supabase.storage.from('temp_docs').upload(fileName, stampedBytes, { contentType: 'application/pdf', upsert: true });

          const { data: publicData } = supabase.storage.from('temp_docs').getPublicUrl(fileName);
          if (publicData?.publicUrl) finalFileUrl = `${publicData.publicUrl}?t=${Date.now()}`;

          const gasUrl = process.env.VITE_GAS_URL || 'https://script.google.com/macros/s/AKfycbzvITJ2HwYAB3tlDDbnjv52b97goxigd2KzNGSIu3jfnlNIpZyNB4hC2nCg_0lxek9E/exec';
          const base64 = Buffer.from(stampedBytes).toString('base64');
          const sanitizedSubject = doc.subject.replace(/[\/\\?%*:|"<>]/g, '-').slice(0, 50);
          const finalFileName = `${doc.doc_number}_เรื่อง_${sanitizedSubject}.pdf`;

          try {
            const driveRes = await fetch(gasUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                folder: 'incoming', 
                filename: finalFileName, 
                mimeType: 'application/pdf', 
                base64: base64,
                year: doc.doc_year || (new Date().getFullYear() + 543)
              })
            });

            if (driveRes.ok) {
              const driveResult = await driveRes.json() as any;
              if (driveResult.status === 'success' && driveResult.url) {
                finalFileUrl = driveResult.url;
                try {
                  await supabase.storage.from('temp_docs').remove([fileName]);
                } catch (e) {}
              }
            }
          } catch (e) {}
        }
      } catch (e) {}
    }

    await supabase.from('incoming_docs').update({ status: 'assigned', file_url: finalFileUrl }).eq('id', docId);

    const { data: insertedAssigns, error: assignErr } = await supabase
      .from('doc_assignments')
      .insert([{ doc_id: docId, assignee_id: teacherId, instruction: instruction, status: 'pending' }])
      .select();

    if (assignErr) throw assignErr;
    const assignment = insertedAssigns?.[0];

    // Fix Bug#1: ใช้ telegram_chat_id จาก profile แทน profile.id (UUID) เพื่อล้าง State ให้ถูก user
    const profileTgId = profile?.telegram_chat_id || profile?.id;
    await supabase.from('line_action_states').delete().eq('user_id', `telegram:${profileTgId}`);

    const teacherName = `${teacher.prefix || ''}${teacher.first_name} ${teacher.last_name}`;
    await sendTelegramMessage(botToken, chatId, `✅ ทำการเกษียณสั่งการหนังสือเรื่อง "${escapeHtml(doc.subject)}" และมอบหมายงานให้คุณครู <b>${escapeHtml(teacherName)}</b> เรียบร้อยแล้วค่ะ 🌸`);

    // สกัด attachment_urls ของหนังสือรับ (สิ่งที่ส่งมาด้วย)
    const rawAttachments = doc.attachment_urls;
    let attachmentUrls: string[] = [];
    if (Array.isArray(rawAttachments)) {
      attachmentUrls = rawAttachments.filter(Boolean);
    } else if (typeof rawAttachments === 'string') {
      try {
        const parsed = JSON.parse(rawAttachments);
        if (Array.isArray(parsed)) attachmentUrls = parsed.filter(Boolean);
      } catch { /* ignore */ }
    }

    let attachLinksText = '';
    if (attachmentUrls.length > 0) {
      attachLinksText = `\n\n📎 <b>สิ่งที่ส่งมาด้วย (ไฟล์แนบ):</b>`;
      attachmentUrls.forEach((url: string, idx: number) => {
        attachLinksText += `\n  ${idx + 1}. <a href="${url}">ไฟล์แนบ ${idx + 1}</a>`;
      });
    }

    const personalMsg = `📌 <b>มีงานมอบหมายใหม่ถึงคุณ</b>\n\n• <b>เรื่อง</b>: ${escapeHtml(doc.subject)}\n• <b>เลขที่หนังสือ</b>: ${escapeHtml(doc.doc_number)}\n• <b>คำสั่งการ</b>: ${escapeHtml(instruction)}\n\n📄 <a href="${finalFileUrl}">เปิดดูต้นฉบับเอกสารสั่งการ</a>${attachLinksText}`;
    const { data: teacherProfile } = await supabase.from('profiles').select('telegram_chat_id').eq('email', teacher.email).maybeSingle();

    const docButtons: any[] = [];
    if (finalFileUrl) {
      docButtons.push({ text: '📄 ดูเอกสารสั่งการ', url: finalFileUrl });
    }
    if (attachmentUrls.length > 0) {
      attachmentUrls.slice(0, 2).forEach((url, i) => {
        docButtons.push({ text: `📎 แนบ ${i + 1}`, url });
      });
    }

    if (teacherProfile?.telegram_chat_id) {
      const teacherReplyMarkup = {
        inline_keyboard: [
          ...(docButtons.length > 0 ? [docButtons] : []),
          [
            { text: '✅ รับทราบงาน', callback_data: `action=acknowledge&id=${assignment.id}` }
          ],
          [
            { text: '↪️ ส่งต่อเฉพาะบุคคล', callback_data: `action=fwd_start&id=${assignment.id}` },
            { text: '📢 ประชาสัมพันธ์ลงกลุ่มกลาง', callback_data: `action=bc_grp&id=${assignment.id}` }
          ]
        ]
      };
      await sendTelegramMessage(botToken, parseInt(teacherProfile.telegram_chat_id), personalMsg, teacherReplyMarkup);
    } else {
      const teacherReplyMarkup = {
        inline_keyboard: [
          ...(docButtons.length > 0 ? [docButtons] : []),
          [
            { text: '✅ รับทราบงาน', callback_data: `action=acknowledge&id=${assignment.id}` }
          ],
          [
            { text: '↪️ ส่งต่อเฉพาะบุคคล', callback_data: `action=fwd_start&id=${assignment.id}` }
          ]
        ]
      };
      const fallbackGroupMsg = `📢 <b>แจ้งมอบหมายงานใหม่</b>\n\n• <b>ถึงคุณครู</b>: ${escapeHtml(teacherName)}\n• <b>เรื่อง</b>: ${escapeHtml(doc.subject)}\n• <b>เลขที่หนังสือ</b>: ${escapeHtml(doc.doc_number)}\n• <b>คำสั่งการ</b>: ${escapeHtml(instruction)}\n\n📄 <a href="${finalFileUrl}">เปิดดูเอกสารสั่งการ</a>${attachLinksText}`;
      await sendTelegramMessage(botToken, chatId, fallbackGroupMsg, teacherReplyMarkup);
    }

    // ── 7. Auto-Next Document Queue: ส่งหนังสือฉบับถัดไปให้ ผอ. เกษียณสั่งการต่อทันที (Continuous Workflow) ──
    try {
      const { data: nextDocs, count: remainingCount } = await supabase
        .from('incoming_docs')
        .select('id, doc_number, subject, from_agency, urgency, doc_date, file_url, attachment_urls, remark, action_deadline, created_at', { count: 'exact' })
        .in('status', ['pending', 'waiting_proposal'])
        .order('created_at', { ascending: true })
        .limit(1);

      if (nextDocs && nextDocs.length > 0) {
        const nextDoc = nextDocs[0];
        const nextCount = (remainingCount || 1);
        
        const uBadge = nextDoc.urgency === 'ด่วนที่สุด' 
          ? '🔴 <b>[ด่วนที่สุด]</b>' 
          : nextDoc.urgency === 'ด่วนมาก' 
            ? '🟠 <b>[ด่วนมาก]</b>' 
            : nextDoc.urgency === 'ด่วน' 
              ? '🟡 <b>[ด่วน]</b>' 
              : '🟢 <b>[ปกติ]</b>';

        let nextSummary = '';
        let nextSenderNo = '';
        let nextSenderDate = '';
        try {
          const rObj = typeof nextDoc.remark === 'object' ? nextDoc.remark : JSON.parse(nextDoc.remark || '{}');
          nextSummary = rObj.proposal_summary || rObj.ai_summary || '';
          nextSenderNo = rObj.sender_doc_number || '';
          nextSenderDate = rObj.sender_doc_date || '';
        } catch {}

        let nextMsg = `📬 <b>[หนังสือรอเกษียณฉบับถัดไป] (ยังเหลืออีก ${nextCount} ฉบับในคิว)</b>\n━━━━━━━━━━━━━━━━━━━━\n\n`;
        nextMsg += `${uBadge} 📌 <b>เลขรับที่:</b> <code>${escapeHtml(nextDoc.doc_number || '-')}</code>\n`;
        nextMsg += `📋 <b>เรื่อง:</b> <b>${escapeHtml(nextDoc.subject || '-')}</b>\n`;
        nextMsg += `🏛️ <b>จาก:</b> ${escapeHtml(nextDoc.from_agency || '-')}\n`;

        if (nextSenderNo || nextSenderDate) {
          nextMsg += `🔢 <b>เลขที่ผู้ส่ง:</b> <code>${escapeHtml(nextSenderNo || '-')}</code> ${nextSenderDate ? `(ลงวันที่ ${toDMYString(nextSenderDate)})` : ''}\n`;
        }

        if (nextSummary) {
          nextMsg += `\n✨ <b>สาระสำคัญ (เกษียณเสนอ):</b>\n<blockquote>${escapeHtml(nextSummary)}</blockquote>\n`;
        }

        if (nextDoc.action_deadline) {
          nextMsg += `⏰ <b>กำหนดส่ง/จัดงาน:</b> <u>${toDMYString(nextDoc.action_deadline)}</u>\n`;
        }

        if (nextDoc.file_url) {
          nextMsg += `\n━━━━━━━━━━━━━━━━━━━━\n📄 <a href="${nextDoc.file_url}"><b>[เปิดดูต้นฉบับหนังสือนำ]</b></a>`;
        }

        let nextAtts: string[] = [];
        if (Array.isArray(nextDoc.attachment_urls)) nextAtts = nextDoc.attachment_urls.filter(Boolean);
        else if (typeof nextDoc.attachment_urls === 'string') {
          try { nextAtts = JSON.parse(nextDoc.attachment_urls).filter(Boolean); } catch {}
        }
        if (nextAtts.length > 0) {
          nextMsg += `\n📎 <b>สิ่งที่ส่งมาด้วย (ไฟล์แนบ):</b>\n`;
          nextAtts.forEach((url, i) => {
            nextMsg += `   🔹 <a href="${url}">ไฟล์แนบที่ ${i + 1}</a>\n`;
          });
        }

        const nextButtons: any[] = [
          [{
            text: `✍️ เกษียณสั่งการเรื่องที่ ${nextDoc.doc_number || 'ถัดไป'}`,
            callback_data: `action=start_assign&id=${nextDoc.id}`
          }]
        ];

        await sendTelegramMessage(botToken, chatId, nextMsg, { inline_keyboard: nextButtons });
      } else {
        await sendTelegramMessage(botToken, chatId, `🎉 <b>ยอดเยี่ยมมากค่ะ ผอ.!</b>\n\nขณะนี้เกษียณสั่งการหนังสือครบทุกฉบับในคิวเรียบร้อยแล้วค่ะ พักผ่อนได้สบายใจเลยนะคะ 🌸✨`);
      }
    } catch (queueErr) {
      console.warn('[AUTO NEXT QUEUE ERROR]', queueErr);
    }

  } catch (err: any) {
    console.error('executeDocAssignment error:', err);
    await sendTelegramMessage(botToken, chatId, `❌ ดำเนินการไม่สำเร็จ: ${err.message}`);
  }
}

/** สร้าง Supabase client โดยใช้ Service Role Key เพื่อก้าวข้ามสิทธิ์ RLS */
function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment variables.');
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

/** ตอบรับ Callback Query เพื่อหยุดปุ่มหมุนค้าง และส่งข้อความ Alert ได้ */
async function answerCallbackQuery(botToken: string, callbackQueryId: string, text?: string, showAlert: boolean = false) {
  const url = `https://api.telegram.org/bot${botToken}/answerCallbackQuery`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text: text,
      show_alert: showAlert
    }),
  });
}

/** แก้ไขปุ่มของข้อความเดิมบน Telegram */
async function editTelegramMessageMarkup(botToken: string, chatId: number, messageId: number, replyMarkup: any) {
  const url = `https://api.telegram.org/bot${botToken}/editMessageReplyMarkup`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      reply_markup: replyMarkup
    }),
  });
}

/** ดึงปุ่ม Markup ตามสถานะงานที่ส่งมอบ เพื่อป้องกันการกดรับทราบ/รายงานซ้ำ */
function getUpdatedMarkupForStatus(status: string, assignmentId: string) {
  if (status === 'pending') {
    return {
      inline_keyboard: [
        [{ text: '✅ รับทราบงาน', callback_data: `action=acknowledge&id=${assignmentId}` }],
        [
          { text: '↪️ ส่งต่อเฉพาะบุคคล', callback_data: `action=fwd_start&id=${assignmentId}` },
          { text: '📢 ประชาสัมพันธ์ลงกลุ่มกลาง', callback_data: `action=bc_grp&id=${assignmentId}` }
        ]
      ]
    };
  } else if (status === 'acknowledged') {
    return {
      inline_keyboard: [
        [{ text: '📝 รายงานผลการปฏิบัติงาน', callback_data: `action=report&id=${assignmentId}` }],
        [
          { text: '↪️ ส่งต่อเฉพาะบุคคล', callback_data: `action=fwd_start&id=${assignmentId}` },
          { text: '📢 ประชาสัมพันธ์ลงกลุ่มกลาง', callback_data: `action=bc_grp&id=${assignmentId}` }
        ]
      ]
    };
  } else if (status === 'completed') {
    return {
      inline_keyboard: [
        [{ text: '📊 รายงานผลแล้ว (รอ ผอ. ตรวจ)', callback_data: `action=noop` }]
      ]
    };
  } else if (status === 'closed') {
    return {
      inline_keyboard: [
        [{ text: '🔒 งานนี้เสร็จสิ้นแล้ว', callback_data: `action=noop` }]
      ]
    };
  }
  return { inline_keyboard: [] };
}

/**
 * จัดการคำสั่ง Inline Callback ของระบบจัดซื้อจัดจ้างอิเล็กทรอนิกส์ (EPCM Interactive Flow)
 * - prc_hok: หัวหน้าเจ้าหน้าที่เห็นชอบรายงานขอซื้อขอจ้าง (ข้อ 22) -> ส่งเสนอ ผอ. อัตโนมัติ
 * - prc_dok: ผู้อำนวยการอนุมัติจัดซื้อจัดจ้าง -> เลื่อนเป็น Gate 3, รันเลขคำสั่ง & PO, แจ้งเตือนผู้เกี่ยวข้อง
 * - prc_rej: ส่งกลับแก้ไข / ไม่อนุมัติ
 */
async function handleProcurementCallback(
  action: string,
  params: URLSearchParams,
  callbackQuery: any,
  callbackChatId: number,
  profileLinked: any,
  botToken: string,
  supabase: any,
  settings: any
) {
  const caseId = params.get('id');
  if (!caseId) {
    await answerCallbackQuery(botToken, callbackQuery.id, '❌ ไม่พบรหัสสำนวนจัดซื้อจัดจ้างค่ะ', true);
    return;
  }

  // 1. ดึงข้อมูลสำนวนจากตาราง procurement_cases
  const { data: caseData, error: caseErr } = await supabase
    .from('procurement_cases')
    .select('*')
    .eq('id', caseId)
    .maybeSingle();

  if (caseErr || !caseData) {
    await answerCallbackQuery(botToken, callbackQuery.id, '❌ ไม่พบข้อมูลสำนวนนี้ในระบบค่ะ', true);
    return;
  }

  const amount = Number(caseData.final_amount) || Number(caseData.estimated_amount) || 0;
  const amountFmt = amount.toLocaleString('th-TH', { minimumFractionDigits: 2 });
  const rawGroupId = settings?.telegram_group_id || '';
  const proposalChatId = rawGroupId.split('|')[1]?.trim() || rawGroupId.split('|')[0]?.trim() || callbackChatId;
  const centralChatId = rawGroupId.split('|')[0]?.trim() || callbackChatId;

  // 2. กรณี: หัวหน้าเจ้าหน้าที่เห็นชอบเสนอ ผอ. (prc_hok)
  if (action === 'prc_hok') {
    await answerCallbackQuery(botToken, callbackQuery.id, '✅ บันทึกความเห็นชอบของหัวหน้าเจ้าหน้าที่แล้วค่ะ 🌸');

    const existingSigs = caseData.approval_signatures || {};
    existingSigs.head_officer = {
      signed: true,
      at: new Date().toISOString(),
      by: profileLinked.display_name || 'หัวหน้าเจ้าหน้าที่พัสดุ'
    };

    // อัปเดตฐานข้อมูล (DB-First)
    await supabase
      .from('procurement_cases')
      .update({
        status: 'pending_approval',
        approval_signatures: existingSigs,
        updated_at: new Date().toISOString()
      })
      .eq('id', caseId);

    // แก้ไขปุ่มของข้อความเดิมบน Telegram
    await editTelegramMessageMarkup(botToken, callbackChatId, callbackQuery.message.message_id, {
      inline_keyboard: [[{ text: `✅ เห็นชอบแล้ว (${profileLinked.display_name || 'หัวหน้าเจ้าหน้าที่'})`, callback_data: 'action=noop' }]]
    });

    // ส่งข้อความการ์ดเสนอ ผอ. อนุมัติต่อไปยังห้องเสนอหนังสือ
    let dirMsg = `📌 <b>[เสนอ ผอ. อนุมัติจัดซื้อจัดจ้าง]</b>\n`;
    dirMsg += `━━━━━━━━━━━━━━━━━━━━\n`;
    dirMsg += `📂 <b>เลขสำนวน:</b> <code>${escapeHtml(caseData.pcid)}</code>\n`;
    dirMsg += `📝 <b>เรื่อง:</b> ${escapeHtml(caseData.title)}\n`;
    dirMsg += `💰 <b>วงเงินขออนุมัติ:</b> ฿${amountFmt} บาท\n`;
    dirMsg += `🏪 <b>คู่สัญญา/ผู้ขาย:</b> ${escapeHtml(caseData.vendor_info?.name || 'ตามใบเสนอราคา')}\n`;
    dirMsg += `✅ <b>หัวหน้าเจ้าหน้าที่:</b> ${escapeHtml(profileLinked.display_name || 'หัวหน้าเจ้าหน้าที่')} (เห็นชอบเสนอ ผอ. แล้ว)\n`;
    dirMsg += `━━━━━━━━━━━━━━━━━━━━\n`;
    dirMsg += `<i>เรียน ผู้อำนวยการโรงเรียน เพื่อโปรดพิจารณาอนุมัติการจัดซื้อจัดจ้างและลงนามคำสั่งแต่งตั้ง/สัญญาค่ะ 🌸</i>`;

    const dirMarkup = {
      inline_keyboard: [
        [
          { text: '✍️ อนุมัติจัดซื้อ/จัดจ้าง', callback_data: `action=prc_dok&id=${caseId}` },
          { text: '❌ ไม่อนุมัติ', callback_data: `action=prc_rej&id=${caseId}` }
        ]
      ]
    };

    const targetProposalId = parseInt(proposalChatId, 10);
    if (!isNaN(targetProposalId)) {
      await sendTelegramMessage(botToken, targetProposalId, dirMsg, dirMarkup);
    } else {
      await sendTelegramMessage(botToken, callbackChatId, dirMsg, dirMarkup);
    }
    return;
  }

  // 3. กรณี: ผู้อำนวยการอนุมัติจัดซื้อจัดจ้าง (prc_dok)
  if (action === 'prc_dok') {
    if (profileLinked.role !== 'director' && profileLinked.role !== 'admin') {
      await answerCallbackQuery(botToken, callbackQuery.id, '❌ ขออภัยค่ะ สิทธิ์การอนุมัติต้องเป็นผู้อำนวยการโรงเรียนเท่านั้นค่ะ 🌸', true);
      return;
    }

    await answerCallbackQuery(botToken, callbackQuery.id, '🎉 ผู้อำนวยการอนุมัติจัดซื้อจัดจ้างเรียบร้อยแล้วค่ะ 🌸');

    const todayStr = new Date().toISOString().split('T')[0];
    const fiscalYear = caseData.fiscal_year || '2569';

    // ตรวจสอบและออกเลขคำสั่งแต่งตั้ง (ถ้ายังไม่มี)
    let orderNum = caseData.order_number;
    let appointmentOrderId = caseData.appointment_order_id;
    if (!orderNum) {
      try {
        const { data: latestOrder } = await supabase
          .from('orders')
          .select('id, order_number, sequence_number')
          .eq('doc_year', parseInt(fiscalYear, 10))
          .order('sequence_number', { ascending: false })
          .limit(1);

        const nextSeq = (latestOrder?.[0]?.sequence_number || 0) + 1;
        orderNum = `คำสั่งที่ ${nextSeq}/${fiscalYear}`;

        const { data: insertedOrder } = await supabase
          .from('orders')
          .insert({
            order_number: orderNum,
            sequence_number: nextSeq,
            doc_year: parseInt(fiscalYear, 10),
            title: `แต่งตั้งคณะกรรมการตรวจรับพัสดุ: ${caseData.title}`,
            doc_date: todayStr,
            status: 'approved'
          })
          .select('id')
          .maybeSingle();

        if (insertedOrder?.id) {
          appointmentOrderId = insertedOrder.id;
        }
      } catch (numErr) {
        console.error('[PROCUREMENT WEBHOOK] Auto reserve order error:', numErr);
        orderNum = `คำสั่งแต่งตั้ง (ออกในระบบ)`;
      }
    }

    // ตรวจสอบและออกเลข PO (ถ้ายังไม่มี)
    let poNum = caseData.po_number;
    if (!poNum) {
      try {
        const { data: latestPO } = await supabase
          .from('procurement_cases')
          .select('po_number')
          .eq('fiscal_year', fiscalYear)
          .not('po_number', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1);

        let nextSeq = 1;
        if (latestPO && latestPO.length > 0 && latestPO[0].po_number) {
          const parts = latestPO[0].po_number.split('/');
          const lastNum = parseInt(parts[0].replace(/\D/g, ''), 10);
          if (!isNaN(lastNum)) nextSeq = lastNum + 1;
        }
        poNum = `PO-${nextSeq}/${fiscalYear}`;
      } catch {
        poNum = `PO-1/${fiscalYear}`;
      }
    }

    const existingSigs = caseData.approval_signatures || {};
    existingSigs.director = {
      signed: true,
      at: new Date().toISOString(),
      by: profileLinked.display_name || 'ผู้อำนวยการโรงเรียน'
    };

    // อัปเดตฐานข้อมูลเป็น Gate 3: ordered (DB-First)
    await supabase
      .from('procurement_cases')
      .update({
        current_gate: 3,
        status: 'ordered',
        pr_approval_date: todayStr,
        po_date: todayStr,
        order_appointment_date: todayStr,
        order_number: orderNum,
        po_number: poNum,
        appointment_order_id: appointmentOrderId,
        approval_signatures: existingSigs,
        updated_at: new Date().toISOString()
      })
      .eq('id', caseId);

    // แก้ไขปุ่มของข้อความเดิมบน Telegram
    await editTelegramMessageMarkup(botToken, callbackChatId, callbackQuery.message.message_id, {
      inline_keyboard: [[{ text: `🔒 ผู้อำนวยการอนุมัติแล้ว (${profileLinked.display_name || 'ผอ.'})`, callback_data: 'action=noop' }]]
    });

    // ส่งข้อความยืนยันผลในแชท ผอ.
    let confirmMsg = `🎉 <b>[อนุมัติเรียบร้อย] สำนวนจัดซื้อจัดจ้าง</b>\n`;
    confirmMsg += `━━━━━━━━━━━━━━━━━━━━\n`;
    confirmMsg += `📂 <b>สำนวน:</b> <code>${escapeHtml(caseData.pcid)}</code>\n`;
    confirmMsg += `📝 <b>เรื่อง:</b> ${escapeHtml(caseData.title)}\n`;
    confirmMsg += `💰 <b>วงเงิน:</b> ฿${amountFmt} บาท\n`;
    confirmMsg += `📋 <b>เลขที่คำสั่งแต่งตั้ง:</b> <code>${escapeHtml(orderNum)}</code>\n`;
    confirmMsg += `🧾 <b>เลขที่ PO:</b> <code>${escapeHtml(poNum)}</code>\n`;
    confirmMsg += `✍️ <b>อนุมัติโดย:</b> ${escapeHtml(profileLinked.display_name || 'ผู้อำนวยการ')}\n`;
    confirmMsg += `━━━━━━━━━━━━━━━━━━━━\n`;
    confirmMsg += `<i>ระบบได้บันทึกการอนุมัติและเลื่อนสถานะไปยัง ขั้นตอนที่ 3 (ออกใบสั่งซื้อ/สัญญา) แล้วค่ะ 🌸</i>`;

    await sendTelegramMessage(botToken, callbackChatId, confirmMsg);

    // แจ้งเตือนไปยังกลุ่มส่วนกลาง
    const targetCentralId = parseInt(centralChatId, 10);
    if (!isNaN(targetCentralId) && targetCentralId !== callbackChatId) {
      await sendTelegramMessage(botToken, targetCentralId, confirmMsg);
    }

    // ส่งแจ้งเตือนบุคคลที่เกี่ยวข้อง (Requester & คณะกรรมการตรวจรับ)
    try {
      // ผู้ขอซื้อ
      if (caseData.requester_id) {
        const { data: reqTeacher } = await supabase.from('teachers').select('telegram_chat_id, email, first_name').eq('id', caseData.requester_id).maybeSingle();
        let reqChatId = reqTeacher?.telegram_chat_id;
        if (!reqChatId && reqTeacher?.email) {
          const { data: prof } = await supabase.from('profiles').select('telegram_chat_id').eq('email', reqTeacher.email).maybeSingle();
          reqChatId = prof?.telegram_chat_id;
        }
        if (reqChatId) {
          const numChatId = parseInt(reqChatId, 10);
          if (!isNaN(numChatId)) {
            let rMsg = `📬 <b>คำขอจัดซื้อจัดจ้างของท่านได้รับอนุมัติแล้วค่ะ</b>\n\n• <b>เรื่อง:</b> ${escapeHtml(caseData.title)}\n• <b>วงเงิน:</b> ฿${amountFmt} บาท\n• <b>เลขที่คำสั่ง:</b> ${escapeHtml(orderNum)}\n\nขณะนี้เจ้าหน้าที่พัสดุกำลังดำเนินการส่งใบสั่งซื้อแก่ร้านค้าค่ะ 🙏`;
            await sendTelegramMessage(botToken, numChatId, rMsg);
          }
        }
      }

      // คณะกรรมการตรวจรับ
      const members = Array.isArray(caseData.committee_members) ? caseData.committee_members : [];
      for (const m of members) {
        const teacherId = m.teacher_id || m.id;
        let cChatId = m.telegram_chat_id;
        if (!cChatId && teacherId) {
          const { data: t } = await supabase.from('teachers').select('telegram_chat_id, email').eq('id', teacherId).maybeSingle();
          cChatId = t?.telegram_chat_id;
          if (!cChatId && t?.email) {
            const { data: p } = await supabase.from('profiles').select('telegram_chat_id').eq('email', t.email).maybeSingle();
            cChatId = p?.telegram_chat_id;
          }
        }
        if (cChatId) {
          const numChatId = parseInt(cChatId, 10);
          if (!isNaN(numChatId)) {
            let cMsg = `📋 <b>แจ้งคำสั่งแต่งตั้งกรรมการตรวจรับพัสดุ (เฉพาะบุคคล)</b>\n━━━━━━━━━━━━━━━━━━━━\nท่านได้รับการแต่งตั้งตาม <b>${escapeHtml(orderNum)}</b>\nให้เป็นผู้ตรวจรับพัสดุสำหรับงาน:\n• <b>เรื่อง:</b> ${escapeHtml(caseData.title)}\n• <b>วงเงิน:</b> ฿${amountFmt} บาท\n\n<i>เมื่อพัสดุมาส่งถึงโรงเรียน ระบบจะแจ้งเตือนให้ท่านร่วมตรวจรับอีกครั้งค่ะ 🌸</i>`;
            await sendTelegramMessage(botToken, numChatId, cMsg);
          }
        }
      }
    } catch (notifyErr) {
      console.error('[PROCUREMENT WEBHOOK] Background notification error:', notifyErr);
    }

    return;
  }

  // 4. กรณี: ส่งกลับแก้ไข / ไม่อนุมัติ (prc_rej)
  if (action === 'prc_rej') {
    await answerCallbackQuery(botToken, callbackQuery.id, '↩️ บันทึกการส่งกลับแก้ไขแล้วค่ะ');

    await supabase
      .from('procurement_cases')
      .update({
        status: 'returned',
        updated_at: new Date().toISOString()
      })
      .eq('id', caseId);

    await editTelegramMessageMarkup(botToken, callbackChatId, callbackQuery.message.message_id, {
      inline_keyboard: [[{ text: `↩️ ส่งกลับแก้ไขแล้ว (${profileLinked.display_name || ''})`, callback_data: 'action=noop' }]]
    });

    let rejMsg = `↩️ <b>[ส่งกลับเพื่อแก้ไข] สำนวนจัดซื้อจัดจ้าง</b>\n`;
    rejMsg += `━━━━━━━━━━━━━━━━━━━━\n`;
    rejMsg += `📂 <b>สำนวน:</b> <code>${escapeHtml(caseData.pcid)}</code>\n`;
    rejMsg += `📝 <b>เรื่อง:</b> ${escapeHtml(caseData.title)}\n`;
    rejMsg += `👤 <b>ผู้ส่งกลับ:</b> ${escapeHtml(profileLinked.display_name || 'ผู้มีอำนาจ')}\n`;
    rejMsg += `━━━━━━━━━━━━━━━━━━━━\n`;
    rejMsg += `<i>กรุณาติดต่อเจ้าหน้าที่พัสดุเพื่อตรวจสอบและปรับปรุงเอกสารในระบบ EPCM ค่ะ</i>`;

    await sendTelegramMessage(botToken, callbackChatId, rejMsg);
    return;
  }
}

export default async function handler(req: any, res: any) {
  // รองรับเฉพาะ POST Webhook เท่านั้น
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // ตอบกลับ 200 OK ทันที เพื่อป้องกัน Telegram timeout และการเกิด Retry ส่งข้อความซ้ำ
  res.status(200).json({ ok: true });

  const mockRes: any = {
    status: () => mockRes,
    json: () => mockRes,
    send: () => mockRes,
    end: () => mockRes
  };

  waitUntil((async () => {
    const res = mockRes;
    try {
      const supabase = getSupabase();

    // --- 2. ดึงข้อมูลทั้งหมดจากตาราง settings (ซึ่งมีเพียงแถวเดียวสำหรับโครงการโรงเรียนนี้) ---
    const { data: settings, error: settingsErr } = await supabase
      .from('settings')
      .select('*')
      .single();

    const botToken = settings?.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN || '';
    if (!botToken) {
      console.error('[TELEGRAM WEBHOOK ERROR] Settings or Token not found:', settingsErr);
      return res.status(400).json({ 
        message: 'Missing telegram_bot_token in settings', 
        error: settingsErr ? settingsErr.message : 'Missing telegram_bot_token' 
      });
    }

    const currentYear = settings?.current_academic_year || '2569';
    
    // แยก telegram_group_id (รองรับการเก็บหลาย Group ID คั่นด้วย | หรือ ,)
    // Fix: ถ้าเก็บ "-5366918972|-1003945011511" ต้องแยกและแปลงเป็น Number ก่อนส่งหา Telegram API
    const rawGroupId = settings?.telegram_group_id || '';
    let primaryGroupId: number | null = null;
    if (rawGroupId) {
      const firstGroupId = rawGroupId.split(/[|,]/)[0].trim();
      const parsed = parseInt(firstGroupId, 10);
      if (!isNaN(parsed)) primaryGroupId = parsed;
    }

    const rawApiKey = settings?.ai_cowork_api_key || 
                      settings?.gemini_api_key || 
                      (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) || 
                      (typeof process !== 'undefined' && process.env?.VITE_GEMINI_API_KEY) || 
                      '';
    let apiKey = '';
    if (rawApiKey) {
      if (rawApiKey.includes(',')) {
        const keys = rawApiKey.split(',').map((k: string) => k.trim()).filter(Boolean);
        apiKey = keys[Math.floor(Math.random() * keys.length)] || '';
      } else {
        apiKey = rawApiKey.trim();
      }
    }

    // --- 3. แกะ payload ที่ Telegram ส่งมา ---
    const update = req.body;
    const message = update?.message;
    const callbackQuery = update?.callback_query;

    // จัดการ callback_query (ปุ่มกดแบบ Inline Keyboard)
    if (callbackQuery) {
      const callbackData = callbackQuery.data;
      const callbackChatId = callbackQuery.message?.chat?.id;
      const userTelegramId = callbackQuery.from?.id;

      if (!callbackData || !callbackChatId || !userTelegramId) {
        return res.status(200).json({ ok: true });
      }

      // 2. ดึงข้อมูล Profile ของผู้กดปุ่มเพื่อตรวจสอบสิทธิ์
      const { data: profileLinked, error: linkErr } = await supabase
        .from('profiles')
        .select('id, display_name, role, signature_url, email')
        .eq('telegram_chat_id', String(userTelegramId))
        
        .maybeSingle();

      if (linkErr || !profileLinked) {
        await sendTelegramMessage(botToken, callbackChatId, '❌ ขออภัยค่ะ ชบาหาบัญชีที่ผูกกับ Telegram ของคุณครูไม่พบค่ะ กรุณาผูกบัญชีของท่านในระบบก่อนใช้งานฟังก์ชันนี้หน้าตู้ควบคุมนะคะ 🌸');
        return res.status(200).json({ ok: true });
      }

      // 3. แยก params วิเคราะห์ action
      const params = new URLSearchParams(callbackData);
      const action = params.get('action');

      if (action === 'noop') {
        await answerCallbackQuery(botToken, callbackQuery.id);
        return res.status(200).json({ ok: true });
      }

      // ============================================================
      // 📦 EPCM Procurement Interactive Callback Routing (Zero-Regression)
      // ============================================================
      if (action && action.startsWith('prc_')) {
        await handleProcurementCallback(
          action,
          params,
          callbackQuery,
          callbackChatId,
          profileLinked,
          botToken,
          supabase,
          settings
        );
        return res.status(200).json({ ok: true });
      }

      if (action === 'smart_assign_confirm' || action === 'sm_asg') {
        const docId = params.get('doc_id') || params.get('id') || '';
        let teacherId = params.get('t_id') || '';

        if (profileLinked.role !== 'director' && profileLinked.role !== 'admin') {
          await answerCallbackQuery(botToken, callbackQuery.id, '❌ ขออภัยค่ะ ปุ่มนี้สำหรับผู้อำนวยการ/ผู้รักษาการเท่านั้นค่ะ 🌸', true);
          return res.status(200).json({ ok: true });
        }

        // หากไม่มี teacherId ส่งมาใน callback (เพื่อประหยัดความยาว <= 64 bytes) ให้ค้นหาจาก incoming_docs
        if (!teacherId && docId) {
          const { data: docInfo } = await supabase
            .from('incoming_docs')
            .select('suggested_assignee_id, remark')
            .eq('id', docId)
            .maybeSingle();

          if (docInfo?.suggested_assignee_id) {
            teacherId = docInfo.suggested_assignee_id;
          } else if (docInfo?.remark) {
            try {
              const parsed = typeof docInfo.remark === 'object' ? docInfo.remark : JSON.parse(docInfo.remark);
              teacherId = parsed.suggested_teacher_id || '';
            } catch {}
          }
        }

        if (!teacherId) {
          await answerCallbackQuery(botToken, callbackQuery.id, '❌ ไม่พบข้อมูลคุณครูที่แนะนำ กรุณากดปุ่ม "✍️ เกษียณสั่งการ" เพื่อเลือกครูด้วยตนเองค่ะ 🌸', true);
          return res.status(200).json({ ok: true });
        }

        await answerCallbackQuery(botToken, callbackQuery.id);

        const { data: doc } = await supabase.from('incoming_docs').select('action_deadline').eq('id', docId).single();
        let instructionText = 'มอบดำเนินการตามภารกิจ';
        if (doc?.action_deadline) {
          const dlStr = toDMYString(doc.action_deadline);
          instructionText = `มอบดำเนินการ (กำหนดส่งภายในวันที่ ${dlStr})`;
        }

        await executeDocAssignment(docId, teacherId, instructionText, botToken, callbackChatId, profileLinked, supabase);

        const completedMarkup = {
          inline_keyboard: [[{ text: '🔒 ดำเนินการมอบหมายงานเรียบร้อยแล้ว', callback_data: 'action=noop' }]]
        };
        await editTelegramMessageMarkup(botToken, callbackChatId, callbackQuery.message.message_id, completedMarkup);
        return res.status(200).json({ ok: true });
      }

      if (action === 'start_assign') {
        const docId = params.get('id');
        if (profileLinked.role !== 'director' && profileLinked.role !== 'admin') {
          await answerCallbackQuery(botToken, callbackQuery.id, '❌ ขออภัยค่ะ ปุ่มนี้สำหรับผู้อำนวยการ/ผู้รักษาการเท่านั้นค่ะ 🌸', true);
          return res.status(200).json({ ok: true });
        }

        const { data: doc } = await supabase
          .from('incoming_docs')
          .select('subject, status')
          .eq('id', docId)
          .single();

        if (!doc) {
          await answerCallbackQuery(botToken, callbackQuery.id, '❌ ไม่พบข้อมูลหนังสือรับชิ้นนี้ในระบบค่ะ', true);
          return res.status(200).json({ ok: true });
        }

        // ป้องกันการทำซ้ำในขั้นตอนเกษียณหนังสือของ ผอ.
        // Fix Bug#1: เพิ่ม waiting_proposal ให้ผ่านได้ เพราะระบบแจ้งเตือน director-pending-reminder ส่งทั้ง 2 status
        if (doc.status && doc.status !== 'pending' && doc.status !== 'waiting_proposal') {
          await answerCallbackQuery(botToken, callbackQuery.id, '⚠️ หนังสือรับฉบับนี้ได้รับการเกษียณสั่งการไปเรียบร้อยแล้วค่ะ', true);

          const completedMarkup = {
            inline_keyboard: [
              [
                { text: '🔒 เกษียณสั่งการแล้ว', callback_data: 'action=noop' }
              ]
            ]
          };
          await editTelegramMessageMarkup(botToken, callbackChatId, callbackQuery.message.message_id, completedMarkup);
          return res.status(200).json({ ok: true });
        }

        await answerCallbackQuery(botToken, callbackQuery.id);

        // ล้างสถานะเก่าของผู้ใช้นี้ออกก่อน จากนั้นเก็บ doc_id ลงใน Action State
        await supabase.from('line_action_states').delete().eq('user_id', `telegram:${userTelegramId}`);
        await supabase.from('line_action_states').insert([{
          user_id: `telegram:${userTelegramId}`,
          action: 'tg_assign_flow',
          context: { doc_id: docId },
          expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() // Fix Bug#6: ขยายเป็น 30 นาที ลด race condition
        }]);

        // ดึงรายชื่อคุณครู active ทั้งหมด
        const { data: teachers } = await supabase
          .from('teachers')
          .select('*')
          .eq('status', 'active')
          .order('first_name');

        if (!teachers || teachers.length === 0) {
          await sendTelegramMessage(botToken, callbackChatId, '❌ ไม่พบรายชื่อคุณครูในระบบสำหรับมอบหมายงานค่ะ');
          return res.status(200).json({ ok: true });
        }

        // สร้าง Inline Keyboard ปุ่มรายชื่อครู (2 คอลัมน์) โดยส่งค่าเพียงครู ID (เลี่ยงข้อจำกัด 64 bytes)
        const inlineKeyboard: any[] = [];
        for (let i = 0; i < teachers.length; i += 2) {
          const row: any[] = [];
          const t1 = teachers[i];
          const t2 = teachers[i + 1];
          
          row.push({
            text: `🧑‍🏫 ${t1.prefix || ''}${t1.first_name} ${t1.last_name.substring(0, 3)}.`,
            callback_data: `action=assign&t_id=${t1.id}`
          });
          
          if (t2) {
            row.push({
              text: `🧑‍🏫 ${t2.prefix || ''}${t2.first_name} ${t2.last_name.substring(0, 3)}.`,
              callback_data: `action=assign&t_id=${t2.id}`
            });
          }
          inlineKeyboard.push(row);
        }

        await sendTelegramMessage(
          botToken,
          callbackChatId,
          `🧑‍🏫 กรุณาเลือกคุณครูผู้รับมอบงานสำหรับเอกสารเรื่อง <b>"${escapeHtml(doc.subject)}"</b> ด้านล่างนี้ค่ะ:`,
          { inline_keyboard: inlineKeyboard }
        );

      } else if (action === 'assign') {
        await answerCallbackQuery(botToken, callbackQuery.id);
        const teacherId = params.get('t_id') || '';

        if (profileLinked.role !== 'director' && profileLinked.role !== 'admin') {
          await sendTelegramMessage(botToken, callbackChatId, '❌ ไม่มีสิทธิ์ดำเนินการค่ะ');
          return res.status(200).json({ ok: true });
        }

        // ค้นหา State ล่าสุดเพื่อดึง doc_id
        const { data: activeState } = await supabase
          .from('line_action_states')
          .select('*')
          .eq('user_id', `telegram:${userTelegramId}`)
          .eq('action', 'tg_assign_flow')
          .maybeSingle();

        if (!activeState || !activeState.context?.doc_id) {
          await sendTelegramMessage(botToken, callbackChatId, '❌ เซสชันการเกษียณสั่งการหมดอายุแล้วค่ะ กรุณากดปุ่มสั่งการใหม่อีกครั้งนะคะ');
          return res.status(200).json({ ok: true });
        }

        const docId = activeState.context.doc_id;

        // อัปเดตเพิ่ม teacher_id เข้าไปใน State
        await supabase
          .from('line_action_states')
          .update({
            context: { doc_id: docId, teacher_id: teacherId }
          })
          .eq('id', activeState.id);

        // แสดงตัวเลือกคำสั่งด่วน (ใช้ shortcodes ป้องกันความยาวปุ่มเกิน 64 bytes)
        const inlineKeyboard = [
          [{ text: 'สั่งการ: มอบดำเนินการ', callback_data: 'action=confirm_assign&ins=1' }],
          [{ text: 'สั่งการ: ทราบ/ถือปฏิบัติ', callback_data: 'action=confirm_assign&ins=2' }],
          [{ text: 'สั่งการ: ประสานงานต่อ', callback_data: 'action=confirm_assign&ins=3' }],
          [{ text: '✍️ พิมพ์ระบุคำสั่งเอง', callback_data: 'action=confirm_assign&ins=manual' }]
        ];

        await sendTelegramMessage(
          botToken,
          callbackChatId,
          '✍️ เลือกคำสั่งการเกษียณสั่งการหนังสือ หรือเลือกพิมพ์แบบเจาะจงเองด้านล่างค่ะ:',
          { inline_keyboard: inlineKeyboard }
        );

      } else if (action === 'confirm_assign') {
        await answerCallbackQuery(botToken, callbackQuery.id);
        const insCode = params.get('ins') || '1';

        if (profileLinked.role !== 'director' && profileLinked.role !== 'admin') {
          await sendTelegramMessage(botToken, callbackChatId, '❌ ไม่มีสิทธิ์ดำเนินการค่ะ');
          return res.status(200).json({ ok: true });
        }

        // ดึง State ล่าสุด
        const { data: activeState } = await supabase
          .from('line_action_states')
          .select('*')
          .eq('user_id', `telegram:${userTelegramId}`)
          .eq('action', 'tg_assign_flow')
          .maybeSingle();

        if (!activeState || !activeState.context?.doc_id || !activeState.context?.teacher_id) {
          await sendTelegramMessage(botToken, callbackChatId, '❌ เซสชันการเกษียณสั่งการหมดอายุแล้วค่ะ กรุณากดปุ่มสั่งการใหม่อีกครั้งนะคะ');
          return res.status(200).json({ ok: true });
        }

        const docId = activeState.context.doc_id;
        const teacherId = activeState.context.teacher_id;

        if (insCode === 'manual') {
          // เปลี่ยนสถานะเป็นรอพิมพ์คำสั่ง
          await supabase
            .from('line_action_states')
            .update({
              action: 'awaiting_assign_instruction',
              expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
            })
            .eq('id', activeState.id);
          await sendTelegramMessage(botToken, callbackChatId, '💬 กรุณาพิมพ์ข้อความคำสั่งการของคุณครูส่งเข้ามาในแชทนี้ได้เลยค่ะ 🌸');
        } else {
          // แปลง shortcode กลับเป็นคำสั่งการจริง
          let instruction = 'มอบดำเนินการ';
          if (insCode === '2') instruction = 'ทราบ/ถือปฏิบัติ';
          else if (insCode === '3') instruction = 'ประสานงานต่อ';

          // ลบ State ออกก่อนรันงานหลัก
          await supabase.from('line_action_states').delete().eq('id', activeState.id);
          await executeDocAssignment(docId, teacherId, instruction, botToken, callbackChatId, profileLinked, supabase);
        }
      } else if (action === 'bc_grp') {
        await answerCallbackQuery(botToken, callbackQuery.id);
        const assignId = params.get('id');
        const { data: assign, error: assignErr } = await supabase
          .from('doc_assignments')
          .select('*, incoming_docs(subject, doc_number, file_url, attachment_urls), teachers:assignee_id(prefix, first_name, last_name)')
          .eq('id', assignId)
          .maybeSingle();

        if (assignErr || !assign) {
          console.error('[BC_GRP ERROR] Fetch assign error:', assignErr);
          await sendTelegramMessage(botToken, callbackChatId, '❌ ไม่พบข้อมูลการรับมอบงานในระบบค่ะ');
          return res.status(200).json({ ok: true });
        }

        let teacherName = 'ครูผู้รับมอบหมาย';
        const t = (assign as any)?.teachers;
        if (t && t.first_name) {
          teacherName = `${t.prefix || ''}${t.first_name} ${t.last_name}`;
        } else if (assign.assignee_id) {
          const { data: tData } = await supabase
            .from('teachers')
            .select('prefix, first_name, last_name')
            .eq('id', assign.assignee_id)
            .maybeSingle();
          if (tData) {
            teacherName = `${tData.prefix || ''}${tData.first_name} ${tData.last_name}`;
          }
        }

        let targetGroupId = primaryGroupId;
        if (!targetGroupId && settings?.telegram_group_id) {
          const centralStr = settings.telegram_group_id.split(/[|,]/)[0]?.trim();
          if (centralStr) {
            const parsed = parseInt(centralStr, 10);
            if (!isNaN(parsed)) targetGroupId = parsed;
          }
        }

        if (targetGroupId) {
          let broadcastMsg = `📢 <b>ประชาสัมพันธ์ / แจ้งเพื่อทราบ</b>\n\n`;
          broadcastMsg += `• <b>เรื่อง</b>: ${escapeHtml(assign.incoming_docs?.subject || '-')}\n`;
          broadcastMsg += `• <b>เลขที่หนังสือ</b>: ${escapeHtml(assign.incoming_docs?.doc_number || '-')}\n`;
          broadcastMsg += `• <b>ผู้รับมอบหมาย</b>: ${escapeHtml(teacherName)}\n`;
          broadcastMsg += `• <b>คำสั่งการ/การดำเนินการ</b>: ${escapeHtml(assign.instruction || 'มอบดำเนินการ')}\n`;

          // ส่งลิงก์ไฟล์หนังสือหลัก
          if (assign.incoming_docs?.file_url) {
            broadcastMsg += `\n📄 <a href="${assign.incoming_docs.file_url}">เปิดดูเอกสารสั่งการที่ลงนามแล้ว</a>`;
          }

          // ส่งลิงก์ไฟล์แนบทุกไฟล์ (attachment_urls)
          const rawAttachments = assign.incoming_docs?.attachment_urls;
          let attachmentUrls: string[] = [];
          if (Array.isArray(rawAttachments)) {
            attachmentUrls = rawAttachments.filter(Boolean);
          } else if (typeof rawAttachments === 'string') {
            try { attachmentUrls = JSON.parse(rawAttachments).filter(Boolean); } catch { /* ignore */ }
          }

          if (attachmentUrls.length > 0) {
            broadcastMsg += `\n\n📎 <b>สิ่งที่ส่งมาด้วย</b>:`;
            attachmentUrls.forEach((url: string, idx: number) => {
              broadcastMsg += `\n  ${idx + 1}. <a href="${url}">ไฟล์แนบ ${idx + 1}</a>`;
            });
          }

          try {
            await sendTelegramMessage(botToken, targetGroupId, broadcastMsg);
            await sendTelegramMessage(botToken, callbackChatId, '✅ ได้ทำการประชาสัมพันธ์ข่าวสารเรื่องนี้เข้ากลุ่มกลางเรียบร้อยแล้วค่ะ 📢');
          } catch (sendErr: any) {
            console.error('[BC_GRP] sendTelegramMessage to group failed:', sendErr);
            await sendTelegramMessage(
              botToken, callbackChatId,
              `⚠️ ส่งเข้ากลุ่มกลางไม่สำเร็จค่ะ\n🆔 Group ID ที่ใช้: <code>${targetGroupId}</code>\n❌ ข้อผิดพลาด: ${sendErr?.message || 'unknown'}\n\n💡 กรุณาตรวจสอบ:\n1. Bot ถูกเพิ่มเข้ากลุ่มกลางแล้วหรือยัง\n2. Group ID ในหน้าตั้งค่าถูกต้องหรือไม่ (พิมพ์ /id ในกลุ่มเพื่อตรวจสอบ)`
            );
          }
        } else {
          await sendTelegramMessage(botToken, callbackChatId, '⚠️ ไม่พบข้อมูลกลุ่มกลางในตารางตั้งค่าค่ะ กรุณาตั้งค่ากลุ่มกลางก่อนนะคะ');
        }
      } else if (action === 'acknowledge') {
        const assignId = params.get('id');
        const { data: assign, error: assignErr } = await supabase
          .from('doc_assignments')
          .select('*, incoming_docs(subject)')
          .eq('id', assignId)
          .single();

        if (assignErr || !assign) {
          await answerCallbackQuery(botToken, callbackQuery.id, '❌ ไม่พบข้อมูลการมอบหมายงานนี้ในระบบค่ะ', true);
          return res.status(200).json({ ok: true });
        }

        // ป้องกันการทำซ้ำ
        if (assign.status !== 'pending') {
          let statusText = 'ได้รับทราบงานนี้ไปแล้ว';
          if (assign.status === 'completed') statusText = 'รายงานผลงานนี้ไปแล้ว';
          if (assign.status === 'closed') statusText = 'งานนี้ปิดเรียบร้อยแล้ว';
          
          await answerCallbackQuery(botToken, callbackQuery.id, `⚠️ คุณครู${statusText}ค่ะ`, true);

          const updatedMarkup = getUpdatedMarkupForStatus(assign.status, assignId || '');
          await editTelegramMessageMarkup(botToken, callbackChatId, callbackQuery.message.message_id, updatedMarkup);
          return res.status(200).json({ ok: true });
        }

        // อัปเดตสถานะเป็น acknowledged
        await supabase
          .from('doc_assignments')
          .update({ status: 'acknowledged' })
          .eq('id', assignId);

        await answerCallbackQuery(botToken, callbackQuery.id, '✅ รับทราบงานเรียบร้อยแล้วค่ะ');

        const docSubject = assign.incoming_docs?.subject || 'หนังสือสั่งการ';
        const teacherName = profileLinked.display_name || 'คุณครู';

        // ตอบกลับครู (ผู้กด) - แก้ไขปุ่มเดิมของข้อความ
        const teacherReplyMarkup = {
          inline_keyboard: [
            [
              { text: '📝 รายงานผลการปฏิบัติงาน', callback_data: `action=report&id=${assignId}` }
            ],
            [
              { text: '↪️ ส่งต่อเฉพาะบุคคล', callback_data: `action=fwd_start&id=${assignId}` },
              { text: '📢 ประชาสัมพันธ์ลงกลุ่มกลาง', callback_data: `action=bc_grp&id=${assignId}` }
            ]
          ]
        };
        await editTelegramMessageMarkup(botToken, callbackChatId, callbackQuery.message.message_id, teacherReplyMarkup);

        await sendTelegramMessage(
          botToken,
          callbackChatId,
          `✅ บันทึกการรับทราบงานเรื่อง "${docSubject}" เรียบร้อยแล้วค่ะ\nคุณครูสามารถกดรายงานผลการปฏิบัติงานจากปุ่มด้านบนได้เลยนะคะเมื่อดำเนินงานเสร็จ 🌸✨`
        );

        // แจ้งเตือนในกลุ่มกลาง Telegram (ใช้ primaryGroupId ที่ parse ไว้ตั้งแต่ต้น)

        if (primaryGroupId) {
          await sendTelegramMessage(
            botToken,
            primaryGroupId,
            `👍 คุณครู <b>${teacherName}</b> กดรับทราบงานเรื่อง <b>"${docSubject}"</b> เรียบร้อยแล้วค่ะ 🌸`
          );
        }

        // แจ้งเตือน ผอ. (หา ผอ. ของโรงเรียนนี้ที่มี telegram_chat_id)
        const { data: directors } = await supabase
          .from('profiles')
          .select('telegram_chat_id')
          .eq('role', 'director')
          ;

        if (directors) {
          for (const dir of directors) {
            if (dir.telegram_chat_id) {
              await sendTelegramMessage(
                botToken,
                parseInt(dir.telegram_chat_id),
                `👍 คุณครู <b>${teacherName}</b> กดรับทราบงานเรื่อง <b>"${docSubject}"</b> แล้วค่ะ`
              );
            }
          }
        }

      } else if (action === 'report') {
        const assignId = params.get('id');
        const { data: assign, error: assignErr } = await supabase
          .from('doc_assignments')
          .select('*, incoming_docs(subject)')
          .eq('id', assignId)
          .single();

        if (assignErr || !assign) {
          await answerCallbackQuery(botToken, callbackQuery.id, '❌ ไม่พบข้อมูลการมอบหมายงานในระบบค่ะ', true);
          return res.status(200).json({ ok: true });
        }

        // ป้องกันการทำซ้ำ
        if (assign.status === 'completed' || assign.status === 'closed') {
          let statusText = 'เคยรายงานผลงานนี้ไปแล้ว';
          if (assign.status === 'closed') statusText = 'งานนี้ปิดเรียบร้อยแล้ว';
          
          await answerCallbackQuery(botToken, callbackQuery.id, `⚠️ ${statusText}ค่ะ`, true);

          const updatedMarkup = getUpdatedMarkupForStatus(assign.status, assignId || '');
          await editTelegramMessageMarkup(botToken, callbackChatId, callbackQuery.message.message_id, updatedMarkup);
          return res.status(200).json({ ok: true });
        }

        await answerCallbackQuery(botToken, callbackQuery.id);

        // ล้างสถานะเก่าของผู้ใช้นี้ออกก่อน จากนั้นเก็บ state
        await supabase.from('line_action_states').delete().eq('user_id', `telegram:${userTelegramId}`);
        await supabase.from('line_action_states').insert([{
          user_id: `telegram:${userTelegramId}`,
          action: 'awaiting_report_text',
          context: { assignment_id: assignId },
          expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
        }]);

        await sendTelegramMessage(
          botToken,
          callbackChatId,
          `✍️ กรุณาพิมพ์รายงานสรุปผลการดำเนินงาน หรือส่งรูปภาพ/ไฟล์เอกสารหลักฐาน (แนบได้สูงสุด 5 ไฟล์) สำหรับเรื่อง <b>"${assign.incoming_docs?.subject}"</b> ส่งเข้ามาในห้องแชทนี้ได้เลยค่ะ ชบาจะนำไปบันทึกรายงานเสนอ ผอ. ทันที 🌸`
        );

      } else if (action === 'close') {
        const assignId = params.get('id');
        if (profileLinked.role !== 'director' && profileLinked.role !== 'admin') {
          await answerCallbackQuery(botToken, callbackQuery.id, '❌ สิทธิ์การปิดงานเป็นของผู้อำนวยการเท่านั้นค่ะ 🌸', true);
          return res.status(200).json({ ok: true });
        }

        const { data: assign, error: assignErr } = await supabase
          .from('doc_assignments')
          .select('*, incoming_docs(subject)')
          .eq('id', assignId)
          .single();

        if (assignErr || !assign) {
          await answerCallbackQuery(botToken, callbackQuery.id, '❌ ไม่พบชิ้นงานในระบบค่ะ', true);
          return res.status(200).json({ ok: true });
        }

        // ป้องกันการทำซ้ำ
        if (assign.status === 'closed') {
          await answerCallbackQuery(botToken, callbackQuery.id, '⚠️ งานนี้ได้รับการปิดงานไปเรียบร้อยแล้วค่ะ', true);
          
          const updatedMarkup = getUpdatedMarkupForStatus('closed', assignId || '');
          await editTelegramMessageMarkup(botToken, callbackChatId, callbackQuery.message.message_id, updatedMarkup);
          return res.status(200).json({ ok: true });
        }

        // อัปเดตสถานะเป็น closed และใส่เวลาปิด
        await supabase
          .from('doc_assignments')
          .update({ status: 'closed', closed_at: new Date().toISOString() })
          .eq('id', assignId);

        await answerCallbackQuery(botToken, callbackQuery.id, '✅ ดำเนินการทราบ/ปิดงานเรียบร้อยแล้วค่ะ');

        // อัปเดตปุ่มเดิมของ ผอ.
        const closedReplyMarkup = {
          inline_keyboard: [
            [
              { text: '🔒 งานนี้เสร็จสิ้นแล้ว (ทราบ/ปิดงาน)', callback_data: `action=noop` }
            ]
          ]
        };
        await editTelegramMessageMarkup(botToken, callbackChatId, callbackQuery.message.message_id, closedReplyMarkup);

        await sendTelegramMessage(botToken, callbackChatId, `✅ ได้ดำเนินการ "ทราบ/ปิดงาน" และส่งแจ้งคุณครูเรียบร้อยแล้วค่ะ 🌸`);

        // ค้นหาคุณครูและส่งแจ้งเตือน
        const { data: teacher } = await supabase
          .from('teachers')
          .select('email, prefix, first_name, last_name')
          .eq('id', assign.assignee_id)
          .maybeSingle();

        if (teacher) {
          const { data: teacherProfile } = await supabase
            .from('profiles')
            .select('telegram_chat_id')
            .eq('email', teacher.email)
            .maybeSingle();

          if (teacherProfile?.telegram_chat_id) {
            await sendTelegramMessage(
              botToken,
              parseInt(teacherProfile.telegram_chat_id),
              `🎉 ผู้อำนวยการได้รับทราบผลรายงานและสั่งการ "ทราบ/ปิดงาน" สำหรับงานเรื่อง <b>"${assign.incoming_docs?.subject}"</b> แล้วค่ะ ขอบคุณในการดำเนินงานและปิดจ๊อบนะคะคุณครู 🌸⚡`
            );
          }
        }

      } else if (action === 'fwd_start') {
        const assignId = params.get('id');
        const { data: assign } = await supabase
          .from('doc_assignments')
          .select('*, incoming_docs(subject, doc_number, file_url, attachment_urls)')
          .eq('id', assignId)
          .maybeSingle();

        if (!assign) {
          await answerCallbackQuery(botToken, callbackQuery.id, '❌ ไม่พบข้อมูลงานมอบหมายในระบบค่ะ', true);
          return res.status(200).json({ ok: true });
        }

        await answerCallbackQuery(botToken, callbackQuery.id);

        // บันทึก Session เพื่อป้องกัน callback_data เกิน 64 bytes ของ Telegram
        await supabase.from('line_action_states').delete().eq('user_id', `telegram:${userTelegramId}`);
        await supabase.from('line_action_states').insert([{
          user_id: `telegram:${userTelegramId}`,
          action: 'fwd_session',
          context: { assignment_id: assignId },
          expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
        }]);

        // ดึงรายชื่อครูทั้งหมดที่ active (ยกเว้นผู้ที่ได้รับมอบหมายอยู่ปัจจุบัน)
        const { data: allTeachers } = await supabase
          .from('teachers')
          .select('id, prefix, first_name, last_name, department')
          .eq('status', 'active')
          .neq('id', assign.assignee_id)
          .order('first_name', { ascending: true });

        if (!allTeachers || allTeachers.length === 0) {
          await sendTelegramMessage(botToken, callbackChatId, '⚠️ ไม่พบบุคลากรอื่นในระบบให้ส่งต่องานค่ะ');
          return res.status(200).json({ ok: true });
        }

        // จัดปุ่มครูเป็น Inline Buttons 2 ปุ่มต่อแถว (ความยาว callback_data <= 50 bytes ปลอดภัย 100%)
        const teacherButtons: any[] = [];
        let tempRow: any[] = [];
        for (const t of allTeachers) {
          const shortName = `${t.prefix || ''}${t.first_name} ${t.last_name ? t.last_name[0] + '.' : ''}`;
          tempRow.push({
            text: `🧑‍🏫 ${shortName}`,
            callback_data: `action=fwd_to&to=${t.id}`
          });
          if (tempRow.length === 2) {
            teacherButtons.push([...tempRow]);
            tempRow = [];
          }
        }
        if (tempRow.length > 0) {
          teacherButtons.push([...tempRow]);
        }

        teacherButtons.push([
          { text: '❌ ยกเลิกการส่งต่อ', callback_data: `action=fwd_cancel` }
        ]);

        const fwdPromptMsg = `↪️ <b>ส่งต่องานมอบหมาย (เฉพาะบุคคล)</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
          `📋 <b>เรื่อง</b>: ${escapeHtml(assign.incoming_docs?.subject || '-')}\n` +
          `📌 <b>เลขรับที่</b>: <code>${escapeHtml(assign.incoming_docs?.doc_number || '-')}</code>\n\n` +
          `<i>กรุณากดเลือกคุณครูที่ท่านต้องการส่งมอบงานต่อให้รับผิดชอบเฉพาะบุคคล (จะไม่ส่งเข้ากลุ่มกลาง):</i>`;

        await sendTelegramMessage(botToken, callbackChatId, fwdPromptMsg, { inline_keyboard: teacherButtons });
        return res.status(200).json({ ok: true });

      } else if (action === 'fwd_to') {
        const targetTeacherId = params.get('to');
        
        // ค้นหา assignment_id จาก session
        const { data: activeSession } = await supabase
          .from('line_action_states')
          .select('*')
          .eq('user_id', `telegram:${userTelegramId}`)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const assignId = activeSession?.context?.assignment_id || params.get('id');

        if (!assignId || !targetTeacherId) {
          await answerCallbackQuery(botToken, callbackQuery.id, '❌ เซสชันหมดอายุ กรุณากดส่งต่อใหม่อีกครั้งค่ะ', true);
          return res.status(200).json({ ok: true });
        }
        await answerCallbackQuery(botToken, callbackQuery.id);

        // อัปเดต session
        await supabase.from('line_action_states').delete().eq('user_id', `telegram:${userTelegramId}`);
        await supabase.from('line_action_states').insert([{
          user_id: `telegram:${userTelegramId}`,
          action: 'fwd_session',
          context: { assignment_id: assignId, target_teacher_id: targetTeacherId },
          expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
        }]);

        const { data: targetTeacher } = await supabase
          .from('teachers')
          .select('prefix, first_name, last_name')
          .eq('id', targetTeacherId)
          .maybeSingle();

        const targetName = targetTeacher 
          ? `${targetTeacher.prefix || ''}${targetTeacher.first_name} ${targetTeacher.last_name}`
          : 'คุณครูปลายทาง';

        const optionsButtons = [
          [
            { text: '⏩ ส่งต่อตามคำสั่งเดิมของ ผอ. ทันที', callback_data: `action=fwd_same` }
          ],
          [
            { text: '✍️ พิมพ์บันทึก/คำสั่งส่งต่อเพิ่มเติม', callback_data: `action=fwd_custom` }
          ],
          [
            { text: '⬅️ เลือกครูท่านอื่น', callback_data: `action=fwd_start&id=${assignId}` }
          ]
        ];

        await sendTelegramMessage(
          botToken, 
          callbackChatId, 
          `🧑‍🏫 <b>ส่งต่องานให้:</b> <b>${escapeHtml(targetName)}</b>\n\nโปรดเลือกรูปแบบคำสั่งการที่ต้องการส่งมอบ:`,
          { inline_keyboard: optionsButtons }
        );
        return res.status(200).json({ ok: true });

      } else if (action === 'fwd_same') {
        await answerCallbackQuery(botToken, callbackQuery.id);

        const { data: activeSession } = await supabase
          .from('line_action_states')
          .select('*')
          .eq('user_id', `telegram:${userTelegramId}`)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const { assignment_id, target_teacher_id } = activeSession?.context || {};
        if (!assignment_id || !target_teacher_id) {
          await sendTelegramMessage(botToken, callbackChatId, '❌ เซสชันหมดอายุ กรุณากดส่งต่องานใหม่อีกครั้งค่ะ');
          return res.status(200).json({ ok: true });
        }

        await supabase.from('line_action_states').delete().eq('user_id', `telegram:${userTelegramId}`);
        await executeForwardAssignment(assignment_id, target_teacher_id, null, botToken, callbackChatId, profileLinked, supabase);
        return res.status(200).json({ ok: true });

      } else if (action === 'fwd_custom') {
        await answerCallbackQuery(botToken, callbackQuery.id);

        const { data: activeSession } = await supabase
          .from('line_action_states')
          .select('*')
          .eq('user_id', `telegram:${userTelegramId}`)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const { assignment_id, target_teacher_id } = activeSession?.context || {};
        if (!assignment_id || !target_teacher_id) {
          await sendTelegramMessage(botToken, callbackChatId, '❌ เซสชันหมดอายุ กรุณากดส่งต่องานใหม่อีกครั้งค่ะ');
          return res.status(200).json({ ok: true });
        }

        // เก็บ state รอให้ครูพิมพ์คำสั่งการ
        await supabase.from('line_action_states').delete().eq('user_id', `telegram:${userTelegramId}`);
        await supabase.from('line_action_states').insert([{
          user_id: `telegram:${userTelegramId}`,
          action: 'awaiting_fwd_instruction',
          context: { assignment_id, target_teacher_id },
          expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
        }]);

        await sendTelegramMessage(
          botToken,
          callbackChatId,
          '💬 <b>กรุณาพิมพ์บันทึกหรือคำสั่งการส่งต่อ</b> ที่ต้องการแจ้งคุณครูปลายทาง แล้วส่งเข้ามาในแชทนี้ได้เลยค่ะ 🌸'
        );
        return res.status(200).json({ ok: true });

      } else if (action === 'fwd_exec') {
        // รองรับ backward compatibility สำหรับปุ่มเก่า
        const assignId = params.get('id');
        const targetTeacherId = params.get('to');
        const mode = params.get('mode');
        if (!assignId || !targetTeacherId) {
          await answerCallbackQuery(botToken, callbackQuery.id, '❌ ข้อมูลไม่ครบถ้วนค่ะ', true);
          return res.status(200).json({ ok: true });
        }
        await answerCallbackQuery(botToken, callbackQuery.id);

        if (mode === 'custom') {
          await supabase.from('line_action_states').delete().eq('user_id', `telegram:${userTelegramId}`);
          await supabase.from('line_action_states').insert([{
            user_id: `telegram:${userTelegramId}`,
            action: 'awaiting_fwd_instruction',
            context: { assignment_id: assignId, target_teacher_id: targetTeacherId },
            expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
          }]);

          await sendTelegramMessage(
            botToken,
            callbackChatId,
            '💬 <b>กรุณาพิมพ์บันทึกหรือคำสั่งการส่งต่อ</b> ที่ต้องการแจ้งคุณครูปลายทาง แล้วส่งเข้ามาในแชทนี้ได้เลยค่ะ 🌸'
          );
          return res.status(200).json({ ok: true });
        } else {
          await executeForwardAssignment(assignId, targetTeacherId, null, botToken, callbackChatId, profileLinked, supabase);
          return res.status(200).json({ ok: true });
        }

      } else if (action === 'fwd_cancel') {
        await supabase.from('line_action_states').delete().eq('user_id', `telegram:${userTelegramId}`);
        await answerCallbackQuery(botToken, callbackQuery.id, 'ยกเลิกการส่งต่องานแล้วค่ะ');
        await sendTelegramMessage(botToken, callbackChatId, '👌 ยกเลิกการส่งต่องานเรียบร้อยแล้วค่ะ คุณครูยังคงเป็นผู้รับผิดชอบงานนี้ตามเดิมนะคะ 🌸');
        return res.status(200).json({ ok: true });

      } else if (action === 'feedback') {
        const assignId = params.get('id');
        if (profileLinked.role !== 'director' && profileLinked.role !== 'admin') {
          await answerCallbackQuery(botToken, callbackQuery.id, '❌ สิทธิ์การสั่งเพิ่มเติมเป็นของผู้อำนวยการเท่านั้นค่ะ 🌸', true);
          return res.status(200).json({ ok: true });
        }

        const { data: assign, error: assignErr } = await supabase
          .from('doc_assignments')
          .select('status')
          .eq('id', assignId)
          .single();

        if (assignErr || !assign) {
          await answerCallbackQuery(botToken, callbackQuery.id, '❌ ไม่พบข้อมูลการมอบหมายงานในระบบค่ะ', true);
          return res.status(200).json({ ok: true });
        }

        if (assign.status === 'closed') {
          await answerCallbackQuery(botToken, callbackQuery.id, '⚠️ ไม่สามารถสั่งการเพิ่มเติมได้เนื่องจากปิดงานไปแล้วค่ะ', true);
          
          const updatedMarkup = getUpdatedMarkupForStatus('closed', assignId || '');
          await editTelegramMessageMarkup(botToken, callbackChatId, callbackQuery.message.message_id, updatedMarkup);
          return res.status(200).json({ ok: true });
        }

        await answerCallbackQuery(botToken, callbackQuery.id);

        // แก้ปุ่ม ผอ. ให้เปลี่ยนเป็นปุ่มพิมพ์คำสั่งเพิ่มเติม
        const feedbackReplyMarkup = {
          inline_keyboard: [
            [
              { text: '💬 อยู่ระหว่างพิมพ์คำสั่งเพิ่มเติม...', callback_data: `action=noop` }
            ]
          ]
        };
        await editTelegramMessageMarkup(botToken, callbackChatId, callbackQuery.message.message_id, feedbackReplyMarkup);

        // ล้างสถานะเก่าของผู้ใช้นี้ออกก่อน จากนั้นเก็บ state
        await supabase.from('line_action_states').delete().eq('user_id', `telegram:${userTelegramId}`);
        await supabase.from('line_action_states').insert([{
          user_id: `telegram:${userTelegramId}`,
          action: 'awaiting_feedback_text',
          context: { assignment_id: assignId },
          expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
        }]);

        await sendTelegramMessage(
          botToken,
          callbackChatId,
          `💬 กรุณาพิมพ์ข้อแนะนำหรือคำสั่งการเพิ่มเติมที่ต้องการให้คุณครูดำเนินการแก้ไข/ทำเพิ่มส่งมาได้เลยค่ะ 🌸`
        );
      } else if (action === 'approve_doc') {
        const type = params.get('type') || 'outgoing';
        const docId = params.get('id');

        if (profileLinked.role !== 'director' && profileLinked.role !== 'admin') {
          await answerCallbackQuery(botToken, callbackQuery.id, '❌ สิทธิ์การอนุมัติเป็นของผู้อำนวยการเท่านั้นค่ะ 🌸', true);
          return res.status(200).json({ ok: true });
        }

        try {
          let tableName = '';
          let numberColumn = '';
          let nameString = '';
          
          if (type === 'outgoing') { tableName = 'outgoing_docs'; numberColumn = 'doc_number'; nameString = 'หนังสือส่ง'; }
          else if (type === 'memo') { tableName = 'memos'; numberColumn = 'memo_number'; nameString = 'บันทึกข้อความ'; }
          else if (type === 'order') { tableName = 'orders'; numberColumn = 'order_number'; nameString = 'คำสั่งแต่งตั้ง'; }
          else {
            await answerCallbackQuery(botToken, callbackQuery.id, '❌ ประเภทเอกสารไม่ถูกต้องค่ะ', true);
            return res.status(200).json({ ok: true });
          }

          // 1. ดึงข้อมูลเอกสาร
          const { data: doc, error: docErr } = await supabase
            .from(tableName)
            .select('*')
            .eq('id', docId)
            .single();

          if (docErr || !doc) {
            await answerCallbackQuery(botToken, callbackQuery.id, `❌ ไม่พบข้อมูล${nameString}ในระบบค่ะ`, true);
            return res.status(200).json({ ok: true });
          }

          // ตรวจสอบความซ้ำซ้อน หากอนุมัติไปแล้ว
          if (doc.status === 'approved') {
            await answerCallbackQuery(botToken, callbackQuery.id, `⚠️ ${nameString}นี้ได้รับการอนุมัติลงนามไปแล้วค่ะ`, true);
            const approvedMarkup = {
              inline_keyboard: [[{ text: `🔒 อนุมัติลงนามแล้ว`, callback_data: 'action=noop' }]]
            };
            await editTelegramMessageMarkup(botToken, callbackChatId, callbackQuery.message.message_id, approvedMarkup);
            return res.status(200).json({ ok: true });
          }

          let finalNumber = doc[numberColumn];
          let docYear = doc.doc_year;
          let docSeq = doc.doc_sequence;

          // สำหรับคำสั่งแต่งตั้ง (รันเลขอัตโนมัติ หากยังไม่ได้รับอนุมัติ)
          if (type === 'order' && (finalNumber === 'รออนุมัติ' || !finalNumber)) {
            const orderDateObj = new Date(doc.order_date || new Date());
            docYear = orderDateObj.getFullYear() + 543;
            
            const { data: seqDocs } = await supabase
              .from('orders')
              .select('doc_sequence')
              .eq('doc_year', docYear)
              .order('doc_sequence', { ascending: false })
              .limit(1);
              
            const startSeq = settings?.start_order_seq || 1;
            docSeq = (seqDocs && seqDocs.length > 0) ? Math.max(Number(seqDocs[0].doc_sequence) + 1, startSeq) : startSeq;
            finalNumber = `${docSeq}/${docYear}`;
          }

          // 2. อัปเดตสถานะและเลขทะเบียนในฐานข้อมูล
          const updateObj: any = { status: 'approved' };
          if (type === 'order') {
            updateObj.order_number = finalNumber;
            updateObj.doc_year = docYear;
            updateObj.doc_sequence = docSeq;
          }

          const { error: updateErr } = await supabase
            .from(tableName)
            .update(updateObj)
            .eq('id', docId);

          if (updateErr) throw updateErr;

          await answerCallbackQuery(botToken, callbackQuery.id, `✅ ทำการอนุมัติและลงนามเรียบร้อยค่ะ`, false);

          // อัปเดตปุ่มเดิมของ ผอ.
          const approvedMarkup = {
            inline_keyboard: [[{ text: `🔒 อนุมัติลงนามแล้ว`, callback_data: 'action=noop' }]]
          };
          await editTelegramMessageMarkup(botToken, callbackChatId, callbackQuery.message.message_id, approvedMarkup);

          // แจ้งข้อความยืนยันหา ผอ.
          await sendTelegramMessage(botToken, callbackChatId, `✅ ทำการอนุมัติและลงนามอิเล็กทรอนิกส์ใน${nameString} เรื่อง <b>"${doc.subject}"</b> เรียบร้อยแล้วค่ะ 🌸`);

          // 3. แจ้งเตือนครูผู้สร้าง/ผู้เสนอ
          if (doc.created_by) {
            const { data: creator } = await supabase
              .from('profiles')
              .select('telegram_chat_id')
              .eq('id', doc.created_by)
              .maybeSingle();

            if (creator?.telegram_chat_id) {
              await sendTelegramMessage(
                botToken,
                parseInt(creator.telegram_chat_id),
                `✅ <b>แจ้งเตือนอนุมัติเอกสาร</b>\n\nยินดีด้วยค่ะ! ผู้อำนวยการได้อนุมัติและลงนามใน${nameString} เรื่อง <b>"${doc.subject}"</b> ของคุณครูเรียบร้อยแล้วนะคะ 🌸✨`
              );
            }
          }

        } catch (err: any) {
          console.error('handleApproveDoc error:', err);
          await answerCallbackQuery(botToken, callbackQuery.id, `❌ เกิดข้อผิดพลาดในการอนุมัติ: ${err.message}`, true);
        }

      } else if (action === 'reject_doc') {
        const type = params.get('type') || 'outgoing';
        const docId = params.get('id');

        if (profileLinked.role !== 'director' && profileLinked.role !== 'admin') {
          await answerCallbackQuery(botToken, callbackQuery.id, '❌ สิทธิ์การปฏิเสธงานเป็นของผู้อำนวยการเท่านั้นค่ะ 🌸', true);
          return res.status(200).json({ ok: true });
        }

        try {
          await answerCallbackQuery(botToken, callbackQuery.id);

          // อัปเดตปุ่มเดิมให้ ผอ.
          const progressMarkup = {
            inline_keyboard: [[{ text: `💬 อยู่ระหว่างพิมพ์เหตุผลแก้ไข...`, callback_data: 'action=noop' }]]
          };
          await editTelegramMessageMarkup(botToken, callbackChatId, callbackQuery.message.message_id, progressMarkup);

          // บันทึกสถานะเพื่อรอเหตุผล (หมดอายุใน 15 นาที)
          await supabase.from('line_action_states').delete().eq('user_id', `telegram:${userTelegramId}`);
          await supabase.from('line_action_states').insert([{
            user_id: `telegram:${userTelegramId}`,
            action: 'awaiting_doc_reject_reason',
            context: { type, id: docId },
            expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
          }]);

          await sendTelegramMessage(
            botToken,
            callbackChatId,
            `💬 กรุณาพิมพ์เหตุผลการส่งกลับ หรือจุดที่ต้องแก้ไขส่งเข้ามาในแชทนี้ เพื่อแจ้งแก่คุณครูผู้ร่างคำเสนอได้เลยค่ะ 🌸`
          );

        } catch (err: any) {
          console.error('handleRejectDoc error:', err);
          await answerCallbackQuery(botToken, callbackQuery.id, `❌ ไม่สามารถทำรายการได้: ${err.message}`, true);
        }
      } else if (action === 'doc_complete') {
        const docId = params.get('id');
        if (!docId) {
          await answerCallbackQuery(botToken, callbackQuery.id, '❌ ไม่พบข้อมูลหนังสือค่ะ', true);
          return res.status(200).json({ ok: true });
        }
        await supabase.from('incoming_docs').update({ status: 'completed' }).eq('id', docId);
        await answerCallbackQuery(botToken, callbackQuery.id, '✅ บันทึกสถานะว่าดำเนินการเสร็จสิ้นเรียบร้อยแล้วค่ะ');
        await editTelegramMessageMarkup(botToken, callbackChatId, callbackQuery.message.message_id, {
          inline_keyboard: [[{ text: '✅ ดำเนินการเสร็จสิ้นแล้ว', callback_data: 'action=noop' }]]
        });
      } else if (action === 'doc_extend_3d') {
        const docId = params.get('id');
        if (!docId) {
          await answerCallbackQuery(botToken, callbackQuery.id, '❌ ไม่พบข้อมูลหนังสือค่ะ', true);
          return res.status(200).json({ ok: true });
        }
        const { data: doc } = await supabase.from('incoming_docs').select('action_deadline').eq('id', docId).single();
        if (doc) {
          // Bug fix: คำนวณวันที่ใหม่จาก date-only string เพื่อป้องกัน timezone offset
          const currentDLStr = doc.action_deadline
            ? doc.action_deadline.split('T')[0]   // ตัด timestamp ทิ้ง เหลือแค่ YYYY-MM-DD
            : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
          const [y, m, d] = currentDLStr.split('-').map(Number);
          const newDL = new Date(y, m - 1, d + 3); // บวก 3 วันแบบ local date ไม่ใช่ UTC
          const newDLStr = `${newDL.getFullYear()}-${String(newDL.getMonth() + 1).padStart(2, '0')}-${String(newDL.getDate()).padStart(2, '0')}`;
          await supabase.from('incoming_docs').update({ action_deadline: newDLStr }).eq('id', docId);
          const thDate = new Date(`${newDLStr}T00:00:00+07:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' });
          await answerCallbackQuery(botToken, callbackQuery.id, `⏰ เลื่อนกำหนดเป็น ${thDate} เรียบร้อยแล้วค่ะ`);
          await sendTelegramMessage(botToken, callbackChatId, `⏰ <b>เลื่อนกำหนดส่งเรียบร้อย</b>\n\nกำหนดส่งใหม่: <u>${thDate}</u>`);
        }
      }

      return res.status(200).json({ ok: true });
    }

    // หากไม่มีข้อความ รูปภาพ หรือเอกสาร หรือไม่มีแชทไอดี ไม่ประมวลผลต่อ
    if ((!message?.text && !message?.photo && !message?.document) || !message?.chat?.id) {
      return res.status(200).json({ ok: true });
    }

    const chatId = message.chat.id;
    const rawText = (message.text || message.caption || '').trim();
    const userTelegramId = message.from?.id;

    // ดักรับคำสั่งหา Chat ID / Group ID ทันทีเพื่อความสะดวกของคุณครู
    const lowerText = rawText.toLowerCase();
    if (lowerText.startsWith('/id') || lowerText.startsWith('/groupid')) {
      await sendTelegramMessage(
        botToken,
        chatId,
        `🆔 <b>รหัสแชทนี้ (Chat ID):</b> <code>${chatId}</code>\n\n*(คุณครูสามารถคัดลอกเลขตัวนี้ไปกรอกในระบบได้เลยค่ะ)*`
      );
      return res.status(200).json({ ok: true });
    }

    // --- 4. ดำเนินการผูกบัญชีด้วย Deep Linking (/start auth_<base64_email>) ---
    if (rawText.startsWith('/start ')) {
      const authToken = rawText.replace('/start ', '').trim();
      
      if (!authToken.startsWith('auth_')) {
        await sendTelegramMessage(botToken, chatId, '❌ รูปแบบลิงก์การผูกบัญชีไม่ถูกต้อง กรุณากดปุ่มผูกบัญชีจากในระบบใหม่อีกครั้ง');
        return res.status(200).json({ ok: true });
      }

      const base64Part = authToken.replace('auth_', '');
      let email = '';
      try {
        email = Buffer.from(base64Part, 'base64').toString('utf-8');
      } catch (decodeErr) {
        await sendTelegramMessage(botToken, chatId, '❌ ไม่สามารถถอดรหัสข้อมูลการผูกบัญชีได้ กรุณาลองใหม่อีกครั้ง');
        return res.status(200).json({ ok: true });
      }

      if (!email || !email.includes('@')) {
        await sendTelegramMessage(botToken, chatId, '❌ ข้อมูลอีเมลในการผูกบัญชีไม่ถูกต้อง');
        return res.status(200).json({ ok: true });
      }

      // ค้นหาโปรไฟล์คุณครูจากอีเมลและรหัสโรงเรียน
      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('id, display_name')
        .eq('email', email.toLowerCase().trim())
        
        .maybeSingle();

      if (profileErr || !profile) {
        console.error('[TELEGRAM WEBHOOK LINKING ERROR]', profileErr);
        await sendTelegramMessage(
          botToken, 
          chatId, 
          `❌ ไม่พบบัญชีผู้ใช้ที่มีอีเมล <b>${email}</b> ในระบบของโรงเรียนนี้ กรุณาลงทะเบียนบัญชีผู้ใช้ในระบบสารบรรณก่อน`
        );
        return res.status(200).json({ ok: true });
      }

      // อัปเดต telegram_chat_id ลงในตาราง profiles และ teachers ของครูผู้ใช้รายนั้น
      const { error: updateErr } = await supabase
        .from('profiles')
        .update({ telegram_chat_id: String(chatId) })
        .eq('id', profile.id);

      const cleanEmail = email.toLowerCase().trim();
      await supabase
        .from('teachers')
        .update({ telegram_chat_id: String(chatId) })
        .eq('email', cleanEmail);

      if (updateErr) {
        console.error('[TELEGRAM WEBHOOK UPDATE ERROR]', updateErr);
        await sendTelegramMessage(botToken, chatId, '❌ ระบบไม่สามารถบันทึกข้อมูลได้ชั่วคราว กรุณาติดต่อผู้ดูแลระบบ');
        return res.status(200).json({ ok: true });
      }

      const name = profile.display_name || 'คุณครู';
      await sendTelegramMessage(
        botToken,
        chatId,
        `🎉 <b>ผูกบัญชีสำเร็จเรียบร้อย!</b>\n\nยินดีต้อนรับคุณครู <b>${name}</b> เข้าสู่ระบบการแจ้งเตือนสารบรรณผ่าน Telegram\nระบบจะส่งข้อความแจ้งเตือนคำสั่ง, มอบหมายงาน และเอกสารราชการต่างๆ มายังห้องแชทนี้โดยตรงอัตโนมัติค่ะ 📬`
      );
      return res.status(200).json({ ok: true });
    }

    // --- 5. ตอบกลับข้อความทั่วไป ---
    // ตรวจสอบว่าแชทไอดีนี้ผูกบัญชีไว้กับโรงเรียนนี้แล้วหรือยัง (รองรับ Self-Healing Auto-Linking)
    let { data: profileLinked, error: linkErr } = await supabase
      .from('profiles')
      .select('id, display_name, role, email, telegram_chat_id')
      .eq('telegram_chat_id', String(userTelegramId))
      .maybeSingle();

    // Fallback 1: ตรวจสอบจาก chatId เผื่อกรณีบันทึกเป็น chatId หรือเคยผูกไว้แบบแชทเดี่ยว
    if (!profileLinked && chatId) {
      const { data: byChatId } = await supabase
        .from('profiles')
        .select('id, display_name, role, email, telegram_chat_id')
        .eq('telegram_chat_id', String(chatId))
        .maybeSingle();
      if (byChatId) {
        profileLinked = byChatId;
        // Self-Healing: อัปเดต userTelegramId คืนให้ถูกต้อง
        if (userTelegramId && byChatId.telegram_chat_id !== String(userTelegramId)) {
          await supabase.from('profiles').update({ telegram_chat_id: String(userTelegramId) }).eq('id', byChatId.id);
        }
      }
    }

    // Fallback 2: ตรวจสอบจากตาราง teachers
    if (!profileLinked && userTelegramId) {
      const { data: teacherMatched } = await supabase
        .from('teachers')
        .select('id, first_name, last_name, email, telegram_chat_id')
        .eq('telegram_chat_id', String(userTelegramId))
        .maybeSingle();
      if (teacherMatched?.email) {
        const { data: profByEmail } = await supabase
          .from('profiles')
          .select('id, display_name, role, email, telegram_chat_id')
          .eq('email', teacherMatched.email.toLowerCase().trim())
          .maybeSingle();
        if (profByEmail) {
          profileLinked = profByEmail;
          await supabase.from('profiles').update({ telegram_chat_id: String(userTelegramId) }).eq('id', profByEmail.id);
        }
      }
    }

    // Fallback 3: Smart Self-Healing Auto-Link ด้วยชื่อผู้ใช้ (ป้องกันปัญหา Chat ID หลุด/ไม่ตรง)
    if (!profileLinked && userTelegramId && (message.from?.first_name || message.from?.last_name || message.from?.username)) {
      const senderFirst = (message.from?.first_name || '').toLowerCase().trim();
      const senderLast = (message.from?.last_name || '').toLowerCase().trim();
      const senderUser = (message.from?.username || '').toLowerCase().trim();
      const senderFullName = `${senderFirst} ${senderLast}`.trim();

      const { data: allProfiles } = await supabase
        .from('profiles')
        .select('id, display_name, role, email, telegram_chat_id');

      if (allProfiles && allProfiles.length > 0) {
        for (const p of allProfiles) {
          const pName = (p.display_name || '').toLowerCase().trim();
          const pEmail = (p.email || '').toLowerCase().trim();
          
          const isMatched = 
            (senderFirst.length >= 3 && pName.includes(senderFirst)) ||
            (senderLast.length >= 3 && pName.includes(senderLast)) ||
            (senderFullName.length >= 3 && (pName.includes(senderFullName) || senderFullName.includes(pName))) ||
            (senderUser.length >= 3 && (pEmail.includes(senderUser) || pName.includes(senderUser)));

          if (isMatched) {
            console.log(`[TELEGRAM SELF-HEALING] Auto-linking profile "${p.display_name}" to Telegram ID ${userTelegramId}`);
            profileLinked = p;
            await supabase.from('profiles').update({ telegram_chat_id: String(userTelegramId) }).eq('id', p.id);
            if (p.email) {
              await supabase.from('teachers').update({ telegram_chat_id: String(userTelegramId) }).eq('email', p.email.toLowerCase().trim());
            }
            break;
          }
        }
      }

      // ตรวจสอบกับชื่อ ผอ. ใน settings เพิ่มเติม
      if (!profileLinked && settings?.director_name) {
        const dirName = settings.director_name.toLowerCase().trim();
        const isMatchedDir = 
          (senderFirst.length >= 3 && dirName.includes(senderFirst)) ||
          (senderLast.length >= 3 && dirName.includes(senderLast)) ||
          (senderFullName.length >= 3 && (dirName.includes(senderFullName) || senderFullName.includes(dirName)));

        if (isMatchedDir) {
          const dirProfile = allProfiles?.find((p: any) => p.role === 'director') || allProfiles?.[0];
          if (dirProfile) {
            console.log(`[TELEGRAM SELF-HEALING] Auto-linking director via settings.director_name to Telegram ID ${userTelegramId}`);
            profileLinked = dirProfile;
            await supabase.from('profiles').update({ telegram_chat_id: String(userTelegramId) }).eq('id', dirProfile.id);
          }
        }
      }
    }

    if (linkErr || !profileLinked) {
      await sendTelegramMessage(
        botToken,
        chatId,
        `🔗 <b>แชทนี้ยังไม่ได้เชื่อมต่อระบบสารบรรณ</b>\n\n🆔 <b>Telegram Chat ID ของท่านคือ:</b> <code>${userTelegramId}</code>\n\nกรุณาเข้าสู่ระบบสารบรรณโรงเรียนบนเว็บไซต์ จากนั้นไปที่หน้า <b>"โปรไฟล์ส่วนตัว"</b> แล้วกดปุ่ม <b>"ผูกบัญชี Telegram"</b> หรือนำเลข ID ด้านบนนี้ไปแจ้งผู้ดูแลระบบเพื่อเปิดสิทธิ์ค่ะ 🌸`
      );
      return res.status(200).json({ ok: true });
    }

    // ตรวจสอบสถานะการพิมพ์ข้อความสั่งการ/รายงานผล (Stateful Conversation)
    const { data: activeState } = await supabase
      .from('line_action_states')
      .select('*')
      .eq('user_id', `telegram:${userTelegramId}`)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeState) {
      if (activeState.action === 'awaiting_assign_instruction') {
        const { doc_id, teacher_id } = activeState.context || {};
        await supabase.from('line_action_states').delete().eq('id', activeState.id);
        await executeDocAssignment(doc_id, teacher_id, rawText, botToken, chatId, profileLinked, supabase);
        return res.status(200).json({ ok: true });
      } else if (activeState.action === 'awaiting_fwd_instruction') {
        const { assignment_id, target_teacher_id } = activeState.context || {};
        await supabase.from('line_action_states').delete().eq('id', activeState.id);
        await executeForwardAssignment(assignment_id, target_teacher_id, rawText, botToken, chatId, profileLinked, supabase);
        return res.status(200).json({ ok: true });
      } else if (activeState.action === 'awaiting_report_text') {
        const { assignment_id } = activeState.context || {};

        const { data: assign, error: assignErr } = await supabase
          .from('doc_assignments')
          .select('*, incoming_docs(subject)')
          .eq('id', assignment_id)
          .single();

        if (assignErr || !assign) {
          await supabase.from('line_action_states').delete().eq('id', activeState.id);
          await sendTelegramMessage(botToken, chatId, '❌ ไม่พบข้อมูลการมอบหมายงานนี้ในระบบค่ะ');
          return res.status(200).json({ ok: true });
        }

        // ดึงรายการไฟล์ที่มีอยู่เดิม
        let reportFileUrls: string[] = [];
        if (Array.isArray(assign.report_file_urls)) {
          reportFileUrls = [...assign.report_file_urls];
        } else if (typeof assign.report_file_urls === 'string') {
          try { reportFileUrls = JSON.parse(assign.report_file_urls); } catch {}
        }

        // ตรวจสอบว่ามีการแนบรูปภาพหรือเอกสารมาในข้อความหรือไม่
        let newFileUrl = '';
        if (message.photo && Array.isArray(message.photo) && message.photo.length > 0) {
          const largestPhoto = message.photo[message.photo.length - 1];
          newFileUrl = await uploadTelegramFileToSupabase(botToken, largestPhoto.file_id, 'jpg', supabase);
        } else if (message.document) {
          const fileExt = message.document.file_name?.split('.').pop() || 'file';
          newFileUrl = await uploadTelegramFileToSupabase(botToken, message.document.file_id, fileExt, supabase);
        }

        if (newFileUrl) {
          if (reportFileUrls.length >= 5) {
            // Fix Bug#4: return ทันทีเมื่อไฟล์เกิน 5 ไม่ให้โค้ดวิ่งต่อและบันทึกรายงานโดยไม่มีไฟล์
            await sendTelegramMessage(botToken, chatId, '⚠️ งานนี้บันทึกไฟล์แนบครบ 5 ไฟล์แล้วค่ะ ไม่สามารถเพิ่มไฟล์อีกได้ค่ะ');
            return res.status(200).json({ ok: true });
          } else {
            reportFileUrls.push(newFileUrl);
          }
        }

        let finalReportText = rawText;
        if (!finalReportText) {
          finalReportText = assign.staff_report || 'แนบไฟล์หลักฐานผลการปฏิบัติงาน';
        }

        // อัปเดตสถานะเป็น completed และบันทึกรายงานผลพร้อม URL ไฟล์แนบ
        await supabase
          .from('doc_assignments')
          .update({
            status: 'completed',
            staff_report: finalReportText,
            report_file_urls: reportFileUrls,
            reported_at: new Date().toISOString()
          })
          .eq('id', assignment_id);

        // ลบ active state เมื่อทำรายการสำเร็จ
        await supabase.from('line_action_states').delete().eq('id', activeState.id);

        const attachInfo = reportFileUrls.length > 0 ? `\n📁 แนบไฟล์หลักฐานรวม ${reportFileUrls.length}/5 ไฟล์` : '';
        await sendTelegramMessage(
          botToken,
          chatId,
          `✅ บันทึกคำรายงานผลและส่งมอบงานเรื่อง <b>"${assign.incoming_docs?.subject}"</b> เสนอผู้อำนวยการเรียบร้อยแล้วค่ะ${attachInfo} ขอบคุณมากนะคะคุณครู 🌸`
        );

        // ค้นหา ผอ. โรงเรียนเพื่อส่งรายงาน
        const { data: directors } = await supabase
          .from('profiles')
          .select('telegram_chat_id')
          .eq('role', 'director');

        const docSubject = assign.incoming_docs?.subject || 'งานที่มอบหมาย';
        const teacherName = profileLinked.display_name || 'คุณครู';

        let fileLinksText = '';
        if (reportFileUrls.length > 0) {
          fileLinksText = '\n\n📁 <b>ไฟล์แนบประกอบรายงาน (' + reportFileUrls.length + ' ไฟล์):</b>\n' +
            reportFileUrls.map((url: string, i: number) => `  • <a href="${url}">หลักฐาน ${i + 1}</a>`).join('\n');
        }

        const dirMessage = `📊 คุณครู <b>${teacherName}</b> ได้รายงานผลงาน\n<b>เรื่อง</b>: ${docSubject}\n\n<b>ผลงาน</b>: "${finalReportText}"${fileLinksText}`;

        const dirReplyMarkup = {
          inline_keyboard: [
            [
              { text: '✅ ทราบ/ปิดงาน', callback_data: `action=close&id=${assignment_id}` },
              { text: '💬 สั่งเพิ่มเติม', callback_data: `action=feedback&id=${assignment_id}` }
            ]
          ]
        };

        if (directors) {
          for (const dir of directors) {
            if (dir.telegram_chat_id) {
              await sendTelegramMessage(
                botToken,
                parseInt(dir.telegram_chat_id),
                dirMessage,
                dirReplyMarkup
              );
            }
          }
        }
        return res.status(200).json({ ok: true });

      } else if (activeState.action === 'awaiting_feedback_text') {
        const { assignment_id } = activeState.context || {};
        await supabase.from('line_action_states').delete().eq('id', activeState.id);

        const { data: assign, error: assignErr } = await supabase
          .from('doc_assignments')
          .select('*, incoming_docs(subject), assignee_id')
          .eq('id', assignment_id)
          .single();

        if (assignErr || !assign) {
          await sendTelegramMessage(botToken, chatId, '❌ ไม่พบข้อมูลการมอบหมายงานนี้ในระบบค่ะ');
          return res.status(200).json({ ok: true });
        }

        // อัปเดต feedback ผอ. และถอยสถานะกลับไปเป็น acknowledged
        await supabase
          .from('doc_assignments')
          .update({
            status: 'acknowledged',
            director_feedback: rawText
          })
          .eq('id', assignment_id);

        await sendTelegramMessage(botToken, chatId, `✅ บันทึกคำสั่งการเพิ่มเติมเรียบร้อยและส่งแจ้งคุณครูเรียบร้อยแล้วค่ะ 🌸`);

        // ค้นหาคุณครูและส่งแจ้งเตือน
        const { data: teacher } = await supabase
          .from('teachers')
          .select('email, prefix, first_name, last_name')
          .eq('id', assign.assignee_id)
          .maybeSingle();

        if (teacher) {
          const { data: teacherProfile } = await supabase
            .from('profiles')
            .select('telegram_chat_id')
            .eq('email', teacher.email)
            .maybeSingle();

          if (teacherProfile?.telegram_chat_id) {
            const docSubject = assign.incoming_docs?.subject || 'งานที่มอบหมาย';
            const teacherMsg = `📌 ผอ. มีคำแนะนำ/สั่งการเพิ่มเติม\n<b>เรื่อง</b>: ${escapeHtml(docSubject)}\n\n<b>คำสั่ง ผอ.</b>: "${escapeHtml(rawText)}"\n\nรบกวนคุณครูดำเนินการเพิ่มเติม และรายงานผลส่งกลับอีกครั้งเมื่อเสร็จงานนะคะ 🌸`;
            
            const teacherReplyMarkup = {
              inline_keyboard: [
                [
                  { text: '📝 รายงานผลใหม่', callback_data: `action=report&id=${assignment_id}` }
                ]
              ]
            };

            await sendTelegramMessage(
              botToken,
              parseInt(teacherProfile.telegram_chat_id),
              teacherMsg,
              teacherReplyMarkup
            );
          }
        }
        return res.status(200).json({ ok: true });

      } else if (activeState.action === 'awaiting_doc_reject_reason') {
        const { type, id } = activeState.context || {};
        await supabase.from('line_action_states').delete().eq('id', activeState.id);

        let tableName = '';
        let nameString = '';
        if (type === 'outgoing') { tableName = 'outgoing_docs'; nameString = 'หนังสือส่ง'; }
        else if (type === 'memo') { tableName = 'memos'; nameString = 'บันทึกข้อความ'; }
        else if (type === 'order') { tableName = 'orders'; nameString = 'คำสั่งแต่งตั้ง'; }
        else {
          await sendTelegramMessage(botToken, chatId, '❌ ประเภทเอกสารไม่ถูกต้องค่ะ');
          return res.status(200).json({ ok: true });
        }

        // 1. ดึงข้อมูลเอกสาร
        const { data: doc, error: docErr } = await supabase
          .from(tableName)
          .select('*')
          .eq('id', id)
          .single();

        if (docErr || !doc) {
          await sendTelegramMessage(botToken, chatId, '❌ ไม่พบข้อมูลเอกสารในระบบค่ะ');
          return res.status(200).json({ ok: true });
        }

        // 2. อัปเดตสถานะและเหตุผลส่งกลับ
        let remarkObj: any = {};
        try {
          remarkObj = typeof doc.remark === 'object' ? doc.remark : JSON.parse(doc.remark || '{}');
        } catch (e) { remarkObj = {}; }

        remarkObj.director_opinion = rawText;
        remarkObj.director_decision = 'ส่งกลับแก้ไข';
        remarkObj.approved_date = new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });

        await supabase
          .from(tableName)
          .update({
            status: 'rejected',
            remark: JSON.stringify(remarkObj)
          })
          .eq('id', id);

        await sendTelegramMessage(
          botToken,
          chatId,
          `✅ ทำการปฏิเสธ/ส่งแก้ไข ${nameString} เรื่อง <b>"${escapeHtml(doc.subject)}"</b> และส่งเหตุผลคืนคุณครูผู้ร่างเรียบร้อยแล้วค่ะ 🌸`
        );

        // 3. แจ้งเตือนครูผู้ร่าง
        if (doc.created_by) {
          const { data: creator } = await supabase
            .from('profiles')
            .select('telegram_chat_id')
            .eq('id', doc.created_by)
            .maybeSingle();

          if (creator?.telegram_chat_id) {
            await sendTelegramMessage(
              botToken,
              parseInt(creator.telegram_chat_id),
              `❌ <b>แจ้งเตือนส่งกลับแก้ไขเอกสาร</b>\n\n${nameString} เรื่อง <b>"${escapeHtml(doc.subject)}"</b> ได้ถูกส่งกลับแก้ไข\n\n💬 <b>เหตุผลของ ผอ.:</b> "${escapeHtml(rawText)}"\n\nรบกวนคุณครูช่วยตรวจสอบและเข้าไปทำการแก้ไขบนหน้าเว็บโรงเรียนนะคะ 🙇‍♀️🌸`
            );
          }
        }
        return res.status(200).json({ ok: true });
      } else {
        // Fix Bug#2 (activeState guard): action ที่ไม่รู้จัก เช่น tg_assign_flow ที่ค้างอยู่
        // ให้ปล่อยผ่านลงไปสู่ระบบ AI ตอบกลับปกติ ห้ามตัดจบเงียบ
        console.warn(`[TELEGRAM WEBHOOK] Unhandled activeState action: ${activeState?.action}, falling through to AI response.`);
      }
    }

    // ── 6. คำสั่งการขอเลขหนังสือ และการรับหนังสือผ่าน Telegram ──
    const docYearNum = parseInt(currentYear, 10) || (new Date().getFullYear() + 543);
    const textTrimmed = (rawText || '').trim();

    // ดึง bot username เพื่อตัด mention ออกอย่างแม่นยำ
    const botUser = settings?.telegram_bot_username || 'ChabaSchoolBot';

    // ล้าง @botmention และ Prefix คำเรียกบอทรวมถึง Typo (ชบา, ชยา, น้องชบา, บอท)
    let cleanCmd = textTrimmed;
    if (botUser) {
      cleanCmd = cleanCmd.replace(new RegExp(`^@${botUser}\\s*`, 'i'), '').trim();
    }
    // ล้าง prefix ชบา / ชยา / น้องชบา / บอท (รองรับการใส่ slash นำหน้า เช่น /ชยา หรือเคาะซ้ำ)
    cleanCmd = cleanCmd.replace(/^(@\w+|\/?(?:น้อง)?(?:ชบา|ชยา|บอท))\s*/i, '').trim();
    cleanCmd = cleanCmd.replace(/^(@\w+|\/?(?:น้อง)?(?:ชบา|ชยา|บอท))\s*/i, '').trim();

    // สตริงที่ตัด Slash ออกเพื่อใช้ดักจับคำสั่งแบบยืดหยุ่น
    const cleanNoSlash = cleanCmd.replace(/^\//, '').trim();

    // ── 6.1 คำสั่งสำหรับ ผอ. / ผู้บริหาร: ขอหนังสือรอเกษียณ ──
    const pendingDocKeywords = [
      'รอเกษียณ', 'ขอหนังสือรอเกษียณ', 'หนังสือรอเกษียณ', 'หนังสือค้างเกษียณ', 
      'ค้างเกษียณ', 'pending', 'เช็คหนังสือรอเกษียณ', 'ดูหนังสือรอเกษียณ',
      'รายการรอเกษียณ', 'งานรอเกษียณ'
    ];
    const isPendingDocsCmd = pendingDocKeywords.some(kw => 
      cleanNoSlash === kw || cleanNoSlash.startsWith(kw + ' ') || cleanNoSlash.startsWith(kw + '\n')
    );

    if (isPendingDocsCmd) {
      if (profileLinked.role !== 'director' && profileLinked.role !== 'admin') {
        await sendTelegramMessage(botToken, chatId, '❌ ขออภัยค่ะ คำสั่งดูหนังสือรอเกษียณสงวนสิทธิ์เฉพาะผู้อำนวยการและผู้ดูแลระบบเท่านั้นค่ะ 🌸');
        return res.status(200).json({ ok: true });
      }

      const { data: pendingDocs, count: totalPending } = await supabase
        .from('incoming_docs')
        .select('id, doc_number, subject, from_agency, urgency, doc_date, file_url, attachment_urls, remark, action_deadline, created_at', { count: 'exact' })
        .in('status', ['pending', 'waiting_proposal'])
        .order('created_at', { ascending: false })
        .limit(10);

      const count = totalPending || (pendingDocs ? pendingDocs.length : 0);

      if (!pendingDocs || pendingDocs.length === 0 || count === 0) {
        await sendTelegramMessage(botToken, chatId, `🎉 <b>ยอดเยี่ยมมากค่ะ!</b>\n\nขณะนี้ไม่มีหนังสือรับเข้าคงค้างรอเกษียณสั่งการเลยค่ะ ผอ. สามารถพักผ่อนได้สบายใจเลยนะคะ 🌸✨`);
        return res.status(200).json({ ok: true });
      }

      let msg = `📬 <b>รายการหนังสือรอเกษียณสั่งการ (${count} ฉบับ)</b>\n━━━━━━━━━━━━━━━━━━━━\n\n`;
      const inlineButtons: any[] = [];

      pendingDocs.forEach((doc: any, idx: number) => {
        const uBadge = doc.urgency === 'ด่วนที่สุด' ? '🔴 <b>[ด่วนที่สุด]</b>' : doc.urgency === 'ด่วนมาก' ? '🟠 <b>[ด่วนมาก]</b>' : doc.urgency === 'ด่วน' ? '🟡 <b>[ด่วน]</b>' : '🟢 <b>[ปกติ]</b>';
        const docNum = doc.doc_number || (idx + 1).toString();
        
        let summaryText = '';
        try {
          const rObj = typeof doc.remark === 'object' ? doc.remark : JSON.parse(doc.remark || '{}');
          summaryText = rObj.proposal_summary || rObj.ai_summary || '';
        } catch {}

        msg += `${idx + 1}. ${uBadge} <b>เรื่อง:</b> <b>${escapeHtml(doc.subject || '-')}</b>\n`;
        msg += `   • <b>เลขรับ:</b> <code>${escapeHtml(docNum)}</code> | <b>จาก:</b> ${escapeHtml(doc.from_agency || '-')}\n`;
        
        if (summaryText) {
          msg += `   ✨ <b>สาระสำคัญ:</b> <i>"${escapeHtml(summaryText.slice(0, 120))}${summaryText.length > 120 ? '...' : ''}"</i>\n`;
        }

        if (doc.action_deadline) {
          const dl = toDMYString(doc.action_deadline);
          msg += `   ⏰ <b>กำหนดส่ง/จัดงาน:</b> <u>${dl}</u>\n`;
        }

        if (doc.file_url) {
          msg += `   📄 <a href="${doc.file_url}">เปิดดูต้นฉบับ</a>`;
        }

        let atts: string[] = [];
        if (Array.isArray(doc.attachment_urls)) atts = doc.attachment_urls.filter(Boolean);
        else if (typeof doc.attachment_urls === 'string') {
          try { atts = JSON.parse(doc.attachment_urls).filter(Boolean); } catch {}
        }
        if (atts.length > 0) {
          msg += ` | 📎 <b>ไฟล์แนบ:</b> `;
          atts.forEach((url, i) => { msg += `<a href="${url}">[แนบ ${i + 1}]</a> `; });
        }
        msg += `\n\n`;

        if (inlineButtons.length < 5) {
          inlineButtons.push([{
            text: `✍️ สั่งการเรื่อง ${docNum}`,
            callback_data: `action=start_assign&id=${doc.id}`
          }]);
        }
      });

      if (count > 10) {
        msg += `📌 <i>และยังมีหนังสือรอเกษียณอีก ${count - 10} ฉบับในระบบ...</i>\n\n`;
      }
      msg += `💡 <i>กดปุ่มสั่งการด้านล่างข้อความเพื่อดำเนินการได้ทันทีค่ะ 🌸</i>`;

      await sendTelegramMessage(botToken, chatId, msg, { inline_keyboard: inlineButtons });
      return res.status(200).json({ ok: true });
    }

    // ── 6.2 คำสั่งสำหรับคุณครู: เช็คภาระงานที่ค้างอยู่ ──
    const myTaskKeywords = ['งานค้าง', 'งานของฉัน', 'mytasks', 'เช็คงานค้าง', 'ดูงานค้าง', 'ภารกิจของฉัน'];
    const isMyTaskCmd = myTaskKeywords.some(kw => 
      cleanNoSlash === kw || cleanNoSlash.startsWith(kw + ' ') || cleanNoSlash.startsWith(kw + '\n')
    );

    if (isMyTaskCmd) {
      let teacherId = '';
      if (profileLinked.email) {
        const { data: tData } = await supabase
          .from('teachers')
          .select('id, prefix, first_name, last_name')
          .eq('email', profileLinked.email)
          .maybeSingle();
        if (tData) teacherId = tData.id;
      }

      if (!teacherId) {
        const { data: tData } = await supabase
          .from('teachers')
          .select('id, prefix, first_name, last_name')
          .ilike('first_name', `%${profileLinked.display_name || ''}%`)
          .maybeSingle();
        if (tData) teacherId = tData.id;
      }

      if (!teacherId) {
        await sendTelegramMessage(botToken, chatId, `❌ ขออภัยค่ะ ชบาไม่พบข้อมูลบัญชีครูที่ผูกกับ Telegram ของท่าน (อีเมล: ${profileLinked.email || 'ไม่ระบุ'}) ค่ะ กรุณาติดต่อผู้ดูแลระบบเพื่อตรวจสอบข้อมูลนะคะ 🌸`);
        return res.status(200).json({ ok: true });
      }

      const { data: assignments } = await supabase
        .from('doc_assignments')
        .select('id, instruction, status, created_at, incoming_docs(id, subject, doc_number, file_url, attachment_urls, action_deadline, urgency)')
        .eq('assignee_id', teacherId)
        .in('status', ['pending', 'acknowledged'])
        .order('created_at', { ascending: false });

      if (!assignments || assignments.length === 0) {
        await sendTelegramMessage(botToken, chatId, `🎉 <b>ยอดเยี่ยมมากค่ะ คุณครู${profileLinked.display_name || ''}!</b>\n\nคุณครูไม่มีภาระงานค้างในระบบเลยค่ะ ทุกงานเสร็จสมบูรณ์เรียบร้อยแล้วค่ะ 🌸✨`);
        return res.status(200).json({ ok: true });
      }

      let msg = `📋 <b>รายการงานที่ได้รับมอบหมาย (${assignments.length} งาน)</b>\n`;
      msg += `👤 <b>ถึงคุณครู:</b> ${escapeHtml(profileLinked.display_name || 'คุณครู')}\n━━━━━━━━━━━━━━━━━━━━\n\n`;

      const inlineButtons: any[] = [];

      assignments.forEach((asg: any, idx: number) => {
        const doc = asg.incoming_docs || {};
        const statusBadge = asg.status === 'acknowledged' ? '🟡 [รับทราบแล้ว/รอดำเนินการ]' : '🔴 [งานใหม่/ยังไม่รับทราบ]';
        
        let deadlineStr = 'ไม่ระบุ';
        let deadlineEmoji = '🟢';
        if (doc.action_deadline) {
          const dlDate = new Date(doc.action_deadline);
          const today = new Date();
          today.setHours(0,0,0,0);
          const diffDays = Math.round((dlDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          
          if (diffDays < 0) deadlineEmoji = '🔴 <b>[เลยกำหนดส่งแล้ว!]</b>';
          else if (diffDays === 0) deadlineEmoji = '🟠 <b>[ครบกำหนดวันนี้!]</b>';
          else if (diffDays === 1) deadlineEmoji = '🟠 <b>[ครบกำหนดพรุ่งนี้!]</b>';
          else if (diffDays <= 3) deadlineEmoji = `🟡 <b>[อีก ${diffDays} วัน]</b>`;
          else deadlineEmoji = `🟢 [อีก ${diffDays} วัน]`;

          deadlineStr = `${toDMYString(doc.action_deadline)} (${deadlineEmoji})`;
        }

        msg += `${idx + 1}. ${statusBadge}\n`;
        msg += `   • <b>เรื่อง:</b> <b>${escapeHtml(doc.subject || '-')}</b>\n`;
        msg += `   • <b>เลขรับ:</b> <code>${escapeHtml(doc.doc_number || '-')}</code>\n`;
        msg += `   • <b>คำสั่งการ ผอ.:</b> <i>"${escapeHtml(asg.instruction || 'โปรดดำเนินการตามหนังสือ')}"</i>\n`;
        msg += `   • <b>กำหนดส่ง:</b> ${deadlineStr}\n`;

        if (doc.file_url) {
          msg += `   📄 <a href="${doc.file_url}">เปิดดูเอกสารสั่งการ</a>`;
        }

        let atts: string[] = [];
        if (Array.isArray(doc.attachment_urls)) atts = doc.attachment_urls.filter(Boolean);
        else if (typeof doc.attachment_urls === 'string') {
          try { atts = JSON.parse(doc.attachment_urls).filter(Boolean); } catch {}
        }
        if (atts.length > 0) {
          msg += ` | 📎 <b>ไฟล์แนบ:</b> `;
          atts.forEach((url, i) => { msg += `<a href="${url}">[แนบ ${i + 1}]</a> `; });
        }
        msg += `\n\n`;

        if (inlineButtons.length < 5) {
          if (asg.status === 'pending') {
            inlineButtons.push([{
              text: `✅ รับทราบงานเรื่อง ${doc.doc_number || idx + 1}`,
              callback_data: `action=acknowledge&id=${asg.id}`
            }]);
          } else {
            inlineButtons.push([{
              text: `📝 รายงานผลเรื่อง ${doc.doc_number || idx + 1}`,
              callback_data: `action=report&id=${asg.id}`
            }]);
          }
        }
      });

      msg += `💡 <i>คุณครูสามารถกดปุ่ม "📝 รายงานผล" ด้านล่างเพื่อส่งผลงานหรือรูปภาพรายงาน ผอ. ได้ทันทีค่ะ 🌸</i>`;
      await sendTelegramMessage(botToken, chatId, msg, { inline_keyboard: inlineButtons });
      return res.status(200).json({ ok: true });
    }

    // ── 6.3 คำสั่งภาพรวมสถานะงานทั้งโรงเรียน: สำหรับ ผอ. และ แอดมิน ──
    const overviewKeywords = ['สถานะงาน', 'สรุปงาน', 'ภาพรวมงาน', 'สรุปงานโรงเรียน', 'ภาพรวม'];
    const isOverviewCmd = overviewKeywords.some(kw => 
      cleanNoSlash === kw || cleanNoSlash.startsWith(kw + ' ') || cleanNoSlash.startsWith(kw + '\n')
    );

    if (isOverviewCmd) {
      if (profileLinked.role !== 'director' && profileLinked.role !== 'admin') {
        await sendTelegramMessage(botToken, chatId, '❌ ขออภัยค่ะ คำสั่งนี้สำหรับผู้อำนวยการและผู้ดูแลระบบเท่านั้นค่ะ 🌸');
        return res.status(200).json({ ok: true });
      }

      const [pendingDocsRes, inProgressRes, completedRes] = await Promise.all([
        supabase.from('incoming_docs').select('id', { count: 'exact', head: true }).in('status', ['pending', 'waiting_proposal']),
        supabase.from('doc_assignments').select('id, status, incoming_docs(action_deadline)').in('status', ['pending', 'acknowledged']),
        supabase.from('doc_assignments').select('id', { count: 'exact', head: true }).in('status', ['completed', 'closed'])
      ]);

      const pendingRetireCount = pendingDocsRes.count || 0;
      const inProgressAssignments = inProgressRes.data || [];
      const completedCount = completedRes.count || 0;

      let overdueCount = 0;
      const today = new Date();
      today.setHours(0,0,0,0);

      inProgressAssignments.forEach((asg: any) => {
        const dl = asg.incoming_docs?.action_deadline;
        if (dl) {
          const dlDate = new Date(dl);
          if (dlDate.getTime() < today.getTime()) overdueCount++;
        }
      });

      let overviewMsg = `📊 <b>สรุปสถานะงานสารบรรณ (${settings?.school_name || 'โรงเรียน'})</b>\n━━━━━━━━━━━━━━━━━━━━\n\n`;
      overviewMsg += `📬 <b>หนังสือรอ ผอ. เกษียณสั่งการ:</b> <b>${pendingRetireCount}</b> ฉบับ ${pendingRetireCount > 0 ? '⚠️' : '✅'}\n`;
      overviewMsg += `⏳ <b>งานอยู่ระหว่างครูดำเนินการ:</b> <b>${inProgressAssignments.length}</b> งาน\n`;
      if (overdueCount > 0) {
        overviewMsg += `🔴 <b>งานที่เกินกำหนดส่ง (Overdue):</b> <b>${overdueCount}</b> งาน ⚠️\n`;
      } else {
        overviewMsg += `🟢 <b>งานเกินกำหนดส่ง:</b> ไม่มี (ตรงตามกำหนดทั้งหมด)\n`;
      }
      overviewMsg += `✅ <b>งานที่ปิดเสร็จสมบูรณ์แล้ว:</b> <b>${completedCount}</b> งาน\n\n`;
      overviewMsg += `💡 <i>พิมพ์ <code>/รอเกษียณ</code> เพื่อดูรายการหนังสือรอสั่งการ หรือพิมพ์ <code>/ขอเลขส่ง</code> เพื่อออกเลขหนังสือส่งค่ะ 🌸</i>`;

      await sendTelegramMessage(botToken, chatId, overviewMsg);
      return res.status(200).json({ ok: true });
    }

    // ปรับแต่งคำสั่งให้เป็นมาตรฐาน (Standardize Command) รองรับทั้งมี slash '/' และไม่มี slash
    let normCmd = cleanCmd;
    if (normCmd.startsWith('จองเลข')) {
      normCmd = normCmd.replace(/^จองเลข/, 'ขอเลข');
    } else if (normCmd.startsWith('/จองเลข')) {
      normCmd = normCmd.replace(/^\/จองเลข/, '/ขอเลข');
    }
    if (normCmd.startsWith('ดูเลขจอง')) {
      normCmd = normCmd.replace(/^ดูเลขจอง/, 'เช็คเลขจอง');
    } else if (normCmd.startsWith('/ดูเลขจอง')) {
      normCmd = normCmd.replace(/^\/ดูเลขจอง/, '/เช็คเลขจอง');
    }
    if (!normCmd.startsWith('/')) {
      const knownCommands = [
        'ขอเลข', 'เช็คเลขจอง', 'แนบเอกสาร', 'แนบรับ', 'แนบหนังสือรับ',
        'แนบส่ง', 'แนบหนังสือส่ง', 'แนบคำสั่ง', 'แนบบันทึก', 'แนบเมโม่',
        'ยกเลิกเลขจอง', 'ยกเลิกจอง', 'ลบเลขจอง', 'ยกเลิกรับ', 'ยกเลิกส่ง',
        'ยกเลิกคำสั่ง', 'ยกเลิกบันทึก', 'ยกเลิกเมโม่'
      ];
      for (const kc of knownCommands) {
        if (normCmd.startsWith(kc)) {
          normCmd = `/${normCmd}`;
          break;
        }
      }
    }

    if (
      normCmd.startsWith('/ขอเลข') ||
      normCmd.startsWith('/เช็คเลขจอง') ||
      normCmd.startsWith('/แนบเอกสาร') ||
      normCmd.startsWith('/แนบรับ') ||
      normCmd.startsWith('/แนบหนังสือรับ') ||
      normCmd.startsWith('/แนบส่ง') ||
      normCmd.startsWith('/แนบหนังสือส่ง') ||
      normCmd.startsWith('/แนบคำสั่ง') ||
      normCmd.startsWith('/แนบบันทึก') ||
      normCmd.startsWith('/แนบเมโม่') ||
      normCmd.startsWith('/ยกเลิกเลขจอง') ||
      normCmd.startsWith('/ยกเลิกจอง') ||
      normCmd.startsWith('/ลบเลขจอง') ||
      normCmd.startsWith('/ยกเลิกรับ') ||
      normCmd.startsWith('/ยกเลิกส่ง') ||
      normCmd.startsWith('/ยกเลิกคำสั่ง') ||
      normCmd.startsWith('/ยกเลิกบันทึก') ||
      normCmd.startsWith('/ยกเลิกเมโม่')
    ) {
      // เมนูแนะนำวิธีการขอเลขหนังสือ หากพิมพ์เพียง /ขอเลข หรือ ขอเลข
      if (normCmd.trim() === '/ขอเลข') {
        const guideMsg = `📌 <b>คู่มือการขอ/จองเลขหนังสือผ่าน Telegram</b> 🌸\n━━━━━━━━━━━━━━━━━━━━\n\n` +
          `ท่านสามารถพิมพ์คำสั่งพร้อมชื่อเรื่องได้เลยค่ะ (ใส่เครื่องหมาย / หรือไม่ใส่ก็ได้):\n\n` +
          `1️⃣ <b>บันทึกข้อความ:</b>\n` +
          `   👉 <code>ขอเลขบันทึก [ชื่อเรื่อง]</code>\n` +
          `   <i>ตัวอย่าง: ขอเลขบันทึก ขออนุมัติจัดโครงการพัฒนาวิชาการ</i>\n\n` +
          `2️⃣ <b>หนังสือส่ง (ออกภายนอก):</b>\n` +
          `   👉 <code>ขอเลขส่ง [ชื่อเรื่อง] ถึง [หน่วยงาน]</code>\n` +
          `   <i>ตัวอย่าง: ขอเลขส่ง รายงานผลการประเมิน ถึง สพป.พัทลุง เขต 2</i>\n\n` +
          `3️⃣ <b>คำสั่งโรงเรียน:</b>\n` +
          `   👉 <code>ขอเลขคำสั่ง [ชื่อเรื่อง]</code>\n` +
          `   <i>ตัวอย่าง: ขอเลขคำสั่ง แต่งตั้งคณะกรรมการตรวจรับพัสดุ</i>\n\n` +
          `4️⃣ <b>หนังสือรับ (เข้าใหม่):</b>\n` +
          `   👉 <code>ขอเลขรับ [ชื่อเรื่อง] จาก [หน่วยงาน]</code>\n` +
          `   <i>ตัวอย่าง: ขอเลขรับ ประชาสัมพันธ์งานวิชาการ จาก สพฐ.</i>\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `📋 <b>คำสั่งเพิ่มเติม:</b>\n` +
          `• <code>เช็คเลขจอง</code> — ดูรายการเลขหนังสือที่ท่านจองค้างไว้\n` +
          `• <code>แนบเอกสาร [เลขที่]</code> — ส่งพร้อมไฟล์ PDF หรือรูปภาพเพื่อแนบเอกสาร\n` +
          `• <code>ยกเลิกเลขจอง [เลขที่]</code> — ลบรายการจองที่ไม่ต้องการใช้งาน`;

        await sendTelegramMessage(botToken, chatId, guideMsg);
        return res.status(200).json({ ok: true });
      }

      if (normCmd.startsWith('/เช็คเลขจอง')) {
        const [memoRes, outRes, ordRes, incRes] = await Promise.all([
          supabase.from('memos').select('memo_number, subject, created_at').eq('reserved_by_telegram_id', String(userTelegramId)).eq('is_reserved', true),
          supabase.from('outgoing_docs').select('doc_number, subject, created_at').eq('reserved_by_telegram_id', String(userTelegramId)).eq('is_reserved', true),
          supabase.from('orders').select('order_number, subject, created_at').eq('reserved_by_telegram_id', String(userTelegramId)).eq('is_reserved', true),
          supabase.from('incoming_docs').select('doc_number, subject, created_at').eq('reserved_by_telegram_id', String(userTelegramId)).eq('is_reserved', true)
        ]);

        const list: string[] = [];
        (memoRes.data || []).forEach(m => list.push(`• <b>บันทึกข้อความ</b>: <code>${escapeHtml(m.memo_number)}</code> - ${escapeHtml(m.subject || '-')}`));
        (outRes.data || []).forEach(o => list.push(`• <b>หนังสือส่ง</b>: <code>${escapeHtml(o.doc_number)}</code> - ${escapeHtml(o.subject || '-')}`));
        (ordRes.data || []).forEach(r => list.push(`• <b>คำสั่งโรงเรียน</b>: <code>${escapeHtml(r.order_number)}</code> - ${escapeHtml(r.subject || '-')}`));
        (incRes.data || []).forEach(i => list.push(`• <b>หนังสือรับ</b>: <code>${escapeHtml(i.doc_number)}</code> - ${escapeHtml(i.subject || '-')}`));

        if (list.length === 0) {
          await sendTelegramMessage(botToken, chatId, `🎉 คุณครู <b>${escapeHtml(profileLinked.display_name || '')}</b> ไม่มีรายการเลขหนังสือที่จองค้างไว้เลยค่ะ 🌸`);
        } else {
          const resMsg = `📋 <b>รายการเลขหนังสือที่จองค้างไว้ (${list.length} รายการ)</b>\n\n${list.join('\n')}\n\n💡 <i>พิมพ์ <code>/แนบเอกสาร [เลขที่]</code> เพื่อแนบไฟล์ หรือ <code>/ยกเลิกเลขจอง [เลขที่]</code> เพื่อยกเลิกรายการจองค่ะ 🌸</i>`;
          await sendTelegramMessage(botToken, chatId, resMsg);
        }
        return res.status(200).json({ ok: true });
      }

      // ── 6.7 คำสั่งลบหนังสือรับ (รองรับการลบหนังสือรับที่ลงผิด/ต้องการลงรับใหม่) ──
      if (
        normCmd.startsWith('/ลบหนังสือรับ') ||
        normCmd.startsWith('/ลบรับ') ||
        normCmd.startsWith('/ลบเลขรับ') ||
        normCmd.startsWith('/ยกเลิกหนังสือรับ')
      ) {
        const targetSeqStr = normCmd.replace(/^\/(ลบหนังสือรับ|ลบรับ|ลบเลขรับ|ยกเลิกหนังสือรับ)\s*/, '').trim();
        const targetSeq = parseInt(targetSeqStr, 10);

        if (!targetSeqStr) {
          await sendTelegramMessage(botToken, chatId, `⚠️ กรุณาระบุเลขรับที่ต้องการลบ เช่น <code>/ลบหนังสือรับ 822</code> ค่ะ 🌸`);
          return res.status(200).json({ ok: true });
        }

        // ค้นหาหนังสือรับที่ตรงกับ doc_number หรือ doc_sequence
        const { data: matchedDocs } = await supabase
          .from('incoming_docs')
          .select('id, doc_number, subject, file_url, doc_sequence')
          .or(`doc_number.eq.${targetSeqStr},doc_sequence.eq.${isNaN(targetSeq) ? -1 : targetSeq}`);

        if (!matchedDocs || matchedDocs.length === 0) {
          await sendTelegramMessage(botToken, chatId, `❌ ไม่พบหนังสือรับเลขที่ <b>${escapeHtml(targetSeqStr)}</b> ในระบบสารบรรณค่ะ 🌸`);
          return res.status(200).json({ ok: true });
        }

        let deletedCount = 0;
        for (const doc of matchedDocs) {
          await supabase.from('doc_assignments').delete().eq('doc_id', doc.id);
          await supabase.from('incoming_docs').delete().eq('id', doc.id);
          deletedCount++;
        }

        await sendTelegramMessage(
          botToken, 
          chatId, 
          `🗑️ <b>ลบหนังสือรับเลขที่ ${escapeHtml(targetSeqStr)} สำเร็จเรียบร้อย!</b>\n\nระบบได้ลบข้อมูลหนังสือรับออกจำนวน <b>${deletedCount}</b> ฉบับเรียบร้อยแล้วค่ะ\nคุณครูสามารถดำเนินการลงรับหนังสือใหม่ในระบบได้ทันทีค่ะ 🌸`
        );
        return res.status(200).json({ ok: true });
      }

      if (
        normCmd.startsWith('/ยกเลิกเลขจอง') ||
        normCmd.startsWith('/ยกเลิกจอง') ||
        normCmd.startsWith('/ลบเลขจอง') ||
        normCmd.startsWith('/ยกเลิกรับ') ||
        normCmd.startsWith('/ยกเลิกส่ง') ||
        normCmd.startsWith('/ยกเลิกคำสั่ง') ||
        normCmd.startsWith('/ยกเลิกบันทึก') ||
        normCmd.startsWith('/ยกเลิกเมโม่')
      ) {
        let typeHint = '';
        if (normCmd.startsWith('/ยกเลิกรับ')) typeHint = 'incoming_docs';
        else if (normCmd.startsWith('/ยกเลิกส่ง')) typeHint = 'outgoing_docs';
        else if (normCmd.startsWith('/ยกเลิกคำสั่ง')) typeHint = 'orders';
        else if (normCmd.startsWith('/ยกเลิกบันทึก') || normCmd.startsWith('/ยกเลิกเมโม่')) typeHint = 'memos';

        const targetSeqStr = normCmd.replace(/^\/(ยกเลิกเลขจอง|ยกเลิกจอง|ลบเลขจอง|ยกเลิกรับ|ยกเลิกส่ง|ยกเลิกคำสั่ง|ยกเลิกบันทึก|ยกเลิกเมโม่)\s*/, '').trim();
        const targetSeq = parseInt(targetSeqStr, 10);

        if (isNaN(targetSeq)) {
          await sendTelegramMessage(botToken, chatId, `⚠️ กรุณาระบุตัวเลขลำดับที่ต้องการยกเลิกการจอง เช่น <code>/ยกเลิกเลขจอง 5</code> ค่ะ 🌸`);
          return res.status(200).json({ ok: true });
        }

        const tablesToSearch = typeHint ? [typeHint] : ['memos', 'outgoing_docs', 'orders', 'incoming_docs'];
        const foundMatches: { table: string; id: string; subject: string; doc_number: string }[] = [];

        for (const tbl of tablesToSearch) {
          const { data: rows } = await supabase
            .from(tbl)
            .select('*')
            .eq('doc_sequence', targetSeq)
            .eq('is_reserved', true)
            .eq('doc_year', docYearNum);

          if (rows && rows.length > 0) {
            rows.forEach(r => {
              const num = r.memo_number || r.doc_number || r.order_number || String(targetSeq);
              foundMatches.push({ table: tbl, id: r.id, subject: r.subject || '', doc_number: num });
            });
          }
        }

        if (foundMatches.length === 0) {
          await sendTelegramMessage(botToken, chatId, `❌ ไม่พบรายการจองเลขลำดับที่ <b>${targetSeq}</b> สำหรับปีการศึกษา ${docYearNum} ที่สามารถยกเลิกได้ในระบบค่ะ 🌸`);
          return res.status(200).json({ ok: true });
        }

        if (foundMatches.length > 1 && !typeHint) {
          const tableLabelMap: Record<string, string> = {
            memos: 'บันทึกข้อความ',
            outgoing_docs: 'หนังสือส่ง',
            orders: 'คำสั่งโรงเรียน',
            incoming_docs: 'หนังสือรับ'
          };
          const cmdMap: Record<string, string> = {
            memos: '/ยกเลิกบันทึก',
            outgoing_docs: '/ยกเลิกส่ง',
            orders: '/ยกเลิกคำสั่ง',
            incoming_docs: '/ยกเลิกรับ'
          };
          const optionsList = foundMatches.map(m => `• <b>${tableLabelMap[m.table] || m.table}</b>: <code>${m.doc_number}</code> (${m.subject})\n  👉 พิมพ์คำสั่ง: <code>${cmdMap[m.table]} ${targetSeq}</code>`).join('\n\n');
          await sendTelegramMessage(botToken, chatId, `⚠️ พบรายการจองเลขลำดับ <b>${targetSeq}</b> ซ้ำกัน ${foundMatches.length} หมวดเอกสารค่ะ:\n\n${optionsList}\n\nกรุณาพิมพ์คำสั่งระบุประเภทเอกสารที่ต้องการยกเลิกอีกครั้งนะคะ 🌸`);
          return res.status(200).json({ ok: true });
        }

        const target = foundMatches[0];
        const { error: delErr } = await supabase.from(target.table).delete().eq('id', target.id);

        if (delErr) {
          await sendTelegramMessage(botToken, chatId, `❌ เกิดข้อผิดพลาดในการยกเลิกรายการจอง: ${escapeHtml(delErr.message)}`);
          return res.status(200).json({ ok: true });
        }

        await sendTelegramMessage(botToken, chatId, `🗑️ <b>ยกเลิกการจองเลขสำเร็จ!</b>\n\nทำการลบรายการจองเลขลำดับ <b>${targetSeq}</b> (เรื่อง: ${escapeHtml(target.subject || '-')}) ออกจากระบบเรียบร้อยแล้วค่ะ สามารถพิมพ์ขอเลขใหม่ได้ทันทีค่ะ 🌸✨`);
        return res.status(200).json({ ok: true });
      }

      if (
        normCmd.startsWith('/ขอเลขบันทึก') ||
        normCmd.startsWith('/ขอเลขเมโม่') ||
        normCmd.startsWith('/ขอเลขmemo')
      ) {
        let subject = normCmd.replace(/^\/(ขอเลขบันทึกข้อความ|ขอเลขบันทึก|ขอเลขเมโม่|ขอเลขmemo)\s*/, '').trim();
        if (!subject) {
          await sendTelegramMessage(botToken, chatId, `⚠️ กรุณาระบุชื่อเรื่องด้วยนะคะ เช่น <code>ขอเลขบันทึก ขออนุมัติจัดโครงการพัฒนาวิชาการ</code> ค่ะ 🌸`);
          return res.status(200).json({ ok: true });
        }

        const startSeq = settings?.start_memo_seq || 1;
        const nextSeq = await getAccurateNextSeqInWebhook(supabase, 'memos', docYearNum, startSeq);
        const fullNumber = `${nextSeq}/${docYearNum}`;
        const todayStr = new Date().toISOString().split('T')[0];

        const { error } = await supabase.from('memos').insert([{
          memo_number: fullNumber,
          subject: subject,
          memo_date: todayStr,
          doc_year: docYearNum,
          doc_sequence: nextSeq,
          status: 'reserved',
          is_reserved: true,
          reserved_by_telegram_id: String(userTelegramId),
          reserved_by_name: profileLinked.display_name
        }]);

        if (error) {
          await sendTelegramMessage(botToken, chatId, `❌ ขออภัยค่ะ ไม่สามารถออกเลขบันทึกข้อความได้: ${escapeHtml(error.message)}`);
          return res.status(200).json({ ok: true });
        }

        // ซิงค์เข้าสู่ระบบออกเลขกลาง Unified Numbering
        await syncUnifiedAllocation(supabase, 'MEMO', docYearNum, nextSeq, fullNumber, subject, profileLinked.display_name, 'memos');

        const msg = `✅ <b>ขอเลขบันทึกข้อความสำเร็จ! (สถานะ: จองเลข)</b>\n\n📌 <b>เลขที่บันทึกข้อความ:</b> <code>${escapeHtml(fullNumber)}</code>\n📄 <b>เรื่อง:</b> ${escapeHtml(subject)}\n👤 <b>ผู้ขอเลข:</b> ${escapeHtml(profileLinked.display_name || '-')}\n\n💡 <i>เลขถูกจองไว้ในระบบแล้ว สามารถส่งไฟล์ PDF มาแนบย้อนหลังได้ตลอดเวลาค่ะ 🌸</i>`;
        await sendTelegramMessage(botToken, chatId, msg);
        return res.status(200).json({ ok: true });
      }

      // รองรับทั้ง /ขอเลขส่ง และ /ขอเลขหนังสือส่ง (alias)
      if (normCmd.startsWith('/ขอเลขส่ง') || normCmd.startsWith('/ขอเลขหนังสือส่ง')) {
        const payload = normCmd.replace(/^\/(ขอเลขหนังสือส่ง|ขอเลขส่ง)\s*/, '').trim();
        let subject = payload;
        let toAgency = 'หน่วยงานภายนอก';

        if (payload.includes(' ถึง ')) {
          const parts = payload.split(' ถึง ');
          subject = parts[0].trim();
          toAgency = parts[1].trim();
        }

        if (!subject) {
          await sendTelegramMessage(botToken, chatId, `⚠️ กรุณาระบุชื่อเรื่องด้วยนะคะ เช่น <code>ขอเลขส่ง แจ้งส่งรายงาน ถึง สพป.พัทลุง เขต 2</code> ค่ะ 🌸`);
          return res.status(200).json({ ok: true });
        }

        const startSeq = settings?.start_outgoing_seq || 1;
        const nextSeq = await getAccurateNextSeqInWebhook(supabase, 'outgoing_docs', docYearNum, startSeq);
        const prefix = settings?.school_doc_prefix || 'ศธ 04225.016/';
        const fullNumber = `${prefix}${nextSeq}`;
        const todayStr = new Date().toISOString().split('T')[0];

        const { error } = await supabase.from('outgoing_docs').insert([{
          doc_number: fullNumber,
          subject: subject,
          to_agency: toAgency,
          doc_date: todayStr,
          doc_year: docYearNum,
          doc_sequence: nextSeq,
          status: 'reserved',
          is_reserved: true,
          reserved_by_telegram_id: String(userTelegramId),
          reserved_by_name: profileLinked.display_name
        }]);

        if (error) {
          await sendTelegramMessage(botToken, chatId, `❌ ขออภัยค่ะ ไม่สามารถออกเลขหนังสือส่งได้: ${escapeHtml(error.message)}`);
          return res.status(200).json({ ok: true });
        }

        // ซิงค์เข้าสู่ระบบออกเลขกลาง Unified Numbering
        await syncUnifiedAllocation(supabase, 'OUTGOING', docYearNum, nextSeq, fullNumber, subject, profileLinked.display_name, 'outgoing_docs');

        const msg = `✅ <b>ขอเลขหนังสือส่งสำเร็จ! (สถานะ: จองเลข)</b>\n\n📌 <b>เลขที่หนังสือส่ง:</b> <code>${escapeHtml(fullNumber)}</code>\n📄 <b>เรื่อง:</b> ${escapeHtml(subject)}\n🏢 <b>ถึง:</b> ${escapeHtml(toAgency)}\n👤 <b>ผู้ขอเลข:</b> ${escapeHtml(profileLinked.display_name || '-')}\n\n💡 <i>เลขหนังสือส่งถูกจองไว้ในระบบแล้ว สามารถส่งไฟล์ PDF มาแนบย้อนหลังได้ตลอดเวลาค่ะ 🌸</i>`;
        await sendTelegramMessage(botToken, chatId, msg);
        return res.status(200).json({ ok: true });
      }

      if (normCmd.startsWith('/ขอเลขคำสั่ง')) {
        let subject = normCmd.replace(/^\/ขอเลขคำสั่ง\s*/, '').trim();
        if (!subject) {
          await sendTelegramMessage(botToken, chatId, `⚠️ กรุณาระบุชื่อเรื่องคำสั่งด้วยนะคะ เช่น <code>ขอเลขคำสั่ง แต่งตั้งคณะทำงานพัฒนาโรงเรียน</code> ค่ะ 🌸`);
          return res.status(200).json({ ok: true });
        }

        const startSeq = settings?.start_order_seq || 1;
        const nextSeq = await getAccurateNextSeqInWebhook(supabase, 'orders', docYearNum, startSeq);
        const fullNumber = `${nextSeq}/${docYearNum}`;
        const todayStr = new Date().toISOString().split('T')[0];

        const { error } = await supabase.from('orders').insert([{
          order_number: fullNumber,
          subject: subject,
          issuer: settings?.school_name || 'โรงเรียน',
          order_date: todayStr,
          doc_year: docYearNum,
          doc_sequence: nextSeq,
          status: 'reserved',
          is_reserved: true,
          reserved_by_telegram_id: String(userTelegramId),
          reserved_by_name: profileLinked.display_name
        }]);

        if (error) {
          await sendTelegramMessage(botToken, chatId, `❌ ขออภัยค่ะ ไม่สามารถออกเลขคำสั่งได้: ${escapeHtml(error.message)}`);
          return res.status(200).json({ ok: true });
        }

        // ซิงค์เข้าสู่ระบบออกเลขกลาง Unified Numbering
        await syncUnifiedAllocation(supabase, 'SCHOOL_ORDER', docYearNum, nextSeq, fullNumber, subject, profileLinked.display_name, 'orders');

        const msg = `✅ <b>ขอเลขคำสั่งโรงเรียนสำเร็จ! (สถานะ: จองเลข)</b>\n\n📌 <b>เลขที่คำสั่ง:</b> <code>${escapeHtml(fullNumber)}</code>\n📄 <b>เรื่อง:</b> ${escapeHtml(subject)}\n👤 <b>ผู้ขอเลข:</b> ${escapeHtml(profileLinked.display_name || '-')}\n\n💡 <i>เลขคำสั่งถูกจองไว้ในระบบแล้ว สามารถส่งไฟล์ PDF มาแนบย้อนหลังได้ตลอดเวลาค่ะ 🌸</i>`;
        await sendTelegramMessage(botToken, chatId, msg);
        return res.status(200).json({ ok: true });
      }

      // รองรับทั้ง /ขอเลขรับ และ /ขอเลขหนังสือรับ (alias)
      if (normCmd.startsWith('/ขอเลขรับ') || normCmd.startsWith('/ขอเลขหนังสือรับ')) {
        const payload = normCmd.replace(/^\/(ขอเลขหนังสือรับ|ขอเลขรับ)\s*/, '').trim();
        let subject = payload;
        let fromAgency = 'หน่วยงานภายนอก';

        if (payload.includes(' จาก ')) {
          const parts = payload.split(' จาก ');
          subject = parts[0].trim();
          fromAgency = parts[1].trim();
        }

        if (!subject) {
          await sendTelegramMessage(botToken, chatId, `⚠️ กรุณาระบุชื่อเรื่องด้วยนะคะ เช่น <code>ขอเลขรับ ประชาสัมพันธ์โครงการ จาก สพป.พัทลุง เขต 2</code> ค่ะ 🌸`);
          return res.status(200).json({ ok: true });
        }

        const startSeq = settings?.start_incoming_seq || 1;
        const nextSeq = await getAccurateNextSeqInWebhook(supabase, 'incoming_docs', docYearNum, startSeq);
        const fullNumber = `${nextSeq}`;
        const todayStr = new Date().toISOString().split('T')[0];

        const { error } = await supabase.from('incoming_docs').insert([{
          doc_number: fullNumber,
          subject: subject,
          from_agency: fromAgency,
          doc_date: todayStr,
          doc_year: docYearNum,
          doc_sequence: nextSeq,
          status: 'reserved',
          is_reserved: true,
          reserved_by_telegram_id: String(userTelegramId),
          reserved_by_name: profileLinked.display_name
        }]);

        if (error) {
          await sendTelegramMessage(botToken, chatId, `❌ ขออภัยค่ะ ไม่สามารถออกเลขรับได้: ${escapeHtml(error.message)}`);
          return res.status(200).json({ ok: true });
        }

        // ซิงค์เข้าสู่ระบบออกเลขกลาง Unified Numbering
        await syncUnifiedAllocation(supabase, 'INCOMING', docYearNum, nextSeq, fullNumber, subject, profileLinked.display_name, 'incoming_docs');

        const msg = `✅ <b>ขอเลขลงรับเอกสารสำเร็จ! (สถานะ: จองเลข)</b>\n\n📌 <b>เลขรับที่:</b> <code>${escapeHtml(fullNumber)}</code>\n📄 <b>เรื่อง:</b> ${escapeHtml(subject)}\n🏢 <b>จาก:</b> ${escapeHtml(fromAgency)}\n👤 <b>ผู้ลงรับ:</b> ${escapeHtml(profileLinked.display_name || '-')}\n\n💡 <i>เลขรับถูกจองไว้ในระบบแล้ว สามารถส่งไฟล์ PDF มาแนบย้อนหลังได้ตลอดเวลาค่ะ 🌸</i>`;
        await sendTelegramMessage(botToken, chatId, msg);
        return res.status(200).json({ ok: true });
      }

      if (
        normCmd.startsWith('/แนบเอกสาร') ||
        normCmd.startsWith('/แนบรับ') ||
        normCmd.startsWith('/แนบหนังสือรับ') ||
        normCmd.startsWith('/แนบส่ง') ||
        normCmd.startsWith('/แนบหนังสือส่ง') ||
        normCmd.startsWith('/แนบคำสั่ง') ||
        normCmd.startsWith('/แนบบันทึก') ||
        normCmd.startsWith('/แนบเมโม่')
      ) {
        let typeHint = '';
        if (normCmd.startsWith('/แนบรับ') || normCmd.startsWith('/แนบหนังสือรับ')) typeHint = 'incoming_docs';
        else if (normCmd.startsWith('/แนบส่ง') || normCmd.startsWith('/แนบหนังสือส่ง')) typeHint = 'outgoing_docs';
        else if (normCmd.startsWith('/แนบคำสั่ง')) typeHint = 'orders';
        else if (normCmd.startsWith('/แนบบันทึก') || normCmd.startsWith('/แนบเมโม่')) typeHint = 'memos';

        const targetSeqStr = normCmd.replace(/^\/(แนบเอกสาร|แนบรับ|แนบหนังสือรับ|แนบส่ง|แนบหนังสือส่ง|แนบคำสั่ง|แนบบันทึก|แนบเมโม่)\s*/, '').trim();
        const targetSeq = parseInt(targetSeqStr, 10);

        let uploadedUrl = '';
        if (message.document) {
          const ext = message.document.file_name?.split('.').pop() || 'pdf';
          uploadedUrl = await uploadTelegramFileToSupabase(botToken, message.document.file_id, ext, supabase, settings);
        } else if (message.photo && Array.isArray(message.photo) && message.photo.length > 0) {
          const largest = message.photo[message.photo.length - 1];
          uploadedUrl = await uploadTelegramFileToSupabase(botToken, largest.file_id, 'jpg', supabase, settings);
        }

        if (!uploadedUrl) {
          await sendTelegramMessage(botToken, chatId, `⚠️ กรุณาส่งไฟล์ PDF หรือรูปภาพเอกสารมาพร้อมกับพิมพ์ <code>/แนบเอกสาร [เลขที่]</code> ด้วยนะคะ 🌸`);
          return res.status(200).json({ ok: true });
        }

        if (isNaN(targetSeq)) {
          await sendTelegramMessage(botToken, chatId, `⚠️ กรุณาระบุตัวเลขลำดับที่ต้องการแนบ เช่น <code>/แนบเอกสาร 154</code> ค่ะ`);
          return res.status(200).json({ ok: true });
        }

        // ค้นหารายการจองในตารางที่เกี่ยวข้อง
        const tablesToSearch = typeHint ? [typeHint] : ['memos', 'outgoing_docs', 'orders', 'incoming_docs'];
        const foundMatches: { table: string; id: string; subject: string; doc_number: string }[] = [];

        for (const tbl of tablesToSearch) {
          const { data: rows } = await supabase.from(tbl).select('*').eq('doc_sequence', targetSeq).eq('is_reserved', true).eq('doc_year', docYearNum);
          if (rows && rows.length > 0) {
            rows.forEach(r => {
              const num = r.memo_number || r.doc_number || r.order_number || String(targetSeq);
              foundMatches.push({ table: tbl, id: r.id, subject: r.subject || '', doc_number: num });
            });
          }
        }

        if (foundMatches.length === 0) {
          await sendTelegramMessage(botToken, chatId, `❌ ไม่พบรายการจองเลขลำดับที่ <b>${targetSeq}</b> สำหรับปีการศึกษา ${docYearNum} ในระบบค่ะ กรุณาเช็คจาก <code>/เช็คเลขจอง</code> อีกครั้งค่ะ`);
          return res.status(200).json({ ok: true });
        }

        // กรณีพบหลายรายการที่มีเลขลำดับซ้ำกันต่างประเภทเอกสาร
        if (foundMatches.length > 1 && !typeHint) {
          const tableLabelMap: Record<string, string> = {
            memos: 'บันทึกข้อความ',
            outgoing_docs: 'หนังสือส่ง',
            orders: 'คำสั่งโรงเรียน',
            incoming_docs: 'หนังสือรับ'
          };
          const cmdMap: Record<string, string> = {
            memos: '/แนบบันทึก',
            outgoing_docs: '/แนบส่ง',
            orders: '/แนบคำสั่ง',
            incoming_docs: '/แนบรับ'
          };
          const optionsList = foundMatches.map(m => `• <b>${tableLabelMap[m.table] || m.table}</b>: <code>${m.doc_number}</code> (${m.subject})\n  👉 พิมพ์คำสั่ง: <code>${cmdMap[m.table]} ${targetSeq}</code>`).join('\n\n');
          await sendTelegramMessage(botToken, chatId, `⚠️ พบรายการจองเลขลำดับ <b>${targetSeq}</b> ซ้ำกัน ${foundMatches.length} หมวดเอกสารค่ะ:\n\n${optionsList}\n\nกรุณาส่งไฟล์พร้อมพิมพ์ระบุประเภทคำสั่งอีกครั้งนะคะ 🌸`);
          return res.status(200).json({ ok: true });
        }

        const selectedMatch = foundMatches[0];
        const matchedTable = selectedMatch.table;
        const matchedId = selectedMatch.id;

        await supabase.from(matchedTable).update({
          file_url: uploadedUrl,
          is_reserved: false,
          status: matchedTable === 'incoming_docs' ? 'waiting_proposal' : 'pending'
        }).eq('id', matchedId);

        let noticeMsg = `🎉 <b>แนบไฟล์เอกสารย้อนหลังสำเร็จ!</b>\n\nอัปเดตไฟล์แนบใส่เรคคอร์ดเลขลำดับ <b>${targetSeq}</b> และเปลี่ยนสถานะเป็นสมบูรณ์เรียบร้อยแล้วค่ะ 🌸✨`;

        // หากเป็นหนังสือรับ (incoming_docs) ให้ส่งแจ้งเตือนเสนอ ผอ. พร้อมปุ่มสั่งการอัตโนมัติทันที
        if (matchedTable === 'incoming_docs') {
          const { data: incDoc } = await supabase
            .from('incoming_docs')
            .select('*')
            .eq('id', matchedId)
            .maybeSingle();

          if (incDoc) {
            const proposalMsg = `📥 <b>เสนอหนังสือรับเข้าใหม่รอเกษียณสั่งการ</b>\n\n📌 <b>เลขรับที่:</b> <code>${incDoc.doc_number || targetSeq}</code>\n📄 <b>เรื่อง:</b> ${escapeHtml(incDoc.subject || '-')}\n🏢 <b>จาก:</b> ${escapeHtml(incDoc.from_agency || '-')}\n👤 <b>ผู้ลงรับ:</b> ${incDoc.reserved_by_name || profileLinked.display_name}\n\n📄 <a href="${uploadedUrl}">เปิดดูต้นฉบับเอกสาร</a>\n\n💡 <i>ท่านสามารถกดปุ่ม "✍️ สั่งการ" ด้านล่างเพื่อดำเนินการสั่งการผ่าน Telegram ได้ทันทีค่ะ 🌸</i>`;
            
            const replyMarkup = {
              inline_keyboard: [
                [
                  {
                    text: `✍️ สั่งการเรื่อง ${incDoc.doc_number || targetSeq}`,
                    callback_data: `action=start_assign&id=${matchedId}`
                  }
                ]
              ]
            };

            // ดึง Telegram ส่วนตัวของ ผอ. / Admin
            const { data: directorProfiles } = await supabase
              .from('profiles')
              .select('telegram_chat_id')
              .or('role.eq.director,role.eq.admin')
              .not('telegram_chat_id', 'is', null);

            let sentProposalCount = 0;
            if (directorProfiles && directorProfiles.length > 0) {
              for (const dir of directorProfiles) {
                if (dir.telegram_chat_id) {
                  const dirChatIdNum = parseInt(String(dir.telegram_chat_id), 10);
                  if (!isNaN(dirChatIdNum)) {
                    await sendTelegramMessage(botToken, dirChatIdNum, proposalMsg, replyMarkup);
                    sentProposalCount++;
                  }
                }
              }
            }

            // Fallback เข้ากลุ่มเสนอหนังสือ
            const rawGroupId = settings?.telegram_group_id || '';
            const proposalGroupIdStr = rawGroupId.split('|')[1]?.trim() || rawGroupId.split('|')[0]?.trim() || '';
            const proposalGroupIdNum = proposalGroupIdStr ? parseInt(proposalGroupIdStr, 10) : null;
            
            if (sentProposalCount === 0 && proposalGroupIdNum !== null && !isNaN(proposalGroupIdNum)) {
              await sendTelegramMessage(botToken, proposalGroupIdNum, proposalMsg, replyMarkup);
              sentProposalCount++;
            }

            noticeMsg += `\n\n📨 <i>ระบบได้ทำการส่งหนังสือเสนอ ผอ. เพื่อเกษียณสั่งการเรียบร้อยแล้วค่ะ (${sentProposalCount} ช่องทาง)</i>`;
          }
        }

        await sendTelegramMessage(botToken, chatId, noticeMsg);
        return res.status(200).json({ ok: true });
      }
    }

    // จัดการข้อความสนทนาทั่วไป
    const isGroup = chatId < 0;
    // Fix Bug#3: fallback botMention ต้องใช้ชื่อ bot จริง ไม่ใช่ตัวเลข Token ID
    // telegram_bot_username ควรเก็บเฉพาะชื่อ เช่น "ChabaSchoolBot" (ไม่มี @)
    const botMention = settings?.telegram_bot_username
      ? `@${settings.telegram_bot_username}`
      : '@ChabaSchoolBot'; // fallback ชื่อ default ที่ถูกต้อง
    const isMentioned = !isGroup || rawText.includes(botMention) || rawText.includes('ชบา') || rawText.includes('น้องชบา');

    if (isGroup && !isMentioned) {
      // อยู่ในกลุ่มแต่ไม่ได้กล่าวถึงบอท ไม่ตอบเพื่อประหยัดโควตาและลดความรำคาญ
      return res.status(200).json({ ok: true });
    }

    // จัดการข้อความ (ล้าง mention ออกเพื่อให้ AI ตอบได้ดีขึ้น)
    const cleanedText = rawText.replace(new RegExp(botMention, 'g'), '').trim();

    // เช็คว่าเป็นคำสั่งด่วนค้นหางานค้าง/รายงานผลของครูหรือไม่
    const isTaskQuery = ['งานของฉัน', 'งานค้าง', 'รายงานผล', 'ส่งงาน', 'เช็คงาน', 'ภารกิจ', 'งานมอบหมาย'].some(k => cleanedText.includes(k));
    if (isTaskQuery) {
      let teacherId = '';
      if (profileLinked.email) {
        const { data: tData } = await supabase
          .from('teachers')
          .select('id')
          .eq('email', profileLinked.email.toLowerCase().trim())
          .maybeSingle();
        if (tData) teacherId = tData.id;
      }

      let assignQuery = supabase
        .from('doc_assignments')
        .select('id, instruction, status, incoming_docs(subject, doc_number, file_url, attachment_urls)')
        .in('status', ['pending', 'acknowledged'])
        .order('created_at', { ascending: false });

      if (teacherId) {
        assignQuery = assignQuery.eq('assignee_id', teacherId);
      }

      const { data: myAssigns } = await assignQuery.limit(10);

      if (!myAssigns || myAssigns.length === 0) {
        await sendTelegramMessage(
          botToken,
          chatId,
          `🎉 ยินดีด้วยค่ะคุณครู <b>${profileLinked.display_name || ''}</b>! ขณะนี้ไม่มีงานราชการที่อยู่ระหว่างรอรายงานผลค้างอยู่เลยค่ะ 🌸`
        );
        return res.status(200).json({ ok: true });
      }

      let taskListMsg = `📊 <b>รายการงานราชการที่ได้รับมอบหมาย (${myAssigns.length} รายการ)</b>\n\n`;
      const inlineKeyboard: any[] = [];

      myAssigns.forEach((item: any, idx: number) => {
        const docSubject = item.incoming_docs?.subject || 'งานที่ได้รับมอบหมาย';
        const docNum = item.incoming_docs?.doc_number || '-';
        const statusLabel = item.status === 'pending' ? '⏳ รอรับทราบ' : '📌 อยู่ระหว่างดำเนินงาน';

        taskListMsg += `<b>${idx + 1}. ${escapeHtml(docSubject)}</b>\n`;
        taskListMsg += `• <b>เลขที่หนังสือ</b>: ${escapeHtml(docNum)}\n`;
        taskListMsg += `• <b>คำสั่งการ</b>: ${escapeHtml(item.instruction || 'มอบดำเนินการ')}\n`;
        taskListMsg += `• <b>สถานะ</b>: ${statusLabel}\n`;

        if (item.incoming_docs?.file_url) {
          taskListMsg += `• 📄 <a href="${item.incoming_docs.file_url}">เปิดดูเอกสารสั่งการ</a>`;
        }

        const rawAtts = item.incoming_docs?.attachment_urls;
        let itemAtts: string[] = [];
        if (Array.isArray(rawAtts)) itemAtts = rawAtts.filter(Boolean);
        else if (typeof rawAtts === 'string') {
          try {
            const parsed = JSON.parse(rawAtts);
            if (Array.isArray(parsed)) itemAtts = parsed.filter(Boolean);
          } catch {}
        }

        if (itemAtts.length > 0) {
          taskListMsg += ` | 📎 `;
          itemAtts.forEach((url, i) => {
            taskListMsg += `<a href="${url}">[แนบ ${i + 1}]</a> `;
          });
        }
        taskListMsg += `\n\n`;

        const shortLabel = docNum !== '-' ? docNum : docSubject.substring(0, 15);
        inlineKeyboard.push([
          { text: `📝 รายงานผล: ${shortLabel}`, callback_data: `action=report&id=${item.id}` }
        ]);
        inlineKeyboard.push([
          { text: `📢 ประชาสัมพันธ์ลงกลุ่มกลาง`, callback_data: `action=bc_grp&id=${item.id}` }
        ]);
      });

      await sendTelegramMessage(botToken, chatId, taskListMsg, { inline_keyboard: inlineKeyboard });
      return res.status(200).json({ ok: true });
    }

    try {
      // 1. ดึงประวัติการสนทนาย้อนหลังในห้องแชทนี้ (Conversational Memory - 5 ข้อความล่าสุด)
      let chatHistoryContext = "";
      try {
        const { data: pastChats } = await supabase
          .from('telegram_chats')
          .select('message, reply')
          .eq('telegram_chat_id', String(chatId))
          .order('created_at', { ascending: false })
          .limit(5);

        if (pastChats && pastChats.length > 0) {
          chatHistoryContext = pastChats.reverse().map((c: any) => `คุณครู: ${c.message}\nน้องชบา: ${c.reply}`).join('\n');
        }
      } catch (chatErr) {
        // Non-blocking fallback if table is not yet created
      }

      // 2. Smart Data Fetch — ดึงข้อมูลจริงจากฐานข้อมูลตามหมวดคำถาม
      const contextData = await smartFetchContext(cleanedText, currentYear, supabase, undefined, profileLinked);
      console.log(`[TELEGRAM WEBHOOK] Context Data size: ${contextData.length} chars`);

      // 3. นับจำนวนบุคลากร
      const { count: staffCount } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        ;

      if (apiKey) {
        // --- โหมด AI อัจฉริยะ (Jarvis Mode V2 with Strict Rules) ---
        const systemPrompt = `คุณคือ "น้องชบา" ผู้ช่วยอัจฉริยะระบบงานธุรการและสารบรรณของ ${settings.school_name || 'โรงเรียน'} (ห้ามใช้คำว่า AI Cowork หรือ AI เด็ดขาด)
ลักษณะนิสัย: สุภาพ อ่อนน้อม ใช้ "ค่ะ/นะคะ" แทนตัวว่า "ชบา" หรือ "หนู" (ห้ามใช้หางเสียง "ครับ" หรือคำพูดเชิงผู้ชายเด็ดขาด)
คล้ายกับบอท J.A.R.V.I.S. ในไอรอนแมน (ผู้ช่วยสมองกลอัจฉริยะ)

⚠️ กฎภาษา (บังคับสูงสุด):
- ตอบเป็นภาษาไทยเท่านั้น ห้ามใช้ภาษาอังกฤษในคำตอบเด็ดขาด แม้แต่คำเดียว
- ห้ามเขียน Thinking / Reasoning / Planning หรือขั้นตอนการคิดเป็นภาษาอังกฤษก่อนตอบ

กฎเหล็ก:
- ตอบเฉพาะ "คำตอบสุดท้ายที่จะส่งให้ครู" โดยใส่ไว้ในแท็ก <ans>...</ans> เท่านั้น ห้ามมีข้อความใดๆ นอกแท็ก <ans> เด็ดขาด
- ห้ามพิมพ์ขั้นตอนการคิด (Thinking), ห้ามทวนคำถาม, ห้ามเกริ่นนำใดๆ นอกแท็ก <ans>
- ห้ามจินตนาการ ห้ามสร้าง คาดเดา หรือสมมติข้อมูลใดๆ เช่น ชื่อคน ชื่อโครงการ วันที่ หรือตัวเลขขึ้นมาเองโดยเด็ดขาด หากข้อมูลไม่อยู่ใน "ข้อมูลฐานข้อมูลโรงเรียน" ที่ส่งมา ให้ตอบอย่างสุภาพว่าไม่พบข้อมูลดังกล่าวในระบบ
- ให้ใช้รูปแบบ HTML สำหรับ Telegram ในการจัดรูปแบบข้อความเท่านั้น **ห้ามใช้รูปแบบ Markdown (เช่น ห้ามใช้ ** หรือ [ข้อความ](ลิงก์) เด็ดขาด)**:
  * ใช้ <b>ข้อความตัวหนา</b> สำหรับตัวหนา (เช่น <b>เรื่อง:</b> หรือ <b>รายละเอียด:</b>)
  * ใช้ <i>ข้อความตัวเอียง</i> สำหรับตัวเอียง
  * ใช้ <code>รหัส</code> สำหรับข้อความโค้ดหรือ ID
- การจัดรูปแบบลิงก์ (สำคัญมาก):
  * ห้ามแสดงลิงก์ URL ยาวๆ แบบดิบ และห้ามใช้วงเล็บลิงก์แบบ Markdown [ลิงก์](URL) เด็ดขาด
  * ให้แปลงเป็นลิงก์ HTML สวยงามโดยใช้แท็ก <a href="URL">ข้อความอ้างอิงสวยงามเป็นภาษาไทย</a> เสมอ เช่น <a href="file_url">🔗 ดาวน์โหลดหนังสือนำส่งหลัก</a> หรือ <a href="attachment_url">📎 เปิดเอกสารแนบ</a>
- การแยกแยะไฟล์ของหนังสือรับ (incoming_docs):
  * "หนังสือนำส่งหลัก" ใช้ลิงก์จาก file_url
  * "ไฟล์แนบ" หรือ "สิ่งที่ส่งมาด้วย" ใช้ลิงก์จาก attachment_urls
- ห้ามใช้สัญลักษณ์ดอกจันเดี่ยว (*) ในการทำ Bullet point ให้ใช้ "•" หรือ "-" แทน
- ใช้ Emoji ให้ดูเป็นมิตร เว้นบรรทัดให้อ่านง่าย
- ห้ามใช้ Markdown Table ให้ใช้ Bullet points แทน

ข้อมูลคุณครูผู้คุยกับคุณ:
- ชื่อ: ${profileLinked.display_name}
- บทบาท: ${profileLinked.role === 'director' ? 'ผู้อำนวยการโรงเรียน' : profileLinked.role === 'admin' ? 'ผู้ดูแลระบบ (Admin)' : 'คุณครูผู้ปฏิบัติงาน'}
- จำนวนบุคลากรในระบบ: ${staffCount || 0} คน`;

        const userPrompt = `${chatHistoryContext ? `ประวัติการสนทนาล่าสุดในห้องแชทนี้:\n${chatHistoryContext}\n\n` : ''}ข้อมูลฐานข้อมูลโรงเรียน: ${contextData || 'ไม่พบข้อมูลที่เกี่ยวข้องในฐานข้อมูล'}\nปีการศึกษา: ${currentYear}\nคำถามของคุณครู: "${cleanedText}"\nกรุณาตอบในแท็ก <ans> ให้ชบาหน่อยนะคะ`;

        const rawResponse = await callGemini(systemPrompt, userPrompt, apiKey);

          if (rawResponse) {
            // 3. Answer Extraction — สกัดคำตอบจากแท็ก <ans>...</ans>
            let finalAnswer = "";
            const matchComplete = rawResponse.match(/<ans>([\s\S]*?)<\/ans>/);
            if (matchComplete && matchComplete[1]) {
              finalAnswer = matchComplete[1].trim();
            } else {
              const startIdx = rawResponse.indexOf('<ans>');
              if (startIdx !== -1) {
                let content = rawResponse.substring(startIdx + 5).trim();
                content = content.replace(/<\/?a(n(s)?)?$/i, '').trim();
                finalAnswer = content;
              } else {
                // Fix: ไม่มีแท็ก <ans> เลย (Gemini ส่ง thinking ภาษาอังกฤษออกมา)
                // ตัดทุก paragraph ที่มีแต่ตัวอักษร ASCII (EN) ออก เก็บเฉพาะบรรทัดที่มีภาษาไทย
                const lines = rawResponse.split('\n');
                const thaiLines = lines.filter(line => /[\u0E00-\u0E7F]/.test(line));
                if (thaiLines.length > 0) {
                  finalAnswer = thaiLines.join('\n').trim();
                  console.warn('[TELEGRAM WEBHOOK] No <ans> tag found — extracted Thai-only lines from raw response.');
                } else {
                  // ไม่มีแม้แต่ภาษาไทย — ให้ Gemini ลองใหม่หรือตอบ default
                  console.error('[TELEGRAM WEBHOOK] No <ans> tag and no Thai text in Gemini response. Raw:', rawResponse.substring(0, 300));
                  finalAnswer = '';
                }
              }
            }

            // 4. Answer Polish — ทำความสะอาดคำตอบ
            finalAnswer = finalAnswer
              .replace(/AI Cowork/gi, 'น้องชบา')
              .replace(/ครับ/g, 'ค่ะ')
              .replace(/^\s*\*\s+/gm, '• ')
              .split('\n')
              .filter(line => !line.match(/^\s*(\*|-)?\s*(Identity|Role|User|Context|Input|Logic|Drafting|Winner|Step|Goal|Strict|Formatting|Section|Check|Evaluation|Actionable|Final|Plan|Result).*?:/i))
              .join('\n')
              .trim();

            const replyMarkup = buildReplyMarkupFromContext(contextData, cleanedText, profileLinked);

            if (finalAnswer) {
              await sendTelegramMessage(botToken, chatId, finalAnswer, replyMarkup);
              // บันทึกประวัติการสนทนาลงฐานข้อมูล (Conversational Memory)
              try {
                await supabase.from('telegram_chats').insert([{
                  telegram_chat_id: String(chatId),
                  telegram_user_id: String(profileLinked?.id || ''),
                  user_name: profileLinked?.display_name || '',
                  message: cleanedText,
                  reply: finalAnswer
                }]);
              } catch (saveErr) {
                // Non-blocking
              }
            } else if (contextData) {
              // Fallback: หาก AI ตอบกลับไม่สมบูรณ์ แต่มีข้อมูลจาก DB → แปลงเป็นข้อความภาษาไทยสวยงาม ไม่ส่ง JSON ดิบ
              const humanFormatted = formatContextDataForHumans(contextData);
              const fallbackMsg = `📊 <b>ข้อมูลจากฐานข้อมูลโรงเรียน:</b>\n\n${humanFormatted.substring(0, 3800)}`;
              await sendTelegramMessage(botToken, chatId, fallbackMsg, replyMarkup);
            } else {
              await sendTelegramMessage(botToken, chatId, `📬 สวัสดีค่ะคุณครู <b>${profileLinked.display_name || ''}</b>\nขณะนี้ระบบพร้อมใช้งานแจ้งเตือนหนังสือราชการและงานสารบรรณแล้วค่ะ หากมีคำสั่งหรือการมอบหมายงานใหม่ ระบบจะทักมาโดยอัตโนมัติค่ะ`);
            }
          } else if (contextData) {
            // Fallback: หาก AI ล่ม หรือไม่มีคำตอบจาก Gemini → แปลงเป็นข้อความภาษาไทยสวยงาม ไม่ส่ง JSON ดิบ
            const replyMarkup = buildReplyMarkupFromContext(contextData, cleanedText, profileLinked);
            const humanFormatted = formatContextDataForHumans(contextData);
            const fallbackMsg = `📊 <b>ข้อมูลจากฐานข้อมูลโรงเรียน:</b>\n\n${humanFormatted.substring(0, 3800)}`;
            await sendTelegramMessage(botToken, chatId, fallbackMsg, replyMarkup);
          } else {
            await sendTelegramMessage(botToken, chatId, `ขออภัยนะคะคุณครู ตอนนี้ระบบสมองของชบามีการเชื่อมต่อขัดข้องชั่วคราวค่ะ รบกวนลองใหม่อีกครั้งในภายหลังนะคะ 🙏🌸`);
          }
        } else if (contextData) {
          // --- โหมดไม่มี API Key แต่มีข้อมูลจาก DB ---
          const replyMarkup = buildReplyMarkupFromContext(contextData, cleanedText, profileLinked);
          const humanFormatted = formatContextDataForHumans(contextData);
          const fallbackMsg = `📊 <b>ข้อมูลจากฐานข้อมูลโรงเรียน:</b>\n\n${humanFormatted.substring(0, 3800)}`;
          await sendTelegramMessage(botToken, chatId, fallbackMsg, replyMarkup);
        } else {
          await sendTelegramMessage(botToken, chatId, `📬 สวัสดีค่ะคุณครู <b>${profileLinked.display_name || ''}</b>\nขณะนี้ระบบพร้อมใช้งานแจ้งเตือนหนังสือราชการและงานสารบรรณแล้วค่ะ หากมีคำสั่งหรือการมอบหมายงานใหม่ ระบบจะทักมาโดยอัตโนมัติค่ะ`);
        }
      } catch (aiErr) {
        console.error('[GEMINI TELEGRAM BOT ERROR]', aiErr);
        await sendTelegramMessage(botToken, chatId, `📬 สวัสดีค่ะคุณครู <b>${profileLinked.display_name || ''}</b>\nขณะนี้ระบบพร้อมใช้งานแจ้งเตือนหนังสือราชการและงานสารบรรณแล้วค่ะ หากมีคำสั่งหรือการมอบหมายงานใหม่ ระบบจะทักมาโดยอัตโนมัติค่ะ`);
      }

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('[TELEGRAM WEBHOOK CRITICAL ERROR]', err);
  }
  })());
}
