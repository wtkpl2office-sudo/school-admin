-- ==============================================================================
-- 🏫 SUPABASE MASTER MIGRATION: COMPLETE PROCUREMENT & INVENTORY SUITE (2026)
-- รวมครบ 2 ระบบหลัก: แฟ้มสำนวนจัดซื้อจัดจ้าง (Procurement) + ทะเบียนคุมพัสดุ/ครุภัณฑ์ (Inventory)
-- ตามพระราชบัญญัติการจัดซื้อจัดจ้างฯ พ.ศ. 2560 และระเบียบกระทรวงการคลังฯ หมวด 9
-- ==============================================================================

-- ==============================================================================
-- 📦 ชุดที่ 1: ระบบแฟ้มสำนวนจัดซื้อจัดจ้าง (Procurement Cases Suite)
-- ==============================================================================

-- 1.1 ตารางสำนวนจัดซื้อจัดจ้างกลาง (Procurement Cases)
CREATE TABLE IF NOT EXISTS procurement_cases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pcid TEXT UNIQUE NOT NULL, -- เช่น SCH-2569-00001
  academic_year TEXT NOT NULL DEFAULT '2569',
  fiscal_year TEXT NOT NULL DEFAULT '2569',
  title TEXT NOT NULL, -- ชื่องานซื้อ/จ้าง
  category TEXT NOT NULL DEFAULT 'goods', -- 'goods', 'service_general', 'service_12m', 'construction', 'lunch'
  policy_code TEXT NOT NULL DEFAULT 'W089', -- 'W119_10K', 'W119_100K', 'W089', 'W877', 'W523', 'LUNCH'
  
  budget_id UUID REFERENCES budget_allocations(id) ON DELETE SET NULL,
  estimated_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  final_amount NUMERIC(15, 2) DEFAULT 0,
  
  current_gate INTEGER NOT NULL DEFAULT 1, -- 1: Demand, 2: Method, 3: PO, 4: Inspection, 5: Disbursement
  status TEXT NOT NULL DEFAULT 'draft', -- 'draft', 'pending_approval', 'approved_pr', 'ordered', 'delivered', 'accepted', 'disbursed', 'cancelled'
  
  -- Foreign Keys ผูกกับสมุดทะเบียนสารบรรณจริง
  memo_request_id UUID REFERENCES memos(id) ON DELETE SET NULL,
  appointment_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  memo_inspection_id UUID REFERENCES memos(id) ON DELETE SET NULL,
  
  -- เลขเอกสารรันอัตโนมัติในสายงานพัสดุ
  pr_number TEXT,
  po_number TEXT,
  inspection_number TEXT,
  disbursement_number TEXT,
  
  -- ลำดับวันที่ในกระบวนการ (Chronological Dates)
  request_date DATE DEFAULT CURRENT_DATE,
  pr_approval_date DATE,
  order_appointment_date DATE,
  po_date DATE,
  delivery_due_date DATE,
  actual_delivery_date DATE,
  inspection_date DATE,
  disbursement_date DATE,
  
  -- ผู้รับผิดชอบ (Stakeholders)
  requester_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
  officer_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
  head_officer_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
  inspector_type TEXT NOT NULL DEFAULT 'single', -- 'single' (1 คน) หรือ 'committee' (>= 3 คน)
  committee_members JSONB DEFAULT '[]'::jsonb, -- [{teacher_id, role, sign_status, sign_date}]
  
  -- ข้อมูลผู้ขาย และสัญญา
  vendor_info JSONB DEFAULT '{
    "name": "",
    "tax_id": "",
    "address": "",
    "phone": "",
    "bank_name": "",
    "bank_account": "",
    "receipt_no": "",
    "receipt_date": ""
  }'::jsonb,
  
  external_egp_ref TEXT, -- เลขคุมสัญญา / เลขที่โครงการ e-GP
  custom_clauses TEXT DEFAULT '', -- เงื่อนไขหรือข้อความเพิ่มเติม
  attached_files JSONB DEFAULT '[]'::jsonb, -- [{name, url, type, uploaded_at}]
  approval_signatures JSONB DEFAULT '{}'::jsonb, -- บันทึกลายเซ็นดิจิทัลรายขั้นตอน
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.2 รายการพัสดุและสินค้าในสำนวน (Procurement Case Items)
CREATE TABLE IF NOT EXISTS procurement_case_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id UUID REFERENCES procurement_cases(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  specification TEXT DEFAULT '',
  quantity NUMERIC(12, 2) NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'รายการ',
  unit_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
  total_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
  is_asset BOOLEAN DEFAULT FALSE,
  asset_code TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.3 ตารางงวดงานและการส่งมอบ (Procurement Case Milestones สำหรับ ว.877 12 งวด และงานก่อสร้าง)
CREATE TABLE IF NOT EXISTS procurement_case_milestones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id UUID REFERENCES procurement_cases(id) ON DELETE CASCADE,
  milestone_no INTEGER NOT NULL, -- งวดที่ 1 ถึง 12
  month_name TEXT, -- เช่น 'ตุลาคม 2568'
  due_date DATE NOT NULL,
  amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'delivered', 'accepted', 'paid'
  delivery_date DATE,
  inspection_date DATE,
  inspection_doc_url TEXT,
  payment_doc_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.4 บันทึกประวัติการตรวจสอบย้อนกลับ (Immutable Audit Trail Logs)
CREATE TABLE IF NOT EXISTS procurement_case_audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id UUID REFERENCES procurement_cases(id) ON DELETE CASCADE,
  gate INTEGER NOT NULL,
  action TEXT NOT NULL, -- 'CASE_CREATED', 'PR_APPROVED', 'PO_ISSUED', 'GOODS_DELIVERED', 'INSPECTED', 'DISBURSED'
  actor_id UUID,
  actor_name TEXT,
  actor_role TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- 🏷️ ชุดที่ 2: ระบบทะเบียนคุมพัสดุและครุภัณฑ์ (Asset & Supplies Registry Suite)
-- ==============================================================================

-- 2.1 ทะเบียนคุมครุภัณฑ์ / สินทรัพย์ถาวร (Durable Articles / Fixed Asset Register)
CREATE TABLE IF NOT EXISTS asset_registry (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_code TEXT UNIQUE NOT NULL, -- เช่น 7110-001-0001/2569, ครุ-2569-0001
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

-- 2.2 ทะเบียนคุมวัสดุสิ้นเปลือง (Consumable Supplies Inventory Register)
CREATE TABLE IF NOT EXISTS supplies_inventory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  item_code TEXT NOT NULL, -- เช่น SUP-2569-001, วสด-2569-001
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

-- 2.3 ตารางประวัติรับ-จ่ายวัสดุ (Supplies Transactions Log)
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

-- ==============================================================================
-- ⚡ สร้าง Indexes เพื่อความรวดเร็วในการค้นหาและเชื่อมโยง
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_proc_cases_pcid ON procurement_cases(pcid);
CREATE INDEX IF NOT EXISTS idx_proc_cases_gate ON procurement_cases(current_gate);
CREATE INDEX IF NOT EXISTS idx_proc_cases_status ON procurement_cases(status);
CREATE INDEX IF NOT EXISTS idx_proc_cases_policy ON procurement_cases(policy_code);
CREATE INDEX IF NOT EXISTS idx_proc_case_items_case ON procurement_case_items(case_id);
CREATE INDEX IF NOT EXISTS idx_proc_milestones_case ON procurement_case_milestones(case_id);
CREATE INDEX IF NOT EXISTS idx_proc_audit_case ON procurement_case_audit_logs(case_id);

CREATE INDEX IF NOT EXISTS idx_asset_code ON asset_registry(asset_code);
CREATE INDEX IF NOT EXISTS idx_asset_case ON asset_registry(procurement_case_id);
CREATE INDEX IF NOT EXISTS idx_asset_status ON asset_registry(status);
CREATE INDEX IF NOT EXISTS idx_supplies_code ON supplies_inventory(item_code);
CREATE INDEX IF NOT EXISTS idx_supplies_tx_supply ON supplies_transactions(supply_id);

-- ==============================================================================
-- 🔒 นโยบายความปลอดภัยระดับแถว (Row Level Security - RLS)
-- ==============================================================================
ALTER TABLE procurement_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_case_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_case_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_case_audit_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE asset_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplies_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplies_transactions ENABLE ROW LEVEL SECURITY;

-- เคลียร์ Policies เดิมหากมีอยู่ เพื่อให้รันซ้ำได้ปลอดภัย 100%
DROP POLICY IF EXISTS "Public read procurement_cases" ON procurement_cases;
DROP POLICY IF EXISTS "Auth users manage procurement_cases" ON procurement_cases;
DROP POLICY IF EXISTS "Public read procurement_case_items" ON procurement_case_items;
DROP POLICY IF EXISTS "Auth users manage procurement_case_items" ON procurement_case_items;
DROP POLICY IF EXISTS "Public read procurement_case_milestones" ON procurement_case_milestones;
DROP POLICY IF EXISTS "Auth users manage procurement_case_milestones" ON procurement_case_milestones;
DROP POLICY IF EXISTS "Public read procurement_case_audit_logs" ON procurement_case_audit_logs;
DROP POLICY IF EXISTS "Auth users manage procurement_case_audit_logs" ON procurement_case_audit_logs;

DROP POLICY IF EXISTS "Public read asset_registry" ON asset_registry;
DROP POLICY IF EXISTS "Auth users manage asset_registry" ON asset_registry;
DROP POLICY IF EXISTS "Public read supplies_inventory" ON supplies_inventory;
DROP POLICY IF EXISTS "Auth users manage supplies_inventory" ON supplies_inventory;
DROP POLICY IF EXISTS "Public read supplies_transactions" ON supplies_transactions;
DROP POLICY IF EXISTS "Auth users manage supplies_transactions" ON supplies_transactions;

-- สร้าง Policies ใหม่
CREATE POLICY "Public read procurement_cases" ON procurement_cases FOR SELECT USING (true);
CREATE POLICY "Auth users manage procurement_cases" ON procurement_cases FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Public read procurement_case_items" ON procurement_case_items FOR SELECT USING (true);
CREATE POLICY "Auth users manage procurement_case_items" ON procurement_case_items FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Public read procurement_case_milestones" ON procurement_case_milestones FOR SELECT USING (true);
CREATE POLICY "Auth users manage procurement_case_milestones" ON procurement_case_milestones FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Public read procurement_case_audit_logs" ON procurement_case_audit_logs FOR SELECT USING (true);
CREATE POLICY "Auth users manage procurement_case_audit_logs" ON procurement_case_audit_logs FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Public read asset_registry" ON asset_registry FOR SELECT USING (true);
CREATE POLICY "Auth users manage asset_registry" ON asset_registry FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Public read supplies_inventory" ON supplies_inventory FOR SELECT USING (true);
CREATE POLICY "Auth users manage supplies_inventory" ON supplies_inventory FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Public read supplies_transactions" ON supplies_transactions FOR SELECT USING (true);
CREATE POLICY "Auth users manage supplies_transactions" ON supplies_transactions FOR ALL USING (auth.uid() IS NOT NULL);
