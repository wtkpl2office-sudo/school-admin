declare const process: any;
import { createClient } from '@supabase/supabase-js';

// ── Thai Public Holidays Inline Helper (Self-Contained for Vercel Lambdas) ──
const THAI_PUBLIC_HOLIDAYS: Record<string, string> = {
  '2025-01-01': 'วันขึ้นปีใหม่', '2025-02-12': 'วันมาฆบูชา', '2025-04-06': 'วันจักรี',
  '2025-04-07': 'วันหยุดชดเชยวันจักรี', '2025-04-13': 'วันสงกรานต์', '2025-04-14': 'วันสงกรานต์',
  '2025-04-15': 'วันสงกรานต์', '2025-04-16': 'วันหยุดชดเชยวันสงกรานต์', '2025-05-04': 'วันฉัตรมงคล',
  '2025-05-05': 'วันหยุดชดเชยวันฉัตรมงคล', '2025-05-09': 'วันพืชมงคล', '2025-05-11': 'วันวิสาขบูชา',
  '2025-05-12': 'วันหยุดชดเชยวันวิสาขบูชา', '2025-06-02': 'วันหยุดพิเศษ', '2025-06-03': 'วันเฉลิมฯ พระราชินี',
  '2025-07-10': 'วันอาสาฬหบูชา', '2025-07-11': 'วันเข้าพรรษา', '2025-07-28': 'วันเฉลิมฯ ร.10',
  '2025-08-11': 'วันหยุดพิเศษ', '2025-08-12': 'วันแม่แห่งชาติ', '2025-10-13': 'วันนวมินทรมหาราช',
  '2025-10-23': 'วันปิยมหาราช', '2025-12-05': 'วันพ่อแห่งชาติ', '2025-12-10': 'วันรัฐธรรมนูญ',
  '2025-12-31': 'วันสิ้นปี',
  '2026-01-01': 'วันขึ้นปีใหม่', '2026-01-02': 'วันหยุดพิเศษ', '2026-03-03': 'วันมาฆบูชา',
  '2026-04-06': 'วันจักรี', '2026-04-13': 'วันสงกรานต์', '2026-04-14': 'วันสงกรานต์',
  '2026-04-15': 'วันสงกรานต์', '2026-05-04': 'วันฉัตรมงคล', '2026-05-13': 'วันพืชมงคล',
  '2026-05-31': 'วันวิสาขบูชา', '2026-06-01': 'วันหยุดชดเชยวันวิสาขบูชา', '2026-06-03': 'วันเฉลิมฯ พระราชินี',
  '2026-07-28': 'วันเฉลิมฯ ร.10', '2026-07-29': 'วันอาสาฬหบูชา', '2026-07-30': 'วันเข้าพรรษา',
  '2026-08-12': 'วันแม่แห่งชาติ', '2026-10-13': 'วันนวมินทรมหาราช', '2026-10-23': 'วันปิยมหาราช',
  '2026-12-05': 'วันพ่อแห่งชาติ', '2026-12-07': 'วันหยุดชดเชยวันพ่อแห่งชาติ', '2026-12-10': 'วันรัฐธรรมนูญ',
  '2026-12-31': 'วันสิ้นปี',
  '2027-01-01': 'วันขึ้นปีใหม่', '2027-02-21': 'วันมาฆบูชา', '2027-02-22': 'วันหยุดชดเชยวันมาฆบูชา',
  '2027-04-06': 'วันจักรี', '2027-04-13': 'วันสงกรานต์', '2027-04-14': 'วันสงกรานต์',
  '2027-04-15': 'วันสงกรานต์', '2027-04-16': 'วันหยุดชดเชยวันสงกรานต์', '2027-05-04': 'วันฉัตรมงคล',
  '2027-05-14': 'วันพืชมงคล', '2027-05-20': 'วันวิสาขบูชา', '2027-06-03': 'วันเฉลิมฯ พระราชินี',
  '2027-07-18': 'วันอาสาฬหบูชา', '2027-07-19': 'วันหยุดชดเชยวันอาสาฬหบูชา', '2027-07-28': 'วันเฉลิมฯ ร.10',
  '2027-08-12': 'วันแม่แห่งชาติ', '2027-10-13': 'วันนวมินทรมหาราช', '2027-10-23': 'วันปิยมหาราช',
  '2027-10-25': 'วันหยุดชดเชยวันปิยมหาราช', '2027-12-05': 'วันพ่อแห่งชาติ', '2027-12-06': 'วันหยุดชดเชยวันพ่อแห่งชาติ',
  '2027-12-10': 'วันรัฐธรรมนูญ', '2027-12-31': 'วันสิ้นปี'
};

const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

function getThaiDateInfo(dateObj?: Date | string) {
  let targetDate: Date;
  if (!dateObj) targetDate = new Date();
  else if (typeof dateObj === 'string') targetDate = new Date(dateObj.includes('T') ? dateObj : `${dateObj}T00:00:00+07:00`);
  else targetDate = dateObj;

  const bangkokDateStr = targetDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const [yearStr, monthStr, dayStr] = bangkokDateStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  const bkkDate = new Date(targetDate.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const dayOfWeek = bkkDate.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const isoDateStr = bangkokDateStr;
  const holidayName = THAI_PUBLIC_HOLIDAYS[isoDateStr];
  const isHoliday = !!holidayName;
  const isWorkingDay = !isWeekend && !isHoliday;
  const thaiYear = year + 543;
  const thaiMonthName = THAI_MONTHS[month - 1] || '';
  const thaiDateStr = `${day} ${thaiMonthName} ${thaiYear}`;

  return { isHoliday, holidayName, isWeekend, isWorkingDay, thaiDateStr, isoDateStr, dayOfWeek };
}

function isNonWorkingDay(dateObj?: Date | string) {
  const info = getThaiDateInfo(dateObj);
  if (info.isWeekend) {
    const dayNames = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];
    return { isNonWorking: true, reason: `วันหยุดสุดสัปดาห์ (${dayNames[info.dayOfWeek]})` };
  }
  if (info.isHoliday) {
    return { isNonWorking: true, reason: `วันหยุดราชการ (${info.holidayName})` };
  }
  return { isNonWorking: false };
}

export default async function handler(req: Request | any, res?: any): Promise<Response | void> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = typeof req?.headers?.get === 'function'
    ? req.headers.get('authorization')
    : (req?.headers?.authorization || req?.headers?.Authorization);

  let querySecret = req?.query?.secret || req?.query?.key;
  let force = req?.query?.force === 'true' || req?.query?.force === true;
  let action = req?.query?.action;
  let testDate = req?.query?.date;

  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host || 'localhost:3000';
  const proto = req?.headers?.['x-forwarded-proto'] || (host.includes('localhost') ? 'http' : 'https');
  const baseUrl = `${proto}://${host}`;

  if (!action) {
    try {
      const url = new URL(req?.url || '/', baseUrl);
      action = url.searchParams.get('action') || 'status';
      if (!force) force = url.searchParams.get('force') === 'true';
      if (!testDate) testDate = url.searchParams.get('date') || undefined;
      if (!querySecret) querySecret = url.searchParams.get('secret') || url.searchParams.get('key');
    } catch {
      action = 'status';
    }
  }

  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
    const payload = { error: 'Unauthorized' };
    if (res?.status) return res.status(401).json(payload);
    return new Response(JSON.stringify(payload), { status: 401 });
  }

  try {
    if (action === 'status' || action === 'check-holiday') {
      const dateInfo = getThaiDateInfo(testDate || undefined);
      const nonWorking = isNonWorkingDay(testDate || undefined);

      const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
      let schoolName = 'ไม่ได้เชื่อมต่อ Database';
      let hasTelegramToken = false;
      let pendingDocsCount = 0;

      if (supabaseUrl && supabaseKey) {
        try {
          const supabase = createClient(supabaseUrl, supabaseKey, {
            auth: { persistSession: false, autoRefreshToken: false }
          });
          const { data: settings } = await supabase.from('settings').select('school_name, telegram_bot_token').maybeSingle();
          if (settings) {
            schoolName = settings.school_name || 'ไม่ได้ระบุชื่อ';
            hasTelegramToken = !!settings.telegram_bot_token;
          }
          const { count } = await supabase.from('incoming_docs').select('*', { count: 'exact', head: true }).in('status', ['pending', 'waiting_proposal']);
          pendingDocsCount = count || 0;
        } catch (dbErr: any) {
          console.error('[TRIGGER TEST STATUS DB ERROR]', dbErr);
        }
      }

      const payload = {
        success: true,
        action: 'status',
        serverTimeBangkok: new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
        dateInfo,
        nonWorkingReason: nonWorking.isNonWorking ? nonWorking.reason : 'วันทำการปกติ (Working day)',
        school: {
          schoolName,
          hasTelegramToken,
          pendingDocsCount
        }
      };

      if (res?.status) return res.status(200).json(payload);
      return new Response(JSON.stringify(payload, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    if (action === 'director-digest' || action === 'director-pending-reminder') {
      const targetUrl = `${baseUrl}/api/director-pending-reminder?force=${force ? 'true' : 'false'}${cronSecret ? `&secret=${cronSecret}` : ''}`;
      const fetchHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (cronSecret) fetchHeaders['Authorization'] = `Bearer ${cronSecret}`;

      const subRes = await fetch(targetUrl, { method: 'GET', headers: fetchHeaders });
      const data = await subRes.json().catch(() => ({ statusText: subRes.statusText }));

      const payload = {
        success: subRes.ok,
        triggeredAction: 'director-digest',
        targetUrl,
        statusCode: subRes.status,
        forceBypassHoliday: force,
        result: data
      };

      if (res?.status) return res.status(subRes.status).json(payload);
      return new Response(JSON.stringify(payload, null, 2), {
        status: subRes.status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    if (action === 'weekly-executive-digest' || action === 'executive-digest') {
      const targetUrl = `${baseUrl}/api/weekly-executive-workload-digest?force=true${cronSecret ? `&secret=${cronSecret}` : ''}`;
      const fetchHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (cronSecret) fetchHeaders['Authorization'] = `Bearer ${cronSecret}`;

      const subRes = await fetch(targetUrl, { method: 'GET', headers: fetchHeaders });
      const data = await subRes.json().catch(() => ({ statusText: subRes.statusText }));

      const payload = {
        success: subRes.ok,
        triggeredAction: 'weekly-executive-digest',
        targetUrl,
        statusCode: subRes.status,
        result: data
      };

      if (res?.status) return res.status(subRes.status).json(payload);
      return new Response(JSON.stringify(payload, null, 2), {
        status: subRes.status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    const payload = {
      success: false,
      error: `ไม่พบ Action '${action}' กรุณาใช้ ?action=status, ?action=director-digest หรือ ?action=weekly-executive-digest`
    };
    if (res?.status) return res.status(400).json(payload);
    return new Response(JSON.stringify(payload), { status: 400 });

  } catch (err: any) {
    console.error('[TRIGGER TEST ERROR]', err);
    const payload = { success: false, error: err.message || 'Internal Server Error' };
    if (res?.status) return res.status(500).json(payload);
    return new Response(JSON.stringify(payload), { status: 500 });
  }
}
