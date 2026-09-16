-- ==============================================================================
-- SUPABASE MIGRATION: CLEAN SCHOOL PROCUREMENT SUITE (EPCM 2026)
-- ระบบสำนวนจัดซื้อจัดจ้างอิเล็กทรอนิกส์โรงเรียน (Clean Architecture 2026)
-- รองรับ 6 บทบาท 5 Control Gates, Chain of Numbers, และหนังสือเวียน ว. ต่างๆ
-- ==============================================================================

-- 1. ตารางสำนวนจัดซื้อจัดจ้างกลาง (Procurement Cases)
CREATE TABLE IF NOT EXISTS procurement_cases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pcid TEXT UNIQUE NOT NULL, -- SCH-xxxx-FY2569-00001
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

-- 2. รายการพัสดุและสินค้าในสำนวน (Procurement Case Items)
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

-- 3. ตารางงวดงานและการส่งมอบ (Procurement Case Milestones สำหรับ ว.877 12 งวด และงานก่อสร้าง)
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

-- 4. บันทึกประวัติการตรวจสอบย้อนกลับ (Immutable Audit Trail Logs)
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

-- สร้าง Indexes เพื่อความรวดเร็วในการค้นหา
CREATE INDEX IF NOT EXISTS idx_proc_cases_pcid ON procurement_cases(pcid);
CREATE INDEX IF NOT EXISTS idx_proc_cases_gate ON procurement_cases(current_gate);
CREATE INDEX IF NOT EXISTS idx_proc_cases_status ON procurement_cases(status);
CREATE INDEX IF NOT EXISTS idx_proc_cases_policy ON procurement_cases(policy_code);
CREATE INDEX IF NOT EXISTS idx_proc_case_items_case ON procurement_case_items(case_id);
CREATE INDEX IF NOT EXISTS idx_proc_milestones_case ON procurement_case_milestones(case_id);
CREATE INDEX IF NOT EXISTS idx_proc_audit_case ON procurement_case_audit_logs(case_id);

-- เปิดใช้งาน RLS (Row Level Security)
ALTER TABLE procurement_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_case_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_case_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_case_audit_logs ENABLE ROW LEVEL SECURITY;

-- นโยบายความปลอดภัย RLS
CREATE POLICY "Public read procurement_cases" ON procurement_cases FOR SELECT USING (true);
CREATE POLICY "Auth users manage procurement_cases" ON procurement_cases FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Public read procurement_case_items" ON procurement_case_items FOR SELECT USING (true);
CREATE POLICY "Auth users manage procurement_case_items" ON procurement_case_items FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Public read procurement_case_milestones" ON procurement_case_milestones FOR SELECT USING (true);
CREATE POLICY "Auth users manage procurement_case_milestones" ON procurement_case_milestones FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Public read procurement_case_audit_logs" ON procurement_case_audit_logs FOR SELECT USING (true);
CREATE POLICY "Auth users manage procurement_case_audit_logs" ON procurement_case_audit_logs FOR ALL USING (auth.uid() IS NOT NULL);
