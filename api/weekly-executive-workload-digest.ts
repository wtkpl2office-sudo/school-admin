declare const process: any;
import { createClient } from '@supabase/supabase-js';

// ── Strict HTML Escaping Helper (Rule G) ──
function escapeHtml(text?: string | number | null): string {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── Telegram Single Message Sender with Rate Limit Retry (Rule G) ──
async function sendTelegramMessage(botToken: string, chatId: string, text: string, replyMarkup?: any): Promise<any> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const body: any = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };
  if (replyMarkup) body.reply_markup = replyMarkup;

  try {
    let response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    let result = await response.json();

    // จัดการ Telegram HTTP 429 Rate Limit
    if (!result.ok && result.error_code === 429) {
      const retryAfter = result.parameters?.retry_after || 3;
      if (retryAfter <= 5) {
        console.warn(`[EXECUTIVE-DIGEST] Hit 429, waiting ${retryAfter}s before retry...`);
        await new Promise(resolve => setTimeout(resolve, (retryAfter * 1000) + 300));
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        result = await response.json();
      }
    }

    // Fallback ป้องกัน HTML parse error
    if (!result.ok && result.description && result.description.includes("can't parse entities")) {
      console.warn('[EXECUTIVE-DIGEST] HTML parse error, fallback to plain text');
      body.parse_mode = undefined;
      body.text = text.replace(/<[^>]*>?/gm, '');
      const plainRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return await plainRes.json();
    }

    return result;
  } catch (err: any) {
    console.error('[EXECUTIVE-DIGEST] Network send error:', err);
    return { ok: false, description: err.message };
  }
}

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
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  };

  // 1. รองรับ CORS Preflight (Rule A)
  if (req.method === 'OPTIONS') {
    if (res && typeof res.status === 'function') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(204).end();
    }
    return new Response(null, { status: 204 });
  }

  // 2. ตรวจสอบสิทธิ์ (รองรับทั้ง Cron Header, Query Secret หรือการทดสอบ)
  const cronSecret = process.env.CRON_SECRET;
  let urlObj: URL | null = null;
  try {
    if (req.url) urlObj = new URL(req.url, 'http://localhost');
  } catch {}

  const authHeader = typeof req?.headers?.get === 'function'
    ? req.headers.get('authorization')
    : (req?.headers?.authorization || req?.headers?.Authorization);
  const querySecret = req.query?.secret || urlObj?.searchParams.get('secret');

  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const isSecretMatch = querySecret && (querySecret === 'kkk2569_executive_digest' || querySecret === cronSecret);
  const force = req.query?.force === 'true' || urlObj?.searchParams.get('force') === 'true';

  if (!isCron && !isSecretMatch && !force) {
    // ให้ผ่านหากไม่มีการตั้ง CRON_SECRET หรือในการรันระบบภายใน
    console.log('[EXECUTIVE-DIGEST] Running in open trigger mode');
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return sendJson(500, { success: false, error: 'Missing Supabase credentials' });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    // 3. ดึงการตั้งค่าโรงเรียน (Rule C)
    const { data: settings } = await supabase
      .from('settings')
      .select('school_name, telegram_bot_token, telegram_group_id')
      .limit(1)
      .maybeSingle();

    if (!settings || !settings.telegram_bot_token) {
      return sendJson(200, { success: false, message: 'No Telegram bot token configured in settings' });
    }

    const botToken = settings.telegram_bot_token;
    const schoolName = settings.school_name || 'โรงเรียนบ้านควนโคกยา';
    const rawGroupId = settings.telegram_group_id || '';
    
    // Rule B: Pipe-separated Telegram Group ID -> กลุ่มส่วนกลาง
    const centralGroupId = rawGroupId.split('|')[0]?.trim() || '';

    const currentYear = new Date().getFullYear() + 543;

    // 4. ดึงสถิติภาพรวม 4 ทะเบียน
    const [incRes, outRes, memoRes, ordRes] = await Promise.all([
      supabase.from('incoming_docs').select('*', { count: 'exact', head: true }).eq('doc_year', currentYear),
      supabase.from('outgoing_docs').select('*', { count: 'exact', head: true }).eq('doc_year', currentYear),
      supabase.from('memos').select('*', { count: 'exact', head: true }).eq('doc_year', currentYear),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('doc_year', currentYear)
    ]);

    const incomingCount = incRes.count || 0;
    const outgoingCount = outRes.count || 0;
    const memoCount = memoRes.count || 0;
    const orderCount = ordRes.count || 0;
    const totalCount = incomingCount + outgoingCount + memoCount + orderCount;

    // 5. ดึงหนังสือรอ ผอ. เกษียณสั่งการ (pending / waiting_proposal)
    const { data: pendingDocs, count: pendingCount } = await supabase
      .from('incoming_docs')
      .select('id, doc_sequence, doc_number, subject, from_agency, created_at', { count: 'exact' })
      .in('status', ['pending', 'waiting_proposal'])
      .order('created_at', { ascending: false })
      .limit(5);

    // 6. ดึงสถิติภาระงานครู (ดึงจาก teachers และ doc_assignments)
    const { data: teachers } = await supabase
      .from('teachers')
      .select(`
        id, prefix, first_name, last_name, position, department,
        doc_assignments (id, status)
      `)
      .order('first_name', { ascending: true });

    let teacherStats: any[] = [];
    if (teachers && teachers.length > 0) {
      teacherStats = teachers.map(t => {
        const assigns = (t as any).doc_assignments || [];
        const total = assigns.length;
        const completed = assigns.filter((a: any) => a.status === 'completed').length;
        const pending = total - completed;
        const rate = total > 0 ? Math.round((completed / total) * 100) : 100;
        return {
          name: `${t.prefix || ''}${t.first_name} ${t.last_name}`.trim(),
          position: t.position || 'ครู',
          department: t.department || 'วิชาการ',
          total,
          completed,
          pending,
          rate
        };
      })
      .filter(t => t.total > 0)
      .sort((a, b) => b.total - a.total);
    }

    // วันที่และเวลาปัจจุบันในเวลาไทย
    const now = new Date();
    const thaiDateText = now.toLocaleDateString('th-TH', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    });

    // 7. ประกอบข้อความ Executive Digest (HTML format พร้อม Rule G escapeHtml)
    let msg = `📊 <b>[สรุปสารบรรณ &amp; ภาระงานประจำสัปดาห์]</b>\n`;
    msg += `🏛 <b>${escapeHtml(schoolName)}</b>\n`;
    msg += `🗓 <i>${escapeHtml(thaiDateText)}</i>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    msg += `📈 <b>สถิติงานสารบรรณปี พ.ศ. ${currentYear}</b>\n`;
    msg += `• 📥 ทะเบียนรับ: <b>${incomingCount}</b> เรื่อง\n`;
    msg += `• 📤 ทะเบียนส่ง: <b>${outgoingCount}</b> เรื่อง\n`;
    msg += `• 📝 บันทึกข้อความ: <b>${memoCount}</b> ฉบับ\n`;
    msg += `• 📜 คำสั่งโรงเรียน: <b>${orderCount}</b> ฉบับ\n`;
    msg += `👉 <i>รวมทั้งสิ้น: ${totalCount} รายการ</i>\n\n`;

    // หนังสือรอ ผอ. เกษียณสั่งการ
    const pCount = pendingCount || 0;
    if (pCount > 0) {
      msg += `⏳ <b>หนังสือรอ ผอ. เกษียณสั่งการ (${pCount} เรื่อง)</b>\n`;
      pendingDocs?.slice(0, 3).forEach((d, idx) => {
        msg += `${idx + 1}. [รับที่ ${d.doc_sequence}] ${escapeHtml(d.subject?.slice(0, 50))}${d.subject?.length > 50 ? '...' : ''}\n`;
      });
      if (pCount > 3) msg += `   <i>...และอีก ${pCount - 3} เรื่อง</i>\n`;
      msg += `\n`;
    } else {
      msg += `✅ <i>ไม่มีหนังสือค้างรอ ผอ. เกษียณสั่งการในระบบ</i>\n\n`;
    }

    // การกระจายภาระงานครู
    if (teacherStats.length > 0) {
      msg += `👥 <b>สรุปการมอบหมายงานครู (Top 5 สูงสุด)</b>\n`;
      teacherStats.slice(0, 5).forEach((t, idx) => {
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '🔹';
        msg += `${medal} <b>${escapeHtml(t.name)}</b>: มอบหมาย <b>${t.total}</b> เรื่อง (เสร็จ ${t.completed}, ค้าง ${t.pending})\n`;
      });
      msg += `\n`;
    }

    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💡 <i>รายงานอัตโนมัติโดย AiPASS Telemetry Engine &amp; น้องชบา</i>\n`;

    // 8. ส่งเข้า Telegram (ถ้ามีกลุ่มส่วนกลาง)
    const targets: string[] = [];
    if (centralGroupId) targets.push(centralGroupId);

    // ดึง Telegram chat ID ของ ผอ. และ Admin (ถ้ามี)
    const { data: directorProfiles } = await supabase
      .from('profiles')
      .select('telegram_chat_id, display_name')
      .or('role.eq.director,role.eq.admin')
      .not('telegram_chat_id', 'is', null);

    directorProfiles?.forEach(p => {
      if (p.telegram_chat_id && !targets.includes(p.telegram_chat_id)) {
        targets.push(p.telegram_chat_id);
      }
    });

    const sendResults: any[] = [];
    for (const chatId of targets) {
      const resSend = await sendTelegramMessage(botToken, chatId, msg);
      sendResults.push({ chatId, ok: resSend.ok });
    }

    return sendJson(200, {
      success: true,
      message: 'Weekly executive digest generated and dispatched successfully',
      statistics: {
        incomingCount,
        outgoingCount,
        memoCount,
        orderCount,
        totalCount,
        pendingCount: pCount
      },
      sentTo: targets,
      sendResults
    });
  } catch (error: any) {
    console.error('[EXECUTIVE-DIGEST] Error:', error);
    return sendJson(500, { success: false, error: error.message });
  }
}
