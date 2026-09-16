-- ==============================================================================
-- SUPABASE MIGRATION: ASSET & SUPPLIES REGISTRY SUITE (2026)
-- ระบบทะเบียนคุมพัสดุและครุภัณฑ์โรงเรียน (ตามระเบียบกระทรวงการคลังฯ พ.ศ. 2560 หมวด 9)
-- ครอบคลุม: ทะเบียนคุมครุภัณฑ์ (Asset Registry), ทะเบียนคุมวัสดุ (Supplies Control), และประวัติรับ-จ่าย
-- ==============================================================================

-- 1. ทะเบียนคุมครุภัณฑ์ / สินทรัพย์ถาวร (Durable Articles / Fixed Asset Register)
CREATE TABLE IF NOT EXISTS asset_registry (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_code TEXT UNIQUE NOT NULL, -- เช่น 7110-001-0001/2569
  academic_year TEXT NOT NULL DEFAULT '2569',
  fiscal_year TEXT NOT NULL DEFAULT '2569',
  name TEXT NOT NULL, -- ชื่อครุภัณฑ์ เช่น คอมพิวเตอร์ All-in-One Core i5
  brand_model TEXT, -- ยี่ห้อ/รุ่น เช่น ASUS Vivo AIO
  serial_number TEXT, -- หมายเลขเครื่อง (S/N)
  category TEXT NOT NULL DEFAULT 'ครุภัณฑ์คอมพิวเตอร์', -- คอมพิวเตอร์, สำนักงาน, การศึกษา, วิทยาศาสตร์, ยานพาหนะ, ก่อสร้าง
  acquired_date DATE DEFAULT CURRENT_DATE, -- วันที่ได้มา
  procurement_case_id UUID REFERENCES procurement_cases(id) ON DELETE SET NULL,
  po_number TEXT, -- เลขที่สัญญา / PO
  inspection_number TEXT, -- เลขที่ใบตรวจรับ
  budget_source TEXT DEFAULT 'เงินอุดหนุนรายหัวนักเรียน', -- แหล่งเงินงบประมาณ
  unit_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 1,
  location TEXT DEFAULT 'ห้องคอมพิวเตอร์ 1', -- สถานที่ติดตั้ง/จัดวาง
  custodian_teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
  custodian_name TEXT, -- ชื่อผู้รับผิดชอบดูแล
  status TEXT NOT NULL DEFAULT 'active', -- 'active' (ปกติ/พร้อมใช้งาน), 'repair_needed' (ชำรุดรอซ่อม), 'disposed' (จำหน่าย/แทงจำหน่าย)
  remarks TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. ทะเบียนคุมวัสดุสิ้นเปลือง (Consumable Supplies Inventory Register)
CREATE TABLE IF NOT EXISTS supplies_inventory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  item_code TEXT NOT NULL, -- เช่น SUP-2569-001
  name TEXT NOT NULL, -- เช่น กระดาษ A4 80 แกรม
  category TEXT NOT NULL DEFAULT 'วัสดุสำนักงาน', -- สำนักงาน, ไฟฟ้า, งานบ้าน, คอมพิวเตอร์, วิทยาศาสตร์, กีฬา
  unit TEXT NOT NULL DEFAULT 'ชิ้น', -- รีม, กล่อง, ด้าม, เล่ม, ชิ้น
  quantity_received NUMERIC(12, 2) NOT NULL DEFAULT 0, -- จำนวนรับเข้าสะสม
  quantity_dispensed NUMERIC(12, 2) NOT NULL DEFAULT 0, -- จำนวนจ่ายออกสะสม
  quantity_remaining NUMERIC(12, 2) NOT NULL DEFAULT 0, -- คงเหลือ
  unit_price NUMERIC(15, 2) NOT NULL DEFAULT 0, -- ราคาต่อหน่วย
  total_value NUMERIC(15, 2) NOT NULL DEFAULT 0, -- มูลค่าคงเหลือ
  procurement_case_id UUID REFERENCES procurement_cases(id) ON DELETE SET NULL,
  storage_location TEXT DEFAULT 'ตู้เก็บพัสดุห้องธุรการ', -- สถานที่จัดเก็บ
  last_restocked_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. ตารางประวัติรับ-จ่ายวัสดุ (Supplies Transactions Log)
CREATE TABLE IF NOT EXISTS supplies_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  supply_id UUID REFERENCES supplies_inventory(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL, -- 'in' (รับเข้า), 'out' (จ่ายออก)
  quantity NUMERIC(12, 2) NOT NULL DEFAULT 1,
  doc_reference TEXT, -- เลขที่ใบสั่งซื้อ / เลขที่บันทึกขอเบิก
  requester_teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
  requester_name TEXT, -- ผู้เบิก / ผู้ส่งมอบ
  department TEXT DEFAULT 'กลุ่มงานบริหารทั่วไป', -- กลุ่มงาน/ฝ่ายที่เบิก
  transaction_date DATE DEFAULT CURRENT_DATE,
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- สร้าง Indexes
CREATE INDEX IF NOT EXISTS idx_asset_code ON asset_registry(asset_code);
CREATE INDEX IF NOT EXISTS idx_asset_case ON asset_registry(procurement_case_id);
CREATE INDEX IF NOT EXISTS idx_asset_status ON asset_registry(status);
CREATE INDEX IF NOT EXISTS idx_supplies_code ON supplies_inventory(item_code);
CREATE INDEX IF NOT EXISTS idx_supplies_tx_supply ON supplies_transactions(supply_id);

-- เปิด RLS
ALTER TABLE asset_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplies_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplies_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read asset_registry" ON asset_registry FOR SELECT USING (true);
CREATE POLICY "Auth users manage asset_registry" ON asset_registry FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Public read supplies_inventory" ON supplies_inventory FOR SELECT USING (true);
CREATE POLICY "Auth users manage supplies_inventory" ON supplies_inventory FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Public read supplies_transactions" ON supplies_transactions FOR SELECT USING (true);
CREATE POLICY "Auth users manage supplies_transactions" ON supplies_transactions FOR ALL USING (auth.uid() IS NOT NULL);
