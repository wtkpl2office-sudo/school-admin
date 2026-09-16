import React from 'react';
import { 
  Plus, 
  Search, 
  Filter, 
  FileText, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Printer, 
  ArrowRight,
  TrendingUp,
  Package,
  Layers,
  ChevronRight,
  Trash2,
  RotateCcw
} from 'lucide-react';

interface CaseSummary {
  id: string;
  pcid: string;
  title: string;
  category: string;
  policy_code: string;
  estimated_amount: number;
  final_amount: number;
  current_gate: number;
  status: string;
  requester_name?: string;
  created_at: string;
}

interface ProcurementDashboardProps {
  cases: CaseSummary[];
  loading: boolean;
  selectedGate: number | null;
  selectedPolicy: string | null;
  searchTerm: string;
  hasDemoCases?: boolean;
  onClearAllDemos?: () => void;
  onRestoreDemos?: () => void;
  onDeleteCase?: (caseId: string) => void;
  onSelectGate: (gate: number | null) => void;
  onSelectPolicy: (policy: string | null) => void;
  onSearchChange: (term: string) => void;
  onOpenWizard: () => void;
  onSelectCase: (caseId: string) => void;
  onQuickPrint: (caseItem: CaseSummary) => void;
}

export const ProcurementDashboard: React.FC<ProcurementDashboardProps> = ({
  cases,
  loading,
  selectedGate,
  selectedPolicy,
  searchTerm,
  hasDemoCases,
  onClearAllDemos,
  onRestoreDemos,
  onDeleteCase,
  onSelectGate,
  onSelectPolicy,
  onSearchChange,
  onOpenWizard,
  onSelectCase,
  onQuickPrint
}) => {
  // คำนวณสถิติ
  const totalAmount = cases.reduce((acc, c) => acc + (Number(c.final_amount) || Number(c.estimated_amount) || 0), 0);
  const pendingApprovalCount = cases.filter(c => c.current_gate === 2 || c.current_gate === 3).length;
  const pendingInspectCount = cases.filter(c => c.current_gate === 4).length;
  const completedCount = cases.filter(c => c.current_gate === 5 || c.status === 'disbursed').length;

  // กรองตามการค้นหา และตัวกรอง
  const filteredCases = cases.filter(c => {
    const matchSearch = c.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        c.pcid.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        (c.requester_name && c.requester_name.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchGate = selectedGate === null || c.current_gate === selectedGate;
    const matchPolicy = selectedPolicy === null || c.policy_code === selectedPolicy;
    return matchSearch && matchGate && matchPolicy;
  });

  const getPolicyBadge = (code: string) => {
    switch (code) {
      case 'W119_10K':
        return <span className="px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">ว.119 (≤1หมื่น)</span>;
      case 'W119_100K':
        return <span className="px-2 py-0.5 rounded text-xs font-bold bg-orange-100 text-orange-800 border border-orange-300">ว.119 (≤1แสน)</span>;
      case 'W089':
        return <span className="px-2 py-0.5 rounded text-xs font-bold bg-blue-100 text-blue-800 border border-blue-300">ว.89 e-GP</span>;
      case 'W877':
        return <span className="px-2 py-0.5 rounded text-xs font-bold bg-purple-100 text-purple-800 border border-purple-300">ว.877 (12 เดือน)</span>;
      case 'W523':
        return <span className="px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">ว.523 งานอาคาร</span>;
      case 'LUNCH':
        return <span className="px-2 py-0.5 rounded text-xs font-bold bg-pink-100 text-pink-800 border border-pink-300">อาหารกลางวัน</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-xs font-bold bg-gray-100 text-gray-800">{code}</span>;
    }
  };

  const getGateLabel = (gate: number) => {
    switch (gate) {
      case 1: return { text: 'Gate 1: ขอความต้องการ', color: 'bg-slate-100 text-slate-700' };
      case 2: return { text: 'Gate 2: รายงานพัสดุ (ข้อ 22)', color: 'bg-indigo-100 text-indigo-700' };
      case 3: return { text: 'Gate 3: สั่งซื้อ/สัญญา (PO)', color: 'bg-blue-100 text-blue-700' };
      case 4: return { text: 'Gate 4: รอตรวจรับพัสดุ', color: 'bg-amber-100 text-amber-700 font-bold animate-pulse' };
      case 5: return { text: 'Gate 5: เบิกจ่ายเงินแล้ว', color: 'bg-emerald-100 text-emerald-700 font-bold' };
      default: return { text: `Gate ${gate}`, color: 'bg-gray-100 text-gray-700' };
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Header & Quick Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 p-6 rounded-2xl text-white shadow-xl">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-500/30 text-blue-200 border border-blue-400/40">
              Clean Architecture 2026
            </span>
            <span className="text-xs text-blue-200">สพป.พัทลุง เขต 2</span>
          </div>
          <h1 className="text-2xl font-black tracking-tight">ระบบสำนวนจัดซื้อจัดจ้างอิเล็กทรอนิกส์ (EPCM)</h1>
          <p className="text-sm text-blue-200 mt-1">
            บริหารห่วงโซ่การออกเลข เชื่อมโยง 6 บทบาท 5 ด่านควบคุม คัดแยกตาม ว.119 / ว.89 / ว.877 / ว.523 อัตโนมัติ
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasDemoCases ? (
            <button
              onClick={onClearAllDemos}
              className="flex items-center justify-center gap-1.5 px-3.5 py-3 rounded-xl bg-white/10 hover:bg-rose-500/30 text-rose-200 hover:text-white border border-rose-400/30 font-bold text-xs transition-all cursor-pointer"
              title="ล้างข้อมูลตัวอย่างทั้งหมดออกจากระบบ เมื่อเข้าใจการทำงานแล้ว"
            >
              <Trash2 size={16} />
              <span>ล้างข้อมูลตัวอย่าง</span>
            </button>
          ) : (
            <button
              onClick={onRestoreDemos}
              className="flex items-center justify-center gap-1.5 px-3.5 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-blue-200 hover:text-white border border-white/20 font-bold text-xs transition-all cursor-pointer"
              title="โหลดข้อมูลตัวอย่าง 4 คดีหลักกลับมาศึกษาใหม่"
            >
              <RotateCcw size={16} />
              <span>โหลดข้อมูลตัวอย่าง</span>
            </button>
          )}
          <button
            onClick={onOpenWizard}
            className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-bold shadow-lg shadow-emerald-500/25 transition-all cursor-pointer transform hover:-translate-y-0.5"
          >
            <Plus size={20} />
            <span>เปิดเรื่องจัดซื้อจัดจ้างใหม่</span>
          </button>
        </div>
      </div>

      {/* Demo Banner */}
      {hasDemoCases && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3.5 px-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs shadow-sm">
          <div className="flex items-center gap-2">
            <span className="font-bold bg-amber-200 text-amber-900 px-2 py-0.5 rounded text-[10px] shrink-0">โหมดเรียนรู้</span>
            <span>ระบบกำลังแสดงสำนวนตัวอย่าง 4 เคส (ว.119, ว.89, ว.877, ว.523) เมื่อทดลองศึกษาจนเข้าใจแล้ว สามารถกดลบทีละเรื่อง หรือกดปุ่ม <strong>"ล้างข้อมูลตัวอย่าง"</strong> ได้ทันที</span>
          </div>
          <button
            onClick={onClearAllDemos}
            className="text-amber-800 font-bold hover:text-rose-700 underline cursor-pointer shrink-0 ml-auto sm:ml-2"
          >
            ล้างตัวอย่างทั้งหมด
          </button>
        </div>
      )}

      {/* 2. Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Layers size={24} />
          </div>
          <div>
            <div className="text-xs text-slate-500 font-medium">เรื่องทั้งหมดในระบบ</div>
            <div className="text-2xl font-bold text-slate-800">{cases.length} <span className="text-sm font-normal text-slate-500">สำนวน</span></div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <Clock size={24} />
          </div>
          <div>
            <div className="text-xs text-slate-500 font-medium">รออนุมัติ / ออก PO</div>
            <div className="text-2xl font-bold text-indigo-600">{pendingApprovalCount} <span className="text-sm font-normal text-slate-500">เรื่อง</span></div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <AlertCircle size={24} />
          </div>
          <div>
            <div className="text-xs text-slate-500 font-medium">รอกรรมการตรวจรับ</div>
            <div className="text-2xl font-bold text-amber-600">{pendingInspectCount} <span className="text-sm font-normal text-slate-500">เรื่อง</span></div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <TrendingUp size={24} />
          </div>
          <div>
            <div className="text-xs text-slate-500 font-medium">มูลค่ารวมงบประมาณ</div>
            <div className="text-2xl font-bold text-emerald-600">
              ฿{totalAmount.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Filter & Search Toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
        <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="ค้นหาชื่อเรื่อง, เลข PCID, หรือผู้ขอ..."
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Filter Gate Buttons */}
          <div className="flex flex-wrap items-center gap-1.5 w-full md:w-auto">
            <button
              onClick={() => onSelectGate(null)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                selectedGate === null ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              ทุกด่าน
            </button>
            {[1, 2, 3, 4, 5].map((g) => (
              <button
                key={g}
                onClick={() => onSelectGate(g)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                  selectedGate === g ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Gate {g}
              </button>
            ))}
          </div>
        </div>

        {/* Filter Policy Buttons */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
          <span className="text-xs text-slate-400 font-medium mr-1 flex items-center gap-1">
            <Filter size={12} /> ระเบียบ:
          </span>
          <button
            onClick={() => onSelectPolicy(null)}
            className={`px-2.5 py-1 rounded text-xs cursor-pointer ${
              selectedPolicy === null ? 'bg-blue-50 text-blue-700 font-bold border border-blue-200' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            ทั้งหมด
          </button>
          {[
            { code: 'W119_10K', label: 'ว.119 (≤1หมื่น)' },
            { code: 'W119_100K', label: 'ว.119 (≤1แสน)' },
            { code: 'W089', label: 'ว.89 e-GP' },
            { code: 'W877', label: 'ว.877 (12 เดือน)' },
            { code: 'W523', label: 'ว.523 ก่อสร้าง' },
            { code: 'LUNCH', label: 'อาหารกลางวัน' }
          ].map(p => (
            <button
              key={p.code}
              onClick={() => onSelectPolicy(p.code)}
              className={`px-2.5 py-1 rounded text-xs cursor-pointer transition-colors ${
                selectedPolicy === p.code ? 'bg-blue-600 text-white font-bold' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* 4. Case Cards Grid */}
      {loading ? (
        <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
          <div className="inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="mt-3 text-sm text-slate-500">กำลังโหลดข้อมูลสำนวนจัดซื้อจัดจ้าง...</p>
        </div>
      ) : filteredCases.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
          <Package className="mx-auto text-slate-300 mb-3" size={48} />
          <h3 className="text-base font-bold text-slate-700">ไม่พบสำนวนจัดซื้อจัดจ้าง</h3>
          <p className="text-xs text-slate-400 mt-1">เริ่มเปิดเรื่องใหม่ หรือลองเปลี่ยนตัวกรองค้นหา</p>
          <button
            onClick={onOpenWizard}
            className="mt-4 px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 cursor-pointer"
          >
            เปิดเรื่องจัดซื้อจัดจ้างใหม่
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCases.map((c) => {
            const gate = getGateLabel(c.current_gate);
            const amount = Number(c.final_amount) || Number(c.estimated_amount) || 0;
            return (
              <div
                key={c.id}
                className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all p-5 flex flex-col justify-between group cursor-pointer"
                onClick={() => onSelectCase(c.id)}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="font-mono text-xs font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                      {c.pcid}
                    </span>
                    {getPolicyBadge(c.policy_code)}
                  </div>

                  <h3 className="font-bold text-slate-800 text-base line-clamp-2 group-hover:text-blue-600 transition-colors">
                    {c.title}
                  </h3>

                  <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                    <span>ผู้ขอ: {c.requester_name || 'ไม่ระบุ'}</span>
                    <span className="font-bold text-slate-800 text-sm">
                      ฿{amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${gate.color}`}>
                    {gate.text}
                  </span>

                  <div className="flex items-center gap-1">
                    {onDeleteCase && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteCase(c.id);
                        }}
                        title="ลบสำนวนนี้"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onQuickPrint(c);
                      }}
                      title="พิมพ์ชุดเอกสาร"
                      className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer"
                    >
                      <Printer size={16} />
                    </button>
                    <ChevronRight size={18} className="text-slate-400 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
