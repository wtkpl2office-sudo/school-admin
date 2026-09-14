import { createClient } from '@supabase/supabase-js';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fs from 'fs';
import path from 'path';
import { waitUntil } from '@vercel/functions';

declare const process: any;
declare const Buffer: any;

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://placeholder-url.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'placeholder-key';
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

export default async function handler(req: any, res: any) {
  if (!process.env.VITE_SUPABASE_URL || (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.VITE_SUPABASE_ANON_KEY)) {
    return res.status(500).json({
      success: false,
      message: 'Vercel configuration missing: VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not defined.'
    });
  }
  if (req.method === 'GET') return res.status(200).json({ message: 'Nong Chaba Online' });
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  // 0. ตรวจสอบสถานะการเปิด/ปิดใช้งาน LINE Bot จากฐานข้อมูล
  try {
    const { data: systemSettings } = await supabaseAdmin
      .from('settings')
      .select('is_line_enabled')
      .maybeSingle();

    if (systemSettings && systemSettings.is_line_enabled === false) {
      console.log('[LINE WEBHOOK] LINE Bot is currently disabled in system settings.');
      return res.status(200).json({ success: false, message: 'LINE Bot is currently disabled' });
    }
  } catch (settingsErr) {
    console.error('[LINE WEBHOOK SETTINGS CHECK ERROR]', settingsErr);
  }

  // 0.1 รองรับการส่งแจ้งเตือนจาก Electron (Client-side push requests)
  const { lineUserId, message, payload, token: clientToken } = req.body || {};
  if ((lineUserId && message) || payload) {
    const token = clientToken || process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) {
      return res.status(500).json({ message: 'LINE Channel Access Token not configured on server' });
    }
    try {
      const bodyToSend = payload ? payload : {
        to: lineUserId,
        messages: [{ type: 'text', text: message.substring(0, 5000) }]
      };
      const response = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(bodyToSend)
      });
      if (response.ok) {
        return res.status(200).json({ success: true, message: 'Notification sent successfully' });
      } else {
        const errData = await response.json();
        console.error('[LINE PUSH ERROR DETAIL]', errData);
        return res.status(response.status).json({ success: false, error: errData });
      }
    } catch (err: any) {
      console.error('[LINE PUSH SYSTEM ERROR]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // ตอบกลับ 200 OK ทันทีเพื่อป้องกัน LINE Webhook Timeout และการ Retry ข้อความซ้ำ
  res.status(200).json({ message: 'OK' });

  waitUntil((async () => {
    try {
      const events = req.body.events || [];
    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'text') {
        const userId = event.source.userId;
        const groupId = event.source.groupId;
        const userMsg = event.message.text.trim();

        // --- ฟีเจอร์อำนวยความสะดวก: ตรวจสอบ Group ID / User ID ---
        if (userMsg === 'เช็คไอดีกลุ่ม' || userMsg.toLowerCase() === 'group id') {
          if (groupId) {
            await replyToLine(event.replyToken, `ไอดีกลุ่มนี้คือ:\n👉 ${groupId}\n\nคุณครูสามารถคัดลอกไอดีนี้ไปกรอกในหน้าตั้งค่าระบบได้เลยค่ะ 🌸`);
          } else {
            await replyToLine(event.replyToken, `ข้อความนี้ไม่ได้ส่งมาจากกลุ่มค่ะ ชบาหาไอดีกลุ่มไม่พบนะคะ 🌸`);
          }
          continue;
        }

        if (userMsg === 'เช็คไอดีผู้ใช้' || userMsg.toLowerCase() === 'my id') {
          await replyToLine(event.replyToken, `ไอดีผู้ใช้ของคุณครูคือ:\n👉 ${userId}\n\nสามารถใช้สำหรับผูกบัญชีรายบุคคลได้ค่ะ 🌸`);
          continue;
        }

        const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('line_user_id', userId).maybeSingle();

        if (profile) {
          // ตรวจสอบว่ามี pending action state (สถานะการทำรายการค้าง) หรือไม่
          const { data: pendingState } = await supabaseAdmin
            .from('line_action_states')
            .select('*')
            .eq('user_id', userId)
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (pendingState) {
            await handlePendingAction(event, pendingState, profile, userMsg);
          } else {
            // เช็คว่าเป็นคำสั่งเรียกดูงานค้างของครูหรือไม่
            if (['รายงานผล', 'ส่งงาน', 'งานค้าง', 'งานของฉัน', 'เช็คงาน', 'งานมอบหมาย', 'ภารกิจ'].some(k => userMsg.includes(k))) {
              await handleListPending(event, new URLSearchParams(''), profile);
            } else if ((profile.role === 'director' || profile.role === 'admin') && (userMsg.includes('รอสั่งการ') || userMsg.includes('รอเกษียณ'))) {
              await handleListPendingDocs(event, profile);
            } else {
              await handleFastAI(event.replyToken, userMsg, profile);
            }
          }

        } else {
          if (userMsg.includes('@')) {
            const { data: found } = await supabaseAdmin.from('profiles').select('*').eq('email', userMsg.toLowerCase().trim()).maybeSingle();
            if (found) {
              await supabaseAdmin.from('profiles').update({ line_user_id: userId }).eq('id', found.id);
              if (found.email) {
                await supabaseAdmin.from('teachers').update({ line_user_id: userId }).ilike('email', found.email);
              }
              await replyToLine(event.replyToken, `ยืนยันตัวตนสำเร็จค่ะคุณครู ${found.display_name}! น้องชบาพร้อมรับใช้แล้วค่ะ ถามงานได้ทันทีเลยนะคะ`);
            } else {
              await replyToLine(event.replyToken, 'ไม่พบอีเมลในระบบค่ะ รบกวนเช็คอีกครั้งนะคะ');
            }
          } else {
            await replyToLine(event.replyToken, 'สวัสดีค่ะ ชบาคือ "น้องชบา" ค่ะ รบกวนคุณครูพิมพ์ "อีเมล" เพื่อเริ่มใช้งานนะคะ');
          }
        }
      }
      
      if (event.type === 'message' && event.message.type === 'image') {
        const userId = event.source.userId;
        const messageId = event.message.id;
        const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('line_user_id', userId).maybeSingle();
        if (profile) {
          await handleReceiptOCR(event.replyToken, messageId, profile);
        } else {
          await replyToLine(event.replyToken, 'สวัสดีค่ะ รบกวนยืนยันตัวตนด้วยการกรอกอีเมลของคุณครูก่อนเริ่มส่งใบเสร็จให้ชบาสแกนนะคะ 🌸');
        }
      }

      // --- เพิ่ม Postback Event Handler ---
      if (event.type === 'postback') {
        const userId = event.source.userId;
        const postbackData = event.postback.data;
        const params = new URLSearchParams(postbackData);
        const action = params.get('action');

        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('*')
          .eq('line_user_id', userId)
          .maybeSingle();

        if (!profile) {
          await replyToLine(event.replyToken, 'สวัสดีค่ะ ชบาหาบัญชีที่ผูกกับ LINE ของคุณครูไม่พบค่ะ รบกวนพิมพ์ "อีเมล" บนแชทนี้เพื่อยืนยันตัวตนก่อนใช้งานนะคะ 🌸');
          continue;
        }

        switch (action) {
          case 'approve_doc':    await handleApproveDoc(event, params, profile); break;
          case 'reject_doc':     await handleRejectDoc(event, params, profile); break;
          case 'start_assign':   await handleStartAssign(event, params, profile); break;
          case 'assign':         await handleAssignTeacher(event, params, profile); break;
          case 'confirm_assign': await handleConfirmAssign(event, params, profile); break;
          case 'acknowledge':    await handleAcknowledge(event, params, profile); break;
          case 'report':         await handleReport(event, params, profile); break;
          case 'close':          await handleClose(event, params, profile); break;
          case 'feedback':       await handleFeedback(event, params, profile); break;
          case 'list_pending':   await handleListPending(event, params, profile); break;
          default:
            await replyToLine(event.replyToken, 'ขออภัยค่ะ ระบบไม่เข้าใจคำสั่งการนี้ 🙇‍♀️');
        }
      }
    }
  } catch (err) {
    console.error('[LINE WEBHOOK ASYNC WORKFLOW ERROR]', err);
  }
  })());
}


function formatFallbackResponse(context: string, userMsg: string): string {
  if (!context || context.trim().length === 0) return "";
  
  const msg = userMsg.toLowerCase();
  let formatted = context;
  
  // 1. ตรวจสอบข้อมูลสถิตินักเรียน
  if (formatted.includes('[สรุปสถิตินักเรียนปีการศึกษา')) {
    const idx = formatted.indexOf('ข้อมูลรายละเอียดดิบสำหรับคุณวิเคราะห์:');
    if (idx !== -1) {
      formatted = formatted.substring(0, idx).trim();
    }
    return `ขออภัยค่ะคุณครู ตอนนี้ระบบประมวลผล AI ของชบาเกิดโควตาใช้งานชั่วคราว 🙇‍♀️ ชบาจึงช่วยดึงสถิติตัวเลขจริงจากฐานข้อมูลโรงเรียนมาให้โดยตรงดังนี้นะคะ:\n\n${formatted}`;
  }
  
  // 2. ตรวจสอบรายชื่อนักเรียนเจาะจงชั้นเรียน
  if (formatted.includes('รายชื่อนักเรียนชั้น') && formatted.includes('รวม')) {
    return `ขออภัยค่ะคุณครู ตอนนี้สมอง AI ของชบาเกิดโควตาใช้งานเต็ม 🙇‍♀️ แต่ชบาช่วยดึงข้อมูลโดยตรงจากระบบมาให้คุณครูได้สำเร็จค่ะ:\n\n${formatted}`;
  }
  
  // 3. ตรวจสอบรายชื่อครูและตารางเวร
  if (formatted.includes('รายชื่อครูและบุคลากร:')) {
    try {
      const teacherMatch = formatted.match(/รายชื่อครูและบุคลากร:\s*(\[[\s\S]*?\])/);
      const dutyMatch = formatted.match(/ตารางเวรประจำวันครู.*:\s*(\[[\s\S]*?\])/);
      
      let res = `ขออภัยค่ะคุณครู ตอนนี้ AI ของชบาเกินโควตาใช้งานชั่วคราว 🙇‍♀️ ชบาช่วยค้นหาคุณครูและเวรประจำวันจากฐานข้อมูลให้โดยตรงดังนี้นะคะ:\n\n🧑‍🏫 [รายชื่อคุณครูในระบบ]:\n`;
      if (teacherMatch) {
        const teachers = JSON.parse(teacherMatch[1]);
        let activeIdx = 1;
        teachers.forEach((t: any) => {
          if (t.status === 'ปกติ' || t.status === 'active' || !t.status) {
            res += `${activeIdx}. ${t.prefix || ''}${t.first_name} ${t.last_name} (${t.position || 'คุณครู'})${t.phone ? ` โทร: ${t.phone}` : ''}\n`;
            activeIdx++;
          }
        });
      }
      
      if (dutyMatch && (msg.includes('เวร') || msg.includes('เวรยาม') || msg.includes('ประจำวัน'))) {
        res += `\n📅 [ตารางเวรประจำวันครู]:\n`;
        const duties = JSON.parse(dutyMatch[1]);
        duties.forEach((d: any, idx: number) => {
          const tInfo = d.teachers ? `${d.teachers.prefix || ''}${d.teachers.first_name} ${d.teachers.last_name}` : 'ไม่ระบุชื่อครู';
          res += `${idx + 1}. วัน${d.duty_day || ''}: ${tInfo} (${d.duty_type || 'เวรทั่วไป'})\n`;
        });
      }
      return res;
    } catch (e) {
      return `ขออภัยค่ะคุณครู ตอนนี้ระบบ AI เกินโควตาใช้งาน 🙇‍♀️ ชบาขอส่งข้อมูลดิบครูและบุคลากรให้ดังนี้นะคะ:\n\n${formatted.substring(0, 1000)}`;
    }
  }

  // 4. สถิติงบประมาณและพัสดุ
  if (formatted.includes('สถิติสรุปงบประมาณและพัสดุ')) {
    const idx = formatted.indexOf('ข้อมูลโครงการทั้งหมด:');
    if (idx !== -1) {
      formatted = formatted.substring(0, idx).trim();
    }
    return `ขออภัยนะคะคุณครู ตอนนี้ระบบ AI เกิดโควตาใช้งานชั่วคราว 🙇‍♀️ ชบาช่วยดึงข้อมูลสถิติงบประมาณและพัสดุจริงจากระบบมาให้โดยตรงดังนี้นะคะ:\n\n${formatted}`;
  }

  // 5. หนังสือราชการต่างๆ
  if (formatted.includes('ข้อมูลหนังสือรับ') || formatted.includes('ข้อมูลหนังสือส่ง') || formatted.includes('ข้อมูลคำสั่ง') || formatted.includes('ข้อมูลบันทึกข้อความ') || formatted.includes('ข้อมูลค่าสาธารณูปโภค')) {
    try {
      const jsonMatch = formatted.match(/:\s*(\[[\s\S]*?\])/);
      if (jsonMatch) {
        const docs = JSON.parse(jsonMatch[1]);
        if (Array.isArray(docs) && docs.length > 0) {
          let res = `ขออภัยนะคะคุณครู ตอนนี้ระบบ AI เกินโควตา 🙇‍♀️ ชบาช่วยค้นหารายการที่เกี่ยวข้องโดยตรงจากระบบสารบรรณมาให้ดังนี้นะคะ:\n\n`;
          docs.forEach((d: any, idx: number) => {
            const docNum = d.doc_number || d.order_number || d.memo_number || '';
            const subject = d.subject || d.remark || 'ไม่ระบุเรื่อง';
            const fileUrl = d.file_url || '';
            
            res += `📍 รายการที่ ${idx + 1}:\n`;
            if (docNum) res += `เลขที่: ${docNum}\n`;
            res += `เรื่อง: ${subject}\n`;
            if (fileUrl) res += `ลิงก์ไฟล์: ${fileUrl}\n`;
            
            if (d.attachment_urls) {
              try {
                const atts = typeof d.attachment_urls === 'string' ? JSON.parse(d.attachment_urls) : d.attachment_urls;
                if (Array.isArray(atts) && atts.length > 0) {
                  res += `ไฟล์แนบเพิ่มเติม:\n`;
                  atts.forEach((a: any, aIdx: number) => {
                    res += `  - แนบที่ ${aIdx + 1}: ${a}\n`;
                  });
                }
              } catch(e) {}
            }
            res += `\n`;
          });
          return res;
        }
      }
    } catch(e) {}
  }
  
  if (formatted.includes('ข้อมูลหนังสือในห้องสมุด:')) {
    return `ขออภัยนะคะคุณครู ตอนนี้ระบบ AI เกิดโควตาใช้งานชั่วคราว 🙇‍♀️ ชบาขอส่งสถิติและข้อมูลห้องสมุดโดยตรงให้ดังนี้นะคะ:\n\n${formatted.substring(0, 1000)}`;
  }
  
  if (!formatted.includes('{') && !formatted.includes('[')) {
    return `ขออภัยนะคะคุณครู ตอนนี้ระบบ AI เกิดโควตาใช้งานชั่วคราว 🙇‍♀️ ชบาจึงนำข้อมูลโดยตรงจากฐานข้อมูลมาให้ดังนี้นะคะ:\n\n${formatted}`;
  }
  
  return "";
}

async function handleFastAI(replyToken: string, message: string, _profile: any) {
  try {
    const { data: sets } = await supabaseAdmin.from('settings').select('school_name, gemini_api_key, ai_cowork_api_key, current_academic_year, custom_sop').limit(1).maybeSingle();
    let apiKey = sets?.ai_cowork_api_key || sets?.gemini_api_key || '';
    if (apiKey.includes(',')) {
      const keys = apiKey.split(',').map((k: string) => k.trim()).filter(Boolean);
      apiKey = keys[Math.floor(Math.random() * keys.length)] || '';
    }
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const currentYear = sets?.current_academic_year || '2569';
    const schoolName = sets?.school_name || 'โรงเรียน';
    const lineUserId = _profile?.line_user_id || '';
    
    console.log(`[LINE WEBHOOK] Message received: "${message}" from user ${lineUserId}`);
    
    // 1. ดึงประวัติสนทนาย้อนหลัง (Conversational Memory)
    let chatHistoryContext = "";
    if (lineUserId) {
      try {
        const { data: pastChats } = await supabaseAdmin
          .from('line_chats')
          .select('message, reply')
          .eq('line_user_id', lineUserId)
          .order('created_at', { ascending: false })
          .limit(5);

        if (pastChats && pastChats.length > 0) {
          chatHistoryContext = pastChats.reverse().map(c => `ครู: ${c.message}\nชบา: ${c.reply}`).join('\n');
        }
      } catch (chatErr) {
        console.error("[LINE WEBHOOK] Error fetching chat history:", chatErr);
      }
    }

    // 2. Smart Data Fetch (Universal Database Router)
    const contextData = await smartFetchContext(message, currentYear, supabaseAdmin);
    console.log(`[LINE WEBHOOK] Context Data size: ${contextData.length} chars`);

    // 3. High-Speed Direct Prompting with Extraction Tag
    const systemPrompt = `คุณคือ "น้องชบา" ผู้ช่วยครูเพศหญิงของ${schoolName} (ห้ามใช้คำว่า AI Cowork หรือ AI เด็ดขาด)
ลักษณะนิสัย: สุภาพ อ่อนน้อม ใช้ "ค่ะ/นะคะ" แทนตัวว่า "ชบา" หรือ "หนู" (ห้ามใช้หางเสียง "ครับ" หรือคำพูดเชิงผู้ชายเด็ดขาด)
${sets?.custom_sop ? `\n[แนวปฏิบัติและข้อกำหนดพิเศษของโรงเรียนที่ชบาต้องตอบตามระเบียบนี้อย่างเคร่งครัด]:\n${sets.custom_sop}\n` : ''}
กฎเหล็ก:
- ตอบเฉพาะ "คำตอบสุดท้ายที่จะส่งให้ครู" โดยใส่ไว้ในแท็ก <ans>...</ans> เท่านั้น
- ใช้ประวัติการคุยล่าสุดในการเข้าใจคำถามถัดไป ในกรณีที่คุณครูคุยต่อเนื่องหรือขอให้แก้คำตอบก่อนหน้า
- ห้ามพิมพ์ขั้นตอนการคิด (Thinking), ห้ามทวนคำถาม, ห้ามเกริ่นนำใดๆ นอกแท็ก <ans>
- ห้ามจินตนาการ ห้ามสร้าง คาดเดา หรือสมมติข้อมูลใดๆ เช่น ชื่อคน ชื่อโครงการ วันที่ หรือตัวเลขขึ้นมาเองโดยเด็ดขาด หากข้อมูลไม่อยู่ใน "ข้อมูลฐานข้อมูลโรงเรียน" ที่ส่งมา ให้ตอบอย่างสุภาพว่าไม่พบข้อมูลดังกล่าวในระบบ (เช่น "ไม่พบข้อมูลรายชื่อครูในระบบค่ะ" หรือ "ไม่มีข้อมูลส่วนนี้ในฐานข้อมูลค่ะ")
- การแยกแยะไฟล์ของหนังสือรับ (incoming_docs):
  * "หนังสือนำส่งหลัก" หรือ "ตัวหนังสือหลักที่ลงเลขรับ" จะใช้ลิงก์ดาวน์โหลดจากฟิลด์ file_url
  * "ไฟล์แนบ" หรือ "เอกสารแนบ" (สิ่งที่ส่งมาด้วย) จะใช้ลิงก์ดาวน์โหลดจากรายการในฟิลด์ attachment_urls ซึ่งเก็บเป็น JSON array
  * หากครูขอ "ไฟล์แนบ" หรือ "เอกสารแนบ": ชบาต้องดึงและแสดงลิงก์ดาวน์โหลดทั้งหมดที่อยู่ใน attachment_urls เท่านั้น ห้ามนำลิงก์ file_url (หนังสือนำ) มาตอบแทนเด็ดขาด! หากในข้อมูลไม่มีไฟล์แนบเพิ่มเติม (attachment_urls ว่างหรือเป็นอาร์เรย์ว่าง) ให้ตอบคุณครูอย่างสุภาพว่า "ไม่มีเอกสารแนบเพิ่มเติมสำหรับหนังสือฉบับนี้ค่ะ"
  * หากครูขอ "ตัวหนังสือ", "หนังสือนำ", หรือเรื่องเอกสารทั่วไป: ให้ส่งลิงก์หนังสือนำหลัก (file_url) และระบุรายการลิงก์ไฟล์แนบเพิ่มเติมไว้ด้านล่างหากมี
- ห้ามใช้สัญลักษณ์ดอกจันเดี่ยว (*) ในการทำ Bullet point ให้เปลี่ยนไปใช้ "•" หรือ "-" แทน
- สามารถใช้ **ตัวหนา** ในประเด็นสำคัญได้ ห้ามละทิ้งรูปแบบตัวหนาเด็ดขาด
- ใช้ Emoji ให้ดูเป็นมิตรและเว้นบรรทัดให้อ่านง่ายบนมือถือ
- ห้ามใช้ Markdown Table ในการตอบคำถามโดยเด็ดขาด ให้ใช้ Bullet points และการเว้นบรรทัดแทน`;

    const userPrompt = `${chatHistoryContext ? `ประวัติการสนทนาล่าสุดของครูคนนี้:\n${chatHistoryContext}\n\n` : ''}ข้อมูลฐานข้อมูลโรงเรียน: ${contextData || 'ไม่พบข้อมูลที่เกี่ยวข้องในฐานข้อมูลด่วน'}\nปีการศึกษา: ${currentYear}\nคำถามของคุณครู: "${message}"\nกรุณาตอบในแท็ก <ans> ให้ชบาหน่อยนะคะ`;

    let rawResponse = "";
    if (apiKey) {
      rawResponse = await callGemini(systemPrompt, userPrompt, apiKey);
    }

    if (!rawResponse && openaiApiKey) {
      console.log("[LINE WEBHOOK] Gemini failed or not configured, falling back to OpenAI...");
      rawResponse = await callOpenAI(systemPrompt, userPrompt, openaiApiKey);
    }
    
    // 4. Absolute Extraction Protocol
    let finalAnswer = "";
    if (!rawResponse) {
      finalAnswer = "ขออภัยนะคะคุณครู ตอนนี้ระบบสมองของชบามีการเชื่อมต่อขัดข้องชั่วคราวค่ะ รบกวนลองใหม่อีกครั้งในภายหลังนะคะ 🙏🌸";
    } else {
      console.log(`[LINE WEBHOOK] Raw response length: ${rawResponse.length}`);
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
          finalAnswer = rawResponse;
        }
      }
    }

    // 5. Final Polish & Cleanup
    if (rawResponse) {
      finalAnswer = finalAnswer
        .replace(/AI Cowork/gi, 'น้องชบา')
        .replace(/ครับ/g, 'ค่ะ')
        .replace(/^\s*\*\s+/gm, '• ')
        .split('\n')
        .filter(line => !line.match(/^\s*(\*|-)?\s*(Identity|Role|User|Context|Input|Logic|Drafting|Winner|Step|Goal|Strict|Formatting|Section|Check|Evaluation|Actionable|Final|Plan|Result).*?:/i))
        .join('\n')
        .trim();
    }

    console.log(`[LINE WEBHOOK] Sending response (length ${finalAnswer.length}): ${JSON.stringify(finalAnswer)}`);
    if (finalAnswer) {
      await replyToLine(replyToken, finalAnswer);
      
      // 6. บันทึกประวัติการคุย (Conversational Memory) ลงในไลน์แชท
      if (lineUserId) {
        try {
          await supabaseAdmin.from('line_chats').insert([{
            line_user_id: lineUserId,
            message: message,
            reply: finalAnswer
          }]);
        } catch (saveErr) {
          console.error("[LINE WEBHOOK] Save chat memory log failed:", saveErr);
        }
      }
    }

  } catch (err) { console.error("[LINE WEBHOOK ERROR]", err); }
}

async function callGemini(system: string, user: string, apiKey: string): Promise<string> {
  const models = ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash", "gemini-flash-latest"];
  for (const model of models) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2048
          }
        })
      });
      if (res.ok) {
        const data = await res.json() as any;
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          console.log(`[LINE WEBHOOK] Gemini model ${model} success!`);
          return text;
        }
      } else {
        const errData = await res.json() as any;
        console.error(`[LINE WEBHOOK] Error with model ${model}:`, JSON.stringify(errData));
      }
    } catch (e) {
      console.error(`[LINE WEBHOOK] Fetch error with model ${model}:`, e);
    }
  }
  return "";
}

async function callOpenAI(system: string, user: string, apiKey: string): Promise<string> {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        temperature: 0.1,
        max_tokens: 2048
      })
    });
    if (res.ok) {
      const data = await res.json() as any;
      const text = data.choices?.[0]?.message?.content;
      if (text) {
        console.log(`[LINE WEBHOOK] OpenAI gpt-4o-mini success!`);
        return text;
      }
    } else {
      const errData = await res.json() as any;
      console.error("[LINE WEBHOOK] Error with OpenAI:", JSON.stringify(errData));
    }
  } catch (e) {
    console.error("[LINE WEBHOOK] Fetch error with OpenAI:", e);
  }
  return "";
}

async function replyToLine(replyToken: string, text: string) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !text) return;
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text: text.substring(0, 5000) }] })
  });
}

function extractClassLevel(text: string): string | null {
  const cleaned = text.replace(/\s+/g, '');
  
  // ค้นหารูปแบบ ป.1 - ป.6
  const pMatch = cleaned.match(/(ป|ประถม|ประถมศึกษา|ประถมศึกษาปีที่)\.?([1-6])/);
  if (pMatch) {
    return `ป.${pMatch[2]}`;
  }

  // ค้นหารูปแบบ อ.2 - อ.3
  const aMatch = cleaned.match(/(อ|อนุบาล|อนุบาลปีที่)\.?([2-3])/);
  if (aMatch) {
    return `อ.${aMatch[2]}`;
  }

  return null;
}

function extractDocSearchWord(message: string): string {
  if (!message) return '';
  const msg = message.toLowerCase();
  const reangIdx = msg.indexOf('เรื่อง');
  const numIdx = msg.indexOf('เลขที่');
  let keyword = '';
  if (reangIdx !== -1) {
    keyword = msg.substring(reangIdx + 6).trim();
  } else if (numIdx !== -1) {
    keyword = msg.substring(numIdx + 6).trim();
  } else {
    keyword = msg;
    const commonWords = [
      'ขอไฟล์แนบ', 'ขอเอกสารแนบ', 'ขอลิงก์', 'ขอลิงค์', 'ขอไฟล์', 'ดาวน์โหลด', 'ขอดู',
      'หนังสือรับที่', 'หนังสือส่งที่', 'คำสั่งที่', 'บันทึกที่', 'จดหมายที่', 'ฉบับที่', 'เรื่องที่',
      'หนังสือรับ', 'หนังสือส่ง', 'หนังสือเข้า', 'หนังสือออก', 'บันทึกข้อความ', 
      'เอกสารรับ', 'เอกสารส่ง', 'ไฟล์แนบ', 'เอกสารแนบ', 'ไฟล์รับ', 'ไฟล์ส่ง', 
      'ไฟล์คำสั่ง', 'ไฟล์บันทึก', 'คำสั่ง', 'ใบสั่ง', 'บันทึก', 'เมโม่', 'memo', 'โหลด',
      'เลขที่', 'เลข', 
      'ของ', 'ที่', 'ฉบับ', 'เรื่อง', 'ขอ', 'มี', 'ส่ง', 'ล่าสุด', 'ใหม่ล่าสุด', 'ย้อนหลัง', 'เก่า', 'ใหม่'
    ];
    commonWords.forEach(w => { keyword = keyword.replace(new RegExp(w, 'g'), ''); });
  }
  const suffixes = [
    'หน่อย', 'ครับ', 'ค่ะ', 'นะ', 'นะคะ', 'ด้วย', 'ที', 'หน่อยครับ', 'หน่อยค่ะ', 
    'หน่อยนะ', 'หน่อยนะคะ', 'ด้วยครับ', 'ด้วยค่ะ', 'ซิ', 'สิ', 'จ๊ะ', 'จ้า'
  ];
  suffixes.forEach(s => {
    keyword = keyword.replace(new RegExp(s + '$', 'g'), '');
    keyword = keyword.replace(new RegExp('\\s+' + s, 'g'), '');
  });
  return keyword.trim();
}

async function smartFetchContext(message: string, currentYear: string, supabase: any): Promise<string> {
  const msg = message.toLowerCase();
  const targetClass = extractClassLevel(message);
  
  const rules = [
    {
      keys: ['ครู', 'คุณครู', 'บุคลากร', 'ผู้สอน', 'เวร', 'เวรยาม', 'เวรประจำวัน', 'อีเมล', 'อีเมล์', 'เมล', 'เบอร์โทร', 'เบอร์โทรศัพท์', 'เบอร์ติดต่อ'],
      fetch: async () => {
        const { data: teachers } = await supabase.from('teachers').select('id, prefix, first_name, last_name, position, department, phone, email, status');
        const { data: duties } = await supabase.from('teacher_duties').select('duty_day, duty_type, teacher_id, teachers(prefix, first_name, last_name)');
        return `รายชื่อครูและบุคลากร: ${JSON.stringify(teachers)}\nตารางเวรประจำวันครู (เชื่อมโยงรายชื่อครูแล้ว): ${JSON.stringify(duties)}`;
      }
    },
    {
      keys: ['เขตพื้นที่บริการ', 'พื้นที่บริการ', 'ทร.14', 'ทร14', 'พฐ.03', 'พฐ03', 'เด็กเข้าเกณฑ์', 'เด็กในเขต'],
      fetch: async () => {
        const { data } = await supabase.from('service_area_students').select('prefix, first_name, last_name, gender, birth_date, moo, sub_district').limit(60);
        return `ข้อมูลทะเบียนเด็กในเขตพื้นที่บริการ (ทร.14 / พฐ.03): ${JSON.stringify(data)}`;
      }
    },
    {
      keys: ['โครงการ', 'งบประมาณ', 'งบ', 'เงินงบ', 'สถิติ', 'สรุป', 'ผลสัมฤทธิ์', 'จัดซื้อจัดจ้าง', 'พัสดุ', 'ซื้อจ้าง'],
      fetch: async () => {
        const { data: projects } = await supabase.from('school_projects').select('project_name, planned_amount, spent_amount, status, budget_allocations(budget_type, category_name)').eq('academic_year', currentYear);
        const { data: budget } = await supabase.from('budget_allocations').select('id, budget_type, category_name, amount, spent_amount, remaining_amount').eq('academic_year', currentYear);
        const { data: procurement } = await supabase.from('procurement_projects').select('project_name, total_amount, status, procurement_type').eq('academic_year', currentYear);
        
        // คำนวณสรุปตัวเลขสถิติเพื่อให้ AI ทำข้อมูลผลสัมฤทธิ์
        const totalAllocated = budget?.reduce((sum: number, b: any) => sum + (b.amount || 0), 0) || 0;
        const totalSpent = budget?.reduce((sum: number, b: any) => sum + (b.spent_amount || 0), 0) || 0;
        const totalRemaining = budget?.reduce((sum: number, b: any) => sum + (b.remaining_amount || 0), 0) || 0;
        
        const procCount = procurement?.length || 0;
        const procFinished = procurement?.filter((p: any) => p.status === 'approved' || p.status === 'completed')?.length || 0;
        const procSpent = procurement?.reduce((sum: number, p: any) => sum + (Number(p.total_amount) || 0), 0) || 0;

        return `สถิติสรุปงบประมาณและพัสดุ ปีการศึกษา ${currentYear}:
- ยอดงบประมาณรวมที่ได้รับการจัดสรร: ${totalAllocated.toLocaleString()} บาท
- งบประมาณที่ใช้ไปแล้วสะสม: ${totalSpent.toLocaleString()} บาท
- งบประมาณคงเหลือสุทธิ: ${totalRemaining.toLocaleString()} บาท
- จำนวนโครงการจัดซื้อจัดจ้างทั้งหมด: ${procCount} รายการ
- โครงการจัดซื้อจัดจ้างที่อนุมัติ/สำเร็จแล้ว: ${procFinished} รายการ
- ยอดจัดซื้อจัดจ้างรวม: ${procSpent.toLocaleString()} บาท

ข้อมูลโครงการทั้งหมด: ${JSON.stringify(projects)}
ข้อมูลแหล่งงบประมาณ: ${JSON.stringify(budget)}
ข้อมูลการจัดซื้อจัดจ้างในระบบ: ${JSON.stringify(procurement)}`;
      }
    },
    {
      keys: ['หนังสือรับ', 'จดหมาย', 'เอกสารรับ', 'หนังสือเข้า', 'ไฟล์แนบ', 'เอกสารแนบ', 'แนบ', 'ไฟล์รับ'],
      fetch: async () => {
        const searchWord = extractDocSearchWord(message);
        let query = supabase.from('incoming_docs').select('doc_number, subject, from_agency, doc_date, urgency, remark, file_url, attachment_urls');
        if (searchWord.length > 0) {
          query = query.or(`subject.ilike.%${searchWord}%,doc_number.ilike.%${searchWord}%`);
        }
        const { data } = await query.order('doc_date', { ascending: false }).limit(5);
        return `ข้อมูลหนังสือรับที่เกี่ยวข้องหรือล่าสุด: ${JSON.stringify(data)}`;
      }
    },
    {
      keys: ['หนังสือส่ง', 'เอกสารส่ง', 'หนังสือออก', 'ไฟล์ส่ง'],
      fetch: async () => {
        const searchWord = extractDocSearchWord(message);
        let query = supabase.from('outgoing_docs').select('doc_number, subject, to_agency, doc_date, urgency, remark, file_url');
        if (searchWord.length > 0) {
          query = query.or(`subject.ilike.%${searchWord}%,doc_number.ilike.%${searchWord}%`);
        }
        const { data } = await query.order('doc_date', { ascending: false }).limit(5);
        return `ข้อมูลหนังสือส่งที่เกี่ยวข้องหรือล่าสุด: ${JSON.stringify(data)}`;
      }
    },
    {
      keys: ['คำสั่ง', 'ใบสั่ง', 'ไฟล์คำสั่ง'],
      fetch: async () => {
        const searchWord = extractDocSearchWord(message);
        let query = supabase.from('orders').select('order_number, subject, issuer, order_date, remark, file_url');
        if (searchWord.length > 0) {
          query = query.or(`subject.ilike.%${searchWord}%,order_number.ilike.%${searchWord}%`);
        }
        const { data } = await query.order('order_date', { ascending: false }).limit(5);
        return `ข้อมูลคำสั่งที่เกี่ยวข้องหรือล่าสุด: ${JSON.stringify(data)}`;
      }
    },
    {
      keys: ['บันทึก', 'เมโม่', 'memo', 'บันทึกข้อความ', 'ไฟล์บันทึก'],
      fetch: async () => {
        const searchWord = extractDocSearchWord(message);
        let query = supabase.from('memos').select('memo_number, subject, requester, memo_date, urgency, remark, file_url');
        if (searchWord.length > 0) {
          query = query.or(`subject.ilike.%${searchWord}%,memo_number.ilike.%${searchWord}%`);
        }
        const { data } = await query.order('memo_date', { ascending: false }).limit(5);
        return `ข้อมูลบันทึกข้อความที่เกี่ยวข้องหรือล่าสุด: ${JSON.stringify(data)}`;
      }
    },
    {
      keys: ['ค่าไฟ', 'ไฟฟ้า', 'ค่าน้ำ', 'ประปา', 'โทรศัพท์', 'เน็ต', 'อินเทอร์เน็ต', 'สาธารณูปโภค', 'บิล'],
      fetch: async () => {
        let query = supabase.from('utilities').select('*').eq('academic_year', currentYear);
        const types: string[] = [];
        if (msg.includes('ค่าไฟ') || msg.includes('ไฟฟ้า')) types.push('electricity');
        if (msg.includes('ค่าน้ำ') || msg.includes('ประปา')) types.push('water');
        if (msg.includes('ค่าโทรศัพท์')) types.push('telephone');
        if (msg.includes('เน็ต') || msg.includes('อินเทอร์เน็ต')) types.push('internet');

        if (types.length > 0) {
          query = query.in('type', types);
        }
        const { data } = await query.order('bill_date', { ascending: false }).limit(20);
        return `ข้อมูลค่าสาธารณูปโภค ปีการศึกษา ${currentYear}: ${JSON.stringify(data)}`;
      }
    },
    {
      keys: ['เช็คชื่อ', 'ขาด', 'ลา', 'มาสาย', 'เข้าเรียน', 'เช็คขาด', 'เช็คมาสาย', 'สถิติ'],
      fetch: async () => {
        const { data } = await supabase.from('attendance').select('date, class_level, summary, recorded_at').order('date', { ascending: false }).limit(5);
        return `ข้อมูลการเช็คชื่อเข้าเรียนล่าสุด: ${JSON.stringify(data)}`;
      }
    },
    {
      keys: ['พัสดุ', 'จัดซื้อ', 'จัดจ้าง', 'การจ้าง', 'สัญญา', 'ผู้ขาย', 'ผู้รับจ้าง', 'ตรวจรับ', 'กรรมการ'],
      fetch: async () => {
        const { data: projects } = await supabase.from('procurement_projects').select('project_name, academic_year, method, procurement_type, total_amount, status, ref_doc_number, contract_number, committee_json, vendor_info, school_projects(project_name)').eq('academic_year', currentYear).limit(10);
        return `ข้อมูลโครงการจัดซื้อจัดจ้าง ปี ${currentYear} (เชื่อมโยงโครงการหลักตามแผนแล้ว): ${JSON.stringify(projects)}`;
      }
    },
    {
      keys: ['ห้องสมุด', 'ยืมหนังสือ', 'คืนหนังสือ', 'ยืม-คืน', 'หนังสือห้องสมุด'],
      fetch: async () => {
        const { data: books } = await supabase.from('library_books').select('id, book_id, title, category, author, available_qty, status').limit(15);
        const { data: borrow } = await supabase.from('library_borrow').select('borrow_date, borrower_name, return_date, status, library_books(book_id, title, category)').order('borrow_date', { ascending: false }).limit(10);
        return `ข้อมูลหนังสือในห้องสมุด: ${JSON.stringify(books)}\nประวัติการยืมคืนหนังสือ (เชื่อมโยงรายละเอียดหนังสือแล้ว): ${JSON.stringify(borrow)}`;
      }
    },
    {
      keys: ['มอบหมาย', 'งานมอบหมาย', 'ติดตามงาน', 'สั่งงาน', 'มอบหมายงาน'],
      fetch: async () => {
        const { data } = await supabase.from('doc_assignments').select('instruction, status, reported_at, staff_report, incoming_docs(doc_number, subject), teachers:assignee_id(prefix, first_name, last_name)').limit(15);
        return `ข้อมูลการมอบหมายหนังสือราชการให้คุณครูผู้รับผิดชอบเชิงลึก: ${JSON.stringify(data)}`;
      }
    },
    {
      keys: ['การตั้งค่า', 'โรงเรียน', 'ผู้อำนวยการ', 'เบอร์โทร', 'ที่อยู่โรงเรียน', 'ข้อมูลโรงเรียน'],
      fetch: async () => {
        const { data } = await supabase.from('settings').select('school_name, school_address, director_name, current_academic_year, current_term, phone_number, local_gov_name').limit(1).maybeSingle();
        return `ข้อมูลการตั้งค่าโรงเรียนทั่วไป: ${JSON.stringify(data)}`;
      }
    },
    {
      keys: ['นักเรียน', 'กี่คน', 'รายชื่อ', 'รายนาม', 'คนไหนบ้าง', 'เด็กนักเรียน', 'ชั้นเรียน'],
      fetch: async () => {
        // หากผู้ใช้พิมพ์เรื่องครู หรือโครงการ หรือจัดซื้อ หรือห้องสมุด ไม่ควรตกในกฎนี้
        if (msg.includes('ครู') || msg.includes('โครงการ') || msg.includes('จัดซื้อ') || msg.includes('พัสดุ') || msg.includes('ห้องสมุด') || msg.includes('หนังสือ')) {
          return "";
        }
        if (targetClass) {
          const prefix = targetClass.startsWith('ป') ? 'ป' : 'อ';
          const levelNum = targetClass.split('.')[1];
          
          let query = supabase
            .from('students')
            .select('prefix, first_name, last_name, class_level, room, gender')
            .eq('academic_year', currentYear)
            .in('graduation_status', ['ปกติ', 'กำลังศึกษา']);
            
          if (prefix === 'ป') {
            query = query.or(`class_level.eq.${targetClass},class_level.ilike.ป%${levelNum}%,class_level.ilike.%ประถม%${levelNum}%`);
          } else {
            query = query.or(`class_level.eq.${targetClass},class_level.ilike.อ%${levelNum}%,class_level.ilike.%อนุบาล%${levelNum}%`);
          }
          
          const { data, error } = await query
            .order('room', { ascending: true })
            .order('first_name', { ascending: true });
            
          if (error) {
            console.error('[LINE WEBHOOK] Error fetching students by class:', error);
            return `เกิดข้อผิดพลาดในการดึงข้อมูลนักเรียนชั้น ${targetClass} ค่ะ`;
          }
          
          if (data && data.length > 0) {
            const listText = data.map((s: any, idx: number) => `${idx + 1}. ${s.prefix || ''}${s.first_name} ${s.last_name} ${s.room ? `(ห้อง ${s.room})` : ''}`).join('\n');
            return `รายชื่อนักเรียนชั้น ${targetClass} สำหรับปีการศึกษา ${currentYear} (รวม ${data.length} คน):\n${listText}`;
          }
          return `ไม่พบข้อมูลรายชื่อนักเรียนชั้น ${targetClass} สำหรับปีการศึกษา ${currentYear} ค่ะ`;
        } else {
          // ดึงสถิตินักเรียนทั้งหมดและสรุป
          const { data: allStudents } = await supabase
            .from('students')
            .select('class_level, gender, religion')
            .eq('academic_year', currentYear)
            .in('graduation_status', ['ปกติ', 'กำลังศึกษา']);
          
          if (allStudents && allStudents.length > 0) {
            const counts: Record<string, number> = {};
            const genders: Record<string, number> = {};
            const religions: Record<string, number> = {};
            
            (allStudents as any[]).forEach((s: any) => {
              const lvl = s.class_level || 'ไม่ระบุชั้น';
              const g = s.gender || 'ไม่ระบุเพศ';
              const r = s.religion || 'ไม่ระบุศาสนา';
              
              counts[lvl] = (counts[lvl] || 0) + 1;
              genders[g] = (genders[g] || 0) + 1;
              religions[r] = (religions[r] || 0) + 1;
            });
            
            const sortedClasses = Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0], 'th'));
            const summaryStr = sortedClasses.map(([lvl, num]) => `- ${lvl}: ${num} คน`).join('\n');
            const genderStr = Object.entries(genders).map(([g, num]) => `- ${g}: ${num} คน`).join('\n');
            const religionStr = Object.entries(religions).map(([r, num]) => `- ${r}: ${num} คน`).join('\n');
            
            return `[สรุปสถิตินักเรียนปีการศึกษา ${currentYear} คำนวณจากระบบฐานข้อมูล]:
รวมนักเรียนปัจจุบันทั้งหมด: ${allStudents.length} คน

จำนวนนักเรียนแยกตามชั้นเรียน:
${summaryStr}

จำนวนนักเรียนแยกตามเพศ:
${genderStr}

จำนวนนักเรียนแยกตามศาสนา:
${religionStr}

ข้อมูลรายละเอียดดิบสำหรับคุณวิเคราะห์: ${JSON.stringify(allStudents)}`;
          }
          
          const { count } = await supabase.from('students').select('*', { count: 'exact', head: true }).eq('academic_year', currentYear).in('graduation_status', ['ปกติ', 'กำลังศึกษา']);
          return `จำนวนนักเรียนปัจจุบันทั้งหมดในปีการศึกษา ${currentYear}: ${count} คน`;
        }
      }
    },
    {
      keys: ['แผนการสอน', 'ส่งแผน', 'แผนสอน', 'ตรวจแผน'],
      fetch: async () => {
        const { data, error } = await supabase
          .from('lesson_plans')
          .select('title, subject_code, subject_name, class_level, term, status, academic_comments, director_comments, created_at, profiles(display_name)');
        
        if (error) {
          console.error('[LINE WEBHOOK] Error fetching lesson plans:', error);
          return `เกิดข้อผิดพลาดในการดึงข้อมูลแผนการสอนค่ะ`;
        }

        if (data && data.length > 0) {
          const listText = data.map((p: any, idx: number) => {
            const dateStr = p.created_at ? new Date(p.created_at).toLocaleDateString('th-TH') : '-';
            let statusText = '';
            if (p.status === 'Draft') statusText = 'แบบร่าง';
            else if (p.status === 'Pending_Academic') statusText = 'รอวิชาการตรวจ';
            else if (p.status === 'Rejected_by_Academic') statusText = 'วิชาการส่งแก้ไข';
            else if (p.status === 'Pending_Director') statusText = 'เสนอ ผอ. อนุมัติ';
            else if (p.status === 'Rejected_by_Director') statusText = 'ผอ. ส่งแก้ไข';
            else if (p.status === 'Approved') statusText = 'อนุมัติแล้ว 🟢';
            
            return `${idx + 1}. แผน: "${p.title}" (${p.subject_code} ${p.subject_name} ชั้น ${p.class_level})\n• ครูผู้สอน: ${p.profiles?.display_name || 'ไม่ระบุ'}\n• สถานะ: ${statusText} (ภาคเรียน: ${p.term})\n• ส่งเมื่อ: ${dateStr}`;
          }).join('\n\n');
          return `ข้อมูลสถานะการส่งแผนการสอนในระบบล่าสุด:\n\n${listText}`;
        }
        return `ยังไม่มีข้อมูลการส่งแผนการสอนในระบบสำหรับปีการศึกษานี้ค่ะ`;
      }
    }
  ];

  for (const rule of rules) {
    if (rule.keys.some(key => msg.includes(key))) {
      try {
        console.log(`[LINE WEBHOOK] Match rule for keys: ${rule.keys[0]}`);
        const result = await rule.fetch();
        if (result) return result; // หากคืนค่าว่าง ให้ผ่านไปตรวจกฎอื่น
      } catch (err) {
        console.error(`[LINE WEBHOOK] Error executing fetch for keys ${rule.keys}:`, err);
      }
    }
  }

  // Fallback: ค้นหาใน school_knowledge
  try {
    const { data: knowledge } = await supabase
      .from('school_knowledge')
      .select('document_name, chunk_text')
      .or(`chunk_text.ilike.%${msg}%,document_name.ilike.%${msg}%`)
      .limit(3);
    
    if (knowledge && knowledge.length > 0) {
      console.log(`[LINE WEBHOOK] Found ${knowledge.length} matches in school_knowledge`);
      return `ข้อมูลความรู้โรงเรียนที่ค้นพบ:\n` + knowledge.map((k: any) => `[ไฟล์: ${k.document_name}]: ${k.chunk_text}`).join('\n\n');
    }
  } catch (err) {
    console.error(`[LINE WEBHOOK] Error fetching school_knowledge:`, err);
  }

  return "";
}

async function handleReceiptOCR(replyToken: string, messageId: string, _profile: any) {
  try {
    await replyToLine(replyToken, "ชบากำลังดึงรูปภาพใบเสร็จของคุณครูและใช้ AI สแกนอ่านรายละเอียดให้อยู่นะคะ สักครู่เดียวค่ะ... 🌸⚡");
    
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKEN not configured");

    // 1. ดาวน์โหลด Content ของรูปภาพ
    const response = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) throw new Error(`LINE image fetch returned HTTP ${response.status}`);
    
    const arrayBuffer = await response.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString('base64');

    // 2. ดึง API Key
    const { data: sets } = await supabaseAdmin.from('settings').select('school_name, gemini_api_key').single();
    let apiKey = sets?.gemini_api_key || '';
    if (apiKey.includes(',')) {
      const keys = apiKey.split(',').map((k: string) => k.trim()).filter(Boolean);
      apiKey = keys[Math.floor(Math.random() * keys.length)] || '';
    }
    if (!apiKey) {
      await replyToLine(replyToken, "ระบบยังไม่ได้ตั้งค่า API Key ในโรงเรียนค่ะ รบกวนคุณครูตั้งค่า API Key ในหน้าตั้งค่าก่อนนะคะ 🌸");
      return;
    }

    // 3. เรียก Gemini Multimodal OCR
    const schoolName = sets?.school_name || 'โรงเรียน';
    const systemPrompt = `คุณคือ "น้องชบา" ผู้ช่วยฝ่ายพัสดุและงบประมาณ${schoolName}
ภารกิจ: วิเคราะห์สแกนรูปภาพใบเสร็จ/บิลค่าใช้จ่ายนี้ และสรุปผลออกมาในรูปแบบราชการที่เข้าใจง่าย
กฎเหล็ก:
- ตอบข้อมูลสกัดออกมาให้ชัดเจนดังนี้:
  1. ชื่อร้านค้า / ผู้ขาย
  2. วันที่ในใบเสร็จ
  3. รายการสินค้าพัสดุ (ระบุเป็นหัวข้อย่อย: ชื่อสินค้า, จำนวน, หน่วย, ราคาต่อหน่วย, ราคารวม)
  4. ยอดเงินรวมทั้งสิ้น (บาท)
- ให้คำแนะนำท้ายข้อความว่า "คุณครูสามารถนำข้อมูลที่ชบาสแกนนี้ไปกดเพิ่มรายการจัดซื้อจัดจ้างใหม่ในหน้าระบบพัสดุได้ทันทีเลยนะคะ 🌸"
- ห้ามใช้คำพูดไม่สุภาพ และตอบอย่างนอบน้อมค่ะ/นะคะ เท่านั้น`;

    const userPrompt = "ชบาส่งรูปใบเสร็จให้ค่ะ รบกวนสแกนอ่านให้ชบาหน่อยนะคะ";
    const ocrResult = await callGeminiMultimodal(systemPrompt, userPrompt, base64Image, 'image/jpeg', apiKey);
    
    if (ocrResult) {
      await replyToLine(replyToken, ocrResult);
    } else {
      await replyToLine(replyToken, "ขออภัยนะคะชบาไม่สามารถวิเคราะห์ข้อมูลจากภาพใบเสร็จนี้ได้ค่ะ รบกวนคุณครูช่วยตรวจสอบความคมชัดและส่งเข้ามาใหม่อีกครั้งนะคะ 🙏🌸");
    }
  } catch (err: any) {
    console.error("[LINE OCR ERROR]", err);
    await replyToLine(replyToken, `เกิดข้อผิดพลาดในการสแกนสกัดใบเสร็จค่ะ: ${err.message}`);
  }
}

async function callGeminiMultimodal(system: string, user: string, base64Data: string, mimeType: string, apiKey: string): Promise<string> {
  const models = ["gemini-2.0-flash", "gemini-1.5-flash"];
  for (const model of models) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{
            role: 'user',
            parts: [
              { inlineData: { mimeType, data: base64Data } },
              { text: user }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2048
          }
        })
      });
      if (res.ok) {
        const data = await res.json() as any;
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return text;
      }
    } catch (e) {
      console.error(`[LINE MULTIMODAL ERROR] ${model}:`, e);
    }
  }
  return "";
}

// ====================================================================
// NEW HELPER FUNCTIONS FOR INTERACTIVE LINE BOT
// ====================================================================

async function replyToLineFlex(replyToken: string, altText: string, contents: any) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !contents) return;
  try {
    await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        replyToken,
        messages: [{ type: 'flex', altText: altText.substring(0, 400), contents }]
      })
    });
  } catch (err) { console.error('Reply Flex error:', err); }
}

async function replyToLineQuickReply(replyToken: string, text: string, items: any[]) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !text) return;
  try {
    await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        replyToken,
        messages: [{
          type: 'text',
          text: text.substring(0, 5000),
          quickReply: { items }
        }]
      })
    });
  } catch (err) { console.error('Reply QuickReply error:', err); }
}

async function pushToLine(toId: string | undefined, text: string) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return;

  let target = toId;
  if (!target) {
    try {
      const { data: settings } = await supabaseAdmin
        .from('settings')
        .select('line_group_id')
        .single();
      target = settings?.line_group_id || process.env.LINE_GROUP_ID || '';
    } catch (e) {
      target = process.env.LINE_GROUP_ID || '';
    }
  }

  if (!target || !text) return;
  try {
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        to: target,
        messages: [{ type: 'text', text: text.substring(0, 5000) }]
      })
    });
  } catch (err) { console.error('Push text error:', err); }
}

async function pushToLineFlex(toId: string | undefined, altText: string, contents: any) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return;

  let target = toId;
  if (!target) {
    try {
      const { data: settings } = await supabaseAdmin
        .from('settings')
        .select('line_group_id')
        .single();
      target = settings?.line_group_id || process.env.LINE_GROUP_ID || '';
    } catch (e) {
      target = process.env.LINE_GROUP_ID || '';
    }
  }

  if (!target || !contents) return;
  try {
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        to: target,
        messages: [{ type: 'flex', altText: altText.substring(0, 400), contents }]
      })
    });
  } catch (err) { console.error('Push Flex error:', err); }
}

// --------------------------------------------------------------------
// PDF Stamping function on Serverless Environment
// --------------------------------------------------------------------

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

export async function applyStampsOnServer(
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
        console.log('Loading font from localFontPath:', localFontPath);
        const buffer = fs.readFileSync(localFontPath);
        fontBytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      } else if (fs.existsSync(localDistFontPath)) {
        console.log('Loading font from localDistFontPath:', localDistFontPath);
        const buffer = fs.readFileSync(localDistFontPath);
        fontBytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      } else if (fs.existsSync(fontB64Path)) {
        console.log('Loading font from fontB64Path:', fontB64Path);
        const b64Str = fs.readFileSync(fontB64Path, 'utf-8');
        fontBytes = Buffer.from(b64Str.trim(), 'base64');
      } else if (fs.existsSync(rootFontPath)) {
        console.log('Loading font from rootFontPath:', rootFontPath);
        const buffer = fs.readFileSync(rootFontPath);
        fontBytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      } else {
        console.log('No local font found. Fetching from remote network...');
        const remoteFontUrl = process.env.VERCEL_URL 
          ? `https://${process.env.VERCEL_URL}/fonts/THSarabunNew.ttf` 
          : 'https://cdn.jsdelivr.net/gh/lazywasabi/thai-web-fonts@master/fonts/THSarabunNew/THSarabunNew.ttf';
        const res = await fetch(remoteFontUrl);
        if (!res.ok) {
          throw new Error(`Failed to fetch remote font from ${remoteFontUrl}: status ${res.status}`);
        }
        fontBytes = await res.arrayBuffer();
      }
    } catch (err) {
      console.error('Error loading local/preferred font, falling back to remote network fetch:', err);
      const fallbackFontUrl = process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}/fonts/THSarabunNew.ttf` 
        : 'https://cdn.jsdelivr.net/gh/lazywasabi/thai-web-fonts@master/fonts/THSarabunNew/THSarabunNew.ttf';
      const res = await fetch(fallbackFontUrl);
      if (!res.ok) {
        throw new Error(`Remote network backup fetch failed: status ${res.status}`);
      }
      fontBytes = await res.arrayBuffer();
    }

    const customFont = await pdfDoc.embedFont(fontBytes);
    const pages = pdfDoc.getPages();
    const pageCount = pages.length;

    // หาหน้าที่จะประทับตรา
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

    // ฝังลายเซ็น (ถ้ามี)
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

    // แปลงวันที่ไทยแบบย่อ
    const dateObj = new Date(directorData.date);
    const thDay = dateObj.getDate();
    const thMonthAbbr = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."][dateObj.getMonth()];
    const thYear = dateObj.getFullYear() + 543;
    const thDateStr = `${thDay}/${thMonthAbbr}/${thYear}`;
    
    // แปลงเป็นเลขไทย
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

// --------------------------------------------------------------------
// Core interactive tasks execution
// --------------------------------------------------------------------

async function executeDocAssignment(docId: string, teacherId: string, instruction: string, replyToken: string, profile: any) {
  try {
    // 1. ดึงข้อมูลหนังสือรับ
    const { data: doc } = await supabaseAdmin
      .from('incoming_docs')
      .select('*')
      .eq('id', docId)
      .single();

    if (!doc) {
      await replyToLine(replyToken, '❌ ไม่พบข้อมูลหนังสือรับชิ้นนี้ในระบบค่ะ');
      return;
    }

    // ดึงข้อมูลครู
    const { data: teacher } = await supabaseAdmin
      .from('teachers')
      .select('*')
      .eq('id', teacherId)
      .single();

    if (!teacher) {
      await replyToLine(replyToken, '❌ ไม่พบข้อมูลคุณครูในระบบค่ะ');
      return;
    }

    // ดึงค่าหน้าประทับตราเดิม จาก JSON remark
    let proposalStampPage = 1;
    if (doc.remark) {
      try {
        const extra = typeof doc.remark === 'object' ? doc.remark : JSON.parse(doc.remark);
        if (extra && extra.stamp_page) {
          proposalStampPage = parseInt(extra.stamp_page) || 1;
        }
      } catch (e) { console.warn('Failed to parse doc.remark JSON:', e); }
    }

    // 2. ดึงข้อมูล ผอ. และโรงเรียน จาก Settings สำหรับประทับตรา
    const { data: settings } = await supabaseAdmin
      .from('settings')
      .select('school_name, director_name, director_signature_url')
      .single();

    const schoolLabel = settings?.school_name 
      ? (settings.school_name.startsWith('โรงเรียน') ? settings.school_name : `โรงเรียน${settings.school_name}`)
      : '';
    const directorPosition = schoolLabel ? `ผู้อำนวยการ${schoolLabel}` : 'ผู้อำนวยการโรงเรียน';

    // 3. เริ่มดำเนินการประทับตรา PDF บน server (ถ้าเป็นไฟล์ PDF และอยู่บน Supabase)
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
            pageNumber: proposalStampPage // ประทับตราหน้าเดียวกับใบเสนอ
          });

          // อัปโหลดไฟล์ประทับตราทับไปที่ Supabase Storage ก่อนเพื่อสำรองข้อมูลชั่วคราว
          const pathSegments = doc.file_url.split('/');
          const fileName = pathSegments[pathSegments.length - 1].split('?')[0];
          
          await supabaseAdmin
            .storage
            .from('temp_docs')
            .upload(fileName, stampedBytes, { contentType: 'application/pdf', upsert: true });

          // ดึง publicUrl จาก Supabase ไว้ก่อน (เป็น Fallback กรณี Google Drive อัปโหลดไม่ผ่าน)
          const { data: publicData } = supabaseAdmin
            .storage
            .from('temp_docs')
            .getPublicUrl(fileName);
          
          if (publicData?.publicUrl) {
            finalFileUrl = `${publicData.publicUrl}?t=${Date.now()}`;
          }

          // ดำเนินการอัปโหลดขึ้น Google Drive ผ่าน Google Apps Script (GAS)
          const gasUrl = process.env.VITE_GAS_URL || 'https://script.google.com/macros/s/AKfycbzvITJ2HwYAB3tlDDbnjv52b97goxigd2KzNGSIu3jfnlNIpZyNB4hC2nCg_0lxek9E/exec';
          const base64 = Buffer.from(stampedBytes).toString('base64');
          const sanitizedSubject = (doc.subject || '').replace(/[\/\\?%*:|"<>]/g, '-').slice(0, 50);
          const finalFileName = `${doc.doc_number || 'doc'}_เรื่อง_${sanitizedSubject || 'untitled'}.pdf`;

          console.log(`[LINE WEBHOOK] Uploading stamped PDF to Google Drive via GAS: ${gasUrl}`);
          try {
            const driveRes = await fetch(gasUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                folder: 'incoming',
                filename: finalFileName,
                mimeType: 'application/pdf',
                base64: base64,
                year: doc.doc_year || (new Date().getFullYear() + 543)
              })
            });

            if (driveRes.ok) {
              const driveResult = (await driveRes.json()) as any;
              if (driveResult.status === 'success' && driveResult.url) {
                finalFileUrl = driveResult.url;
                console.log('Successfully uploaded to Google Drive from Webhook:', finalFileUrl);

                // ลบไฟล์ชั่วคราวใน Supabase Storage เพื่อประหยัดพื้นที่เมื่อเก็บใน Drive สำเร็จแล้ว
                try {
                  await supabaseAdmin.storage.from('temp_docs').remove([fileName]);
                  console.log('Cleaned up temporary Supabase file:', fileName);
                } catch (cleanupErr) {
                  console.warn('Failed to clean up temporary Supabase file:', cleanupErr);
                }
              } else {
                console.error('GAS Upload failed on script side:', driveResult.message);
              }
            } else {
              console.error('GAS Upload returned HTTP error status:', driveRes.status);
            }
          } catch (driveErr) {
            console.error('Failed to communicate with GAS for Google Drive upload:', driveErr);
          }
        }
      } catch (pdfErr) {
        console.error('Server PDF Stamping failed:', pdfErr);
        // ดำเนินการต่อแม้ PDF จะประทับตราไม่สำเร็จ เพื่อไม่ให้ระบบมอบหมายพัง
      }
    }

    // 4. อัปเดตตาราง incoming_docs
    await supabaseAdmin
      .from('incoming_docs')
      .update({ 
        status: 'assigned',
        file_url: finalFileUrl
      })
      .eq('id', docId);

    // 5. บันทึกประวัติ doc_assignments
    const { data: insertedAssigns, error: assignErr } = await supabaseAdmin
      .from('doc_assignments')
      .insert([{
        doc_id: docId,
        assignee_id: teacherId,
        instruction: instruction,
        status: 'pending'
      }])
      .select();

    if (assignErr) throw assignErr;
    const assignment = insertedAssigns?.[0];

    // 6. ลบ state LINE action state
    await supabaseAdmin
      .from('line_action_states')
      .delete()
      .eq('user_id', profile.line_user_id);

    // 7. แจ้งยืนยัน ผอ. และ Push หาครู
    const teacherName = `${teacher.prefix || ''}${teacher.first_name} ${teacher.last_name}`;
    await replyToLine(replyToken, `✅ ทำการเกษียณสั่งการหนังสือเรื่อง "${doc.subject}" และมอบหมายงานให้คุณครู ${teacherName} เรียบร้อยแล้วค่ะ 🌸`);

    const personalMsg = `เรื่อง: ${doc.subject}\nเลขที่หนังสือ: ${doc.doc_number}\nคำสั่งการ: ${instruction}`;
    const lineActions = [
      { label: '📄 ดูเอกสารสั่งการ', type: 'uri' as const, uri: finalFileUrl },
      { label: '✅ รับทราบงาน', type: 'postback' as const, data: `action=acknowledge&id=${assignment?.id || ''}`, color: '#007AFF' }
    ];
    if (Array.isArray(doc.attachment_urls)) {
      doc.attachment_urls.forEach((url: string, i: number) => {
        if (lineActions.length < 10) {
          lineActions.push({ label: `📎 แนบ ${i + 1}`, type: 'uri' as const, uri: url });
        }
      });
    }

    // กรองปุ่มที่ไม่สมบูรณ์ออกเพื่อป้องกัน LINE API 400 Bad Request
    const validLineActions = lineActions.filter(act => {
      if (act.type === 'uri' && !act.uri) return false;
      if (act.type === 'postback' && !act.data) return false;
      return true;
    });

    if (teacher.line_user_id) {
      await pushToLineFlex(teacher.line_user_id, '📌 มีงานมอบหมายถึงคุณครู', {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            { type: "text", text: "📌 คุณครูมีงานมอบหมายใหม่", weight: "bold", color: "#007AFF", size: "sm" },
            { type: "text", text: personalMsg, margin: "md", wrap: true, weight: "bold", size: "md" }
          ]
        },
        footer: {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: validLineActions.map(act => ({
            type: "button",
            style: "primary",
            height: "sm",
            color: act.color || "#1DB446",
            action: act.type === 'uri' ? { type: "uri", label: act.label, uri: act.uri } : { type: "postback", label: act.label, data: act.data }
          }))
        }
      });
    } else {
      // ส่งไปที่กลุ่มไลน์
      const groupMsg = `ถึง: ${teacherName}\nเรื่อง: ${doc.subject}\nเลขที่หนังสือ: ${doc.doc_number}\nคำสั่งการ: ${instruction}`;
      await pushToLineFlex(undefined, '📢 มอบหมายงานใหม่', {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            { type: "text", text: "📢 มอบหมายงานใหม่", weight: "bold", color: "#E91E63", size: "sm" },
            { type: "text", text: groupMsg, margin: "md", wrap: true, weight: "bold", size: "md" }
          ]
        },
        footer: {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: validLineActions.map(act => ({
            type: "button",
            style: "primary",
            height: "sm",
            color: act.color || "#1DB446",
            action: act.type === 'uri' ? { type: "uri", label: act.label, uri: act.uri } : { type: "postback", label: act.label, data: act.data }
          }))
        }
      });
    }
  } catch (err: any) {
    console.error('executeDocAssignment error:', err);
    await replyToLine(replyToken, `❌ ดำเนินการไม่สำเร็จ: ${err.message}`);
  }
}

// --------------------------------------------------------------------
// Postback handler functions
// --------------------------------------------------------------------

async function handleApproveDoc(event: any, params: URLSearchParams, profile: any) {
  const type = params.get('type') || 'outgoing';
  const id = params.get('id');
  const replyToken = event.replyToken;

  if (profile.role !== 'director' && profile.role !== 'admin') {
    await replyToLine(replyToken, '❌ ขออภัยค่ะ ปุ่มนี้สำหรับผู้อำนวยการดำเนินการเท่านั้นนะคะ 🌸');
    return;
  }

  try {
    let tableName = '';
    let numberColumn = '';
    let nameString = '';
    
    if (type === 'outgoing') { tableName = 'outgoing_docs'; numberColumn = 'doc_number'; nameString = 'หนังสือส่ง'; }
    else if (type === 'memo') { tableName = 'memos'; numberColumn = 'memo_number'; nameString = 'บันทึกข้อความ'; }
    else if (type === 'order') { tableName = 'orders'; numberColumn = 'order_number'; nameString = 'คำสั่งแต่งตั้ง'; }
    else {
      await replyToLine(replyToken, '❌ ประเภทเอกสารไม่ถูกต้องค่ะ');
      return;
    }

    // 1. ดึงข้อมูลเอกสาร
    const { data: doc } = await supabaseAdmin
      .from(tableName)
      .select('*')
      .eq('id', id)
      .single();

    if (!doc) {
      await replyToLine(replyToken, `❌ ไม่พบข้อมูล${nameString}ในระบบค่ะ`);
      return;
    }

    let finalNumber = doc[numberColumn];
    let docYear = doc.doc_year;
    let docSeq = doc.doc_sequence;

    // สำหรับคำสั่งแต่งตั้ง (ถ้าเขียนว่า รออนุมัติ ให้รันเลขอัตโนมัติ)
    if (type === 'order' && (finalNumber === 'รออนุมัติ' || !finalNumber)) {
      const orderDateObj = new Date(doc.order_date || new Date());
      docYear = orderDateObj.getFullYear() + 543;
      
      const { data: seqDocs } = await supabaseAdmin
        .from('orders')
        .select('doc_sequence')
        .eq('doc_year', docYear)
        .order('doc_sequence', { ascending: false })
        .limit(1);
        
      docSeq = (seqDocs && seqDocs.length > 0) ? (seqDocs[0].doc_sequence + 1) : 1;
      finalNumber = `${docSeq}/${docYear}`;
    }

    // 2. อัปเดตสถานะและเลขทะเบียนในฐานข้อมูล
    const updateObj: any = { status: 'approved' };
    if (type === 'order') {
      updateObj.order_number = finalNumber;
      updateObj.doc_year = docYear;
      updateObj.doc_sequence = docSeq;
    }

    const { error: updateErr } = await supabaseAdmin
      .from(tableName)
      .update(updateObj)
      .eq('id', id);

    if (updateErr) throw updateErr;

    // 3. แจ้งเตือน ผอ. และแจ้งข่าวครูผู้เสนอ
    await replyToLine(replyToken, `✅ ทำการอนุมัติและลงนามอิเล็กทรอนิกส์ใน${nameString}เรื่อง "${doc.subject}" เรียบร้อยแล้วค่ะ 🌸`);

    // แจ้งเตือนผู้สร้าง
    if (doc.created_by) {
      const { data: creator } = await supabaseAdmin
        .from('profiles')
        .select('line_user_id')
        .eq('id', doc.created_by)
        .maybeSingle();

      if (creator?.line_user_id) {
        await pushToLine(creator.line_user_id, `✅ ยินดีด้วยค่ะ! ผู้อำนวยการได้อนุมัติและลงนามใน${nameString}เรื่อง "${doc.subject}" ของคุณครูเรียบร้อยแล้วนะคะ 🌸`);
      }
    }
  } catch (err: any) {
    console.error('handleApproveDoc error:', err);
    await replyToLine(replyToken, `❌ เกิดข้อผิดพลาดในการอนุมัติ: ${err.message}`);
  }
}

async function handleRejectDoc(event: any, params: URLSearchParams, profile: any) {
  const type = params.get('type') || 'outgoing';
  const id = params.get('id');
  const replyToken = event.replyToken;

  if (profile.role !== 'director' && profile.role !== 'admin') {
    await replyToLine(replyToken, '❌ ขออภัยค่ะ ปุ่มนี้สำหรับผู้อำนวยการดำเนินการเท่านั้นนะคะ 🌸');
    return;
  }

  try {
    // บันทึก state เฝ้ารอรับเหตุผลสั่งแก้ไข
    await supabaseAdmin
      .from('line_action_states')
      .insert([{
        user_id: profile.line_user_id,
        action: 'awaiting_reject_reason',
        context: { type, id }
      }]);

    await replyToLine(replyToken, '💬 กรุณาพิมพ์เหตุผลการส่งกลับ หรือจุดแก้ไขส่งเข้ามาในแชทนี้ เพื่อแจ้งแก่ผู้ร่างคำเสนอได้เลยค่ะ 🌸');
  } catch (err: any) {
    console.error('handleRejectDoc error:', err);
    await replyToLine(replyToken, `❌ ไม่สามารถทำรายการได้: ${err.message}`);
  }
}

async function handleStartAssign(event: any, params: URLSearchParams, profile: any) {
  const docId = params.get('id');
  const replyToken = event.replyToken;

  if (profile.role !== 'director' && profile.role !== 'admin') {
    await replyToLine(replyToken, '❌ ขออภัยค่ะ ปุ่มนี้สำหรับผู้อำนวยการดำเนินการเท่านั้นนะคะ 🌸');
    return;
  }

  try {
    const { data: doc } = await supabaseAdmin
      .from('incoming_docs')
      .select('subject')
      .eq('id', docId)
      .single();

    if (!doc) {
      await replyToLine(replyToken, '❌ ไม่พบข้อมูลหนังสือรับชิ้นนี้ค่ะ');
      return;
    }

    // ดึงคุณครู active ทั้งหมด
    const { data: teachers } = await supabaseAdmin
      .from('teachers')
      .select('*')
      .eq('status', 'active')
      .order('first_name');

    if (!teachers || teachers.length === 0) {
      await replyToLine(replyToken, '❌ ไม่พบรายชื่อคุณครูในระบบสำหรับมอบหมายงานค่ะ');
      return;
    }

    // สร้าง Quick Reply Items (แสดงรายชื่อคุณครู)
    const quickReplyItems = teachers.slice(0, 13).map(teacher => {
      const name = `${teacher.first_name} ${teacher.last_name.substring(0, 5)}`;
      return {
        type: 'action',
        action: {
          type: 'postback',
          label: `${teacher.prefix || ''}${name}`,
          data: `action=assign&doc_id=${docId}&teacher_id=${teacher.id}`,
          displayText: `เลือกมอบหมาย: ${teacher.prefix || ''}${teacher.first_name} ${teacher.last_name}`
        }
      };
    });

    await replyToLineQuickReply(
      replyToken,
      `🧑‍🏫 กรุณาเลือกคุณครูผู้รับมอบงานสำหรับเอกสารเรื่อง "${doc.subject}" ด้านล่างนี้ค่ะ:`,
      quickReplyItems
    );

  } catch (err: any) {
    console.error('handleStartAssign error:', err);
    await replyToLine(replyToken, `❌ ดำเนินการไม่สำเร็จ: ${err.message}`);
  }
}

async function handleAssignTeacher(event: any, params: URLSearchParams, profile: any) {
  const docId = params.get('doc_id');
  const teacherId = params.get('teacher_id');
  const replyToken = event.replyToken;

  if (profile.role !== 'director' && profile.role !== 'admin') {
    await replyToLine(replyToken, '❌ ไม่มีสิทธิ์ดำเนินการค่ะ');
    return;
  }

  // ส่ง Quick Reply สำหรับคำสั่งการแบบด่วน
  const docIdStr = docId || '';
  const teacherIdStr = teacherId || '';
  const options = ['มอบดำเนินการ', 'ทราบ/ถือปฏิบัติ', 'ประสานงานต่อ', 'พิมพ์ระบุคำสั่งการเอง'];
  
  const quickReplyItems = options.map(opt => {
    if (opt === 'พิมพ์ระบุคำสั่งการเอง') {
      return {
        type: 'action',
        action: {
          type: 'postback',
          label: opt,
          data: `action=confirm_assign&doc_id=${docIdStr}&teacher_id=${teacherIdStr}&instruction=manual`,
          displayText: opt
        }
      };
    } else {
      return {
        type: 'action',
        action: {
          type: 'postback',
          label: opt,
          data: `action=confirm_assign&doc_id=${docIdStr}&teacher_id=${teacherIdStr}&instruction=${opt}`,
          displayText: `สั่งการ: ${opt}`
        }
      };
    }
  });

  await replyToLineQuickReply(
    replyToken,
    '✍️ เลือกคำสั่งการเกษียณสั่งการหนังสือ หรือเลือกพิมพ์แบบเจาะจงเองด้านล่างค่ะ:',
    quickReplyItems
  );
}

async function handleConfirmAssign(event: any, params: URLSearchParams, profile: any) {
  const docId = params.get('doc_id') || '';
  const teacherId = params.get('teacher_id') || '';
  const instruction = params.get('instruction') || 'มอบดำเนินการ';
  const replyToken = event.replyToken;

  if (profile.role !== 'director' && profile.role !== 'admin') {
    await replyToLine(replyToken, '❌ ไม่มีสิทธิ์ดำเนินการค่ะ');
    return;
  }

  if (instruction === 'manual') {
    // บันทึก state เพื่อรอรับข้อความสั่งพิมพ์เอง
    await supabaseAdmin
      .from('line_action_states')
      .insert([{
        user_id: profile.line_user_id,
        action: 'awaiting_assign_instruction',
        context: { doc_id: docId, teacher_id: teacherId }
      }]);
    await replyToLine(replyToken, '💬 กรุณาพิมพ์ข้อความคำสั่งการของคุณครูส่งเข้ามาในแชทนี้ได้เลยค่ะ 🌸');
  } else {
    // รันการมอบหมายจริง
    await executeDocAssignment(docId, teacherId, instruction, replyToken, profile);
  }
}

async function handleAcknowledge(event: any, params: URLSearchParams, profile: any) {
  const assignmentId = params.get('id');
  const replyToken = event.replyToken;

  try {
    const { data: assignment } = await supabaseAdmin
      .from('doc_assignments')
      .select('*, incoming_docs(subject)')
      .eq('id', assignmentId)
      .single();

    if (!assignment) {
      await replyToLine(replyToken, '❌ ไม่พบข้อมูลการมอบหมายงานนี้ในระบบค่ะ');
      return;
    }

    // ตรวจสอบว่าครูผู้กดตรงกับผู้รับงานหรือไม่
    // ใช้ profiles.id เป็นตัวเชื่อมเพราะตาราง teachers.profile_id หรือ teachers.line_user_id อาจไม่ทันซิงค์เสมอ
    const { data: teacher } = await supabaseAdmin
      .from('teachers')
      .select('id')
      .eq('line_user_id', profile.line_user_id)
      .maybeSingle();

    if (!teacher || teacher.id !== assignment.assignee_id) {
      await replyToLine(replyToken, '❌ ขออภัยค่ะ งานชิ้นนี้มอบหมายให้คุณครูท่านอื่นรับผิดชอบค่ะ 🌸');
      return;
    }

    // อัปเดตตาราง doc_assignments
    await supabaseAdmin
      .from('doc_assignments')
      .update({ status: 'acknowledged' })
      .eq('id', assignmentId);

    const docSubject = assignment.incoming_docs?.subject || 'หนังสือสั่งการ';
    await replyToLine(replyToken, `✅ รับทราบงานเรื่อง "${docSubject}" เรียบร้อยแล้วค่ะ ขอให้การทำงานเป็นไปได้ด้วยดีนะคะคุณครู 🌸✨`);

    // แจ้งเตือนในกลุ่มไลน์โรงเรียน
    await pushToLine(undefined, `👍 คุณครู ${profile.display_name} กดรับทราบงานเรื่อง "${docSubject}" เรียบร้อยแล้วค่ะ 🌸`);

    // แจ้งเตือน ผอ. (รองรับกรณีมีผู้อำนวยการหลายคน ใช้ .limit(1) เพื่อป้องกัน PGRST116)
    const { data: directors } = await supabaseAdmin
      .from('profiles')
      .select('line_user_id')
      .eq('role', 'director')
      .limit(5);

    if (directors && directors.length > 0) {
      for (const dir of directors) {
        if (dir.line_user_id) {
          await pushToLine(dir.line_user_id, `👍 คุณครู ${profile.display_name} กดรับทราบงานเรื่อง "${docSubject}" แล้วค่ะ`);
        }
      }
    }
  } catch (err: any) {
    console.error('handleAcknowledge error:', err);
    await replyToLine(replyToken, `❌ ดำเนินการไม่สำเร็จ: ${err.message}`);
  }
}

async function handleListPending(event: any, params: URLSearchParams, profile: any) {
  const replyToken = event.replyToken;

  try {
    // ค้นหาคุณครูในตาราง teachers
    const { data: teacher } = await supabaseAdmin
      .from('teachers')
      .select('id')
      .eq('line_user_id', profile.line_user_id)
      .maybeSingle();

    if (!teacher) {
      await replyToLine(replyToken, '❌ ไม่พบคุณครูในตารางระบบครูหลักค่ะ กรุณาผูกข้อมูลหรือแจ้งธุรการก่อนนะคะ');
      return;
    }

    // ค้นหางานค้าง (status = pending หรือ acknowledged) ของครูคนนี้
    const { data: pendingAssigns } = await supabaseAdmin
      .from('doc_assignments')
      .select('*, incoming_docs(subject, doc_number)')
      .eq('assignee_id', teacher.id)
      .in('status', ['pending', 'acknowledged'])
      .order('created_at', { ascending: false });

    if (!pendingAssigns || pendingAssigns.length === 0) {
      await replyToLine(replyToken, '🎉 ยินดีด้วยค่ะ! ตอนนี้คุณครูไม่มีงานราชการรอรายงานผลค้างอยู่เลยนะคะ 🌸');
      return;
    }

    // สร้าง Flex Message Carousel รายชิ้นงานค้าง
    const flexContents = {
      type: "carousel",
      contents: pendingAssigns.slice(0, 10).map(assign => ({
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            { type: "text", text: "📊 งานราชการที่ได้รับมอบหมาย", weight: "bold", color: "#9C27B0", size: "xs" },
            { type: "text", text: assign.incoming_docs?.subject || 'ไม่มีหัวเรื่อง', weight: "bold", size: "sm", wrap: true, margin: "md", color: "#333333" },
            { type: "text", text: `เลขหนังสือ: ${assign.incoming_docs?.doc_number || '-'}`, size: "xs", color: "#777777", margin: "xs" },
            { type: "text", text: `คำสั่งการ: ${assign.instruction || '-'}`, size: "xs", color: "#ff8c00", margin: "xs", weight: "bold" }
          ]
        },
        footer: {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: [
            {
              type: "button",
              style: "primary",
              height: "sm",
              color: "#9C27B0",
              action: {
                type: "postback",
                label: "📝 รายงานผลงานชิ้นนี้",
                data: `action=report&id=${assign.id}`
              }
            }
          ]
        }
      }))
    };

    await replyToLineFlex(replyToken, '📊 รายการงานค้างสารบรรณ', flexContents);
  } catch (err: any) {
    console.error('handleListPending error:', err);
    await replyToLine(replyToken, `❌ ดึงรายการงานค้างไม่สำเร็จ: ${err.message}`);
  }
}

async function handleListPendingDocs(event: any, profile: any) {
  const replyToken = event.replyToken;
  if (profile.role !== 'director' && profile.role !== 'admin') {
    await replyToLine(replyToken, '❌ ขออภัยค่ะ เมนูนี้สำหรับผู้อำนวยการเช็คหนังสือรอเกษียณเท่านั้นนะคะ 🌸');
    return;
  }

  try {
    const { data: pendingDocs } = await supabaseAdmin
      .from('incoming_docs')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(10);

    if (!pendingDocs || pendingDocs.length === 0) {
      await replyToLine(replyToken, '🎉 ยินดีด้วยค่ะ! ไม่มีหนังสือราชการรอผู้อำนวยการเกษียณค้างอยู่เลยนะคะ 🌸');
      return;
    }

    const flexContents = {
      type: "carousel",
      contents: pendingDocs.map((doc, index) => {
        let documentUrl = doc.file_url || 'https://google.com';
        return {
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            contents: [
              { type: "text", text: `📥 หนังสือรับรอเกษียณ (${index + 1}/${pendingDocs.length})`, weight: "bold", color: "#9C27B0", size: "xs" },
              { type: "text", text: doc.subject || 'ไม่มีหัวเรื่อง', weight: "bold", size: "sm", wrap: true, margin: "md", color: "#333333" },
              { type: "text", text: `จาก: ${doc.from_agency || '-'}`, size: "xs", color: "#777777", margin: "xs", wrap: true },
              { type: "text", text: `เลขรับ: ${doc.doc_number || '-'}`, size: "xs", color: "#777777", margin: "xs" }
            ]
          },
          footer: {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            contents: [
              {
                type: "button",
                style: "primary",
                height: "sm",
                color: "#007AFF",
                action: {
                  type: "uri",
                  label: "📄 ดูต้นฉบับหนังสือ",
                  uri: documentUrl
                }
              },
              {
                type: "button",
                style: "primary",
                height: "sm",
                color: "#1DB446",
                action: {
                  type: "postback",
                  label: "✍️ เกษียณสั่งการ",
                  data: `action=start_assign&id=${doc.id}`
                }
              }
            ]
          }
        };
      })
    };

    await replyToLineFlex(replyToken, '📥 รายการหนังสือรอเกษียณ', flexContents);
  } catch (err: any) {
    console.error('handleListPendingDocs error:', err);
    await replyToLine(replyToken, `❌ ดึงรายการหนังสือรอเกษียณไม่สำเร็จ: ${err.message}`);
  }
}

async function handleReport(event: any, params: URLSearchParams, profile: any) {

  const assignmentId = params.get('id');
  const replyToken = event.replyToken;

  try {
    const { data: assignment } = await supabaseAdmin
      .from('doc_assignments')
      .select('*, incoming_docs(subject)')
      .eq('id', assignmentId)
      .single();

    if (!assignment) {
      await replyToLine(replyToken, '❌ ไม่พบข้อมูลการมอบหมายงานในระบบค่ะ');
      return;
    }

    // บันทึก state เฝ้ารอพิมพ์ผลการทำงาน
    await supabaseAdmin
      .from('line_action_states')
      .insert([{
        user_id: profile.line_user_id,
        action: 'awaiting_report_text',
        context: { assignment_id: assignmentId }
      }]);

    await replyToLine(replyToken, `✍️ กรุณาพิมพ์รายงานสรุปผลการดำเนินงานสำหรับเรื่อง "${assignment.incoming_docs?.subject}" ส่งเข้ามาในห้องแชทได้เลยค่ะ ชบาจะนำไปบันทึกรายงานเสนอเสนอ ผอ. ทันที 🌸`);
  } catch (err: any) {
    console.error('handleReport error:', err);
    await replyToLine(replyToken, `❌ ไม่สามารถเริ่มรายงานผลได้: ${err.message}`);
  }
}

async function handleClose(event: any, params: URLSearchParams, profile: any) {
  const assignmentId = params.get('id');
  const replyToken = event.replyToken;

  if (profile.role !== 'director' && profile.role !== 'admin') {
    await replyToLine(replyToken, '❌ สิทธิ์การปิดงานเป็นของผู้อำนวยการเท่านั้นค่ะ 🌸');
    return;
  }

  try {
    const { data: assignment } = await supabaseAdmin
      .from('doc_assignments')
      .select('*, incoming_docs(subject), assignee_id')
      .eq('id', assignmentId)
      .single();

    if (!assignment) {
      await replyToLine(replyToken, '❌ ไม่พบชิ้นงานในระบบค่ะ');
      return;
    }

    // อัปเดตสถานะเป็น closed และใส่เวลาปิด
    await supabaseAdmin
      .from('doc_assignments')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', assignmentId);

    await replyToLine(replyToken, `✅ ปิดงานราชการและทราบผลรายงานเรื่อง "${assignment.incoming_docs?.subject}" เรียบร้อยแล้วค่ะ 🌸`);

    // แจ้งเตือนครูผู้รายงาน
    const { data: teacher } = await supabaseAdmin
      .from('teachers')
      .select('line_user_id')
      .eq('id', assignment.assignee_id)
      .maybeSingle();

    if (teacher?.line_user_id) {
      await pushToLine(teacher.line_user_id, `🎉 ผู้อำนวยการได้รับทราบผลรายงานและสั่งการ "ทราบ/ปิดงาน" สำหรับงานเรื่อง "${assignment.incoming_docs?.subject}" แล้วค่ะ ขอบคุณในการดำเนินงานและปิดจ๊อบนะคะคุณครู 🌸⚡`);
    }
  } catch (err: any) {
    console.error('handleClose error:', err);
    await replyToLine(replyToken, `❌ ปิดงานไม่สำเร็จ: ${err.message}`);
  }
}

async function handleFeedback(event: any, params: URLSearchParams, profile: any) {
  const assignmentId = params.get('id');
  const replyToken = event.replyToken;

  if (profile.role !== 'director' && profile.role !== 'admin') {
    await replyToLine(replyToken, '❌ ขออภัยค่ะ ฟังก์ชันนี้สำหรับผู้อำนวยการสั่งการเท่านั้นค่ะ 🌸');
    return;
  }

  try {
    // บันทึก state เพื่อรอคำสั่งการเพิ่มเติม
    await supabaseAdmin
      .from('line_action_states')
      .insert([{
        user_id: profile.line_user_id,
        action: 'awaiting_feedback_text',
        context: { assignment_id: assignmentId }
      }]);

    await replyToLine(replyToken, '💬 กรุณาพิมพ์ข้อแนะนำหรือคำสั่งการเพิ่มเติมที่ต้องการให้คุณครูดำเนินการแก้ไข/ทำเพิ่มส่งมาได้เลยค่ะ 🌸');
  } catch (err: any) {
    console.error('handleFeedback error:', err);
    await replyToLine(replyToken, `❌ ไม่สามารถเตรียมสั่งเพิ่มเติมได้: ${err.message}`);
  }
}

// --------------------------------------------------------------------
// Pending Stateful Action handler (รับข้อความตาม State)
// --------------------------------------------------------------------

async function handlePendingAction(event: any, pendingState: any, profile: any, userMsg: string) {
  const replyToken = event.replyToken;
  const stateId = pendingState.id;
  const action = pendingState.action;
  const context = pendingState.context || {};

  try {
    if (action === 'awaiting_reject_reason') {
      const { type, id } = context;
      let tableName = '';
      let numberColumn = '';
      let nameString = '';
      
      if (type === 'outgoing') { tableName = 'outgoing_docs'; numberColumn = 'doc_number'; nameString = 'หนังสือส่ง'; }
      else if (type === 'memo') { tableName = 'memos'; numberColumn = 'memo_number'; nameString = 'บันทึกข้อความ'; }
      else if (type === 'order') { tableName = 'orders'; numberColumn = 'order_number'; nameString = 'คำสั่งแต่งตั้ง'; }

      // 1. ดึงข้อมูล
      const { data: doc } = await supabaseAdmin.from(tableName).select('*').eq('id', id).single();
      if (!doc) {
        await replyToLine(replyToken, '❌ ไม่พบข้อมูลเอกสารในระบบค่ะ');
        return;
      }

      // 2. อัปเดตสถานะและเหตุผลส่งกลับ
      let remarkObj: any = {};
      try {
        remarkObj = typeof doc.remark === 'object' ? doc.remark : JSON.parse(doc.remark || '{}');
      } catch (e) { remarkObj = {}; }

      remarkObj.director_opinion = userMsg;
      remarkObj.director_decision = 'ส่งกลับแก้ไข';
      remarkObj.approved_date = new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });

      await supabaseAdmin
        .from(tableName)
        .update({
          status: 'rejected',
          remark: JSON.stringify(remarkObj)
        })
        .eq('id', id);

      // ลบ state
      await supabaseAdmin.from('line_action_states').delete().eq('id', stateId);

      await replyToLine(replyToken, `✅ ทำการปฏิเสธ/ส่งแก้ไข ${nameString}เรื่อง "${doc.subject}" และส่งเหตุผลคืนคุณครูผู้ร่างเรียบร้อยแล้วค่ะ 🌸`);

      // แจ้งเตือนครูผู้ร่าง
      if (doc.created_by) {
        const { data: creator } = await supabaseAdmin.from('profiles').select('line_user_id').eq('id', doc.created_by).maybeSingle();
        if (creator?.line_user_id) {
          await pushToLine(creator.line_user_id, `❌ แจ้งเตือน: ${nameString}เรื่อง "${doc.subject}" ได้ถูกส่งกลับแก้ไข\nเหตุผลของ ผอ.: "${userMsg}"\n\nรบกวนคุณครูช่วยตรวจสอบและเข้าไปทำการแก้ไขบนหน้าเว็บโรงเรียนนะคะ 🙇‍♀️🌸`);
        }
      }
    }
    
    else if (action === 'awaiting_assign_instruction') {
      const { doc_id, teacher_id } = context;
      // เรียกกระบวนการมอบหมายงานหลัก
      await executeDocAssignment(doc_id, teacher_id, userMsg, replyToken, profile);
    }
    
    else if (action === 'awaiting_report_text') {
      const { assignment_id } = context;

      // 1. ค้นหาเอกสารและการมอบหมาย
      const { data: assign } = await supabaseAdmin
        .from('doc_assignments')
        .select('*, incoming_docs(subject)')
        .eq('id', assignment_id)
        .single();

      if (!assign) {
        await replyToLine(replyToken, '❌ ไม่พบข้อมูลการมอบหมายงานนี้ในระบบค่ะ');
        return;
      }

      // 2. อัปเดตการรายงานผล
      await supabaseAdmin
        .from('doc_assignments')
        .update({
          status: 'completed',
          staff_report: userMsg,
          reported_at: new Date().toISOString()
        })
        .eq('id', assignment_id);

      // ลบ state
      await supabaseAdmin.from('line_action_states').delete().eq('id', stateId);

      await replyToLine(replyToken, `✅ บันทึกคำรายงานผลและส่งมอบงานเรื่อง "${assign.incoming_docs?.subject}" เสนอผู้อำนวยการเรียบร้อยแล้วค่ะ ขอบคุณมากนะคะคุณครู 🌸`);

      // ค้นหาไลน์ ผอ. เพื่อส่งรายงานไปแจ้งเตือนโต้กลับ (รองรับ director หลายคน ป้องกัน PGRST116)
      const { data: directorsList } = await supabaseAdmin
        .from('profiles')
        .select('line_user_id')
        .eq('role', 'director')
        .limit(5);

      const docSubject = assign.incoming_docs?.subject || 'งานที่มอบหมาย';
      const dirMessage = `📊 คุณครู ${profile.display_name} ได้รายงานผลงาน\nเรื่อง: ${docSubject}\n\nผลงาน: "${userMsg}"`;
      
      const dirActions = [
        { label: '✅ ทราบ/ปิดงาน', type: 'postback' as const, data: `action=close&id=${assignment_id}`, color: '#1DB446' },
        { label: '💬 สั่งเพิ่มเติม', type: 'postback' as const, data: `action=feedback&id=${assignment_id}`, color: '#007AFF' }
      ];

      const firstDirectorLineId = directorsList?.find(d => d.line_user_id)?.line_user_id || undefined;
      await pushToLineFlex(
        firstDirectorLineId, // ผอ. หรือ กลุ่ม
        '📊 สรุปรายงานการดำเนินงาน',
        {
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            contents: [
              { type: "text", text: "📊 สรุปผลรายงานการดำเนินงาน", weight: "bold", color: "#9C27B0", size: "sm" },
              { type: "text", text: dirMessage, margin: "md", wrap: true, weight: "bold", size: "md" }
            ]
          },
          footer: {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            contents: dirActions.map(act => ({
              type: "button",
              style: "primary",
              height: "sm",
              color: act.color || "#1DB446",
              action: { type: "postback", label: act.label, data: act.data }
            }))
          }
        }
      );
    }
    
    else if (action === 'awaiting_feedback_text') {
      const { assignment_id } = context;

      // 1. ค้นหาเอกสารและการมอบหมาย
      const { data: assign } = await supabaseAdmin
        .from('doc_assignments')
        .select('*, incoming_docs(subject), assignee_id')
        .eq('id', assignment_id)
        .single();

      if (!assign) {
        await replyToLine(replyToken, '❌ ไม่พบข้อมูลการมอบหมายงานนี้ในระบบค่ะ');
        return;
      }

      // 2. อัปเดต feedback ผอ. และถอยสถานะกลับไปเป็น acknowledged (เพื่อให้ครูแก้ไขและส่งงานได้อีกรอบ)
      await supabaseAdmin
        .from('doc_assignments')
        .update({
          status: 'acknowledged',
          director_feedback: userMsg
        })
        .eq('id', assignment_id);

      // ลบ state
      await supabaseAdmin.from('line_action_states').delete().eq('id', stateId);

      await replyToLine(replyToken, `✅ บันทึกคำสั่งการเพิ่มเติมเรียบร้อยและส่งแจ้งคุณครูเรียบร้อยแล้วค่ะ 🌸`);

      // ค้นหาไลน์ครูเพื่อยิง feedback
      const { data: teacher } = await supabaseAdmin
        .from('teachers')
        .select('line_user_id, prefix, first_name, last_name')
        .eq('id', assign.assignee_id)
        .maybeSingle();

      const docSubject = assign.incoming_docs?.subject || 'งานที่มอบหมาย';
      const teacherName = teacher ? `${teacher.prefix || ''}${teacher.first_name} ${teacher.last_name}` : 'ครูผู้รับงาน';
      
      const teacherMsg = `📌 ผอ. มีคำแนะนำ/สั่งการเพิ่มเติม\nเรื่อง: ${docSubject}\n\nคำสั่ง ผอ.: "${userMsg}"\n\nรบกวนคุณครูดำเนินการเพิ่มเติม และรายงานผลส่งกลับอีกครั้งเมื่อเสร็จงานนะคะ 🌸`;
      
      const teacherActions = [
        { label: '📄 ดูเอกสาร', type: 'uri' as const, uri: assign.report_file_urls?.[0] || assign.incoming_docs?.file_url || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://school-admin-psi.vercel.app') },
        { label: '📝 รายงานผลใหม่', type: 'postback' as const, data: `action=report&id=${assignment_id}`, color: '#9C27B0' }
      ];

      if (teacher?.line_user_id) {
        await pushToLineFlex(teacher.line_user_id, '📌 คำสั่งการเพิ่มเติมจาก ผอ.', {
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            contents: [
              { type: "text", text: "📌 คำสั่งการเพิ่มเติมจากผู้อำนวยการ", weight: "bold", color: "#ff8c00", size: "sm" },
              { type: "text", text: teacherMsg, margin: "md", wrap: true, weight: "bold", size: "md" }
            ]
          },
          footer: {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            contents: teacherActions.map(act => ({
              type: "button",
              style: "primary",
              height: "sm",
              color: act.color || "#1DB446",
              action: act.type === 'uri' ? { type: "uri", label: act.label, uri: act.uri } : { type: "postback", label: act.label, data: act.data }
            }))
          }
        });
      } else {
        // ส่งกลุ่ม
        const groupMsg = `ถึง: ${teacherName}\nเรื่อง: ${docSubject}\n\nคำสั่ง ผอ. เพิ่มเติม: "${userMsg}"\n\nกรุณาดำเนินการต่อและกดส่งงานใหม่เมื่อเรียบร้อยค่ะ`;
        await pushToLineFlex(undefined, '📢 คำสั่งการเพิ่มเติมถึงคุณครู', {
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            contents: [
              { type: "text", text: "📢 คำสั่งเพิ่มเติมจากผู้อำนวยการ", weight: "bold", color: "#ff8c00", size: "sm" },
              { type: "text", text: groupMsg, margin: "md", wrap: true, weight: "bold", size: "md" }
            ]
          },
          footer: {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            contents: teacherActions.map(act => ({
              type: "button",
              style: "primary",
              height: "sm",
              color: act.color || "#1DB446",
              action: act.type === 'uri' ? { type: "uri", label: act.label, uri: act.uri } : { type: "postback", label: act.label, data: act.data }
            }))
          }
        });
      }
    }
  } catch (err: any) {
    console.error('handlePendingAction error:', err);
    await replyToLine(replyToken, `❌ ดำเนินการขั้นตอนต่อเนื่องไม่สำเร็จ: ${err.message}`);
  }
}
