import { supabase } from '../lib/supabase';

export interface AnnualSarabanOverview {
  docYear: number;
  incomingCount: number;
  outgoingCount: number;
  memoCount: number;
  orderCount: number;
  totalCount: number;
}

export interface StaffWorkloadSummary {
  staffId: string;
  staffName: string;
  position: string;
  department: string;
  totalAssigned: number;
  completedCount: number;
  pendingCount: number;
  completionRate: number;
}

/**
 * บริการจัดทำรายงานสรุปงานสารบรรณประจำปี พ.ศ. เสนอ ผอ. โรงเรียน
 */
export class AnnualSarabanService {
  /**
   * ดึงสถิติภาพรวมงานสารบรรณประจำปี พ.ศ. สำหรับบันทึกข้อความปะหน้า
   */
  static async getOverview(docYear: number): Promise<AnnualSarabanOverview> {
    try {
      const { data, error } = await supabase.rpc('get_annual_saraban_overview', {
        p_doc_year: docYear
      });

      if (error) {
        console.warn('[AnnualSarabanService] RPC overview error, using fallback:', error);
        return await this.fallbackOverview(docYear);
      }

      const res = data as any;
      return {
        docYear: res.doc_year,
        incomingCount: res.incoming_count,
        outgoingCount: res.outgoing_count,
        memoCount: res.memo_count,
        orderCount: res.order_count,
        totalCount: res.total_count
      };
    } catch (err) {
      console.error('[AnnualSarabanService] Exception in getOverview:', err);
      return await this.fallbackOverview(docYear);
    }
  }

  /**
   * ดึงสถิติการกระจายภาระงานรายบุคคล (Staff Workload Distribution)
   */
  static async getStaffWorkload(docYear: number): Promise<StaffWorkloadSummary[]> {
    try {
      // 1. ดึง profiles (master list — 1 row ต่อ 1 account จริง) + teachers join ด้วย email
      const [profilesRes, teachersRes, assignRes] = await Promise.all([
        supabase.from('profiles').select('id, display_name, email, role, status').eq('status', 'active'),
        supabase.from('teachers').select('email, prefix, first_name, last_name, position, department'),
        supabase.from('doc_assignments')
          .select('assignee_id, status, incoming_docs!inner(doc_year)')
          .eq('incoming_docs.doc_year', docYear)
      ]);

      const profiles = profilesRes.data || [];
      const teachers = teachersRes.data || [];
      const assignments = assignRes.data || [];

      // 2. Map email → teacher info
      const teacherByEmail = new Map<string, any>();
      teachers.forEach(t => {
        if (t.email) teacherByEmail.set(t.email.toLowerCase(), t);
      });

      // 3. นับงานต่อ assignee_id
      const statsById = new Map<string, { total: number; completed: number; pending: number }>();
      (assignments as any[]).forEach((a: any) => {
        const id = a.assignee_id;
        if (!id) return;
        const s = statsById.get(id) || { total: 0, completed: 0, pending: 0 };
        s.total += 1;
        if (['reported', 'acknowledged', 'completed'].includes(a.status)) s.completed += 1;
        else s.pending += 1;
        statsById.set(id, s);
      });

      // 4. สร้าง result จาก profiles (ไม่ซ้ำแน่นอน)
      const result: StaffWorkloadSummary[] = profiles.map(p => {
        const t = teacherByEmail.get(p.email?.toLowerCase() || '');
        const fullName = t
          ? `${t.prefix || ''}${t.first_name} ${t.last_name || ''}`.trim()
          : p.display_name || p.email || 'ไม่ระบุชื่อ';
        const s = statsById.get(p.id) || { total: 0, completed: 0, pending: 0 };
        const rate = s.total > 0 ? Math.round((s.completed / s.total) * 1000) / 10 : 0;
        return {
          staffId: p.id,
          staffName: fullName,
          position: t?.position || (p.role === 'admin' ? 'ผู้ดูแลระบบ' : 'บุคลากร'),
          department: t?.department || 'ทั่วไป',
          totalAssigned: s.total,
          completedCount: s.completed,
          pendingCount: s.pending,
          completionRate: rate
        };
      });

      return result.sort((a, b) => b.totalAssigned - a.totalAssigned);

    } catch (err) {
      console.error('[AnnualSarabanService] Exception in getStaffWorkload:', err);
      return await this.fallbackWorkload(docYear);
    }
  }

  /**
   * Fallback สำหรับภาพรวม
   */
  private static async fallbackOverview(docYear: number): Promise<AnnualSarabanOverview> {
    const [inc, out, memo, ord] = await Promise.all([
      supabase.from('incoming_docs').select('*', { count: 'exact', head: true }).eq('doc_year', docYear),
      supabase.from('outgoing_docs').select('*', { count: 'exact', head: true }).eq('doc_year', docYear),
      supabase.from('memos').select('*', { count: 'exact', head: true }).eq('doc_year', docYear),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('doc_year', docYear)
    ]);

    const incomingCount = inc.count || 0;
    const outgoingCount = out.count || 0;
    const memoCount = memo.count || 0;
    const orderCount = ord.count || 0;

    return {
      docYear,
      incomingCount,
      outgoingCount,
      memoCount,
      orderCount,
      totalCount: incomingCount + outgoingCount + memoCount + orderCount
    };
  }

  /**
   * Fallback สำหรับภาระงาน
   */
  private static async fallbackWorkload(docYear: number): Promise<StaffWorkloadSummary[]> {
    try {
      const { data: assignments } = await supabase
        .from('doc_assignments')
        .select(`
          assignee_id,
          status,
          incoming_docs!inner(doc_year)
        `)
        .eq('incoming_docs.doc_year', docYear);

      const { data: teachers } = await supabase
        .from('teachers')
        .select('id, prefix, first_name, last_name, position, department');

      const teacherMap = new Map<string, any>();
      (teachers || []).forEach(t => {
        teacherMap.set(t.id, t);
      });

      const statsMap = new Map<string, { total: number; completed: number; pending: number }>();

      (assignments || []).forEach((a: any) => {
        const tId = a.assignee_id;
        if (!tId) return;
        const current = statsMap.get(tId) || { total: 0, completed: 0, pending: 0 };
        current.total += 1;
        if (a.status === 'reported' || a.status === 'acknowledged' || a.status === 'completed') {
          current.completed += 1;
        } else {
          current.pending += 1;
        }
        statsMap.set(tId, current);
      });

      const result: StaffWorkloadSummary[] = [];
      statsMap.forEach((val, tId) => {
        const teacher = teacherMap.get(tId);
        const name = teacher ? `${teacher.prefix || ''}${teacher.first_name} ${teacher.last_name || ''}`.trim() : 'ไม่ระบุชื่อ';
        const rate = val.total > 0 ? Math.round((val.completed / val.total) * 1000) / 10 : 100;
        result.push({
          staffId: tId,
          staffName: name,
          position: teacher?.position || 'ครูผู้สอน',
          department: teacher?.department || 'วิชาการ',
          totalAssigned: val.total,
          completedCount: val.completed,
          pendingCount: val.pending,
          completionRate: rate
        });
      });

      return result.sort((a, b) => b.totalAssigned - a.totalAssigned);
    } catch (e) {
      console.error('[AnnualSarabanService] Fallback workload error:', e);
      return [];
    }
  }
}
