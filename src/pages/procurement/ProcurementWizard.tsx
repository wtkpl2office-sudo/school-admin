import React, { useState } from 'react';
import { 
  X, 
  Upload, 
  Camera, 
  Plus, 
  Trash2, 
  Check, 
  AlertTriangle, 
  Sparkles, 
  ArrowRight, 
  ArrowLeft,
  FileText,
  DollarSign,
  Users,
  ShieldCheck,
  Building2,
  Calendar
} from 'lucide-react';
import { ProcurementNumberingService } from '../../services/procurementNumberingService';
import { ProcurementOcrService } from '../../services/procurementOcrService';
import { thaiBahtText } from '../../services/procurementDocGenerator';

interface Teacher {
  id: string;
  first_name: string;
  last_name: string;
  position?: string;
}

interface Budget {
  id: string;
  category_name: string;
  budget_type: string;
  amount: number;
  remaining_amount?: number;
}

interface ProcurementWizardProps {
  teachers: Teacher[];
  budgets: Budget[];
  onClose: () => void;
  onSubmit: (caseData: any, items: any[]) => Promise<void>;
}

export const ProcurementWizard: React.FC<ProcurementWizardProps> = ({
  teachers,
  budgets,
  onClose,
  onSubmit
}) => {
  const [step, setStep] = useState<number>(1);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [scanning, setScanning] = useState<boolean>(false);
  const [ocrSuccess, setOcrSuccess] = useState<string | null>(null);

  // Form State
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('goods'); // 'goods', 'service_general', 'service_12m', 'construction', 'lunch'
  const [policyCode, setPolicyCode] = useState('W089');
  const [budgetId, setBudgetId] = useState(budgets[0]?.id || '');
  const [fiscalYear, setFiscalYear] = useState('2569');

  // Vendor Info
  const [vendorName, setVendorName] = useState('');
  const [vendorTaxId, setVendorTaxId] = useState('');
  const [vendorAddress, setVendorAddress] = useState('');
  const [vendorPhone, setVendorPhone] = useState('');
  const [receiptNo, setReceiptNo] = useState('');
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().split('T')[0]);

  // Roles
  const [requesterId, setRequesterId] = useState('');
  const [officerId, setOfficerId] = useState('');
  const [headOfficerId, setHeadOfficerId] = useState('');
  const [committeeMembers, setCommitteeMembers] = useState<{ teacher_id: string; role: string }[]>([
    { teacher_id: '', role: 'ประธานกรรมการ' }
  ]);

  // Items
  const [items, setItems] = useState<any[]>([
    { item_name: '', specification: '', quantity: 1, unit: 'รายการ', unit_price: 0, total_price: 0 }
  ]);

  // Custom Clauses
  const [customClauses, setCustomClauses] = useState('');

  // คำนวณยอดเงินรวม
  const estimatedAmount = items.reduce((acc, it) => acc + (Number(it.total_price) || 0), 0);

  // Auto-detect Policy Code based on Category & Amount
  React.useEffect(() => {
    if (category === 'service_12m') {
      setPolicyCode('W877');
    } else if (category === 'construction') {
      setPolicyCode('W523');
    } else if (category === 'lunch') {
      setPolicyCode('LUNCH');
    } else {
      if (estimatedAmount <= 10000 && estimatedAmount > 0) {
        setPolicyCode('W119_10K');
      } else if (estimatedAmount <= 100000 && estimatedAmount > 10000) {
        setPolicyCode('W119_100K');
      } else {
        setPolicyCode('W089');
      }
    }
  }, [category, estimatedAmount]);

  // จัดการรายการพัสดุ
  const addItem = () => {
    setItems([...items, { item_name: '', specification: '', quantity: 1, unit: 'รายการ', unit_price: 0, total_price: 0 }]);
  };

  const updateItem = (index: number, field: string, val: any) => {
    const next = [...items];
    next[index][field] = val;
    if (field === 'quantity' || field === 'unit_price') {
      next[index].total_price = Number(next[index].quantity || 0) * Number(next[index].unit_price || 0);
    }
    setItems(next);
  };

  const removeItem = (index: number) => {
    if (items.length <= 1) return;
    const next = items.filter((_, i) => i !== index);
    setItems(next);
  };

  // จัดการกรรมการตรวจรับ
  const addCommittee = () => {
    setCommitteeMembers([...committeeMembers, { teacher_id: '', role: 'กรรมการ' }]);
  };

  const updateCommittee = (index: number, teacher_id: string, role: string) => {
    const next = [...committeeMembers];
    next[index] = { teacher_id, role };
    setCommitteeMembers(next);
  };

  const removeCommittee = (index: number) => {
    if (committeeMembers.length <= 1) return;
    setCommitteeMembers(committeeMembers.filter((_, i) => i !== index));
  };

  // Separation of Duties (SoD) Check
  const inspectorIds = committeeMembers.map(m => m.teacher_id).filter(Boolean);
  const sodResult = ProcurementNumberingService.validateSeparationOfDuties({
    requesterId,
    officerId,
    headOfficerId,
    inspectorIds
  });

  // AI OCR File Upload Handler
  const handleOcrUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanning(true);
    setOcrSuccess(null);
    try {
      const extracted = await ProcurementOcrService.parseReceiptOrQuotation(file);
      if (extracted) {
        if (extracted.vendor_name) setVendorName(extracted.vendor_name);
        if (extracted.tax_id) setVendorTaxId(extracted.tax_id);
        if (extracted.address) setVendorAddress(extracted.address);
        if (extracted.phone) setVendorPhone(extracted.phone);
        if (extracted.receipt_no) setReceiptNo(extracted.receipt_no);
        if (extracted.receipt_date) setReceiptDate(extracted.receipt_date);

        if (extracted.items && extracted.items.length > 0) {
          setItems(extracted.items.map(it => ({
            item_name: it.item_name,
            specification: '',
            quantity: it.quantity || 1,
            unit: it.unit || 'รายการ',
            unit_price: it.unit_price || 0,
            total_price: it.total_price || 0
          })));
        }
        setOcrSuccess(`สกัดข้อมูลจาก ${file.name} สำเร็จเรียบร้อย! ข้อมูลร้านค้าและรายการถูกกรอกให้อัตโนมัติ`);
      } else {
        alert('ระบบไม่สามารถสกัดข้อมูลจากเอกสารนี้ได้อัตโนมัติ กรุณากรอกข้อมูลในตารางด้วยตนเอง');
      }
    } catch (err) {
      console.error(err);
      alert('เกิดข้อผิดพลาดในการสแกนไฟล์');
    } finally {
      setScanning(false);
    }
  };

  const handleFinalSubmit = async () => {
    if (!title.trim()) {
      alert('กรุณาระบุชื่องานจัดซื้อจัดจ้าง');
      return;
    }
    if (items.some(it => !it.item_name.trim())) {
      alert('กรุณาระบุชื่อรายการพัสดุให้ครบถ้วน');
      return;
    }
    if (!sodResult.valid) {
      alert(`ไม่สามารถบันทึกได้เนื่องจากติดกฎระเบียบ:\n${sodResult.errors.join('\n')}`);
      return;
    }

    setSubmitting(true);
    try {
      // 1. สร้าง PCID
      const pcid = await ProcurementNumberingService.generateNextPCID(fiscalYear);
      const prNumber = await ProcurementNumberingService.getNextPRNumber(fiscalYear);

      // 2. ดึงชื่อครูผู้ขอเพื่อสำรองเลข memo
      const requester = teachers.find(t => t.id === requesterId);
      const requesterName = requester ? `${requester.first_name} ${requester.last_name}` : 'เจ้าหน้าที่';
      
      const { memo_id, memo_number } = await ProcurementNumberingService.reserveNextMemoNumber(fiscalYear, title, requesterName);

      const caseData = {
        pcid,
        title,
        category,
        policy_code: policyCode,
        budget_id: budgetId || null,
        estimated_amount: estimatedAmount,
        final_amount: estimatedAmount,
        current_gate: policyCode === 'W119_10K' ? 5 : 2, // ว.119 ข้ามไปด่านเบิกจ่ายได้เลย
        status: policyCode === 'W119_10K' ? 'delivered' : 'pending_approval',
        fiscal_year: fiscalYear,
        academic_year: fiscalYear,
        memo_request_id: memo_id || null,
        pr_number: prNumber,
        requester_id: requesterId || null,
        officer_id: officerId || null,
        head_officer_id: headOfficerId || null,
        inspector_type: committeeMembers.length > 1 ? 'committee' : 'single',
        committee_members: committeeMembers.map(m => {
          const t = teachers.find(x => x.id === m.teacher_id);
          return {
            teacher_id: m.teacher_id,
            name: t ? `${t.first_name} ${t.last_name}` : '',
            role: m.role,
            position: t?.position || 'ครู'
          };
        }),
        vendor_info: {
          name: vendorName,
          tax_id: vendorTaxId,
          address: vendorAddress,
          phone: vendorPhone,
          receipt_no: receiptNo,
          receipt_date: receiptDate
        },
        custom_clauses: customClauses
      };

      await onSubmit(caseData, items);
      onClose();
    } catch (e: any) {
      console.error(e);
      alert(`บันทึกไม่สำเร็จ: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="bg-slate-900 text-white p-5 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs text-blue-300 font-bold mb-0.5">
              <span>ขั้นตอนที่ {step} จาก 3</span>
              <span>•</span>
              <span>ระเบียบที่จับคู่: {policyCode}</span>
            </div>
            <h2 className="text-xl font-bold">เปิดสำนวนจัดซื้อจัดจ้างใหม่ (Procurement Case Wizard)</h2>
          </div>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Stepper Progress Bar */}
        <div className="bg-slate-100 px-6 py-3 border-b border-slate-200 flex items-center justify-between text-xs font-bold text-slate-600">
          <div className={`flex items-center gap-2 ${step >= 1 ? 'text-blue-600' : 'text-slate-400'}`}>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center ${step >= 1 ? 'bg-blue-600 text-white' : 'bg-slate-300'}`}>1</span>
            <span>ประเภท & สแกนใบเสร็จ</span>
          </div>
          <div className="w-12 h-0.5 bg-slate-300"></div>
          <div className={`flex items-center gap-2 ${step >= 2 ? 'text-blue-600' : 'text-slate-400'}`}>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center ${step >= 2 ? 'bg-blue-600 text-white' : 'bg-slate-300'}`}>2</span>
            <span>รายการพัสดุ & ราคากลาง</span>
          </div>
          <div className="w-12 h-0.5 bg-slate-300"></div>
          <div className={`flex items-center gap-2 ${step >= 3 ? 'text-blue-600' : 'text-slate-400'}`}>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center ${step >= 3 ? 'bg-blue-600 text-white' : 'bg-slate-300'}`}>3</span>
            <span>ผู้รับผิดชอบ & SoD Check</span>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          
          {/* STEP 1: ประเภทและนโยบาย */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">ชื่องานจัดซื้อจัดจ้าง *</label>
                <input
                  type="text"
                  placeholder="เช่น ซื้อวัสดุการศึกษาสำหรับกิจกรรมพัฒนาผู้เรียน ประจำภาคเรียนที่ 1/2569"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-slate-800 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">หมวดหมู่พัสดุ/ลักษณะงาน</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="goods">จัดซื้อวัสดุทั่วไป / ครุภัณฑ์</option>
                    <option value="service_general">จ้างทำของ / จ้างบริการทั่วไป</option>
                    <option value="service_12m">จ้างเหมาบริการ 12 เดือน (ว.877 บุคคลธรรมดา)</option>
                    <option value="construction">จ้างปรับปรุงซ่อมแซมสิ่งก่อสร้าง (ว.523 Factor F)</option>
                    <option value="lunch">จัดซื้อ/จ้างอาหารกลางวันนักเรียน</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">แหล่งงบประมาณ</label>
                  <select
                    value={budgetId}
                    onChange={(e) => setBudgetId(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    {budgets.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.category_name} ({b.budget_type}) - คงเหลือ ฿{Number(b.remaining_amount || b.amount).toLocaleString()}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* AI OCR Scan Section */}
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-5">
                <div className="flex items-center gap-2 text-blue-900 font-bold mb-2">
                  <Sparkles size={18} className="text-blue-600" />
                  <span>ระบบ AI OCR สแกนใบเสร็จหรือใบเสนอราคาอัตโนมัติ</span>
                </div>
                <p className="text-xs text-slate-600 mb-4">
                  หากคุณครูมีใบเสร็จรับเงิน (ว.119) หรือใบเสนอราคาจากร้านค้า สามารถอัปโหลดไฟล์หรือถ่ายรูปเพื่อให้ AI อ่านข้อมูลชื่อร้าน, เลขผู้เสียภาษี และรายการสินค้าให้อัตโนมัติ โดยไม่ต้องพิมพ์เอง
                </p>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-md cursor-pointer transition-colors">
                    <Upload size={16} />
                    <span>{scanning ? 'กำลังอ่านข้อมูลเอกสาร...' : 'เลือกรูปภาพ / PDF ใบเสร็จ'}</span>
                    <input 
                      type="file" 
                      accept="image/*,application/pdf" 
                      onChange={handleOcrUpload} 
                      disabled={scanning}
                      className="hidden" 
                    />
                  </label>
                  {scanning && (
                    <span className="text-xs text-blue-600 font-medium animate-pulse flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-full border-2 border-blue-600 border-t-transparent animate-spin"></span>
                      AI กำลังประมวลผลข้อความ...
                    </span>
                  )}
                </div>

                {ocrSuccess && (
                  <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-medium flex items-center gap-2">
                    <Check size={16} className="text-emerald-600 shrink-0" />
                    <span>{ocrSuccess}</span>
                  </div>
                )}
              </div>

              {/* Policy Preview Box */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">กฎระเบียบที่ระบบแนะนำ:</div>
                <div className="text-sm font-bold text-slate-800">
                  {policyCode === 'W119_10K' && '📌 ว.119 (วงเงินไม่เกิน 10,000 บาท): ใช้สิทธิซื้อก่อนเบิกทีหลัง แนบใบเสร็จฉบับเดียว'}
                  {policyCode === 'W119_100K' && '📌 ว.119 (วงเงิน 10,001 - 100,000 บาท): หัวหน้าพัสดุสั่งการได้โดยตรง ไม่ต้องทำรายงานข้อ 22'}
                  {policyCode === 'W089' && '📌 ว.89 เฉพาะเจาะจง (เกิน 100,000 - 500,000 บาท): ชุดเอกสาร e-GP ครบชุด 5 ฉบับ + กก. >= 3 คน'}
                  {policyCode === 'W877' && '📌 ว.877 (จ้างเหมาบริการ 12 เดือน): สัญญาจ้างบุคคลธรรมดา + ส่งมอบตรวจรับรายเดือน 12 งวด'}
                  {policyCode === 'W523' && '📌 ว.523 (งานปรับปรุงสิ่งก่อสร้าง): ถอดแบบ ปร.4/5/6 + Factor F ดอกเบี้ย 6% / VAT 7%'}
                  {policyCode === 'LUNCH' && '📌 ระเบียบอาหารกลางวัน สพฐ.: คำนวณตามจำนวนนักเรียนจริง (Headcount Sync)'}
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: รายการพัสดุและร้านค้า */}
          {step === 2 && (
            <div className="space-y-5">
              {/* ข้อมูลร้านค้าผู้ขาย */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="font-bold text-sm text-slate-700">ข้อมูลร้านค้า / ผู้ขาย / ผู้รับจ้าง</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">ชื่อร้านค้า / ผู้ขาย *</label>
                    <input
                      type="text"
                      placeholder="เช่น ร้านสมหมายเครื่องเขียน"
                      value={vendorName}
                      onChange={(e) => setVendorName(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">เลขประจำตัวผู้เสียภาษี</label>
                    <input
                      type="text"
                      placeholder="13 หลัก"
                      value={vendorTaxId}
                      onChange={(e) => setVendorTaxId(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">เบอร์โทรศัพท์</label>
                    <input
                      type="text"
                      placeholder="08x-xxx-xxxx"
                      value={vendorPhone}
                      onChange={(e) => setVendorPhone(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                {policyCode === 'W119_10K' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-slate-200">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">เลขที่ใบเสร็จรับเงิน (ตาม ว.119)</label>
                      <input
                        type="text"
                        placeholder="เช่น เล่มที่ 12 เลขที่ 45"
                        value={receiptNo}
                        onChange={(e) => setReceiptNo(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">วันที่ในใบเสร็จรับเงิน</label>
                      <input
                        type="date"
                        value={receiptDate}
                        onChange={(e) => setReceiptDate(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* ตารางรายการพัสดุ */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-slate-700">รายการพัสดุ / สินค้า ({items.length} รายการ)</span>
                  <button
                    onClick={addItem}
                    className="flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-700 cursor-pointer"
                  >
                    <Plus size={16} />
                    <span>เพิ่มแถว</span>
                  </button>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-100 text-slate-600 text-xs font-bold">
                      <tr>
                        <th className="p-2.5 w-12 text-center">#</th>
                        <th className="p-2.5">ชื่อรายการพัสดุ *</th>
                        <th className="p-2.5 w-24 text-center">จำนวน</th>
                        <th className="p-2.5 w-24 text-center">หน่วยนับ</th>
                        <th className="p-2.5 w-32 text-right">ราคา/หน่วย</th>
                        <th className="p-2.5 w-32 text-right">รวมเงิน</th>
                        <th className="p-2.5 w-12 text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {items.map((it, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/60">
                          <td className="p-2.5 text-center text-xs text-slate-400 font-bold">{idx + 1}</td>
                          <td className="p-2.5">
                            <input
                              type="text"
                              placeholder="เช่น กระดาษ A4 80 แกรม"
                              value={it.item_name}
                              onChange={(e) => updateItem(idx, 'item_name', e.target.value)}
                              className="w-full px-2 py-1.5 rounded border border-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </td>
                          <td className="p-2.5">
                            <input
                              type="number"
                              min="1"
                              value={it.quantity}
                              onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                              className="w-full px-2 py-1.5 rounded border border-slate-200 text-sm text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </td>
                          <td className="p-2.5">
                            <input
                              type="text"
                              value={it.unit}
                              onChange={(e) => updateItem(idx, 'unit', e.target.value)}
                              className="w-full px-2 py-1.5 rounded border border-slate-200 text-sm text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </td>
                          <td className="p-2.5">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={it.unit_price}
                              onChange={(e) => updateItem(idx, 'unit_price', e.target.value)}
                              className="w-full px-2 py-1.5 rounded border border-slate-200 text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </td>
                          <td className="p-2.5 text-right font-bold text-slate-800">
                            ฿{Number(it.total_price || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="p-2.5 text-center">
                            <button
                              onClick={() => removeItem(idx)}
                              disabled={items.length <= 1}
                              className="text-slate-300 hover:text-rose-500 disabled:opacity-30 cursor-pointer"
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-xl">
                  <div className="text-xs text-blue-800">
                    <b>ตัวอักษร:</b> {thaiBahtText(estimatedAmount)}
                  </div>
                  <div className="text-base font-black text-blue-900">
                    รวมทั้งสิ้น: ฿{estimatedAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: ผู้รับผิดชอบ และตรวจ SoD */}
          {step === 3 && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">ครูผู้ขอซื้อ/ขอจ้าง (Requester) *</label>
                  <select
                    value={requesterId}
                    onChange={(e) => setRequesterId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">-- เลือกครูผู้ขอ --</option>
                    {teachers.map(t => (
                      <option key={t.id} value={t.id}>{t.first_name} {t.last_name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">เจ้าหน้าที่พัสดุ (Officer) *</label>
                  <select
                    value={officerId}
                    onChange={(e) => setOfficerId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">-- เลือกเจ้าหน้าที่พัสดุ --</option>
                    {teachers.map(t => (
                      <option key={t.id} value={t.id}>{t.first_name} {t.last_name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">หัวหน้าเจ้าหน้าที่พัสดุ (Head) *</label>
                  <select
                    value={headOfficerId}
                    onChange={(e) => setHeadOfficerId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">-- เลือกหัวหน้าเจ้าหน้าที่ --</option>
                    {teachers.map(t => (
                      <option key={t.id} value={t.id}>{t.first_name} {t.last_name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* คณะกรรมการตรวจรับพัสดุ */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-bold text-sm text-slate-800">ผู้ตรวจรับพัสดุ / คณะกรรมการตรวจรับ</span>
                    <p className="text-xs text-slate-500">วงเงินไม่เกิน 1 แสน แต่งตั้ง 1 คนได้ / วงเงินเกิน 1 แสน ต้องแต่งตั้งอย่างน้อย 3 คน</p>
                  </div>
                  <button
                    onClick={addCommittee}
                    className="flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-700 cursor-pointer"
                  >
                    <Plus size={16} />
                    <span>เพิ่มกรรมการ</span>
                  </button>
                </div>

                <div className="space-y-2">
                  {committeeMembers.map((m, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="w-6 text-xs text-slate-400 font-bold text-center">{idx + 1}</span>
                      <select
                        value={m.teacher_id}
                        onChange={(e) => updateCommittee(idx, e.target.value, m.role)}
                        className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">-- เลือกคุณครูผู้ตรวจรับ --</option>
                        {teachers.map(t => (
                          <option key={t.id} value={t.id}>{t.first_name} {t.last_name} ({t.position || 'ครู'})</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={m.role}
                        onChange={(e) => updateCommittee(idx, m.teacher_id, e.target.value)}
                        placeholder="หน้าที่ เช่น ประธานกรรมการ / กรรมการ"
                        className="w-36 px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        onClick={() => removeCommittee(idx)}
                        disabled={committeeMembers.length <= 1}
                        className="text-slate-300 hover:text-rose-500 disabled:opacity-30 cursor-pointer p-1"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* SoD Separation of Duties Warning */}
              {!sodResult.valid && (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl space-y-1">
                  <div className="flex items-center gap-2 text-rose-800 font-bold text-sm">
                    <AlertTriangle size={18} className="text-rose-600" />
                    <span>ข้อผิดพลาดด้านกฎระเบียบ (SoD Conflict Guard):</span>
                  </div>
                  <ul className="list-disc list-inside text-xs text-rose-700 pl-6 space-y-0.5">
                    {sodResult.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {sodResult.valid && requesterId && officerId && headOfficerId && inspectorIds.length > 0 && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-medium flex items-center gap-2">
                  <ShieldCheck size={18} className="text-emerald-600" />
                  <span>ผ่านการตรวจสอบการแบ่งแยกหน้าที่ตามระเบียบกระทรวงการคลังฯ ข้อ 25 ถูกต้อง 100%</span>
                </div>
              )}

              {/* Custom Clauses */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">ข้อกำหนดพิเศษ / เงื่อนไขเพิ่มเติม (Custom Clauses)</label>
                <textarea
                  rows={2}
                  placeholder="เช่น การส่งมอบจะต้องกระทำในวันและเวลาราชการ, การรับประกันความชำรุดบกพร่อง 1 ปี..."
                  value={customClauses}
                  onChange={(e) => setCustomClauses(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

        </div>

        {/* Footer Navigation */}
        <div className="bg-slate-100 px-6 py-4 border-t border-slate-200 flex items-center justify-between">
          {step > 1 ? (
            <button
              onClick={() => setStep(step - 1)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-300 text-slate-700 font-bold text-sm hover:bg-slate-200 transition-colors cursor-pointer"
            >
              <ArrowLeft size={16} />
              <span>ย้อนกลับ</span>
            </button>
          ) : (
            <div></div>
          )}

          {step < 3 ? (
            <button
              onClick={() => {
                if (step === 1 && !title.trim()) {
                  alert('กรุณาระบุชื่องานจัดซื้อจัดจ้าง');
                  return;
                }
                setStep(step + 1);
              }}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-md transition-all cursor-pointer"
            >
              <span>ถัดไป</span>
              <ArrowRight size={16} />
            </button>
          ) : (
            <button
              onClick={handleFinalSubmit}
              disabled={submitting || !sodResult.valid}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold text-sm shadow-lg shadow-emerald-600/25 disabled:opacity-50 transition-all cursor-pointer"
            >
              {submitting ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  <span>กำลังสร้างสำนวนและออกเลข...</span>
                </>
              ) : (
                <>
                  <Check size={18} />
                  <span>บันทึกเปิดสำนวนจัดซื้อจัดจ้าง</span>
                </>
              )}
            </button>
          )}
        </div>

      </div>
    </div>
  );
};
