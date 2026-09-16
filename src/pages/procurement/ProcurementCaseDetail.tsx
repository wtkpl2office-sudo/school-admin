import React, { useState } from 'react';
import { 
  ArrowLeft, 
  Printer, 
  FileText, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Upload, 
  Plus, 
  ShieldCheck, 
  DollarSign, 
  Calendar, 
  User, 
  Building, 
  Tag, 
  Check, 
  Camera, 
  Download,
  ChevronRight,
  ExternalLink,
  Trash2,
  Edit3,
  X,
  Package
} from 'lucide-react';
import { ProcurementNumberingService } from '../../services/procurementNumberingService';
import { thaiBahtText } from '../../services/procurementDocGenerator';

interface CaseDetailProps {
  caseData: any;
  items: any[];
  auditLogs: any[];
  onBack: () => void;
  onUpdateCase: (updatedData: any) => Promise<void>;
  onDeleteCase?: (caseId: string) => void;
  onPrintDoc: (docType: string, includeSignatures?: boolean) => void;
  onPrintBundle: (includeSignatures?: boolean) => void;
}

export const ProcurementCaseDetail: React.FC<CaseDetailProps> = ({
  caseData,
  items,
  auditLogs,
  onBack,
  onUpdateCase,
  onDeleteCase,
  onPrintDoc,
  onPrintBundle
}) => {
  const [activeGateTab, setActiveGateTab] = useState<number>(caseData.current_gate || 1);
  const [updating, setUpdating] = useState(false);
  const [includeSignatures, setIncludeSignatures] = useState<boolean>(true);
  const [isEditingNumbers, setIsEditingNumbers] = useState(false);
  const [isRegisteredToInventory, setIsRegisteredToInventory] = useState<boolean>(() => {
    return caseData.is_registered_to_inventory === true || localStorage.getItem(`registered_inv_${caseData.id}`) === 'true';
  });
  const [editFormData, setEditFormData] = useState({
    memo_number: caseData.memo_number || '',
    request_date: caseData.request_date || '',
    pr_number: caseData.pr_number || '',
    pr_approval_date: caseData.pr_approval_date || '',
    order_number: caseData.order_number || '',
    order_appointment_date: caseData.order_appointment_date || '',
    po_number: caseData.po_number || '',
    po_date: caseData.po_date || '',
    inspection_number: caseData.inspection_number || '',
    inspection_date: caseData.inspection_date || '',
    delivery_due_date: caseData.delivery_due_date || ''
  });

  const handleSaveNumbers = async () => {
    setUpdating(true);
    try {
      await onUpdateCase(editFormData);
      setIsEditingNumbers(false);
      alert('บันทึกการปรับปรุงเลขที่และวันที่เอกสารเรียบร้อยแล้ว');
    } catch (e: any) {
      alert(`บันทึกไม่สำเร็จ: ${e.message}`);
    } finally {
      setUpdating(false);
    }
  };

  // Handler: นำเข้าระบบทะเบียนคุมพัสดุและครุภัณฑ์อัตโนมัติ (1-Click Register)
  const handleRegisterToInventory = async () => {
    if (!items || items.length === 0) {
      alert('ไม่พบรายการพัสดุในสำนวนนี้');
      return;
    }

    setUpdating(true);
    try {
      const existingAssets = JSON.parse(localStorage.getItem('school_asset_registry') || '[]');
      const existingSupplies = JSON.parse(localStorage.getItem('school_supplies_inventory') || '[]');

      let newAssetCount = 0;
      let newSupplyCount = 0;

      const newAssets = [...existingAssets];
      const newSupplies = [...existingSupplies];

      items.forEach((it, idx) => {
        const isAsset = it.is_asset || Number(it.unit_price) >= 5000 || 
          it.item_name.includes('คอมพิวเตอร์') || 
          it.item_name.includes('พิมพ์') || 
          it.item_name.includes('ปรับอากาศ') || 
          it.item_name.includes('โต๊ะ') ||
          it.item_name.includes('เก้าอี้');

        if (isAsset) {
          const nextSeq = String(newAssets.length + 1).padStart(4, '0');
          const asset_code = `7110-001-${nextSeq}/${caseData.fiscal_year || '2569'}`;
          newAssets.push({
            id: `ast-${Date.now()}-${idx}`,
            asset_code,
            name: it.item_name,
            brand_model: it.specification || '',
            category: it.item_name.includes('คอมพิวเตอร์') ? 'ครุภัณฑ์คอมพิวเตอร์' : 'ครุภัณฑ์สำนักงาน',
            acquired_date: caseData.inspection_date || caseData.actual_delivery_date || new Date().toISOString().split('T')[0],
            po_number: caseData.po_number || '',
            inspection_number: caseData.inspection_number || '',
            budget_source: caseData.budget_type || 'เงินอุดหนุนรายหัวนักเรียน',
            unit_price: Number(it.unit_price) || 0,
            quantity: Number(it.quantity) || 1,
            location: 'อาคารเรียน 1',
            custodian_name: caseData.requester_name || 'เจ้าหน้าที่',
            status: 'active',
            remarks: `รับเข้าจากโครงการจัดซื้อจัดจ้าง ${caseData.pcid}`
          });
          newAssetCount++;
        } else {
          const nextSeq = String(newSupplies.length + 1).padStart(3, '0');
          const item_code = `SUP-${caseData.fiscal_year || '2569'}-${nextSeq}`;
          const qty = Number(it.quantity) || 1;
          const price = Number(it.unit_price) || 0;
          newSupplies.push({
            id: `sup-${Date.now()}-${idx}`,
            item_code,
            name: it.item_name,
            category: 'วัสดุสำนักงาน',
            unit: it.unit || 'ชิ้น',
            quantity_received: qty,
            quantity_dispensed: 0,
            quantity_remaining: qty,
            unit_price: price,
            total_value: qty * price,
            storage_location: 'ตู้เก็บพัสดุห้องธุรการ',
            last_restocked_date: caseData.inspection_date || new Date().toISOString().split('T')[0]
          });
          newSupplyCount++;
        }
      });

      localStorage.setItem('school_asset_registry', JSON.stringify(newAssets));
      localStorage.setItem('school_supplies_inventory', JSON.stringify(newSupplies));
      localStorage.setItem(`registered_inv_${caseData.id}`, 'true');
      setIsRegisteredToInventory(true);

      await onUpdateCase({
        is_registered_to_inventory: true,
        current_gate: 6,
        status: 'completed'
      });
      setActiveGateTab(6);

      alert(`✅ ลงทะเบียนคุมพัสดุสำเร็จ!\n• ลงทะเบียนครุภัณฑ์: ${newAssetCount} รายการ\n• บันทึกรับเข้าวัสดุสิ้นเปลือง: ${newSupplyCount} รายการ\nพัสดุพร้อมออกสติกเกอร์รหัสครุภัณฑ์และคุมยอดในระบบแล้วครับ`);
    } catch (err: any) {
      alert(`ไม่สามารถลงทะเบียนได้: ${err.message}`);
    } finally {
      setUpdating(false);
    }
  };

  const amount = Number(caseData.final_amount) || Number(caseData.estimated_amount) || 0;

  // Handler: ก้าวข้าม Gate
  const handleAdvanceGate = async (nextGate: number, updates: any = {}) => {
    if (!confirm(`ยืนยันการดำเนินการและเลื่อนสถานะไปยังขั้นตอนที่ ${nextGate}?`)) return;
    setUpdating(true);
    try {
      const payload: any = {
        ...updates,
        current_gate: nextGate,
        updated_at: new Date().toISOString()
      };

      if (nextGate === 3 && !caseData.order_number) {
        // ออกเลขคำสั่งแต่งตั้ง กก.
        const { order_id, order_number } = await ProcurementNumberingService.reserveNextOrderNumber(
          caseData.fiscal_year,
          `แต่งตั้งคณะกรรมการตรวจรับพัสดุ: ${caseData.title}`
        );
        payload.appointment_order_id = order_id || null;
        payload.order_number = order_number;
        payload.order_appointment_date = new Date().toISOString().split('T')[0];

        // ออกเลข PO
        payload.po_number = await ProcurementNumberingService.getNextPONumber(caseData.fiscal_year);
        payload.po_date = new Date().toISOString().split('T')[0];
        payload.status = 'ordered';
      }

      if (nextGate === 4) {
        payload.status = 'delivered';
        payload.actual_delivery_date = new Date().toISOString().split('T')[0];
      }

      if (nextGate === 5 && !caseData.inspection_number) {
        // ออกเลขตรวจรับ
        payload.inspection_number = await ProcurementNumberingService.getNextInspectionNumber(caseData.fiscal_year);
        payload.inspection_date = new Date().toISOString().split('T')[0];
        payload.status = 'accepted';
      }

      if (updates.status === 'disbursed') {
        payload.disbursement_date = new Date().toISOString().split('T')[0];
      }

      if (nextGate === 6) {
        payload.current_gate = 6;
      }

      await onUpdateCase(payload);
      setActiveGateTab(nextGate);
    } catch (err: any) {
      console.error(err);
      alert(`เกิดข้อผิดพลาด: ${err.message}`);
    } finally {
      setUpdating(false);
    }
  };

  const getPolicyBadge = (code: string) => {
    switch (code) {
      case 'W119_10K':
        return <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">ว.119 (≤1หมื่น)</span>;
      case 'W119_100K':
        return <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-orange-100 text-orange-800 border border-orange-300">ว.119 (≤1แสน)</span>;
      case 'W089':
        return <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-blue-100 text-blue-800 border border-blue-300">ว.89 e-GP</span>;
      case 'W877':
        return <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-purple-100 text-purple-800 border border-purple-300">ว.877 (12 เดือน)</span>;
      case 'W523':
        return <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">ว.523 งานอาคาร</span>;
      case 'LUNCH':
        return <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-pink-100 text-pink-800 border border-pink-300">อาหารกลางวัน</span>;
      default:
        return <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-gray-100 text-gray-800">{code}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Header Toolbar */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs font-black bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-0.5 rounded">
                {caseData.pcid}
              </span>
              {getPolicyBadge(caseData.policy_code)}
              <span className="text-xs text-slate-400">ปีงบประมาณ {caseData.fiscal_year}</span>
            </div>
            <h1 className="text-xl font-black text-slate-800">{caseData.title}</h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setEditFormData({
                memo_number: caseData.memo_number || '',
                request_date: caseData.request_date || '',
                pr_number: caseData.pr_number || '',
                pr_approval_date: caseData.pr_approval_date || '',
                order_number: caseData.order_number || '',
                order_appointment_date: caseData.order_appointment_date || '',
                po_number: caseData.po_number || '',
                po_date: caseData.po_date || '',
                inspection_number: caseData.inspection_number || '',
                inspection_date: caseData.inspection_date || '',
                delivery_due_date: caseData.delivery_due_date || ''
              });
              setIsEditingNumbers(true);
            }}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-all cursor-pointer"
            title="ปรับแก้เลขที่หนังสือและวันที่ตามเอกสารจริง"
          >
            <Edit3 size={16} />
            <span>แก้ไขเลขที่/วันที่</span>
          </button>

          {/* Signature Option Segmented Toggle */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs">
            <button
              onClick={() => setIncludeSignatures(true)}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer font-bold flex items-center gap-1 ${
                includeSignatures 
                  ? 'bg-white text-blue-700 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <span>✍️ ใส่ลายเซ็นดิจิทัล</span>
            </button>
            <button
              onClick={() => setIncludeSignatures(false)}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer font-bold flex items-center gap-1 ${
                !includeSignatures 
                  ? 'bg-white text-emerald-700 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <span>📝 ปริ้นมาเซ็นสด</span>
            </button>
          </div>

          {onDeleteCase && (
            <button
              onClick={() => onDeleteCase(caseData.id)}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-xs transition-all cursor-pointer"
              title="ลบสำนวนนี้"
            >
              <Trash2 size={16} />
              <span>ลบสำนวนนี้</span>
            </button>
          )}

          <button
            onClick={() => onPrintBundle(includeSignatures)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-md transition-all cursor-pointer"
          >
            <Printer size={16} />
            <span>พิมพ์ชุดเอกสาร 1-Click {includeSignatures ? '(มีลายเซ็น)' : '(เซ็นสด)'}</span>
          </button>
        </div>
      </div>

      {/* Handover Custodian Banner */}
      <div className="bg-gradient-to-r from-blue-50 via-indigo-50 to-emerald-50 border border-blue-200 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold shadow-sm">
            {caseData.current_gate || 1}
          </div>
          <div>
            <div className="text-[11px] font-bold text-blue-600 uppercase tracking-wider">
              สายธารการส่งต่องาน (Handover Custody Chain)
            </div>
            <div className="text-sm font-black text-slate-800 flex items-center gap-2">
              <span>ขณะนี้เรื่องอยู่ในมือ:</span>
              <span className="text-blue-700 bg-white px-2.5 py-0.5 rounded-md border border-blue-200 shadow-xs">
                {caseData.current_gate === 1 && '👤 เจ้าหน้าที่ (จัดทำบันทึกขอซื้อ/จ้าง)'}
                {caseData.current_gate === 2 && '🧐 หัวหน้าเจ้าหน้าที่ (พิจารณาให้ความเห็นชอบ)'}
                {caseData.current_gate === 3 && '✍️ ผู้อำนวยการโรงเรียน (อนุมัติ & เจ้าหน้าที่ออก PO)'}
                {caseData.current_gate === 4 && '📦 ผู้ตรวจรับพัสดุ (ตรวจรับของ/งาน)'}
                {caseData.current_gate === 5 && (caseData.status === 'disbursed' ? '🏷️ เจ้าหน้าที่ (ลงทะเบียนคุม & ปิดแฟ้ม)' : '💰 เจ้าหน้าที่การเงิน (เบิกจ่ายเงิน)')}
                {caseData.current_gate >= 6 && '🏁 เจ้าหน้าที่ (ลงทะเบียนคุมและปิดแฟ้มสมบูรณ์)'}
              </span>
            </div>
          </div>
        </div>

        <div className="text-xs text-slate-500 font-medium">
          ผู้เสนอต้นเรื่อง: <span className="font-bold text-slate-700">{caseData.requester_name || 'เจ้าหน้าที่'}</span>
        </div>
      </div>

      {/* 2. Interactive 6 Control Steps Stepper */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <span className="font-black text-sm text-slate-800">ลำดับขั้นตอนการส่งต่องานจัดซื้อจัดจ้าง (6 Steps Workflow)</span>
          <span className="text-xs text-slate-500">คลิกที่ด่านเพื่อดูเอกสารหรือลงนาม</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {[
            { gate: 1, title: 'ขั้น 1: ขอซื้อ/จ้าง', desc: 'เจ้าหน้าที่', icon: <FileText size={16} /> },
            { gate: 2, title: 'ขั้น 2: รายงานพัสดุ', desc: 'หัวหน้าเจ้าหน้าที่', icon: <ShieldCheck size={16} /> },
            { gate: 3, title: 'ขั้น 3: สั่งซื้อ/สัญญา', desc: 'ผอ. / เจ้าหน้าที่', icon: <CheckCircle2 size={16} /> },
            { gate: 4, title: 'ขั้น 4: ตรวจรับ', desc: 'ผู้ตรวจรับพัสดุ', icon: <Clock size={16} /> },
            { gate: 5, title: 'ขั้น 5: เบิกจ่ายเงิน', desc: 'การเงิน & ผอ.', icon: <DollarSign size={16} /> },
            { gate: 6, title: 'ขั้น 6: ทะเบียนคุม', desc: 'เจ้าหน้าที่', icon: <Package size={16} /> }
          ].map((g) => {
            const isCurrent = (caseData.current_gate || 1) === g.gate;
            const isPassed = (caseData.current_gate || 1) > g.gate;
            const isSelected = activeGateTab === g.gate;

            return (
              <button
                key={g.gate}
                onClick={() => setActiveGateTab(g.gate)}
                className={`p-3 rounded-xl text-left border transition-all cursor-pointer relative overflow-hidden ${
                  isSelected 
                    ? 'border-blue-600 bg-blue-50/50 shadow-sm ring-2 ring-blue-500/20' 
                    : isPassed 
                    ? 'border-emerald-200 bg-emerald-50/30' 
                    : 'border-slate-200 bg-slate-50/50 hover:bg-slate-100/50'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold ${
                    isPassed ? 'bg-emerald-600 text-white' : isCurrent ? 'bg-blue-600 text-white animate-pulse' : 'bg-slate-200 text-slate-600'
                  }`}>
                    {isPassed ? <Check size={12} /> : g.gate}
                  </span>
                  {isCurrent && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-600 text-white">
                      ปัจจุบัน
                    </span>
                  )}
                </div>
                <div className="font-bold text-xs text-slate-800 line-clamp-1">{g.title}</div>
                <div className="text-[10px] text-slate-500 mt-0.5 truncate">{g.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Gate Content & Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left 2 Cols: Active Gate Operations */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
            
            {/* GATE 1 DETAILS */}
            {activeGateTab === 1 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="font-bold text-base text-slate-800">Gate 1: ความต้องการและงบประมาณ (Demand & Budget)</h3>
                    <p className="text-xs text-slate-500">เจ้าหน้าที่จัดทำบันทึกข้อความขออนุมัติหลักการจัดซื้อจัดจ้าง</p>
                  </div>
                  <button
                    onClick={() => onPrintDoc('request_memo', includeSignatures)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    <Printer size={14} />
                    <span>พิมพ์บันทึกขอซื้อ</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-xs text-slate-400 block">เลขที่บันทึกข้อความ:</span>
                    <span className="font-bold text-slate-700">{caseData.memo_number || 'ที่ ศธ 04225/...'}</span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-400 block">วันที่ขอ:</span>
                    <span className="font-bold text-slate-700">{caseData.request_date || '-'}</span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-400 block">วงเงินประมาณการ:</span>
                    <span className="font-bold text-blue-600 text-base">฿{amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-400 block">สถานะ:</span>
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600">
                      <CheckCircle2 size={14} /> อนุมัติหลักการแล้ว
                    </span>
                  </div>
                </div>

                {caseData.current_gate === 1 && (
                  <div className="pt-4 border-t border-slate-100">
                    <button
                      onClick={() => handleAdvanceGate(2)}
                      disabled={updating}
                      className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md cursor-pointer transition-all"
                    >
                      ส่งต่อหัวหน้าเจ้าหน้าที่ ➔ พิจารณารายงานข้อ 22 (Gate 2)
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* GATE 2 DETAILS */}
            {activeGateTab === 2 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="font-bold text-base text-slate-800">Gate 2: วิธีจัดหาและรายงานขอซื้อขอจ้าง (ข้อ 22)</h3>
                    <p className="text-xs text-slate-500">เจ้าหน้าที่และหัวหน้าเจ้าหน้าที่กลั่นกรองตามระเบียบ</p>
                  </div>
                  <button
                    onClick={() => onPrintDoc('report_clause_22', includeSignatures)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    <Printer size={14} />
                    <span>พิมพ์รายงานข้อ 22</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-xs text-slate-400 block">เลขที่รายงานขอซื้อ/จ้าง:</span>
                    <span className="font-bold text-slate-700">{caseData.pr_number || 'พด. ...'}</span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-400 block">วิธีจัดหา:</span>
                    <span className="font-bold text-slate-700">เฉพาะเจาะจง ตามมาตรา 56 (2) (ข)</span>
                  </div>
                </div>

                {caseData.current_gate === 2 && (
                  <div className="pt-4 border-t border-slate-100 flex items-center gap-3">
                    <button
                      onClick={() => handleAdvanceGate(3, { pr_approval_date: new Date().toISOString().split('T')[0] })}
                      disabled={updating}
                      className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold text-xs shadow-md cursor-pointer transition-all"
                    >
                      หัวหน้าเจ้าหน้าที่เห็นชอบ ➔ เสนอ ผอ. อนุมัติ & ออก PO (Gate 3)
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* GATE 3 DETAILS */}
            {activeGateTab === 3 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="font-bold text-base text-slate-800">Gate 3: สั่งซื้อสั่งจ้างและแต่งตั้งกรรมการ (Commitment & PO)</h3>
                    <p className="text-xs text-slate-500">ผู้อำนวยการลงนามคำสั่งแต่งตั้งและใบสั่งซื้อ/สัญญา</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onPrintDoc('appointment_order', includeSignatures)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      <Printer size={14} />
                      <span>พิมพ์คำสั่ง</span>
                    </button>
                    <button
                      onClick={() => onPrintDoc('po_order', includeSignatures)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      <Printer size={14} />
                      <span>{caseData.policy_code === 'W877' ? 'พิมพ์ข้อตกลงจ้าง ว.877' : 'พิมพ์ PO'}</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-xs text-slate-400 block">เลขที่คำสั่งแต่งตั้งกรรมการ:</span>
                    <span className="font-bold text-slate-700">{caseData.order_number || 'คำสั่งที่ ...'}</span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-400 block">
                      {caseData.policy_code === 'W877' ? 'เลขที่ข้อตกลงจ้าง (ว.877):' : 'เลขที่ใบสั่งซื้อ (PO):'}
                    </span>
                    <span className="font-bold text-slate-700">{caseData.po_number || 'PO-...'}</span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-400 block">ผู้ขาย/ผู้รับจ้าง:</span>
                    <span className="font-bold text-slate-700">{caseData.vendor_info?.name || '-'}</span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-400 block">กำหนดส่งมอบ:</span>
                    <span className="font-bold text-slate-700">
                      {caseData.policy_code === 'W877' ? 'ส่งมอบรายเดือน (ภายใน 5 วันทำการ)' : (caseData.delivery_due_date || 'ภายใน 15 วันทำการ')}
                    </span>
                  </div>
                </div>

                {caseData.current_gate === 3 && (
                  <div className="pt-4 border-t border-slate-100">
                    <button
                      onClick={() => handleAdvanceGate(4)}
                      disabled={updating}
                      className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-md cursor-pointer transition-all"
                    >
                      {caseData.policy_code === 'W877' 
                        ? 'ส่งมอบงานจ้างแล้ว ➔ ส่งต่อผู้ตรวจรับพัสดุ (Gate 4)' 
                        : 'ผู้ขายส่งมอบพัสดุแล้ว ➔ ส่งต่อผู้ตรวจรับพัสดุ (Gate 4)'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* GATE 4 DETAILS */}
            {activeGateTab === 4 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="font-bold text-base text-slate-800">
                      {caseData.policy_code === 'W877' 
                        ? 'Gate 4: ตรวจรับผลงานจ้างรายเดือน (Monthly Service Acceptance)' 
                        : 'Gate 4: ส่งมอบและตรวจรับพัสดุ (Delivery & Acceptance)'}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {caseData.policy_code === 'W877' 
                        ? 'คณะกรรมการตรวจรับพัสดุลงนามรับรองผลการปฏิบัติงานตาม TOR เพื่อเบิกจ่ายรายเดือน' 
                        : 'คณะกรรมการตรวจรับพัสดุลงนามตรวจรับของจริง'}
                    </p>
                  </div>
                  <button
                    onClick={() => onPrintDoc('inspection_report', includeSignatures)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    <Printer size={14} />
                    <span>{caseData.policy_code === 'W877' ? 'พิมพ์ใบตรวจรับรายเดือน' : 'พิมพ์ใบตรวจรับ'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-xs text-slate-400 block">เลขที่ใบตรวจรับ:</span>
                    <span className="font-bold text-slate-700">{caseData.inspection_number || 'ตรวจรับ ...'}</span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-400 block">วันที่ตรวจรับจริง:</span>
                    <span className="font-bold text-slate-700">{caseData.inspection_date || caseData.actual_delivery_date || '-'}</span>
                  </div>
                </div>

                {/* รายชื่อกรรมการผู้ตรวจรับ */}
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
                  <span className="font-bold text-slate-700">คณะกรรมการตรวจรับพัสดุ:</span>
                  <div className="space-y-1 pt-1">
                    {caseData.committee_members?.map((m: any, i: number) => (
                      <div key={i} className="flex items-center justify-between">
                        <span>{i + 1}. {m.name} ({m.role})</span>
                        <span className="text-emerald-600 font-bold flex items-center gap-1">
                          <Check size={12} /> ตรวจรับแล้ว
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {caseData.current_gate === 4 && (
                  <div className="pt-4 border-t border-slate-100">
                    <button
                      onClick={() => handleAdvanceGate(5)}
                      disabled={updating}
                      className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md cursor-pointer transition-all"
                    >
                      ผู้ตรวจรับพัสดุลงนามตรวจรับเรียบร้อย ➔ ส่งต่อเจ้าหน้าที่การเงินเบิกจ่าย (Gate 5)
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* GATE 5 DETAILS */}
            {activeGateTab === 5 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="font-bold text-base text-slate-800">Gate 5: เบิกจ่ายเงินและปิดยอด (Disbursement & Close)</h3>
                    <p className="text-xs text-slate-500">เจ้าหน้าที่การเงินตรวจสอบหลักฐาน หักภาษี ณ ที่จ่าย และ ผอ. อนุมัติจ่าย</p>
                  </div>
                </div>

                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2 text-xs">
                  <div className="flex items-center justify-between font-bold text-emerald-900 text-sm">
                    <span>ยอดเงินที่ต้องจ่าย:</span>
                    <span>฿{amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600">
                    <span>หักภาษี ณ ที่จ่าย (ถ้ามี 1% นิติบุคคลเกิน 1 พัน):</span>
                    <span>฿{(amount >= 1000 ? amount * 0.01 : 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex items-center justify-between font-bold text-slate-800 pt-2 border-t border-emerald-200">
                    <span>ยอดจ่ายสุทธิ:</span>
                    <span>฿{(amount >= 1000 ? amount * 0.99 : amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>

                {caseData.status !== 'disbursed' ? (
                  <div className="pt-4 border-t border-slate-100">
                    <button
                      onClick={() => handleAdvanceGate(5, { status: 'disbursed' })}
                      disabled={updating}
                      className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold text-xs shadow-md cursor-pointer transition-all"
                    >
                      ผู้อำนวยการอนุมัติจ่ายเงิน & ตัดยอดงบประมาณสำเร็จ
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3 pt-4 border-t border-slate-100">
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800 font-bold flex items-center gap-2">
                      <CheckCircle2 size={16} className="text-blue-600" />
                      <span>สำนวนจัดซื้อจัดจ้างนี้ได้รับการเบิกจ่ายเงินและตัดงบประมาณเรียบร้อยแล้ว</span>
                    </div>

                    <button
                      onClick={() => handleAdvanceGate(6)}
                      disabled={updating}
                      className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md cursor-pointer transition-all"
                    >
                      ส่งต่อเจ้าหน้าที่ ➔ ลงทะเบียนคุมพัสดุและครุภัณฑ์ (Gate 6)
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* GATE 6 DETAILS: ทะเบียนคุมพัสดุและครุภัณฑ์ */}
            {activeGateTab === 6 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="font-bold text-base text-slate-800">Gate 6: ลงทะเบียนคุมพัสดุและครุภัณฑ์ (Asset & Supplies Registry)</h3>
                    <p className="text-xs text-slate-500">เจ้าหน้าที่นำรายการพัสดุลงทะเบียนคุมตามระเบียบกระทรวงการคลังฯ หมวด 9 และปิดแฟ้ม</p>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 text-xs">
                  <div className="font-bold text-slate-700">รายการพัสดุที่จะนำเข้าทะเบียนคุม ({items.length} รายการ):</div>
                  <div className="space-y-1">
                    {items.map((it, i) => (
                      <div key={i} className="flex items-center justify-between bg-white p-2.5 rounded-xl border border-slate-100">
                        <span className="font-medium text-slate-800">{i + 1}. {it.item_name} ({it.quantity} {it.unit})</span>
                        <span className="font-bold text-slate-600">฿{Number(it.total_price).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100">
                  {isRegisteredToInventory ? (
                    <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl space-y-2">
                      <div className="flex items-center gap-2 text-emerald-800 font-bold text-xs">
                        <CheckCircle2 size={16} className="text-emerald-600" />
                        <span>ลงทะเบียนในระบบทะเบียนคุมพัสดุและครุภัณฑ์เรียบร้อยแล้ว</span>
                      </div>
                      <p className="text-[11px] text-emerald-700">
                        ระบบได้สร้างรหัสครุภัณฑ์และบันทึกสต็อกวัสดุสิ้นเปลืองให้เรียบร้อยแล้ว สามารถดูสติกเกอร์รหัสครุภัณฑ์และคุมยอดได้ที่แท็บ "ระบบทะเบียนคุมพัสดุและครุภัณฑ์"
                      </p>
                    </div>
                  ) : (
                    <button
                      onClick={handleRegisterToInventory}
                      disabled={updating}
                      className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black text-sm shadow-md cursor-pointer transition-all"
                    >
                      <Package size={18} />
                      <span>เจ้าหน้าที่ลงทะเบียนคุมพัสดุ/ครุภัณฑ์อัตโนมัติ (1-Click Register)</span>
                    </button>
                  )}
                </div>
              </div>
            )}

          </div>

          {/* Items Table */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <div className="font-bold text-sm text-slate-800">รายการพัสดุในสำนวน ({items.length} รายการ)</div>
            <div className="border border-slate-100 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 font-bold">
                  <tr>
                    <th className="p-2.5 text-center w-10">#</th>
                    <th className="p-2.5">รายการ</th>
                    <th className="p-2.5 text-center">จำนวน</th>
                    <th className="p-2.5 text-right">ราคา/หน่วย</th>
                    <th className="p-2.5 text-right">รวมเงิน</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((it, idx) => (
                    <tr key={idx}>
                      <td className="p-2.5 text-center text-slate-400 font-bold">{idx + 1}</td>
                      <td className="p-2.5 font-medium text-slate-800">{it.item_name}</td>
                      <td className="p-2.5 text-center">{it.quantity} {it.unit}</td>
                      <td className="p-2.5 text-right">฿{Number(it.unit_price).toLocaleString()}</td>
                      <td className="p-2.5 text-right font-bold text-slate-800">฿{Number(it.total_price).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right 1 Col: Linked Documents & Audit Log */}
        <div className="space-y-6">
          
          {/* Linked Documents Card */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-slate-800">เอกสารในสายงานพัสดุ</span>
              <span className="text-[10px] text-slate-400">คลิกเพื่อพิมพ์</span>
            </div>

            <div className="space-y-2">
              <button
                onClick={() => onPrintDoc('request_memo')}
                className="w-full p-2.5 rounded-xl border border-slate-100 hover:border-blue-300 hover:bg-blue-50/50 flex items-center justify-between text-xs text-left transition-all cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-blue-600" />
                  <div>
                    <div className="font-bold text-slate-700">1. บันทึกขออนุมัติหลักการ</div>
                    <div className="text-[10px] text-slate-400">{caseData.memo_number || 'สมุด memos'}</div>
                  </div>
                </div>
                <Printer size={14} className="text-slate-400" />
              </button>

              <button
                onClick={() => onPrintDoc('report_clause_22')}
                className="w-full p-2.5 rounded-xl border border-slate-100 hover:border-blue-300 hover:bg-blue-50/50 flex items-center justify-between text-xs text-left transition-all cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-indigo-600" />
                  <div>
                    <div className="font-bold text-slate-700">2. รายงานขอซื้อขอจ้าง ข้อ 22</div>
                    <div className="text-[10px] text-slate-400">{caseData.pr_number || 'งานพัสดุ'}</div>
                  </div>
                </div>
                <Printer size={14} className="text-slate-400" />
              </button>

              <button
                onClick={() => onPrintDoc('appointment_order')}
                className="w-full p-2.5 rounded-xl border border-slate-100 hover:border-blue-300 hover:bg-blue-50/50 flex items-center justify-between text-xs text-left transition-all cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-purple-600" />
                  <div>
                    <div className="font-bold text-slate-700">3. คำสั่งแต่งตั้งกรรมการตรวจรับ</div>
                    <div className="text-[10px] text-slate-400">{caseData.order_number || 'สมุด orders'}</div>
                  </div>
                </div>
                <Printer size={14} className="text-slate-400" />
              </button>

              <button
                onClick={() => onPrintDoc('po_order')}
                className="w-full p-2.5 rounded-xl border border-slate-100 hover:border-blue-300 hover:bg-blue-50/50 flex items-center justify-between text-xs text-left transition-all cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-amber-600" />
                  <div>
                    <div className="font-bold text-slate-700">4. ใบสั่งซื้อ/สั่งจ้าง (PO)</div>
                    <div className="text-[10px] text-slate-400">{caseData.po_number || 'คุมสัญญา'}</div>
                  </div>
                </div>
                <Printer size={14} className="text-slate-400" />
              </button>

              <button
                onClick={() => onPrintDoc('inspection_report')}
                className="w-full p-2.5 rounded-xl border border-slate-100 hover:border-blue-300 hover:bg-blue-50/50 flex items-center justify-between text-xs text-left transition-all cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-emerald-600" />
                  <div>
                    <div className="font-bold text-slate-700">5. ใบตรวจรับพัสดุ</div>
                    <div className="text-[10px] text-slate-400">{caseData.inspection_number || 'คุมตรวจรับ'}</div>
                  </div>
                </div>
                <Printer size={14} className="text-slate-400" />
              </button>
            </div>
          </div>

          {/* Vendor Info Card */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2 text-xs">
            <span className="font-bold text-sm text-slate-800 block">ข้อมูลร้านค้าผู้ขาย</span>
            <div className="text-slate-700"><b>ชื่อ:</b> {caseData.vendor_info?.name || '-'}</div>
            <div className="text-slate-700"><b>เลขผู้เสียภาษี:</b> {caseData.vendor_info?.tax_id || '-'}</div>
            <div className="text-slate-700"><b>ที่อยู่:</b> {caseData.vendor_info?.address || '-'}</div>
            <div className="text-slate-700"><b>โทรศัพท์:</b> {caseData.vendor_info?.phone || '-'}</div>
          </div>

        </div>

      </div>

      {/* Edit Numbers & Dates Modal */}
      {isEditingNumbers && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="font-bold text-base text-slate-800">ปรับแก้เลขที่เอกสารและวันที่ตามจริง</h3>
                <p className="text-xs text-slate-500">สามารถแก้ไขให้ตรงกับสมุดทะเบียนคุมหรือเอกสารราชการจริงของโรงเรียนได้</p>
              </div>
              <button
                onClick={() => setIsEditingNumbers(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto p-1">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">เลขที่บันทึกข้อความ (ขออนุมัติ)</label>
                <input
                  type="text"
                  value={editFormData.memo_number}
                  onChange={(e) => setEditFormData({ ...editFormData, memo_number: e.target.value })}
                  placeholder="เช่น ที่ ศธ 04225/12"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-medium focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">วันที่ขออนุมัติ</label>
                <input
                  type="date"
                  value={editFormData.request_date}
                  onChange={(e) => setEditFormData({ ...editFormData, request_date: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-medium focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">เลขที่รายงานขอซื้อ/จ้าง (พด.)</label>
                <input
                  type="text"
                  value={editFormData.pr_number}
                  onChange={(e) => setEditFormData({ ...editFormData, pr_number: e.target.value })}
                  placeholder="เช่น พด. 12/2569"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-medium focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">วันที่เห็นชอบรายงานข้อ 22</label>
                <input
                  type="date"
                  value={editFormData.pr_approval_date}
                  onChange={(e) => setEditFormData({ ...editFormData, pr_approval_date: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-medium focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">เลขที่คำสั่งแต่งตั้ง กก.ตรวจรับ</label>
                <input
                  type="text"
                  value={editFormData.order_number}
                  onChange={(e) => setEditFormData({ ...editFormData, order_number: e.target.value })}
                  placeholder="เช่น คำสั่งที่ 28/2569"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-medium focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">วันที่สั่งแต่งตั้ง</label>
                <input
                  type="date"
                  value={editFormData.order_appointment_date}
                  onChange={(e) => setEditFormData({ ...editFormData, order_appointment_date: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-medium focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  {caseData.policy_code === 'W877' ? 'เลขที่ข้อตกลงจ้าง (ว.877)' : 'เลขที่ใบสั่งซื้อ (PO)'}
                </label>
                <input
                  type="text"
                  value={editFormData.po_number}
                  onChange={(e) => setEditFormData({ ...editFormData, po_number: e.target.value })}
                  placeholder="เช่น PO-12/2569 หรือ 12/2569"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-medium focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  {caseData.policy_code === 'W877' ? 'วันที่ทำข้อตกลงจ้าง' : 'วันที่ออกใบสั่งซื้อ (PO)'}
                </label>
                <input
                  type="date"
                  value={editFormData.po_date}
                  onChange={(e) => setEditFormData({ ...editFormData, po_date: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-medium focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">เลขที่ใบตรวจรับพัสดุ</label>
                <input
                  type="text"
                  value={editFormData.inspection_number}
                  onChange={(e) => setEditFormData({ ...editFormData, inspection_number: e.target.value })}
                  placeholder="เช่น ตรวจรับ 12/2569"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-medium focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">วันที่ตรวจรับจริง</label>
                <input
                  type="date"
                  value={editFormData.inspection_date}
                  onChange={(e) => setEditFormData({ ...editFormData, inspection_date: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-medium focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t">
              <button
                onClick={() => setIsEditingNumbers(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleSaveNumbers}
                disabled={updating}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md cursor-pointer disabled:opacity-50"
              >
                {updating ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
