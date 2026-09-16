import React, { useState, useEffect } from 'react';
import { 
  Package, 
  Tag, 
  Search, 
  Filter, 
  Plus, 
  Printer, 
  QrCode, 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  Calendar, 
  Building, 
  User, 
  Edit, 
  Trash2, 
  ArrowDownRight, 
  ArrowUpRight, 
  DollarSign, 
  FileSpreadsheet, 
  Layers,
  X,
  Check,
  ChevronRight
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

export interface AssetRecord {
  id: string;
  asset_code: string;
  name: string;
  brand_model?: string;
  serial_number?: string;
  category: string;
  acquired_date: string;
  po_number?: string;
  inspection_number?: string;
  budget_source: string;
  unit_price: number;
  quantity: number;
  location: string;
  custodian_name: string;
  status: 'active' | 'repair_needed' | 'disposed';
  remarks?: string;
}

export interface SupplyRecord {
  id: string;
  item_code: string;
  name: string;
  category: string;
  unit: string;
  quantity_received: number;
  quantity_dispensed: number;
  quantity_remaining: number;
  unit_price: number;
  total_value: number;
  storage_location: string;
  last_restocked_date: string;
}

const DEMO_ASSETS: AssetRecord[] = [
  {
    id: 'ast-1',
    asset_code: '7110-001-0001/2569',
    name: 'คอมพิวเตอร์ประมวลผล All-in-One Core i5',
    brand_model: 'ASUS Vivo AIO 24 M3400',
    serial_number: 'SN-ASUS-2569001',
    category: 'ครุภัณฑ์คอมพิวเตอร์',
    acquired_date: '2026-09-15',
    po_number: 'PO-15/2569',
    inspection_number: 'ตรวจรับ 15/2569',
    budget_source: 'เงินอุดหนุนรายหัวนักเรียน',
    unit_price: 19500,
    quantity: 1,
    location: 'ห้องปฏิบัติการคอมพิวเตอร์ 1',
    custodian_name: 'ประสิทธิ์ มั่นคง',
    status: 'active',
    remarks: 'จัดซื้อจากงวดงบประมาณ 2569'
  },
  {
    id: 'ast-2',
    asset_code: '7110-001-0002/2569',
    name: 'คอมพิวเตอร์ประมวลผล All-in-One Core i5',
    brand_model: 'ASUS Vivo AIO 24 M3400',
    serial_number: 'SN-ASUS-2569002',
    category: 'ครุภัณฑ์คอมพิวเตอร์',
    acquired_date: '2026-09-15',
    po_number: 'PO-15/2569',
    inspection_number: 'ตรวจรับ 15/2569',
    budget_source: 'เงินอุดหนุนรายหัวนักเรียน',
    unit_price: 19500,
    quantity: 1,
    location: 'ห้องปฏิบัติการคอมพิวเตอร์ 1',
    custodian_name: 'สุดา จันทร์สว่าง',
    status: 'active'
  },
  {
    id: 'ast-3',
    asset_code: '7110-002-0001/2569',
    name: 'เครื่องพิมพ์ Multifunction Ink Tank',
    brand_model: 'Brother DCP-T720DW',
    serial_number: 'SN-BROTHER-9988',
    category: 'ครุภัณฑ์คอมพิวเตอร์',
    acquired_date: '2026-09-15',
    po_number: 'PO-15/2569',
    inspection_number: 'ตรวจรับ 15/2569',
    budget_source: 'เงินรายได้สถานศึกษา',
    unit_price: 6500,
    quantity: 1,
    location: 'ห้องธุรการ-สารบรรณ',
    custodian_name: 'สมหมาย ใจดี',
    status: 'active'
  }
];

const DEMO_SUPPLIES: SupplyRecord[] = [
  {
    id: 'sup-1',
    item_code: 'SUP-2569-001',
    name: 'กระดาษถ่ายเอกสาร A4 80 แกรม (Double A)',
    category: 'วัสดุสำนักงาน',
    unit: 'รีม',
    quantity_received: 50,
    quantity_dispensed: 20,
    quantity_remaining: 30,
    unit_price: 130,
    total_value: 3900,
    storage_location: 'ตู้เก็บพัสดุห้องธุรการ ชั้น 1',
    last_restocked_date: '2026-09-02'
  },
  {
    id: 'sup-2',
    item_code: 'SUP-2569-002',
    name: 'หมึกพิมพ์เลเซอร์ Brother TN-2460',
    category: 'วัสดุคอมพิวเตอร์',
    unit: 'กล่อง',
    quantity_received: 5,
    quantity_dispensed: 2,
    quantity_remaining: 3,
    unit_price: 1550,
    total_value: 4650,
    storage_location: 'ตู้ล็อกเกอร์ฝ่ายวิชาการ',
    last_restocked_date: '2026-09-02'
  },
  {
    id: 'sup-3',
    item_code: 'SUP-2569-003',
    name: 'ปากกาเคมีและไวท์บอร์ด คละสี (ตราม้า)',
    category: 'วัสดุการศึกษา',
    unit: 'ด้าม',
    quantity_received: 60,
    quantity_dispensed: 45,
    quantity_remaining: 15,
    unit_price: 25,
    total_value: 375,
    storage_location: 'กล่องพัสดุกลางห้องพักครู',
    last_restocked_date: '2026-09-02'
  }
];

interface AssetSuppliesRegistryProps {
  onBack?: () => void;
  teachers?: any[];
}

export const AssetSuppliesRegistry: React.FC<AssetSuppliesRegistryProps> = ({ onBack, teachers = [] }) => {
  const [activeTab, setActiveTab] = useState<'assets' | 'supplies'>('assets');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');

  // State สำหรับ Assets และ Supplies
  const [assets, setAssets] = useState<AssetRecord[]>(() => {
    const saved = localStorage.getItem('school_asset_registry');
    return saved ? JSON.parse(saved) : DEMO_ASSETS;
  });

  const [supplies, setSupplies] = useState<SupplyRecord[]>(() => {
    const saved = localStorage.getItem('school_supplies_inventory');
    return saved ? JSON.parse(saved) : DEMO_SUPPLIES;
  });

  // Modals State
  const [isAddAssetModalOpen, setIsAddAssetModalOpen] = useState(false);
  const [isAddSupplyModalOpen, setIsAddSupplyModalOpen] = useState(false);
  const [isDispenseModalOpen, setIsDispenseModalOpen] = useState(false);
  const [selectedSupplyForDispense, setSelectedSupplyForDispense] = useState<SupplyRecord | null>(null);

  // Form States
  const [assetForm, setAssetForm] = useState({
    name: '',
    brand_model: '',
    serial_number: '',
    category: 'ครุภัณฑ์คอมพิวเตอร์',
    acquired_date: new Date().toISOString().split('T')[0],
    po_number: '',
    inspection_number: '',
    budget_source: 'เงินอุดหนุนรายหัวนักเรียน',
    unit_price: 0,
    location: 'อาคารเรียน 1',
    custodian_name: '',
    status: 'active' as 'active' | 'repair_needed' | 'disposed',
    remarks: ''
  });

  const [supplyForm, setSupplyForm] = useState({
    name: '',
    category: 'วัสดุสำนักงาน',
    unit: 'ชิ้น',
    quantity_received: 1,
    unit_price: 0,
    storage_location: 'ตู้เก็บพัสดุห้องธุรการ'
  });

  const [dispenseForm, setDispenseForm] = useState({
    quantity: 1,
    requester_name: '',
    department: 'ฝ่ายวิชาการ',
    note: ''
  });

  // บันทึกลง localStorage เสมอ
  useEffect(() => {
    localStorage.setItem('school_asset_registry', JSON.stringify(assets));
  }, [assets]);

  useEffect(() => {
    localStorage.setItem('school_supplies_inventory', JSON.stringify(supplies));
  }, [supplies]);

  // Handler: เพิ่มครุภัณฑ์ใหม่
  const handleSaveAsset = (e: React.FormEvent) => {
    e.preventDefault();
    if (!assetForm.name.trim()) return;

    // เจนรหัสครุภัณฑ์อัตโนมัติ
    const nextSeq = String(assets.length + 1).padStart(4, '0');
    const asset_code = `7110-001-${nextSeq}/2569`;

    const newRecord: AssetRecord = {
      id: `ast-${Date.now()}`,
      asset_code,
      name: assetForm.name,
      brand_model: assetForm.brand_model,
      serial_number: assetForm.serial_number,
      category: assetForm.category,
      acquired_date: assetForm.acquired_date,
      po_number: assetForm.po_number,
      inspection_number: assetForm.inspection_number,
      budget_source: assetForm.budget_source,
      unit_price: Number(assetForm.unit_price) || 0,
      quantity: 1,
      location: assetForm.location,
      custodian_name: assetForm.custodian_name || 'ครูผู้รับผิดชอบ',
      status: assetForm.status,
      remarks: assetForm.remarks
    };

    setAssets([newRecord, ...assets]);
    setIsAddAssetModalOpen(false);
    setAssetForm({
      name: '',
      brand_model: '',
      serial_number: '',
      category: 'ครุภัณฑ์คอมพิวเตอร์',
      acquired_date: new Date().toISOString().split('T')[0],
      po_number: '',
      inspection_number: '',
      budget_source: 'เงินอุดหนุนรายหัวนักเรียน',
      unit_price: 0,
      location: 'อาคารเรียน 1',
      custodian_name: '',
      status: 'active',
      remarks: ''
    });
    alert(`ลงทะเบียนครุภัณฑ์สำเร็จ รหัส: ${asset_code}`);
  };

  // Handler: เพิ่มวัสดุใหม่
  const handleSaveSupply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplyForm.name.trim()) return;

    const nextSeq = String(supplies.length + 1).padStart(3, '0');
    const item_code = `SUP-2569-${nextSeq}`;
    const qty = Number(supplyForm.quantity_received) || 0;
    const price = Number(supplyForm.unit_price) || 0;

    const newRecord: SupplyRecord = {
      id: `sup-${Date.now()}`,
      item_code,
      name: supplyForm.name,
      category: supplyForm.category,
      unit: supplyForm.unit,
      quantity_received: qty,
      quantity_dispensed: 0,
      quantity_remaining: qty,
      unit_price: price,
      total_value: qty * price,
      storage_location: supplyForm.storage_location,
      last_restocked_date: new Date().toISOString().split('T')[0]
    };

    setSupplies([newRecord, ...supplies]);
    setIsAddSupplyModalOpen(false);
    alert(`บันทึกรับเข้าวัสดุสำเร็จ รหัส: ${item_code}`);
  };

  // Handler: เบิกจ่ายวัสดุ
  const handleDispenseSupply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplyForDispense) return;

    const qty = Number(dispenseForm.quantity) || 0;
    if (qty <= 0) {
      alert('กรุณาระบุจำนวนที่ต้องการเบิก');
      return;
    }

    if (qty > selectedSupplyForDispense.quantity_remaining) {
      alert(`จำนวนคงเหลือไม่พอ (คงเหลือเพียง ${selectedSupplyForDispense.quantity_remaining} ${selectedSupplyForDispense.unit})`);
      return;
    }

    const updated = supplies.map(s => {
      if (s.id === selectedSupplyForDispense.id) {
        const newDispensed = s.quantity_dispensed + qty;
        const newRemaining = s.quantity_received - newDispensed;
        return {
          ...s,
          quantity_dispensed: newDispensed,
          quantity_remaining: newRemaining,
          total_value: newRemaining * s.unit_price
        };
      }
      return s;
    });

    setSupplies(updated);
    setIsDispenseModalOpen(false);
    alert(`บันทึกการเบิก ${selectedSupplyForDispense.name} จำนวน ${qty} ${selectedSupplyForDispense.unit} เรียบร้อยแล้ว`);
  };

  // Handler: พิมพ์สติกเกอร์ QR Code ครุภัณฑ์
  const handlePrintAssetStickers = (assetList: AssetRecord[]) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>สติกเกอร์รหัสครุภัณฑ์โรงเรียน</title>
        <style>
          @page { size: A4; margin: 10mm; }
          body { font-family: 'Sarabun', sans-serif; margin: 0; padding: 0; }
          .sticker-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; }
          .sticker { 
            border: 2px solid #000; 
            border-radius: 8px; 
            padding: 12px; 
            display: flex; 
            gap: 12px; 
            align-items: center;
            background: #fff;
            page-break-inside: avoid;
          }
          .qr-box { 
            width: 70px; 
            height: 70px; 
            border: 1px dashed #666; 
            display: flex; 
            flex-direction: column;
            align-items: center; 
            justify-content: center; 
            font-size: 8px;
            text-align: center;
          }
          .info { flex: 1; font-size: 11px; line-height: 1.4; }
          .title { font-weight: bold; font-size: 12px; border-bottom: 1px solid #ccc; padding-bottom: 2px; margin-bottom: 4px; }
          .code { font-weight: bold; font-family: monospace; font-size: 13px; color: #000; }
          @media print {
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="no-print" style="background: #2563eb; color: #fff; padding: 12px; text-align: center; font-size: 14px; font-weight: bold;">
          กด Ctrl + P หรือ Cmd + P เพื่อพิมพ์สติกเกอร์รหัสครุภัณฑ์ (รองรับกระดาษสติกเกอร์ A4 แบ่ง 2 แถว)
        </div>
        <div class="sticker-grid" style="margin-top: 15px;">
          ${assetList.map(a => `
            <div class="sticker">
              <div class="qr-box">
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=65x65&data=${encodeURIComponent(a.asset_code)}" alt="QR" width="65" height="65" />
              </div>
              <div class="info">
                <div class="title">ทรัพย์สินทางราชการ</div>
                <div><b>รหัส:</b> <span class="code">${a.asset_code}</span></div>
                <div><b>รายการ:</b> ${a.name}</div>
                <div><b>ยี่ห้อ/รุ่น:</b> ${a.brand_model || '-'}</div>
                <div><b>สถานที่:</b> ${a.location}</div>
                <div><b>ผู้ดูแล:</b> ${a.custodian_name}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
  };

  // Filtered lists
  const filteredAssets = assets.filter(a => {
    const matchSearch = a.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                        a.asset_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        a.custodian_name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchCat = selectedCategory === 'all' || a.category === selectedCategory;
    const matchStatus = selectedStatus === 'all' || a.status === selectedStatus;
    return matchSearch && matchCat && matchStatus;
  });

  const filteredSupplies = supplies.filter(s => {
    const matchSearch = s.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                        s.item_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        s.storage_location.toLowerCase().includes(searchTerm.toLowerCase());
    const matchCat = selectedCategory === 'all' || s.category === selectedCategory;
    return matchSearch && matchCat;
  });

  // สถิติสรุป
  const totalAssetValue = assets.reduce((sum, a) => sum + (a.unit_price * a.quantity), 0);
  const totalActiveAssets = assets.filter(a => a.status === 'active').length;
  const totalRepairAssets = assets.filter(a => a.status === 'repair_needed').length;

  const totalSuppliesValue = supplies.reduce((sum, s) => sum + s.total_value, 0);
  const lowStockCount = supplies.filter(s => s.quantity_remaining <= 5).length;

  return (
    <div className="space-y-6">
      {/* 1. Header Toolbar */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-xs font-black bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 rounded">
              ระเบียบพัสดุ 2560 หมวด 9
            </span>
            <span className="text-xs text-slate-400">ปีงบประมาณ 2569</span>
          </div>
          <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
            <Package className="text-emerald-600" /> ระบบทะเบียนคุมพัสดุและครุภัณฑ์
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            ทะเบียนคุมทรัพย์สินถาวร (Asset Register) และทะเบียนคุมวัสดุสิ้นเปลือง (Supplies Inventory Control)
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Tab Switcher */}
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-bold">
            <button
              onClick={() => { setActiveTab('assets'); setSelectedCategory('all'); }}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg transition-all cursor-pointer ${
                activeTab === 'assets' 
                  ? 'bg-white text-emerald-700 shadow-sm' 
                  : 'text-slate-600 hover:text-slate-800'
              }`}
            >
              <Tag size={16} />
              <span>ทะเบียนคุมครุภัณฑ์ ({assets.length})</span>
            </button>
            <button
              onClick={() => { setActiveTab('supplies'); setSelectedCategory('all'); }}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg transition-all cursor-pointer ${
                activeTab === 'supplies' 
                  ? 'bg-white text-blue-700 shadow-sm' 
                  : 'text-slate-600 hover:text-slate-800'
              }`}
            >
              <Package size={16} />
              <span>ทะเบียนคุมวัสดุ ({supplies.length})</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Stat Summary Cards */}
      {activeTab === 'assets' ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-xs text-slate-500 font-bold mb-1">ครุภัณฑ์ทั้งหมด</div>
            <div className="text-2xl font-black text-slate-800">{assets.length} รายการ</div>
            <div className="text-[11px] text-slate-400 mt-1">มีรหัสคุมและสติกเกอร์พร้อม</div>
          </div>
          <div className="bg-emerald-50 p-5 rounded-2xl border border-emerald-200 shadow-sm">
            <div className="text-xs text-emerald-700 font-bold mb-1">ใช้งานได้ปกติ</div>
            <div className="text-2xl font-black text-emerald-800">{totalActiveAssets} รายการ</div>
            <div className="text-[11px] text-emerald-600 mt-1">พร้อมใช้งาน 100%</div>
          </div>
          <div className="bg-amber-50 p-5 rounded-2xl border border-amber-200 shadow-sm">
            <div className="text-xs text-amber-700 font-bold mb-1">ชำรุดรอซ่อม</div>
            <div className="text-2xl font-black text-amber-800">{totalRepairAssets} รายการ</div>
            <div className="text-[11px] text-amber-600 mt-1">รอเสนอรายงานความชำรุด</div>
          </div>
          <div className="bg-blue-50 p-5 rounded-2xl border border-blue-200 shadow-sm">
            <div className="text-xs text-blue-700 font-bold mb-1">มูลค่าครุภัณฑ์รวม</div>
            <div className="text-2xl font-black text-blue-800">฿{totalAssetValue.toLocaleString('th-TH')}</div>
            <div className="text-[11px] text-blue-600 mt-1">ยอดประเมินตามราคาทุน</div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-xs text-slate-500 font-bold mb-1">รายการวัสดุในคลัง</div>
            <div className="text-2xl font-black text-slate-800">{supplies.length} รายการ</div>
            <div className="text-[11px] text-slate-400 mt-1">วัสดุสิ้นเปลืองทั้งหมด</div>
          </div>
          <div className="bg-blue-50 p-5 rounded-2xl border border-blue-200 shadow-sm">
            <div className="text-xs text-blue-700 font-bold mb-1">มูลค่าคงคลังรวม</div>
            <div className="text-2xl font-black text-blue-800">฿{totalSuppliesValue.toLocaleString('th-TH')}</div>
            <div className="text-[11px] text-blue-600 mt-1">ตามยอดคงเหลือจริง</div>
          </div>
          <div className="bg-amber-50 p-5 rounded-2xl border border-amber-200 shadow-sm">
            <div className="text-xs text-amber-700 font-bold mb-1">พัสดุใกล้หมด (≤ 5)</div>
            <div className="text-2xl font-black text-amber-800">{lowStockCount} รายการ</div>
            <div className="text-[11px] text-amber-600 mt-1">ควรตั้งงบประมาณขอซื้อเพิ่ม</div>
          </div>
          <div className="bg-purple-50 p-5 rounded-2xl border border-purple-200 shadow-sm">
            <div className="text-xs text-purple-700 font-bold mb-1">ระบบเบิกจ่าย</div>
            <div className="text-2xl font-black text-purple-800">ตัดสต็อกอัตโนมัติ</div>
            <div className="text-[11px] text-purple-600 mt-1">คุมยอดคงเหลือเรียลไทม์</div>
          </div>
        </div>
      )}

      {/* 3. Search & Actions Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-3 w-full">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder={activeTab === 'assets' ? 'ค้นหาชื่อครุภัณฑ์, รหัส, ผู้ดูแล...' : 'ค้นหาชื่อวัสดุ, รหัส, สถานที่จัดเก็บ...'}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {activeTab === 'assets' && (
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 focus:outline-none"
            >
              <option value="all">ทุกสถานะ</option>
              <option value="active">ปกติ/พร้อมใช้งาน</option>
              <option value="repair_needed">ชำรุดรอซ่อม</option>
              <option value="disposed">จำหน่าย/แทงจำหน่าย</option>
            </select>
          )}
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          {activeTab === 'assets' ? (
            <>
              <button
                onClick={() => handlePrintAssetStickers(filteredAssets)}
                className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-all cursor-pointer"
                title="พิมพ์สติกเกอร์รหัสครุภัณฑ์และ QR Code ติดบนตัวทรัพย์สิน"
              >
                <QrCode size={16} />
                <span>พิมพ์สติกเกอร์ QR Code</span>
              </button>

              <button
                onClick={() => setIsAddAssetModalOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md transition-all cursor-pointer"
              >
                <Plus size={16} />
                <span>ลงทะเบียนครุภัณฑ์</span>
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setIsAddSupplyModalOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md transition-all cursor-pointer"
              >
                <Plus size={16} />
                <span>รับเข้าวัสดุ</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* 4. Main Table Views */}
      {activeTab === 'assets' ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                <tr>
                  <th className="p-3.5 text-center w-12">#</th>
                  <th className="p-3.5">รหัสครุภัณฑ์</th>
                  <th className="p-3.5">รายการ / ยี่ห้อรุ่น</th>
                  <th className="p-3.5">หมวดหมู่</th>
                  <th className="p-3.5">สถานที่ติดตั้ง</th>
                  <th className="p-3.5">ผู้ดูแลรับผิดชอบ</th>
                  <th className="p-3.5 text-right">ราคาต่อหน่วย</th>
                  <th className="p-3.5 text-center">สถานะ</th>
                  <th className="p-3.5 text-center">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAssets.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-slate-400">
                      ไม่พบข้อมูลครุภัณฑ์ตามเงื่อนไขที่ค้นหา
                    </td>
                  </tr>
                ) : (
                  filteredAssets.map((a, idx) => (
                    <tr key={a.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="p-3.5 text-center text-slate-400 font-bold">{idx + 1}</td>
                      <td className="p-3.5 font-mono font-bold text-blue-700">
                        {a.asset_code}
                      </td>
                      <td className="p-3.5 font-bold text-slate-800">
                        <div>{a.name}</div>
                        {a.brand_model && <div className="text-[11px] font-normal text-slate-500">{a.brand_model} {a.serial_number ? `(S/N: ${a.serial_number})` : ''}</div>}
                      </td>
                      <td className="p-3.5 text-slate-600">{a.category}</td>
                      <td className="p-3.5 text-slate-600 flex items-center gap-1">
                        <Building size={12} className="text-slate-400" />
                        <span>{a.location}</span>
                      </td>
                      <td className="p-3.5 text-slate-700 font-medium">
                        <div className="flex items-center gap-1">
                          <User size={12} className="text-slate-400" />
                          <span>{a.custodian_name}</span>
                        </div>
                      </td>
                      <td className="p-3.5 text-right font-bold text-slate-800">
                        ฿{a.unit_price.toLocaleString('th-TH')}
                      </td>
                      <td className="p-3.5 text-center">
                        {a.status === 'active' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                            <CheckCircle2 size={11} /> พร้อมใช้งาน
                          </span>
                        )}
                        {a.status === 'repair_needed' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                            <AlertTriangle size={11} /> ชำรุดรอซ่อม
                          </span>
                        )}
                        {a.status === 'disposed' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                            จำหน่ายแล้ว
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 text-center">
                        <button
                          onClick={() => handlePrintAssetStickers([a])}
                          className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer transition-colors"
                          title="พิมพ์สติกเกอร์รายการนี้"
                        >
                          <QrCode size={14} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                <tr>
                  <th className="p-3.5 text-center w-12">#</th>
                  <th className="p-3.5">รหัสวัสดุ</th>
                  <th className="p-3.5">ชื่อวัสดุ / รายการ</th>
                  <th className="p-3.5">หมวดหมู่</th>
                  <th className="p-3.5 text-center">รับเข้าสะสม</th>
                  <th className="p-3.5 text-center">จ่ายออก</th>
                  <th className="p-3.5 text-center">คงเหลือในคลัง</th>
                  <th className="p-3.5 text-right">ราคา/หน่วย</th>
                  <th className="p-3.5 text-right">มูลค่าคงเหลือ</th>
                  <th className="p-3.5">ที่เก็บพัสดุ</th>
                  <th className="p-3.5 text-center">เบิกจ่าย</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSupplies.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="p-8 text-center text-slate-400">
                      ไม่พบข้อมูลวัสดุสิ้นเปลือง
                    </td>
                  </tr>
                ) : (
                  filteredSupplies.map((s, idx) => (
                    <tr key={s.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="p-3.5 text-center text-slate-400 font-bold">{idx + 1}</td>
                      <td className="p-3.5 font-mono font-bold text-blue-700">{s.item_code}</td>
                      <td className="p-3.5 font-bold text-slate-800">{s.name}</td>
                      <td className="p-3.5 text-slate-600">{s.category}</td>
                      <td className="p-3.5 text-center font-bold text-slate-600">{s.quantity_received} {s.unit}</td>
                      <td className="p-3.5 text-center font-bold text-amber-700">{s.quantity_dispensed} {s.unit}</td>
                      <td className="p-3.5 text-center">
                        <span className={`px-2 py-0.5 rounded font-bold ${
                          s.quantity_remaining <= 5 
                            ? 'bg-rose-100 text-rose-700' 
                            : 'bg-emerald-100 text-emerald-800'
                        }`}>
                          {s.quantity_remaining} {s.unit}
                        </span>
                      </td>
                      <td className="p-3.5 text-right text-slate-600">฿{s.unit_price.toLocaleString()}</td>
                      <td className="p-3.5 text-right font-bold text-slate-800">฿{s.total_value.toLocaleString()}</td>
                      <td className="p-3.5 text-slate-600">{s.storage_location}</td>
                      <td className="p-3.5 text-center">
                        <button
                          onClick={() => {
                            setSelectedSupplyForDispense(s);
                            setDispenseForm({ quantity: 1, requester_name: '', department: 'ฝ่ายวิชาการ', note: '' });
                            setIsDispenseModalOpen(true);
                          }}
                          disabled={s.quantity_remaining <= 0}
                          className="px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-[11px] transition-colors cursor-pointer disabled:opacity-40"
                        >
                          เบิกจ่าย
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL: เพิ่มครุภัณฑ์ */}
      {isAddAssetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 shadow-2xl border border-slate-100 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-black text-slate-800 text-base">🏷️ ลงทะเบียนคุมครุภัณฑ์ใหม่</h3>
              <button onClick={() => setIsAddAssetModalOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveAsset} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">ชื่อครุภัณฑ์ *</label>
                <input
                  type="text"
                  required
                  placeholder="เช่น เครื่องปรับอากาศ ขนาด 18,000 BTU, คอมพิวเตอร์ All-in-One"
                  value={assetForm.name}
                  onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">ยี่ห้อ / รุ่น</label>
                  <input
                    type="text"
                    placeholder="เช่น Daikin Inverter FTKM18"
                    value={assetForm.brand_model}
                    onChange={(e) => setAssetForm({ ...assetForm, brand_model: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">หมายเลขเครื่อง (Serial No.)</label>
                  <input
                    type="text"
                    placeholder="เช่น SN-2026-9901"
                    value={assetForm.serial_number}
                    onChange={(e) => setAssetForm({ ...assetForm, serial_number: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">หมวดหมู่</label>
                  <select
                    value={assetForm.category}
                    onChange={(e) => setAssetForm({ ...assetForm, category: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200"
                  >
                    <option value="ครุภัณฑ์คอมพิวเตอร์">ครุภัณฑ์คอมพิวเตอร์</option>
                    <option value="ครุภัณฑ์สำนักงาน">ครุภัณฑ์สำนักงาน</option>
                    <option value="ครุภัณฑ์การศึกษา">ครุภัณฑ์การศึกษา</option>
                    <option value="ครุภัณฑ์วิทยาศาสตร์">ครุภัณฑ์วิทยาศาสตร์</option>
                    <option value="ครุภัณฑ์ยานพาหนะ">ครุภัณฑ์ยานพาหนะ</option>
                    <option value="ครุภัณฑ์งานบ้านงานครัว">ครุภัณฑ์งานบ้านงานครัว</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">ราคาต่อหน่วย (บาท)</label>
                  <input
                    type="number"
                    value={assetForm.unit_price}
                    onChange={(e) => setAssetForm({ ...assetForm, unit_price: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 font-bold text-emerald-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">สถานที่ติดตั้ง / จัดวาง</label>
                  <input
                    type="text"
                    value={assetForm.location}
                    onChange={(e) => setAssetForm({ ...assetForm, location: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">ผู้ดูแลรับผิดชอบ</label>
                  <input
                    type="text"
                    placeholder="ระบุชื่อคุณครูผู้ดูแล"
                    value={assetForm.custodian_name}
                    onChange={(e) => setAssetForm({ ...assetForm, custodian_name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddAssetModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-md"
                >
                  บันทึกลงทะเบียน
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: เพิ่มวัสดุ */}
      {isAddSupplyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-black text-slate-800 text-base">📦 บันทึกรับเข้าพัสดุ/วัสดุสิ้นเปลือง</h3>
              <button onClick={() => setIsAddSupplyModalOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveSupply} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">ชื่อวัสดุ *</label>
                <input
                  type="text"
                  required
                  placeholder="เช่น กระดาษ A4 80 แกรม, ปากกาไวท์บอร์ด"
                  value={supplyForm.name}
                  onChange={(e) => setSupplyForm({ ...supplyForm, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">หมวดหมู่</label>
                  <select
                    value={supplyForm.category}
                    onChange={(e) => setSupplyForm({ ...supplyForm, category: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200"
                  >
                    <option value="วัสดุสำนักงาน">วัสดุสำนักงาน</option>
                    <option value="วัสดุการศึกษา">วัสดุการศึกษา</option>
                    <option value="วัสดุคอมพิวเตอร์">วัสดุคอมพิวเตอร์</option>
                    <option value="วัสดุไฟฟ้าและวิทยุ">วัสดุไฟฟ้าและวิทยุ</option>
                    <option value="วัสดุงานบ้านงานครัว">วัสดุงานบ้านงานครัว</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">หน่วยนับ</label>
                  <input
                    type="text"
                    placeholder="เช่น รีม, กล่อง, ด้าม"
                    value={supplyForm.unit}
                    onChange={(e) => setSupplyForm({ ...supplyForm, unit: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">จำนวนรับเข้า</label>
                  <input
                    type="number"
                    min="1"
                    value={supplyForm.quantity_received}
                    onChange={(e) => setSupplyForm({ ...supplyForm, quantity_received: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">ราคาต่อหน่วย</label>
                  <input
                    type="number"
                    value={supplyForm.unit_price}
                    onChange={(e) => setSupplyForm({ ...supplyForm, unit_price: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 font-bold text-blue-700"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">ที่เก็บพัสดุ</label>
                <input
                  type="text"
                  value={supplyForm.storage_location}
                  onChange={(e) => setSupplyForm({ ...supplyForm, storage_location: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200"
                />
              </div>

              <div className="pt-4 border-t border-slate-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddSupplyModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-md"
                >
                  บันทึกรับเข้า
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: เบิกจ่ายวัสดุ */}
      {isDispenseModalOpen && selectedSupplyForDispense && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-black text-slate-800 text-base">📤 บันทึกการเบิกจ่ายวัสดุ</h3>
              <button onClick={() => setIsDispenseModalOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
                <X size={18} />
              </button>
            </div>

            <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs space-y-1">
              <div className="font-bold text-blue-900">{selectedSupplyForDispense.name}</div>
              <div className="text-blue-700">คงเหลือในคลัง: <b>{selectedSupplyForDispense.quantity_remaining} {selectedSupplyForDispense.unit}</b></div>
            </div>

            <form onSubmit={handleDispenseSupply} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">จำนวนที่ขอเบิก ({selectedSupplyForDispense.unit}) *</label>
                <input
                  type="number"
                  min="1"
                  max={selectedSupplyForDispense.quantity_remaining}
                  required
                  value={dispenseForm.quantity}
                  onChange={(e) => setDispenseForm({ ...dispenseForm, quantity: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 font-bold text-base text-blue-700"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">ชื่อผู้ขอเบิก *</label>
                <input
                  type="text"
                  required
                  placeholder="เช่น ครูสมหมาย, ครูสุดา"
                  value={dispenseForm.requester_name}
                  onChange={(e) => setDispenseForm({ ...dispenseForm, requester_name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 font-medium"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">ฝ่าย / กลุ่มงาน</label>
                <select
                  value={dispenseForm.department}
                  onChange={(e) => setDispenseForm({ ...dispenseForm, department: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200"
                >
                  <option value="ฝ่ายวิชาการ">ฝ่ายวิชาการ</option>
                  <option value="ฝ่ายบริหารทั่วไป">ฝ่ายบริหารทั่วไป</option>
                  <option value="ฝ่ายงบประมาณ">ฝ่ายงบประมาณ</option>
                  <option value="ฝ่ายบุคคล">ฝ่ายบุคคล</option>
                  <option value="ระดับชั้นปฐมวัย">ระดับชั้นปฐมวัย</option>
                  <option value="ระดับชั้นประถมศึกษา">ระดับชั้นประถมศึกษา</option>
                </select>
              </div>

              <div className="pt-4 border-t border-slate-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsDispenseModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-md"
                >
                  ยืนยันการเบิกจ่าย
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
