import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { 
  FileText, Printer, Calendar, Download, RefreshCw, 
  CheckCircle, Clock, Users, Inbox, Send, Award, 
  ChevronRight, AlertCircle, BarChart3, Filter, UserCheck
} from 'lucide-react';
import { AnnualSarabanService, type AnnualSarabanOverview, type StaffWorkloadSummary } from '../services/annualSarabanService';
import garuda15mm from '../assets/saraban/garuda-1.5cm.png';

export default function AnnualSarabanReport() {
  const currentYearInt = new Date().getFullYear() + 543;
  const [selectedYear, setSelectedYear] = useState<number>(currentYearInt);
  const [reportType, setReportType] = useState<'calendar' | 'fiscal'>('calendar');
  const [activeTab, setActiveTab] = useState<'cover' | 'incoming' | 'workload' | 'memos' | 'outgoing' | 'orders'>('cover');
  const [loading, setLoading] = useState<boolean>(true);

  // ข้อมูลสถิติ
  const [overview, setOverview] = useState<AnnualSarabanOverview>({
    docYear: currentYearInt,
    incomingCount: 0,
    outgoingCount: 0,
    memoCount: 0,
    orderCount: 0,
    totalCount: 0
  });

  const [workloadList, setWorkloadList] = useState<StaffWorkloadSummary[]>([]);
  const [incomingDocs, setIncomingDocs] = useState<any[]>([]);
  const [memos, setMemos] = useState<any[]>([]);
  const [outgoingDocs, setOutgoingDocs] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [teachersList, setTeachersList] = useState<any[]>([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>('');

  // ข้อมูลปรับแต่งในบันทึกข้อความปะหน้า
  const [memoSubject, setMemoSubject] = useState<string>('รายงานสรุปผลการดำเนินงานสารบรรณอิเล็กทรอนิกส์');
  const [memoDocNumber, setMemoDocNumber] = useState<string>('');
  const [memoDate, setMemoDate] = useState<string>('');
  const [memoCustomNote, setMemoCustomNote] = useState<string>('');
  const [memoOfficerName, setMemoOfficerName] = useState<string>('เจ้าหน้าที่งานสารบรรณ');
  const [memoOfficerPos, setMemoOfficerPos] = useState<string>('ครูผู้รับผิดชอบงานสารบรรณ');

  useEffect(() => {
    fetchSettings();
    loadAllData();
  }, [selectedYear]);

  async function fetchSettings() {
    try {
      const { data } = await supabase.from('settings').select('*').limit(1).maybeSingle();
      if (data) {
        setSettings(data);
      }
    } catch (err) {
      console.error('Error fetching settings:', err);
    }
  }

  async function loadAllData() {
    setLoading(true);
    try {
      // 1. ดึงภาพรวมและภาระงานจาก RPC
      const [overviewData, workloadData] = await Promise.all([
        AnnualSarabanService.getOverview(selectedYear),
        AnnualSarabanService.getStaffWorkload(selectedYear)
      ]);
      setOverview(overviewData);
      setWorkloadList(workloadData);

      // 2. ดึงรายชื่อครูและบุคลากรสำหรับเลือกผู้จัดทำรายงาน
      const { data: tData, error: tErr } = await supabase
        .from('teachers')
        .select('id, prefix, first_name, last_name, position, department')
        .order('first_name', { ascending: true });
      
      if (tErr) {
        console.error('Error fetching teachers for report:', tErr);
      } else if (tData && tData.length > 0) {
        setTeachersList(tData);
        // เลือกอัตโนมัติหากยังไม่เคยเลือก: หาครูสารบรรณ หรือนายไพโรจน์ หรือครูคนแรก
        if (!selectedTeacherId) {
          const defaultStaff = tData.find(t => 
            (t.position && t.position.includes('สารบรรณ')) || 
            (t.first_name && t.first_name.includes('ไพโรจน์'))
          ) || tData[0];
          
          if (defaultStaff) {
            setSelectedTeacherId(defaultStaff.id);
            setMemoOfficerName(`${defaultStaff.prefix || ''}${defaultStaff.first_name} ${defaultStaff.last_name}`.trim());
            setMemoOfficerPos(defaultStaff.position || 'ครูผู้รับผิดชอบงานสารบรรณ');
          }
        }
      }

      // 3. ดึงข้อมูลรายการหนังสือรับ (Incoming Docs) พร้อมข้อมูลผู้รับมอบหมาย และ remark (สำหรับเลขหนังสือต้นทาง)
      const { data: incData } = await supabase
        .from('incoming_docs')
        .select(`
          id, doc_sequence, doc_number, doc_date, subject, from_agency, urgency, status, created_at, remark,
          doc_assignments (
            id, status, instruction,
            teachers:assignee_id (prefix, first_name, last_name, position)
          )
        `)
        .or(`doc_year.eq.${selectedYear}`)
        .order('doc_sequence', { ascending: true });

      setIncomingDocs(incData || []);

      // 4. ดึงข้อมูลบันทึกข้อความ (Memos)
      const { data: memoData } = await supabase
        .from('memos')
        .select('id, doc_sequence, memo_number, memo_date, subject, requester, department, status')
        .or(`doc_year.eq.${selectedYear}`)
        .order('doc_sequence', { ascending: true });

      setMemos(memoData || []);

      // 5. ดึงข้อมูลหนังสือส่ง (Outgoing Docs)
      const { data: outData } = await supabase
        .from('outgoing_docs')
        .select('id, doc_sequence, doc_number, doc_date, subject, to_agency, status')
        .or(`doc_year.eq.${selectedYear}`)
        .order('doc_sequence', { ascending: true });

      setOutgoingDocs(outData || []);

      // 6. ดึงข้อมูลคำสั่งโรงเรียน (Orders)
      const { data: orderData, error: ordErr } = await supabase
        .from('orders')
        .select('id, doc_sequence, order_number, order_date, subject, issuer, status')
        .or(`doc_year.eq.${selectedYear}`)
        .order('doc_sequence', { ascending: true });

      if (ordErr) {
        console.error('Error fetching orders for report:', ordErr);
      }
      setOrders(orderData || []);

    } catch (error) {
      console.error('Error loading saraban annual report:', error);
    } finally {
      setLoading(false);
    }
  }

  // ฟังก์ชันเลือกครูผู้จัดทำรายงาน
  const handleTeacherSelect = (tId: string) => {
    setSelectedTeacherId(tId);
    if (!tId) return;
    const found = teachersList.find(t => t.id === tId);
    if (found) {
      const fullName = `${found.prefix || ''}${found.first_name} ${found.last_name}`.trim();
      setMemoOfficerName(fullName);
      setMemoOfficerPos(found.position || 'ครูผู้รับผิดชอบงานสารบรรณ');
    }
  };

  // ฟังก์ชันดึงเลขที่หนังสือต้นทางและวันที่ลงในหนังสือจาก remark
  const parseSenderInfo = (remark: any) => {
    if (!remark) return { senderDocNo: '-', senderDocDate: '' };
    try {
      const data = typeof remark === 'string' ? JSON.parse(remark) : remark;
      const docNo = data.sender_doc_number || data.sender_doc_no || '-';
      const docDate = data.sender_doc_date || data.sender_date || '';
      return { senderDocNo: docNo, senderDocDate: docDate };
    } catch {
      return { senderDocNo: '-', senderDocDate: '' };
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const schoolName = settings?.school_name || 'โรงเรียนบ้านควนโคกยา';

  // แปลงตัวเลขเป็นเลขไทยสำหรับเอกสารทางการ
  const toThaiNumber = (num: number | string) => {
    const thaiDigits = ['๐', '๑', '๒', '๓', '๔', '๕', '๖', '๗', '๘', '๙'];
    return String(num).replace(/[0-9]/g, d => thaiDigits[parseInt(d, 10)]);
  };

  // เลขที่หนังสือปะหน้า: พิเศษ/ปี พ.ศ. (เช่น พิเศษ/๒๕๖๙)
  const defaultMemoDocNumber = `พิเศษ/${toThaiNumber(selectedYear)}`;
  const currentMemoDocNo = memoDocNumber || defaultMemoDocNumber;

  // จัดรูปแบบวันที่ไทย
  const formatThaiDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    try {
      const d = new Date(dateStr);
      const day = d.getDate();
      const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
      const month = months[d.getMonth()];
      const year = d.getFullYear() + 543;
      return `${day} ${month} ${year}`;
    } catch {
      return dateStr;
    }
  };

  // จัดรูปแบบวันที่ไทยแบบเต็มสำหรับบันทึกข้อความ
  const formatMemoFullDate = () => {
    const monthsFull = [
      'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
      'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
    ];
    const today = new Date();
    return `${toThaiNumber(today.getDate())} ${monthsFull[today.getMonth()]} ${toThaiNumber(selectedYear || (today.getFullYear() + 543))}`;
  };
  const currentMemoDate = memoDate || formatMemoFullDate();

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto min-h-screen text-slate-800 print:p-0 print:m-0 print:max-w-none print:w-full">
      {/* ส่วนควบคุมและตัวกรอง (ไม่แสดงเมื่อพิมพ์) */}
      <div className="print:hidden space-y-6">
        {/* หัวเรื่อง */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div>
            <div className="flex items-center gap-2 text-indigo-600 font-semibold mb-1">
              <Award className="w-5 h-5" />
              <span>ระบบบริหารจัดการสารบรรณอิเล็กทรอนิกส์</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900">
              รายงานสรุปงานสารบรรณประจำปี พ.ศ. {selectedYear}
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              ชุดรายงานราชการประจำปีพร้อมบันทึกข้อความปะหน้า ทะเบียนทุกหมวด และสรุปการกระจายภาระงานรายบุคคลเสนอ ผู้อำนวยการโรงเรียน
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* เลือกปี พ.ศ. */}
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-300 rounded-xl px-3 py-2">
              <Calendar className="w-4 h-4 text-slate-500" />
              <span className="text-sm font-medium text-slate-600">ประจำปี พ.ศ.</span>
              <select 
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="bg-transparent font-bold text-indigo-700 outline-none cursor-pointer"
              >
                {[currentYearInt + 1, currentYearInt, currentYearInt - 1, currentYearInt - 2, currentYearInt - 3].map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>

            {/* ปุ่มรีเฟรช */}
            <button 
              onClick={loadAllData}
              disabled={loading}
              className="p-2.5 text-slate-600 hover:text-indigo-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition"
              title="รีเฟรชข้อมูล"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin text-indigo-600' : ''}`} />
            </button>

            {/* ปุ่มพิมพ์ชุดรายงาน A4 */}
            <button 
              onClick={handlePrint}
              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl shadow-sm transition active:scale-95 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>พิมพ์ชุดรายงาน A4</span>
            </button>
          </div>
        </div>

        {/* สรุปตัวชี้วัด 4 หมวด (Executive KPI Cards) */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Inbox className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">ทะเบียนหนังสือรับ</p>
              <h3 className="text-2xl font-bold text-slate-900">{overview.incomingCount} <span className="text-xs font-normal text-slate-400">เรื่อง</span></h3>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Send className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">ทะเบียนหนังสือส่ง</p>
              <h3 className="text-2xl font-bold text-slate-900">{overview.outgoingCount} <span className="text-xs font-normal text-slate-400">เรื่อง</span></h3>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">บันทึกข้อความ</p>
              <h3 className="text-2xl font-bold text-slate-900">{overview.memoCount} <span className="text-xs font-normal text-slate-400">ฉบับ</span></h3>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
              <Award className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">คำสั่งโรงเรียน</p>
              <h3 className="text-2xl font-bold text-slate-900">{overview.orderCount} <span className="text-xs font-normal text-slate-400">ฉบับ</span></h3>
            </div>
          </div>

          <div className="col-span-2 lg:col-span-1 bg-gradient-to-br from-indigo-600 to-indigo-800 p-5 rounded-2xl shadow-sm text-white flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center">
              <BarChart3 className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-xs text-indigo-200 font-medium">รวมงานสารบรรณทั้งสิ้น</p>
              <h3 className="text-2xl font-bold text-white">{overview.totalCount} <span className="text-xs font-normal text-indigo-200">รายการ</span></h3>
            </div>
          </div>
        </div>

        {/* แถบนำทางเลือกดูเอกสารแต่ละหมวด */}
        <div className="flex border-b border-slate-200 gap-2 overflow-x-auto pb-1">
          <button 
            onClick={() => setActiveTab('cover')}
            className={`px-4 py-2.5 font-semibold text-sm rounded-xl transition flex items-center gap-2 ${
              activeTab === 'cover' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>๑. บันทึกข้อความปะหน้าเสนอ ผอ.</span>
          </button>

          <button 
            onClick={() => setActiveTab('incoming')}
            className={`px-4 py-2.5 font-semibold text-sm rounded-xl transition flex items-center gap-2 ${
              activeTab === 'incoming' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Inbox className="w-4 h-4" />
            <span>๒. ทะเบียนหนังสือรับ ({incomingDocs.length})</span>
          </button>

          <button 
            onClick={() => setActiveTab('workload')}
            className={`px-4 py-2.5 font-semibold text-sm rounded-xl transition flex items-center gap-2 ${
              activeTab === 'workload' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>๓. สรุปการกระจายภาระงานรายบุคคล ({workloadList.length})</span>
          </button>

          <button 
            onClick={() => setActiveTab('memos')}
            className={`px-4 py-2.5 font-semibold text-sm rounded-xl transition flex items-center gap-2 ${
              activeTab === 'memos' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>๔. ทะเบียนบันทึกข้อความ ({memos.length})</span>
          </button>

          <button 
            onClick={() => setActiveTab('outgoing')}
            className={`px-4 py-2.5 font-semibold text-sm rounded-xl transition flex items-center gap-2 ${
              activeTab === 'outgoing' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Send className="w-4 h-4" />
            <span>๕. ทะเบียนหนังสือส่ง ({outgoingDocs.length})</span>
          </button>

          <button 
            onClick={() => setActiveTab('orders')}
            className={`px-4 py-2.5 font-semibold text-sm rounded-xl transition flex items-center gap-2 ${
              activeTab === 'orders' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Award className="w-4 h-4" />
            <span>๖. ทะเบียนคำสั่งโรงเรียน ({orders.length})</span>
          </button>
        </div>

        {/* กล่องตั้งค่าบันทึกข้อความปะหน้า (แสดงเฉพาะเมื่อดูแท็บบันทึกข้อความปะหน้า) */}
        {activeTab === 'cover' && (
          <div className="bg-indigo-50/50 p-5 rounded-2xl border border-indigo-100 space-y-3">
            <div className="flex items-center gap-2 text-indigo-700 font-bold text-sm">
              <UserCheck className="w-4 h-4" />
              <span>กำหนดข้อมูลผู้จัดทำ/สรุปเสนอรายงาน (สำหรับลงชื่อในบันทึกข้อความปะหน้า)</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">เลขที่หนังสือ (ที่):</label>
                <input 
                  type="text" 
                  value={memoDocNumber !== '' ? memoDocNumber : defaultMemoDocNumber} 
                  onChange={(e) => setMemoDocNumber(e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm font-medium text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder={defaultMemoDocNumber}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">วันที่ (พิมพ์แก้ไขได้):</label>
                <input 
                  type="text" 
                  value={memoDate !== '' ? memoDate : formatMemoFullDate()} 
                  onChange={(e) => setMemoDate(e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm font-medium text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder={formatMemoFullDate()}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">เลือกจากรายชื่อบุคลากร:</label>
                <select 
                  value={selectedTeacherId} 
                  onChange={(e) => handleTeacherSelect(e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm font-medium text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
                >
                  <option value="">-- กำหนดเอง หรือเลือก --</option>
                  {teachersList.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.prefix || ''}{t.first_name} {t.last_name} ({t.position || 'ครู'})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">ชื่อ-สกุล ผู้จัดทำ:</label>
                <input 
                  type="text" 
                  value={memoOfficerName} 
                  onChange={(e) => setMemoOfficerName(e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm font-medium text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="เช่น นายไพโรจน์ มากแก้ว"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">ตำแหน่งผู้จัดทำ:</label>
                <input 
                  type="text" 
                  value={memoOfficerPos} 
                  onChange={(e) => setMemoOfficerPos(e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm font-medium text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="เช่น ครูผู้รับผิดชอบงานสารบรรณ"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* =========================================================================
          ส่วนแสดงผลเอกสาร (ทั้งบนหน้าจอ และในโหมด Print A4)
      ========================================================================= */}
      <div className="mt-6 bg-white p-6 md:p-12 rounded-2xl shadow-sm border border-slate-200 print:border-none print:shadow-none print:p-0 print:m-0 print:mt-0">

        {/* -----------------------------------------------------------------------
            ส่วนที่ 1: บันทึกข้อความปะหน้า (Official Memo Cover - อิงแบบฟอร์ม ร.ร.บ้านควนโคกยา 100%)
        ----------------------------------------------------------------------- */}
        <div className={`${activeTab === 'cover' ? 'block' : 'hidden print:block'} print:break-after-page font-sarabun text-slate-900 print:text-black print:p-0 print:m-0`}>
          {/* หัวครุฑ ๑.๕ ซม. ด้านซ้าย และ บันทึกข้อความ กึ่งกลางหน้ากระดาษ */}
          <div className="relative flex items-center justify-between pb-1 mb-2">
            <div className="w-16 shrink-0">
              <img 
                src={garuda15mm} 
                alt="ตราครุฑ ๑.๕ ซม." 
                className="w-[1.5cm] h-auto object-contain" 
              />
            </div>
            <div className="flex-1 text-center font-bold text-3xl tracking-wider text-slate-900 print:text-black font-sarabun mr-16">
              บันทึกข้อความ
            </div>
          </div>

          {/* ส่วนราชการ, ที่, วันที่, เรื่อง มีเส้นประใต้ข้อความตามระเบียบงานสารบรรณ */}
          <div className="space-y-1 text-[16pt] font-sarabun leading-tight">
            {/* บรรทัดที่ ๑: ส่วนราชการ (ซีกซ้าย) / โทร. (เริ่มกึ่งกลางหน้ากระดาษ ๕๐%) */}
            <div className="flex items-baseline">
              <div className="w-1/2 pr-3 flex items-baseline">
                <span className="font-bold shrink-0 mr-1.5">ส่วนราชการ</span>
                <span className="flex-1 border-b border-dotted border-slate-600 pb-0.5">{schoolName}</span>
              </div>
              <div className="w-1/2 flex items-baseline">
                <span className="font-bold shrink-0 mr-1.5">โทร.</span>
                <span className="flex-1 border-b border-dotted border-slate-600 pb-0.5">{settings?.phone_number || '-'}</span>
              </div>
            </div>

            {/* บรรทัดที่ ๒: ที่ (ซีกซ้าย) / วันที่ (เริ่มกึ่งกลางหน้ากระดาษ ๕๐% ตรงแนวเดียวกับ โทร.) */}
            <div className="flex items-baseline">
              <div className="w-1/2 pr-3 flex items-baseline">
                <span className="font-bold shrink-0 mr-1.5">ที่</span>
                <span className="flex-1 border-b border-dotted border-slate-600 pb-0.5">{currentMemoDocNo}</span>
              </div>
              <div className="w-1/2 flex items-baseline">
                <span className="font-bold shrink-0 mr-1.5">วันที่</span>
                <span className="flex-1 border-b border-dotted border-slate-600 pb-0.5">{currentMemoDate}</span>
              </div>
            </div>

            {/* บรรทัดที่ ๓: เรื่อง (เต็มบรรทัด) */}
            <div className="flex items-baseline">
              <span className="font-bold shrink-0 mr-1.5">เรื่อง</span>
              <span className="flex-1 border-b border-dotted border-slate-600 pb-0.5 font-normal">
                รายงานสรุปผลการดำเนินงานสารบรรณอิเล็กทรอนิกส์ ประจำปี พ.ศ. {toThaiNumber(selectedYear)}
              </span>
            </div>
          </div>

          {/* คำขึ้นต้น */}
          <div className="text-[16pt] font-sarabun mt-3 mb-2">
            <span className="font-bold">เรียน</span> ผู้อำนวยการ{schoolName}
          </div>

          {/* ข้อความเนื้อเรื่อง (จัดระยะบรรทัดมาตรฐานกระชับ ไม่ยืด ไม่ตกขอบ) */}
          <div className="text-[16pt] font-sarabun leading-[1.35] text-justify space-y-2 indent-12">
            <p>
              ตามที่ {schoolName} ได้พัฒนาระบบบริหารจัดการงานสารบรรณอิเล็กทรอนิกส์เพื่อยกระดับประสิทธิภาพ 
              ความรวดเร็ว และความโปร่งใสในการดำเนินงานเอกสารราชการ รวมทั้งสนับสนุนการทำงานแบบดิจิทัลอย่างครบวงจร นั้น
            </p>
            <p>
              บัดนี้ ได้สิ้นสุดรอบปีปฏิทิน พ.ศ. {toThaiNumber(selectedYear)} (ตั้งแต่วันที่ ๑ มกราคม ถึง ๓๑ ธันวาคม {toThaiNumber(selectedYear)}) 
              งานสารบรรณจึงได้ประมวลผลข้อมูลการปฏิบัติงานเอกสารราชการทั้งหมด และจัดทำชุดรายงานสรุปผลการดำเนินงานสารบรรณอิเล็กทรอนิกส์ 
              ประจำปี พ.ศ. {toThaiNumber(selectedYear)} โดยมีสถิติภาพรวมจำแนกตามประเภทเอกสาร ดังนี้
            </p>
            
            <div className="indent-0 pl-12 space-y-0.5 font-normal leading-[1.35]">
              <div>๑. ทะเบียนหนังสือรับ (หนังสือเข้า) จำนวนทั้งสิ้น <span className="font-bold">{toThaiNumber(overview.incomingCount)}</span> เรื่อง</div>
              <div>๒. ทะเบียนบันทึกข้อความ จำนวนทั้งสิ้น <span className="font-bold">{toThaiNumber(overview.memoCount)}</span> ฉบับ</div>
              <div>๓. ทะเบียนหนังสือส่ง (หนังสือออก) จำนวนทั้งสิ้น <span className="font-bold">{toThaiNumber(overview.outgoingCount)}</span> เรื่อง</div>
              <div>๔. ทะเบียนคำสั่งโรงเรียน จำนวนทั้งสิ้น <span className="font-bold">{toThaiNumber(overview.orderCount)}</span> ฉบับ</div>
              <div className="pt-0.5 font-medium">รวมงานสารบรรณที่ดำเนินการทั้งสิ้น <span className="font-bold text-indigo-900 print:text-black">{toThaiNumber(overview.totalCount)}</span> รายการ</div>
            </div>

            <p>
              ทั้งนี้ งานสารบรรณได้แนบรายละเอียดทะเบียนหนังสือทุกประเภท พร้อมทั้ง <span className="font-bold">ตารางสรุปการกระจายภาระงานราชการที่ได้รับมอบหมายจำแนกตามรายบุคคล</span> 
              เพื่อเป็นข้อมูลประกอบการพิจารณา ประเมินผลสัมฤทธิ์ และวางแผนการบริหารจัดการงานสารบรรณในปีต่อไป ปรากฏตามเอกสารที่แนบมาพร้อมนี้
            </p>
            <p className="pt-2">
              จึงเรียนมาเพื่อโปรดทราบและพิจารณา
            </p>
          </div>

          {/* ช่องลงชื่อผู้รายงาน (ด้านขวา) */}
          <div className="mt-5 flex justify-end pr-4 font-sarabun text-[16pt]">
            <div className="text-center">
              <div>(ลงชื่อ)........................................................... {memoOfficerPos}</div>
              <div className="mt-1">({memoOfficerName})</div>
            </div>
          </div>

          {/* ส่วนความเห็นของผู้อำนวยการโรงเรียน (ตามแบบฟอร์มจริงของโรงเรียนบ้านควนโคกยา) */}
          <div className="mt-4 font-sarabun text-[16pt]">
            <div className="font-bold mb-1">ความเห็นของผู้อำนวยการโรงเรียน</div>
            <div className="border-b border-dotted border-slate-600 h-5 mb-2"></div>
            <div className="border-b border-dotted border-slate-600 h-5 mb-3"></div>

            <div className="flex justify-end pr-4 mt-2">
              <div className="text-center">
                <div>(ลงชื่อ)...........................................................</div>
                <div className="mt-1">({settings?.director_name || 'นายเอกคณิต สิทธิศักดิ์'})</div>
                <div className="mt-0.5">ผู้อำนวยการ{schoolName}</div>
              </div>
            </div>
          </div>
        </div>

        {/* -----------------------------------------------------------------------
            ส่วนที่ 2: ทะเบียนหนังสือรับ (Incoming Docs Register)
        ----------------------------------------------------------------------- */}
        <div className={`${activeTab === 'incoming' ? 'block' : 'hidden print:block'} print:break-after-page mt-8 print:mt-0`}>
          <div className="text-center mb-6">
            <h2 className="text-xl font-bold">ทะเบียนหนังสือรับ (หนังสือเข้า) ประจำปี พ.ศ. {selectedYear}</h2>
            <p className="text-sm text-slate-600">{schoolName} (รวมทั้งสิ้น {incomingDocs.length} เรื่อง)</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse border border-slate-300">
              <thead>
                <tr className="bg-slate-100 print:bg-slate-200 text-slate-800 font-bold border-b border-slate-300">
                  <th className="p-2 border border-slate-300 text-center w-16">เลขที่รับ</th>
                  <th className="p-2 border border-slate-300 text-center w-24">วันที่รับ</th>
                  <th className="p-2 border border-slate-300 w-32">เลขที่หนังสือ</th>
                  <th className="p-2 border border-slate-300 text-center w-24">ลงวันที่</th>
                  <th className="p-2 border border-slate-300">เรื่อง</th>
                  <th className="p-2 border border-slate-300 w-36">จากหน่วยงาน</th>
                  <th className="p-2 border border-slate-300 w-36">ผู้รับมอบหมาย</th>
                </tr>
              </thead>
              <tbody>
                {incomingDocs.map((doc, idx) => {
                  const assignees = (doc.doc_assignments || [])
                    .map((a: any) => a.teachers ? `${a.teachers.prefix || ''}${a.teachers.first_name} ${a.teachers.last_name || ''}`.trim() : null)
                    .filter(Boolean);
                  
                  const { senderDocNo, senderDocDate } = parseSenderInfo(doc.remark);

                  return (
                    <tr key={doc.id || idx} className="border-b border-slate-200 hover:bg-slate-50 print:hover:bg-transparent">
                      {/* 1. เลขที่รับ (เลขที่รับจริงของโรงเรียน เช่น 187, 188...) */}
                      <td className="p-2 border border-slate-300 text-center font-bold text-slate-800">
                        {doc.doc_number || doc.doc_sequence || idx + 1}
                      </td>
                      {/* 2. วันที่รับ (วันที่โรงเรียนรับเข้ามา) */}
                      <td className="p-2 border border-slate-300 text-center">{formatThaiDate(doc.created_at)}</td>
                      {/* 3. เลขที่หนังสือ (เลขที่ของหนังสือต้นทางที่ส่งมา) */}
                      <td className="p-2 border border-slate-300 font-medium">{senderDocNo}</td>
                      {/* 4. ลงวันที่ (วันที่ของหนังสือต้นทาง) */}
                      <td className="p-2 border border-slate-300 text-center">{formatThaiDate(senderDocDate || doc.doc_date)}</td>
                      {/* 5. เรื่อง */}
                      <td className="p-2 border border-slate-300 font-medium text-slate-800">{doc.subject}</td>
                      {/* 6. จากหน่วยงาน */}
                      <td className="p-2 border border-slate-300 text-slate-600">{doc.from_agency || '-'}</td>
                      {/* 7. ผู้รับมอบหมาย */}
                      <td className="p-2 border border-slate-300 font-medium text-indigo-700 print:text-slate-900">
                        {assignees.length > 0 ? assignees.join(', ') : <span className="text-slate-400 font-normal">ยังไม่มอบหมาย</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* -----------------------------------------------------------------------
            ส่วนที่ 3: สรุปภาระงานรายบุคคล (Staff Workload Distribution)
        ----------------------------------------------------------------------- */}
        <div className={`${activeTab === 'workload' ? 'block' : 'hidden print:block'} print:break-after-page mt-8 print:mt-0`}>
          <div className="text-center mb-6">
            <h2 className="text-xl font-bold">ตารางสรุปการกระจายภาระงานราชการจำแนกตามรายบุคคล ประจำปี พ.ศ. {selectedYear}</h2>
            <p className="text-sm text-slate-600">คำนวณจากคำสั่งการของผู้อำนวยการในระบบสารบรรณอิเล็กทรอนิกส์ (doc_assignments)</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse border border-slate-300">
              <thead>
                <tr className="bg-slate-100 print:bg-slate-200 text-slate-800 font-bold border-b border-slate-300">
                  <th className="p-2.5 border border-slate-300 text-center w-12">ลำดับ</th>
                  <th className="p-2.5 border border-slate-300">ชื่อ-สกุล ครูผู้ปฏิบัติงาน</th>
                  <th className="p-2.5 border border-slate-300 w-36">ตำแหน่ง</th>
                  <th className="p-2.5 border border-slate-300 w-28 text-center">ฝ่ายงาน</th>
                  <th className="p-2.5 border border-slate-300 text-center w-28 bg-indigo-50/50 print:bg-transparent">มอบหมาย (เรื่อง)</th>
                  <th className="p-2.5 border border-slate-300 text-center w-28 text-emerald-700 print:text-slate-900">แล้วเสร็จ</th>
                  <th className="p-2.5 border border-slate-300 text-center w-28 text-amber-700 print:text-slate-900">ค้างดำเนินการ</th>
                  <th className="p-2.5 border border-slate-300 text-center w-24">ร้อยละความสำเร็จ</th>
                </tr>
              </thead>
              <tbody>
                {workloadList.map((item, idx) => (
                  <tr key={item.staffId || idx} className="border-b border-slate-200 hover:bg-slate-50 print:hover:bg-transparent">
                    <td className="p-2.5 border border-slate-300 text-center">{idx + 1}</td>
                    <td className="p-2.5 border border-slate-300 font-bold text-slate-900">{item.staffName}</td>
                    <td className="p-2.5 border border-slate-300 text-slate-600">{item.position}</td>
                    <td className="p-2.5 border border-slate-300 text-center text-slate-600">{item.department}</td>
                    <td className="p-2.5 border border-slate-300 text-center font-bold text-indigo-700 print:text-slate-900 bg-indigo-50/30 print:bg-transparent">
                      {item.totalAssigned}
                    </td>
                    <td className="p-2.5 border border-slate-300 text-center font-semibold text-emerald-600 print:text-slate-900">
                      {item.completedCount}
                    </td>
                    <td className="p-2.5 border border-slate-300 text-center font-semibold text-amber-600 print:text-slate-900">
                      {item.pendingCount}
                    </td>
                    <td className="p-2.5 border border-slate-300 text-center font-bold">
                      <span className={item.completionRate >= 80 ? 'text-emerald-600 print:text-slate-900' : 'text-amber-600 print:text-slate-900'}>
                        {item.completionRate}%
                      </span>
                    </td>
                  </tr>
                ))}

                {/* แถวสรุปรวม */}
                <tr className="bg-slate-100 print:bg-slate-200 font-bold border-t-2 border-slate-400">
                  <td colSpan={4} className="p-2.5 border border-slate-300 text-center">รวมบุคลากรทั้งสิ้น ({workloadList.length} คน)</td>
                  <td className="p-2.5 border border-slate-300 text-center text-indigo-800 print:text-slate-900">
                    {workloadList.reduce((sum, item) => sum + item.totalAssigned, 0)}
                  </td>
                  <td className="p-2.5 border border-slate-300 text-center text-emerald-800 print:text-slate-900">
                    {workloadList.reduce((sum, item) => sum + item.completedCount, 0)}
                  </td>
                  <td className="p-2.5 border border-slate-300 text-center text-amber-800 print:text-slate-900">
                    {workloadList.reduce((sum, item) => sum + item.pendingCount, 0)}
                  </td>
                  <td className="p-2.5 border border-slate-300 text-center">
                    {workloadList.length > 0 
                      ? Math.round((workloadList.reduce((sum, item) => sum + item.completedCount, 0) / (workloadList.reduce((sum, item) => sum + item.totalAssigned, 0) || 1)) * 1000) / 10 
                      : 100}%
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* -----------------------------------------------------------------------
            ส่วนที่ 4: ทะเบียนบันทึกข้อความ (Memos Register)
        ----------------------------------------------------------------------- */}
        <div className={`${activeTab === 'memos' ? 'block' : 'hidden print:block'} print:break-after-page mt-8 print:mt-0`}>
          <div className="text-center mb-6">
            <h2 className="text-xl font-bold">ทะเบียนบันทึกข้อความ ประจำปี พ.ศ. {selectedYear}</h2>
            <p className="text-sm text-slate-600">{schoolName} (รวมทั้งสิ้น {memos.length} ฉบับ)</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse border border-slate-300">
              <thead>
                <tr className="bg-slate-100 print:bg-slate-200 text-slate-800 font-bold border-b border-slate-300">
                  <th className="p-2 border border-slate-300 text-center w-12">ลำดับ</th>
                  <th className="p-2 border border-slate-300 w-28">เลขที่บันทึก</th>
                  <th className="p-2 border border-slate-300 text-center w-24">วันที่</th>
                  <th className="p-2 border border-slate-300">เรื่อง</th>
                  <th className="p-2 border border-slate-300 w-36">ผู้เขียนบันทึก</th>
                  <th className="p-2 border border-slate-300 w-32 text-center">ฝ่ายงาน</th>
                  <th className="p-2 border border-slate-300 w-24 text-center">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {memos.map((memo, idx) => (
                  <tr key={memo.id || idx} className="border-b border-slate-200 hover:bg-slate-50 print:hover:bg-transparent">
                    <td className="p-2 border border-slate-300 text-center">{memo.doc_sequence || idx + 1}</td>
                    <td className="p-2 border border-slate-300 font-semibold">{memo.memo_number || '-'}</td>
                    <td className="p-2 border border-slate-300 text-center">{formatThaiDate(memo.memo_date)}</td>
                    <td className="p-2 border border-slate-300">{memo.subject}</td>
                    <td className="p-2 border border-slate-300">{memo.requester}</td>
                    <td className="p-2 border border-slate-300 text-center text-slate-600">{memo.department || '-'}</td>
                    <td className="p-2 border border-slate-300 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        memo.status === 'approved' ? 'bg-emerald-100 text-emerald-700 print:text-slate-900' : 'bg-amber-100 text-amber-700 print:text-slate-900'
                      }`}>
                        {memo.status === 'approved' ? 'อนุมัติแล้ว' : 'รอเสนอ'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* -----------------------------------------------------------------------
            ส่วนที่ 5: ทะเบียนหนังสือส่ง (Outgoing Docs Register)
        ----------------------------------------------------------------------- */}
        <div className={`${activeTab === 'outgoing' ? 'block' : 'hidden print:block'} print:break-after-page mt-8 print:mt-0`}>
          <div className="text-center mb-6">
            <h2 className="text-xl font-bold">ทะเบียนหนังสือส่ง (หนังสือออก) ประจำปี พ.ศ. {selectedYear}</h2>
            <p className="text-sm text-slate-600">{schoolName} (รวมทั้งสิ้น {outgoingDocs.length} เรื่อง)</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse border border-slate-300">
              <thead>
                <tr className="bg-slate-100 print:bg-slate-200 text-slate-800 font-bold border-b border-slate-300">
                  <th className="p-2 border border-slate-300 text-center w-12">ลำดับ</th>
                  <th className="p-2 border border-slate-300 w-32">เลขที่หนังสือส่ง</th>
                  <th className="p-2 border border-slate-300 text-center w-24">วันที่ส่ง</th>
                  <th className="p-2 border border-slate-300">เรื่อง</th>
                  <th className="p-2 border border-slate-300 w-44">ส่งถึง (หน่วยงานปลายทาง)</th>
                </tr>
              </thead>
              <tbody>
                {outgoingDocs.map((out, idx) => (
                  <tr key={out.id || idx} className="border-b border-slate-200 hover:bg-slate-50 print:hover:bg-transparent">
                    <td className="p-2 border border-slate-300 text-center">{out.doc_sequence || idx + 1}</td>
                    <td className="p-2 border border-slate-300 font-semibold">{out.doc_number || '-'}</td>
                    <td className="p-2 border border-slate-300 text-center">{formatThaiDate(out.doc_date)}</td>
                    <td className="p-2 border border-slate-300">{out.subject}</td>
                    <td className="p-2 border border-slate-300 text-slate-700">{out.to_agency || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* -----------------------------------------------------------------------
            ส่วนที่ 6: ทะเบียนคำสั่งโรงเรียน (Orders Register)
        ----------------------------------------------------------------------- */}
        <div className={`${activeTab === 'orders' ? 'block' : 'hidden print:block'} mt-8 print:mt-0`}>
          <div className="text-center mb-6">
            <h2 className="text-xl font-bold">ทะเบียนคำสั่งโรงเรียน ประจำปี พ.ศ. {selectedYear}</h2>
            <p className="text-sm text-slate-600">{schoolName} (รวมทั้งสิ้น {orders.length} ฉบับ)</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse border border-slate-300">
              <thead>
                <tr className="bg-slate-100 print:bg-slate-200 text-slate-800 font-bold border-b border-slate-300">
                  <th className="p-2 border border-slate-300 text-center w-12">ลำดับ</th>
                  <th className="p-2 border border-slate-300 w-32">ที่คำสั่ง</th>
                  <th className="p-2 border border-slate-300 text-center w-24">วันที่สั่งการ</th>
                  <th className="p-2 border border-slate-300">เรื่อง</th>
                  <th className="p-2 border border-slate-300 w-36">ผู้ลงนาม</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((ord, idx) => (
                  <tr key={ord.id || idx} className="border-b border-slate-200 hover:bg-slate-50 print:hover:bg-transparent">
                    <td className="p-2 border border-slate-300 text-center">{ord.doc_sequence || idx + 1}</td>
                    <td className="p-2 border border-slate-300 font-semibold">{ord.order_number || '-'}</td>
                    <td className="p-2 border border-slate-300 text-center">{formatThaiDate(ord.order_date)}</td>
                    <td className="p-2 border border-slate-300">{ord.subject}</td>
                    <td className="p-2 border border-slate-300 text-slate-700">{ord.issuer || `ผู้อำนวยการ${schoolName}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* สไตล์การพิมพ์ A4 และหัวตารางซ้ำอัตโนมัติ */}
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 20mm 15mm 15mm 25mm;
          }
          html, body {
            background: white !important;
            color: black !important;
            font-family: 'TH Sarabun New', 'TH Sarabun PSK', 'Sarabun', sans-serif !important;
          }
          thead {
            display: table-header-group;
          }
          tr {
            page-break-inside: avoid;
          }
          .break-after-page {
            page-break-after: always;
            break-after: page;
          }
        }
      `}</style>
    </div>
  );
}
