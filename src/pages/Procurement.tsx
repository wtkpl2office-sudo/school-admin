import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { ProcurementDashboard } from './procurement/ProcurementDashboard';
import { ProcurementWizard } from './procurement/ProcurementWizard';
import { ProcurementCaseDetail } from './procurement/ProcurementCaseDetail';
import { AssetSuppliesRegistry } from './procurement/AssetSuppliesRegistry';
import { ProcurementDocGenerator, type ProcurementDocData } from '../services/procurementDocGenerator';

// ==========================================
// ข้อมูลจำลองสำหรับทดสอบโหมดออฟไลน์ (Offline Mode)
// ==========================================
const DEMO_TEACHERS = [
  { id: 't1', first_name: 'สมหมาย', last_name: 'ใจดี', position: 'เจ้าหน้าที่' },
  { id: 't2', first_name: 'วิชาญ', last_name: 'ชำนาญการ', position: 'หัวหน้าเจ้าหน้าที่' },
  { id: 't3', first_name: 'รัตนา', last_name: 'สุขใจ', position: 'ครูชำนาญการพิเศษ' },
  { id: 't4', first_name: 'ประสิทธิ์', last_name: 'มั่นคง', position: 'ครูชำนาญการ' },
  { id: 't5', first_name: 'สุดา', last_name: 'จันทร์สว่าง', position: 'ครู' }
];

const DEMO_BUDGETS = [
  { id: 'b1', category_name: 'เงินอุดหนุนรายหัวนักเรียน', budget_type: 'งบอุดหนุน', amount: 150000, remaining_amount: 125000 },
  { id: 'b2', category_name: 'โครงการสนับสนุนการศึกษาขั้นพื้นฐาน (เรียนฟรี 15 ปี)', budget_type: 'งบเรียนฟรี', amount: 80000, remaining_amount: 65000 },
  { id: 'b3', category_name: 'เงินรายได้สถานศึกษา', budget_type: 'เงินรายได้', amount: 50000, remaining_amount: 48000 },
  { id: 'b4', category_name: 'เงินอุดหนุนอาหารกลางวันนักเรียน', budget_type: 'อาหารกลางวัน', amount: 120000, remaining_amount: 98000 }
];

const INITIAL_DEMO_CASES = [
  {
    id: 'demo-1',
    pcid: 'PRC-FY2569-00001',
    title: 'ซื้อวัสดุอุปกรณ์การศึกษาสำหรับกิจกรรมพัฒนาผู้เรียน (ว.119 วงเงินเล็กน้อย)',
    category: 'goods',
    policy_code: 'W119_10K',
    estimated_amount: 4500,
    final_amount: 4500,
    current_gate: 5,
    status: 'disbursed',
    fiscal_year: '2569',
    academic_year: '2569',
    memo_number: 'ที่ ศธ 04225/12',
    request_date: '2026-09-02',
    pr_number: 'พด. 12/2569',
    po_number: 'PO-12/2569',
    inspection_number: 'ตรวจรับ 12/2569',
    requester_name: 'รัตนา สุขใจ',
    vendor_info: {
      name: 'ร้านสมหมายเครื่องเขียน',
      tax_id: '1939900123456',
      receipt_no: 'เล่ม 04 เลขที่ 25',
      receipt_date: '2026-09-02',
      phone: '074-612345'
    },
    committee_members: [
      { name: 'รัตนา สุขใจ', role: 'ผู้ตรวจรับพัสดุ' }
    ],
    items: [
      { item_name: 'กระดาษ A4 80 แกรม', quantity: 15, unit: 'รีม', unit_price: 130, total_price: 1950 },
      { item_name: 'หมึกพิมพ์เลเซอร์ Brother', quantity: 1, unit: 'กล่อง', unit_price: 1550, total_price: 1550 },
      { item_name: 'ปากกาเคมีและไวท์บอร์ด', quantity: 20, unit: 'ด้าม', unit_price: 50, total_price: 1000 }
    ],
    created_at: '2026-09-02T08:30:00Z'
  },
  {
    id: 'demo-2',
    pcid: 'PRC-FY2569-00002',
    title: 'ซื้อชุดอุปกรณ์วิทยาศาสตร์และคอมพิวเตอร์เพื่อการเรียนรู้ (วิธีเฉพาะเจาะจง e-GP)',
    category: 'goods',
    policy_code: 'W089',
    estimated_amount: 48500,
    final_amount: 48500,
    current_gate: 4,
    status: 'delivered',
    fiscal_year: '2569',
    academic_year: '2569',
    memo_number: 'ที่ ศธ 04225/15',
    request_date: '2026-09-05',
    pr_number: 'พด. 15/2569',
    order_number: 'คำสั่งที่ 28/2569',
    po_number: 'PO-15/2569',
    delivery_due_date: '2026-09-20',
    actual_delivery_date: '2026-09-15',
    requester_name: 'สมหมาย ใจดี',
    vendor_info: {
      name: 'บริษัท ทักษิณไอทีเทคโนโลยี จำกัด',
      tax_id: '0935560001234',
      phone: '074-689000',
      address: 'ต.ควนมะพร้าว อ.เมือง จ.พัทลุง'
    },
    committee_members: [
      { name: 'ประสิทธิ์ มั่นคง', role: 'ประธานกรรมการตรวจรับ' },
      { name: 'สุดา จันทร์สว่าง', role: 'กรรมการตรวจรับ' },
      { name: 'วิชาญ ชำนาญการ', role: 'กรรมการตรวจรับ' }
    ],
    items: [
      { item_name: 'คอมพิวเตอร์ประมวลผล All-in-One Core i5', quantity: 2, unit: 'ชุด', unit_price: 19500, total_price: 39000 },
      { item_name: 'เครื่องพิมพ์ Multifunction Ink Tank', quantity: 1, unit: 'เครื่อง', unit_price: 6500, total_price: 6500 },
      { item_name: 'เครื่องสำรองไฟฟ้า UPS 800VA', quantity: 2, unit: 'เครื่อง', unit_price: 1500, total_price: 3000 }
    ],
    created_at: '2026-09-05T09:15:00Z'
  },
  {
    id: 'demo-3',
    pcid: 'PRC-FY2569-00003',
    title: 'จ้างเหมาบริการนักการภารโรง ประจำปีงบประมาณ 2569 (ว.877 บุคคลธรรมดา 12 เดือน)',
    category: 'service_12m',
    policy_code: 'W877',
    estimated_amount: 108000,
    final_amount: 108000,
    current_gate: 3,
    status: 'pending_approval',
    fiscal_year: '2569',
    academic_year: '2569',
    memo_number: 'ที่ ศธ 04225/18',
    request_date: '2026-09-10',
    pr_number: 'พด. 18/2569',
    order_number: 'คำสั่งที่ 35/2569',
    po_number: 'PO-18/2569',
    requester_name: 'วิชาญ ชำนาญการ',
    vendor_info: {
      name: 'นายวินัย ขยันงาน (ผู้รับจ้างเหมาบริการ)',
      tax_id: '3930400123456',
      phone: '081-2345678'
    },
    committee_members: [
      { name: 'ประสิทธิ์ มั่นคง', role: 'ผู้ตรวจรับพัสดุ' }
    ],
    items: [
      { item_name: 'จ้างเหมาบริการทำความสะอาดและดูแลรักษาอาคารสถานที่ (เดือนละ 9,000 บาท x 12 เดือน)', quantity: 12, unit: 'งวด', unit_price: 9000, total_price: 108000 }
    ],
    created_at: '2026-09-10T10:00:00Z'
  },
  {
    id: 'demo-4',
    pcid: 'PRC-FY2569-00004',
    title: 'จ้างปรับปรุงซ่อมแซมฝ้าเพดานและทาสีอาคารเรียน ป.1ข (ว.523 Factor F งานอาคาร)',
    category: 'construction',
    policy_code: 'W523',
    estimated_amount: 185000,
    final_amount: 185000,
    current_gate: 2,
    status: 'pending_approval',
    fiscal_year: '2569',
    academic_year: '2569',
    memo_number: 'ที่ ศธ 04225/20',
    request_date: '2026-09-14',
    pr_number: 'พด. 20/2569',
    requester_name: 'ประสิทธิ์ มั่นคง',
    vendor_info: {
      name: 'ห้างหุ้นส่วนจำกัด พัทลุงการช่าง 2026',
      tax_id: '0933560007890'
    },
    committee_members: [
      { name: 'วิชาญ ชำนาญการ', role: 'ประธานกรรมการตรวจรับ' },
      { name: 'สุดา จันทร์สว่าง', role: 'กรรมการตรวจรับ' },
      { name: 'สมหมาย ใจดี', role: 'ผู้ควบคุมงาน' }
    ],
    items: [
      { item_name: 'งานรื้อถอนฝ้าเพดานชำรุดและโครงคร่าวเดิม', quantity: 240, unit: 'ตร.ม.', unit_price: 85, total_price: 20400 },
      { item_name: 'งานติดตั้งฝ้าเพดานยิปซัมบอร์ด 9 มม. ฉาบเรียบโครงเหล็กชุบสังกะสี', quantity: 240, unit: 'ตร.ม.', unit_price: 320, total_price: 76800 },
      { item_name: 'งานขูดลอกสีเดิมและทาสีน้ำพลาสติกอาคารเรียน (รวมค่า Factor F)', quantity: 480, unit: 'ตร.ม.', unit_price: 182.91, total_price: 87800 }
    ],
    created_at: '2026-09-14T11:20:00Z'
  },
  {
    id: 'demo-admin',
    pcid: 'PRC-FY2569-00005',
    title: 'จ้างเหมาบริการปฏิบัติงานธุรการโรงเรียน ประจำปีงบประมาณ 2569 (ว.877 บุคคลธรรมดา 12 เดือน)',
    category: 'service_12m',
    policy_code: 'W877',
    estimated_amount: 180000,
    final_amount: 180000,
    current_gate: 4,
    status: 'delivered',
    fiscal_year: '2569',
    academic_year: '2569',
    memo_number: 'ที่ ศธ 04225/19',
    request_date: '2026-09-08',
    pr_number: 'พด. 19/2569',
    order_number: 'คำสั่งที่ 36/2569',
    po_number: 'PO-19/2569',
    requester_name: 'วิชาญ ชำนาญการ',
    vendor_info: {
      name: 'นางสาวกัญญาภัทร เอกสารดี (ผู้รับจ้างเหมาบริการธุรการ)',
      tax_id: '1930100456789',
      phone: '089-7654321',
      address: 'ต.ควนโคกยา อ.เขาชัยสน จ.พัทลุง'
    },
    committee_members: [
      { name: 'รัตนา สุขใจ', role: 'ผู้ตรวจรับพัสดุ' }
    ],
    items: [
      { item_name: 'จ้างเหมาบริการปฏิบัติงานธุรการ สารบรรณ และข้อมูลสารสนเทศ DMC/CCT (เดือนละ 15,000 บาท x 12 เดือน)', quantity: 12, unit: 'งวด', unit_price: 15000, total_price: 180000 }
    ],
    custom_clauses: `ขอบเขตของงานจ้างเหมาบริการ (TOR) ตำแหน่ง เจ้าหน้าที่ธุรการโรงเรียน:
1. งานธุรการ สารบรรณ จัดเก็บเอกสาร หลักฐาน ทะเบียน และหนังสือราชการต่างๆ ทั้งระบบ e-office และการทำลายเอกสาร
2. งานพัสดุ จัดลงทะเบียน คุมการเบิกจ่าย การจัดเก็บ รักษาดูแลความเป็นระเบียบเรียบร้อยของทรัพย์สินโรงเรียน
3. งานข้อมูลสารสนเทศทางการศึกษา จัดระบบทะเบียน สำรวจ บันทึก และจัดทำรายงานข้อมูลในระบบ ICT (DMC, CCT ปัจจัยพื้นฐานนักเรียนยากจน, EMIS, B-OBEC)
4. งานการเงินและบัญชี หรือภารกิจสนับสนุนการจัดการเรียนการสอนตามที่สถานศึกษาได้รับมอบหมาย`,
    created_at: '2026-09-08T09:00:00Z'
  }
];

export default function Procurement() {
  const { user } = useAuth();
  const [view, setView] = useState<'dashboard' | 'wizard' | 'detail' | 'registry'>('dashboard');
  const [loading, setLoading] = useState<boolean>(true);

  // Core Data State
  const [cases, setCases] = useState<any[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [selectedCaseData, setSelectedCaseData] = useState<any | null>(null);
  const [selectedCaseItems, setSelectedCaseItems] = useState<any[]>([]);
  const [selectedCaseLogs, setSelectedCaseLogs] = useState<any[]>([]);

  // Auxiliary State
  const [teachers, setTeachers] = useState<any[]>(DEMO_TEACHERS);
  const [budgets, setBudgets] = useState<any[]>(DEMO_BUDGETS);
  const [settings, setSettings] = useState<any | null>({
    school_name: 'โรงเรียนบ้านควนโคกยา',
    department: 'งานบริหารทั่วไปและพัสดุ',
    director_name: 'นายไพโรจน์ มากแก้ว'
  });

  // Filter & Search State
  const [selectedGate, setSelectedGate] = useState<number | null>(null);
  const [selectedPolicy, setSelectedPolicy] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');

  useEffect(() => {
    fetchInitialData();
  }, []);

  async function fetchInitialData() {
    setLoading(true);
    try {
      const [teachRes, budRes, setRes] = await Promise.all([
        supabase.from('teachers').select('*').order('first_name'),
        supabase.from('budget_allocations').select('*'),
        supabase.from('settings').select('*').limit(1).maybeSingle()
      ]);

      if (teachRes.data && teachRes.data.length > 0) setTeachers(teachRes.data);
      if (budRes.data && budRes.data.length > 0) setBudgets(budRes.data);
      if (setRes.data) setSettings(setRes.data);

      await fetchCases();
    } catch (err) {
      console.warn('Procurement: Running in Offline Resilient Mode.');
      await fetchCases();
    } finally {
      setLoading(false);
    }
  }

  async function fetchCases() {
    try {
      // ดึงเคสจาก localStorage
      const localStored = localStorage.getItem('local_procurement_cases');
      let localList: any[] = localStored ? JSON.parse(localStored) : [];

      // จัดการเคสตัวอย่าง (Demo Cases)
      const dismissedDemos: string[] = JSON.parse(localStorage.getItem('dismissed_demo_cases') || '[]');
      const hideAllDemos = localStorage.getItem('hide_all_demo_cases') === 'true';
      const activeDemoCases = hideAllDemos 
        ? [] 
        : INITIAL_DEMO_CASES.filter(c => !dismissedDemos.includes(c.id));

      // 1. ลองดึงจาก procurement_cases ใน Supabase
      const { data, error } = await supabase
        .from('procurement_cases')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && data && data.length > 0) {
        const enriched = data.map((c: any) => {
          const t = teachers.find(x => x.id === c.requester_id);
          return {
            ...c,
            requester_name: t ? `${t.first_name} ${t.last_name}` : c.requester_name || ''
          };
        });
        // รวมกับ localList และ activeDemoCases
        setCases([...localList, ...enriched, ...activeDemoCases]);
        return;
      }

      // 2. ถ้า Supabase ยังไม่มีข้อมูล หรือ Offline ให้ใช้ activeDemoCases รวมกับ localList
      const combined = [...localList, ...activeDemoCases];
      setCases(combined);
    } catch (e) {
      console.warn('Procurement: Using local demo cases.');
      const localStored = localStorage.getItem('local_procurement_cases');
      const localList: any[] = localStored ? JSON.parse(localStored) : [];
      const dismissedDemos: string[] = JSON.parse(localStorage.getItem('dismissed_demo_cases') || '[]');
      const hideAllDemos = localStorage.getItem('hide_all_demo_cases') === 'true';
      const activeDemoCases = hideAllDemos ? [] : INITIAL_DEMO_CASES.filter(c => !dismissedDemos.includes(c.id));
      setCases([...localList, ...activeDemoCases]);
    }
  }

  async function handleSelectCase(caseId: string) {
    setSelectedCaseId(caseId);
    setLoading(true);
    try {
      // 1. ลองหาใน Supabase
      const { data: cData } = await supabase
        .from('procurement_cases')
        .select('*')
        .eq('id', caseId)
        .maybeSingle();

      if (cData) {
        setSelectedCaseData(cData);
        const { data: itData } = await supabase
          .from('procurement_case_items')
          .select('*')
          .eq('case_id', caseId);
        setSelectedCaseItems(itData || []);

        const { data: logData } = await supabase
          .from('procurement_case_audit_logs')
          .select('*')
          .eq('case_id', caseId)
          .order('created_at', { ascending: true });
        setSelectedCaseLogs(logData || []);
      } else {
        // 2. หาใน Local Cases / Demo Cases
        const localCase = cases.find(c => c.id === caseId);
        setSelectedCaseData(localCase || null);
        setSelectedCaseItems(localCase?.items || []);
        setSelectedCaseLogs([
          { gate: 1, action: 'CASE_CREATED', actor_name: localCase?.requester_name || 'เจ้าหน้าที่', created_at: localCase?.created_at }
        ]);
      }
      setView('detail');
    } catch (e) {
      const localCase = cases.find(c => c.id === caseId);
      setSelectedCaseData(localCase || null);
      setSelectedCaseItems(localCase?.items || []);
      setView('detail');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateCase(caseData: any, items: any[]) {
    try {
      let errorMsg = '';
      let savedToDb = false;

      // 1. พยายามบันทึกไปยัง Supabase
      try {
        const { data: newCase, error: caseErr } = await supabase
          .from('procurement_cases')
          .insert(caseData)
          .select()
          .single();

        if (caseErr) {
          console.error('[PROCUREMENT DB INSERT ERROR]', caseErr);
          errorMsg = caseErr.message;
        } else if (newCase) {
          savedToDb = true;
          if (items.length > 0) {
            const itemRows = items.map(it => ({
              case_id: newCase.id,
              item_name: it.item_name,
              specification: it.specification || '',
              quantity: it.quantity,
              unit: it.unit,
              unit_price: it.unit_price,
              total_price: it.total_price
            }));
            const { error: itemsErr } = await supabase.from('procurement_case_items').insert(itemRows);
            if (itemsErr) {
              console.error('[PROCUREMENT ITEMS INSERT ERROR]', itemsErr);
            }
          }
        }
      } catch (err: any) {
        console.error('[PROCUREMENT EXCEPTION]', err);
        savedToDb = false;
        errorMsg = err.message;
      }

      if (!savedToDb) {
        // บันทึกสำรองใน LocalStorage กรณีออฟไลน์
        const localStored = localStorage.getItem('local_procurement_cases');
        const localList: any[] = localStored ? JSON.parse(localStored) : [];
        const newLocalCase = {
          ...caseData,
          id: `local-${Date.now()}`,
          items: items,
          created_at: new Date().toISOString()
        };
        localList.unshift(newLocalCase);
        localStorage.setItem('local_procurement_cases', JSON.stringify(localList));
      }

      await fetchCases();
      if (savedToDb) {
        alert('บันทึกเปิดสำนวนจัดซื้อจัดจ้างลงฐานข้อมูลสำเร็จเรียบร้อยแล้วค่ะ');
      } else {
        alert(`บันทึกเปิดสำนวนจัดซื้อจัดจ้างสำเร็จเรียบร้อย! (โหมดทดสอบออฟไลน์: ${errorMsg || 'ฐานข้อมูลขัดข้อง'})`);
      }
    } catch (e: any) {
      console.error(e);
      alert(`บันทึกไม่สำเร็จ: ${e.message}`);
    }
  }

  async function handleUpdateCase(updates: any) {
    if (!selectedCaseId) return;
    try {
      // 1. พยายามอัปเดต Supabase
      try {
        await supabase
          .from('procurement_cases')
          .update(updates)
          .eq('id', selectedCaseId);
      } catch {}

      // 2. อัปเดตใน LocalStorage
      const localStored = localStorage.getItem('local_procurement_cases');
      if (localStored) {
        const localList: any[] = JSON.parse(localStored);
        const idx = localList.findIndex(c => c.id === selectedCaseId);
        if (idx !== -1) {
          localList[idx] = { ...localList[idx], ...updates };
          localStorage.setItem('local_procurement_cases', JSON.stringify(localList));
        }
      }

      // 3. อัปเดตใน State
      setSelectedCaseData((prev: any) => ({ ...prev, ...updates }));
      setCases(prev => prev.map(c => c.id === selectedCaseId ? { ...c, ...updates } : c));
    } catch (e) {
      console.error('Update case error:', e);
    }
  }

  async function handleDeleteCase(caseId: string) {
    if (!confirm('คุณแน่ใจหรือไม่ว่าต้องการลบสำนวนจัดซื้อจัดจ้างนี้? ข้อมูลที่ลบจะไม่สามารถกู้คืนได้')) {
      return;
    }

    try {
      // 1. กรณีเป็นเคสตัวอย่าง (Demo Case)
      if (caseId.startsWith('demo-')) {
        const dismissedDemos: string[] = JSON.parse(localStorage.getItem('dismissed_demo_cases') || '[]');
        if (!dismissedDemos.includes(caseId)) {
          dismissedDemos.push(caseId);
          localStorage.setItem('dismissed_demo_cases', JSON.stringify(dismissedDemos));
        }
      }

      // 2. กรณีเป็นเคสใน LocalStorage
      const localStored = localStorage.getItem('local_procurement_cases');
      if (localStored) {
        let localList: any[] = JSON.parse(localStored);
        localList = localList.filter(c => c.id !== caseId);
        localStorage.setItem('local_procurement_cases', JSON.stringify(localList));
      }

      // 3. กรณีเป็นเคสใน Supabase (Cascade delete เฉพาะกรณีเป็น UUID จริง)
      const isRealUUID = typeof caseId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(caseId);
      if (isRealUUID) {
        try {
          await supabase.from('procurement_case_items').delete().eq('case_id', caseId);
          await supabase.from('procurement_case_audit_logs').delete().eq('case_id', caseId);
          await supabase.from('procurement_case_milestones').delete().eq('case_id', caseId);
          await supabase.from('procurement_cases').delete().eq('id', caseId);
        } catch (err) {
          console.warn('Supabase delete error:', err);
        }
      }

      // 4. อัปเดต State หน้าจอ
      setCases(prev => prev.filter(c => c.id !== caseId));
      if (selectedCaseId === caseId) {
        setSelectedCaseId(null);
        setSelectedCaseData(null);
        setView('dashboard');
      }
      alert('ลบสำนวนจัดซื้อจัดจ้างเรียบร้อยแล้ว');
    } catch (e: any) {
      console.error(e);
      alert(`ลบไม่สำเร็จ: ${e.message}`);
    }
  }

  function handleClearAllDemos() {
    if (!confirm('ยืนยันล้างข้อมูลสำนวนตัวอย่างทั้งหมดใช่หรือไม่? (ระบบจะเข้าสู่สถานะพร้อมใช้งานจริง)')) {
      return;
    }
    localStorage.setItem('hide_all_demo_cases', 'true');
    fetchCases();
    alert('ล้างข้อมูลสำนวนตัวอย่างทั้งหมดเรียบร้อยแล้ว');
  }

  function handleRestoreDemos() {
    localStorage.removeItem('hide_all_demo_cases');
    localStorage.removeItem('dismissed_demo_cases');
    fetchCases();
    alert('โหลดสำนวนตัวอย่างทั้ง 4 คดีหลักกลับคืนมาแล้ว');
  }

  // เตรียมข้อมูลสำหรับพิมพ์เอกสาร
  function preparePrintData(c: any, its: any[], includeSignatures: boolean = true): ProcurementDocData {
    const requester = teachers.find(t => t.id === c.requester_id);
    const officer = teachers.find(t => t.id === c.officer_id);
    const headOfficer = teachers.find(t => t.id === c.head_officer_id);

    return {
      school_name: settings?.school_name || 'โรงเรียนบ้านควนโคกยา',
      department: settings?.department || 'งานบริหารทั่วไปและพัสดุ',
      pcid: c.pcid,
      title: c.title,
      policy_code: c.policy_code || 'W089',
      memo_number: c.memo_number || 'ที่ ศธ 04225/1',
      request_date: c.request_date || new Date().toISOString().split('T')[0],
      pr_number: c.pr_number || 'พด. 1/2569',
      pr_date: c.pr_approval_date || c.request_date,
      order_number: c.order_number || 'คำสั่งที่ 1/2569',
      order_date: c.order_appointment_date || c.request_date,
      po_number: c.po_number || 'PO-1/2569',
      po_date: c.po_date || c.request_date,
      delivery_due_date: c.delivery_due_date || '',
      actual_delivery_date: c.actual_delivery_date || '',
      inspection_number: c.inspection_number || 'ตรวจรับ 1/2569',
      inspection_date: c.inspection_date || '',
      disbursement_date: c.disbursement_date || '',
      estimated_amount: Number(c.estimated_amount) || 0,
      final_amount: Number(c.final_amount) || Number(c.estimated_amount) || 0,
      requester_name: requester ? `${requester.first_name} ${requester.last_name}` : c.requester_name || 'ครูผู้ขอ',
      requester_position: requester?.position || 'ครู',
      officer_name: officer ? `${officer.first_name} ${officer.last_name}` : 'เจ้าหน้าที่',
      officer_position: officer?.position || 'เจ้าหน้าที่',
      head_officer_name: headOfficer ? `${headOfficer.first_name} ${headOfficer.last_name}` : 'หัวหน้าเจ้าหน้าที่',
      head_officer_position: headOfficer?.position || 'หัวหน้าเจ้าหน้าที่',
      director_name: settings?.director_name || 'ผู้อำนวยการโรงเรียน',
      director_position: `ผู้อำนวยการ${settings?.school_name || 'โรงเรียนบ้านควนโคกยา'}`,
      director_signature_url: includeSignatures ? settings?.director_signature_url : undefined,
      school_stamp_url: includeSignatures ? settings?.school_logo_url : undefined,
      include_signatures: includeSignatures,
      vendor_info: c.vendor_info || { name: 'ผู้ขาย' },
      committee_members: (c.committee_members && c.committee_members.length > 0)
        ? c.committee_members
        : [{ name: 'ครูผู้ตรวจรับ', role: 'ผู้ตรวจรับพัสดุ', position: 'ครู' }],
      items: (its && its.length > 0)
        ? its.map(it => ({
            item_name: it.item_name,
            specification: it.specification,
            quantity: Number(it.quantity) || 1,
            unit: it.unit || 'รายการ',
            unit_price: Number(it.unit_price) || 0,
            total_price: Number(it.total_price) || 0
          }))
        : [{ item_name: c.title, quantity: 1, unit: 'งาน', unit_price: c.estimated_amount, total_price: c.estimated_amount }],
      custom_clauses: c.custom_clauses
    };
  }

  function handlePrintDoc(docType: string, includeSignatures: boolean = true) {
    if (!selectedCaseData) return;
    const printData = preparePrintData(selectedCaseData, selectedCaseItems, includeSignatures);
    let html = '';
    let docTitle = '';

    switch (docType) {
      case 'request_memo':
        html = ProcurementDocGenerator.renderRequestMemo(printData);
        docTitle = `บันทึกขออนุมัติจัดซื้อ_${printData.pcid}`;
        break;
      case 'report_clause_22':
        html = ProcurementDocGenerator.renderReportClause22(printData);
        docTitle = `รายงานขอซื้อข้อ22_${printData.pcid}`;
        break;
      case 'appointment_order':
        html = ProcurementDocGenerator.renderAppointmentOrder(printData);
        docTitle = `คำสั่งแต่งตั้งกรรมการ_${printData.pcid}`;
        break;
      case 'po_order':
        if (printData.policy_code === 'W877') {
          html = ProcurementDocGenerator.renderW877Agreement(printData);
          docTitle = `ข้อตกลงจ้างเหมาบริการว877_${printData.pcid}`;
        } else {
          html = ProcurementDocGenerator.renderPO(printData);
          docTitle = `ใบสั่งซื้อPO_${printData.pcid}`;
        }
        break;
      case 'inspection_report':
        if (printData.policy_code === 'W877') {
          html = ProcurementDocGenerator.renderW877MonthlyInspection(printData);
          docTitle = `ใบตรวจรับงานจ้างรายเดือน_${printData.pcid}`;
        } else {
          html = ProcurementDocGenerator.renderInspectionCertificate(printData);
          docTitle = `ใบตรวจรับพัสดุ_${printData.pcid}`;
        }
        break;
      default:
        html = ProcurementDocGenerator.renderRequestMemo(printData);
        docTitle = `เอกสารพัสดุ_${printData.pcid}`;
    }

    ProcurementDocGenerator.printHtml(html, docTitle);
  }

  function handlePrintBundle(targetCase?: any, includeSignatures: boolean = true) {
    const c = targetCase || selectedCaseData;
    if (!c) return;

    let itemsForPrint = selectedCaseItems;
    if (targetCase && targetCase.id !== selectedCaseId) {
      itemsForPrint = c.items || [{ item_name: c.title, quantity: 1, unit: 'งาน', unit_price: c.estimated_amount, total_price: c.estimated_amount }];
    }

    const printData = preparePrintData(c, itemsForPrint, includeSignatures);
    ProcurementDocGenerator.printBundle(printData);
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Top Level Navigation Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView('dashboard')}
            className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all cursor-pointer ${
              view === 'dashboard' || view === 'detail' || view === 'wizard'
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
            }`}
          >
            <span>📋 แฟ้มสำนวนจัดซื้อจัดจ้าง (Procurement Cases)</span>
          </button>
          <button
            onClick={() => setView('registry')}
            className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all cursor-pointer ${
              view === 'registry'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
            }`}
          >
            <span>🏷️ ระบบทะเบียนคุมพัสดุและครุภัณฑ์ (Asset & Supplies)</span>
          </button>
        </div>
      </div>

      {view === 'dashboard' && (
        <ProcurementDashboard
          cases={cases}
          loading={loading}
          selectedGate={selectedGate}
          selectedPolicy={selectedPolicy}
          searchTerm={searchTerm}
          hasDemoCases={cases.some(c => c.id.startsWith('demo-'))}
          onClearAllDemos={handleClearAllDemos}
          onRestoreDemos={handleRestoreDemos}
          onDeleteCase={handleDeleteCase}
          onSelectGate={setSelectedGate}
          onSelectPolicy={setSelectedPolicy}
          onSearchChange={setSearchTerm}
          onOpenWizard={() => setView('wizard')}
          onSelectCase={handleSelectCase}
          onQuickPrint={(caseItem) => handlePrintBundle(caseItem)}
        />
      )}

      {view === 'detail' && selectedCaseData && (
        <ProcurementCaseDetail
          caseData={selectedCaseData}
          items={selectedCaseItems}
          auditLogs={selectedCaseLogs}
          onBack={() => setView('dashboard')}
          onUpdateCase={handleUpdateCase}
          onDeleteCase={handleDeleteCase}
          onPrintDoc={(docType, incSig) => handlePrintDoc(docType, incSig)}
          onPrintBundle={(incSig) => handlePrintBundle(selectedCaseData, incSig)}
        />
      )}

      {view === 'wizard' && (
        <ProcurementWizard
          teachers={teachers}
          budgets={budgets}
          onClose={() => setView('dashboard')}
          onSubmit={handleCreateCase}
        />
      )}

      {view === 'registry' && (
        <AssetSuppliesRegistry
          onBack={() => setView('dashboard')}
          teachers={teachers}
        />
      )}
    </div>
  );
}
