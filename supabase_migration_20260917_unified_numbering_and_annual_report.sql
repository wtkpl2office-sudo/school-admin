-- ==============================================================================
-- Migration: Unified Numbering Architecture & Annual Saraban Executive Report
-- Date: 2026-09-17 (Fixed: PostgreSQL reserved keyword "position")
-- Description:
--   1. ระบบออกเลขและจองเลขแบบรวมศูนย์ (Single Source of Truth) ป้องกันเลขชนกัน 100%
--   2. ระบบสถิติและรายงานสรุปงานสารบรรณประจำปี พ.ศ. เสนอ ผอ. พร้อมตารางกระจายภาระงาน
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ตารางชุดเลขเอกสาร (Document Number Series)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_number_series (
  series_code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  prefix_pattern TEXT, -- เช่น 'ศธ ๐๔๐xx.xxx/'
  format_pattern TEXT NOT NULL DEFAULT '{sequence}/{year}',
  padding_zeros INTEGER NOT NULL DEFAULT 0, -- 0 = ไม่เติม 0 ข้างหน้า, 3 = 001
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- เพิ่มหมวดชุดเลขมาตรฐาน
INSERT INTO document_number_series (series_code, name, description, format_pattern, padding_zeros)
VALUES
  ('MEMO', 'บันทึกข้อความ', 'ใช้ร่วมกันทุกฝ่าย (ทั่วไป, พัสดุ, โครงการ)', '{sequence}/{year}', 0),
  ('INCOMING', 'ทะเบียนหนังสือรับ', 'หนังสือรับเข้าสถานศึกษา', '{sequence}/{year}', 0),
  ('OUTGOING', 'ทะเบียนหนังสือส่ง', 'หนังสือส่งออกภายนอก', '{sequence}/{year}', 0),
  ('SCHOOL_ORDER', 'ทะเบียนคำสั่งโรงเรียน', 'คำสั่งโรงเรียนประจำปี', '{sequence}/{year}', 0)
ON CONFLICT (series_code) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 2. ตารางตัวนับเลขกลางแยกตามปี พ.ศ. (Document Number Counters)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_number_counters (
  series_code TEXT NOT NULL REFERENCES document_number_series(series_code) ON DELETE RESTRICT,
  doc_year INTEGER NOT NULL, -- ปี พ.ศ. เช่น 2569
  last_sequence INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (series_code, doc_year)
);

-- ------------------------------------------------------------------------------
-- 3. ตารางประวัติการจองและออกเลข (Document Number Allocations)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_number_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_code TEXT NOT NULL REFERENCES document_number_series(series_code) ON DELETE RESTRICT,
  doc_year INTEGER NOT NULL,
  sequence_number INTEGER NOT NULL,
  formatted_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'issued', 'voided', 'expired')),
  title TEXT,
  requested_by UUID, -- REFERENCES profiles(id)
  requested_by_name TEXT,
  channel TEXT NOT NULL DEFAULT 'web' CHECK (channel IN ('web', 'telegram', 'line', 'procurement', 'system')),
  idempotency_key TEXT,
  document_table TEXT, -- เช่น 'memos', 'incoming_docs', 'orders'
  document_id UUID,
  void_reason TEXT,
  allocated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issued_at TIMESTAMPTZ,
  voided_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);

-- Index สำหรับสืบค้นและป้องกันเลขซ้ำ
CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_alloc_unique_seq 
  ON document_number_allocations(series_code, doc_year, sequence_number);

CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_alloc_idempotency 
  ON document_number_allocations(idempotency_key) 
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_doc_alloc_search 
  ON document_number_allocations(series_code, doc_year, status);

-- ------------------------------------------------------------------------------
-- 4. RPC Function: ขอเลข / จองเลขแบบรวมศูนย์ (Transaction Row Lock)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reserve_document_number(
  p_series_code TEXT,
  p_doc_year INTEGER,
  p_title TEXT DEFAULT NULL,
  p_requested_by UUID DEFAULT NULL,
  p_requested_by_name TEXT DEFAULT NULL,
  p_channel TEXT DEFAULT 'web',
  p_idempotency_key TEXT DEFAULT NULL,
  p_auto_issue BOOLEAN DEFAULT FALSE,
  p_document_table TEXT DEFAULT NULL,
  p_document_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_series RECORD;
  v_next_seq INTEGER;
  v_formatted TEXT;
  v_allocation RECORD;
  v_status TEXT := 'reserved';
  v_issued_at TIMESTAMPTZ := NULL;
BEGIN
  -- 1. ตรวจสอบว่ามี Idempotency Key และเคยสร้างไปแล้วหรือไม่
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_allocation 
    FROM document_number_allocations 
    WHERE idempotency_key = p_idempotency_key;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'allocation_id', v_allocation.id,
        'series_code', v_allocation.series_code,
        'doc_year', v_allocation.doc_year,
        'sequence_number', v_allocation.sequence_number,
        'formatted_number', v_allocation.formatted_number,
        'status', v_allocation.status,
        'is_duplicate_request', true
      );
    END IF;
  END IF;

  -- 2. ดึงข้อมูล Series
  SELECT * INTO v_series 
  FROM document_number_series 
  WHERE series_code = p_series_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Series code % not found', p_series_code;
  END IF;

  -- 3. ทำ Atomic Counter Increment ด้วย Row-level Lock
  INSERT INTO document_number_counters (series_code, doc_year, last_sequence, updated_at)
  VALUES (p_series_code, p_doc_year, 1, NOW())
  ON CONFLICT (series_code, doc_year)
  DO UPDATE SET
    last_sequence = document_number_counters.last_sequence + 1,
    updated_at = NOW()
  RETURNING last_sequence INTO v_next_seq;

  -- 4. จัดรูปแบบเลขหนังสือ
  IF v_series.padding_zeros > 0 THEN
    v_formatted := LPAD(v_next_seq::TEXT, v_series.padding_zeros, '0') || '/' || p_doc_year::TEXT;
  ELSE
    v_formatted := v_next_seq::TEXT || '/' || p_doc_year::TEXT;
  END IF;

  IF p_auto_issue THEN
    v_status := 'issued';
    v_issued_at := NOW();
  END IF;

  -- 5. บันทึกลงตาราง Allocations
  INSERT INTO document_number_allocations (
    series_code,
    doc_year,
    sequence_number,
    formatted_number,
    status,
    title,
    requested_by,
    requested_by_name,
    channel,
    idempotency_key,
    document_table,
    document_id,
    allocated_at,
    issued_at
  )
  VALUES (
    p_series_code,
    p_doc_year,
    v_next_seq,
    v_formatted,
    v_status,
    p_title,
    p_requested_by,
    p_requested_by_name,
    p_channel,
    p_idempotency_key,
    p_document_table,
    p_document_id,
    NOW(),
    v_issued_at
  )
  RETURNING * INTO v_allocation;

  RETURN jsonb_build_object(
    'success', true,
    'allocation_id', v_allocation.id,
    'series_code', v_allocation.series_code,
    'doc_year', v_allocation.doc_year,
    'sequence_number', v_allocation.sequence_number,
    'formatted_number', v_allocation.formatted_number,
    'status', v_allocation.status,
    'is_duplicate_request', false
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. RPC Function: ยืนยันการใช้เลขจริง (Confirm / Issue Document Number)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION confirm_document_number(
  p_allocation_id UUID,
  p_document_table TEXT,
  p_document_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE document_number_allocations
  SET
    status = 'issued',
    issued_at = NOW(),
    document_table = p_document_table,
    document_id = p_document_id
  WHERE id = p_allocation_id;

  RETURN FOUND;
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. RPC Function: ยกเลิกเลข (Void Document Number - No Reuse)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION void_document_number(
  p_allocation_id UUID,
  p_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE document_number_allocations
  SET
    status = 'voided',
    voided_at = NOW(),
    void_reason = p_reason
  WHERE id = p_allocation_id;

  RETURN FOUND;
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. RPC Function: สรุปภาพรวมงานสารบรรณประจำปี พ.ศ. (สำหรับบันทึกข้อความปะหน้า)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_annual_saraban_overview(p_doc_year INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_incoming_count INTEGER := 0;
  v_outgoing_count INTEGER := 0;
  v_memo_count INTEGER := 0;
  v_order_count INTEGER := 0;
BEGIN
  -- 1. หนังสือรับ
  SELECT COUNT(*) INTO v_incoming_count
  FROM incoming_docs
  WHERE doc_year = p_doc_year OR EXTRACT(YEAR FROM created_at::date) + 543 = p_doc_year;

  -- 2. หนังสือส่ง
  SELECT COUNT(*) INTO v_outgoing_count
  FROM outgoing_docs
  WHERE doc_year = p_doc_year OR EXTRACT(YEAR FROM created_at::date) + 543 = p_doc_year;

  -- 3. บันทึกข้อความ
  SELECT COUNT(*) INTO v_memo_count
  FROM memos
  WHERE doc_year = p_doc_year OR EXTRACT(YEAR FROM created_at::date) + 543 = p_doc_year;

  -- 4. คำสั่งโรงเรียน
  SELECT COUNT(*) INTO v_order_count
  FROM orders
  WHERE doc_year = p_doc_year OR EXTRACT(YEAR FROM created_at::date) + 543 = p_doc_year;

  RETURN jsonb_build_object(
    'doc_year', p_doc_year,
    'incoming_count', COALESCE(v_incoming_count, 0),
    'outgoing_count', COALESCE(v_outgoing_count, 0),
    'memo_count', COALESCE(v_memo_count, 0),
    'order_count', COALESCE(v_order_count, 0),
    'total_count', COALESCE(v_incoming_count, 0) + COALESCE(v_outgoing_count, 0) + COALESCE(v_memo_count, 0) + COALESCE(v_order_count, 0)
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 8. RPC Function: สรุปภาระงานรายบุคคล (Staff Workload Distribution)
-- Fixed: เปลี่ยน position/department เป็น staff_position/staff_department เพื่อไม่ชน Reserved Keyword
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_staff_workload_summary(p_doc_year INTEGER)
RETURNS TABLE (
  staff_id UUID,
  staff_name TEXT,
  staff_position TEXT,
  staff_department TEXT,
  total_assigned BIGINT,
  completed_count BIGINT,
  pending_count BIGINT,
  completion_rate NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH staff_list AS (
    SELECT 
      t.id AS s_id,
      COALESCE(t.prefix, '') || t.first_name || ' ' || COALESCE(t.last_name, '') AS s_name,
      COALESCE(t.position, 'ครูผู้สอน') AS s_pos,
      COALESCE(t.department, 'วิชาการ') AS s_dept
    FROM teachers t
    WHERE t.status = 'active' OR t.status IS NULL
    UNION
    SELECT 
      p.id AS s_id,
      COALESCE(p.display_name, p.email) AS s_name,
      CASE WHEN p.role = 'director' THEN 'ผู้อำนวยการโรงเรียน'
           WHEN p.role = 'admin' THEN 'ผู้ดูแลระบบ'
           ELSE 'บุคลากร' END AS s_pos,
      'ทั่วไป' AS s_dept
    FROM profiles p
    WHERE p.id NOT IN (SELECT t2.id FROM teachers t2)
  ),
  assignments_year AS (
    SELECT 
      da.assignee_id,
      da.status AS a_status
    FROM doc_assignments da
    JOIN incoming_docs inc ON da.doc_id = inc.id
    WHERE inc.doc_year = p_doc_year 
       OR EXTRACT(YEAR FROM inc.created_at::date) + 543 = p_doc_year
  )
  SELECT 
    sl.s_id AS staff_id,
    sl.s_name AS staff_name,
    sl.s_pos AS staff_position,
    sl.s_dept AS staff_department,
    COUNT(ay.a_status) AS total_assigned,
    COUNT(CASE WHEN ay.a_status IN ('reported', 'acknowledged', 'completed') THEN 1 END) AS completed_count,
    COUNT(CASE WHEN ay.a_status IN ('pending') THEN 1 END) AS pending_count,
    ROUND(
      CASE WHEN COUNT(ay.a_status) > 0 
           THEN (COUNT(CASE WHEN ay.a_status IN ('reported', 'acknowledged', 'completed') THEN 1 END)::NUMERIC / COUNT(ay.a_status)::NUMERIC) * 100 
           ELSE 100.0 END, 
      1
    ) AS completion_rate
  FROM staff_list sl
  LEFT JOIN assignments_year ay ON sl.s_id = ay.assignee_id
  GROUP BY sl.s_id, sl.s_name, sl.s_pos, sl.s_dept
  HAVING COUNT(ay.a_status) > 0
  ORDER BY total_assigned DESC, completed_count DESC;
END;
$$;

-- ------------------------------------------------------------------------------
-- 9. ตารางบันทึกประวัติการสร้างรายงานสรุปประจำปี (Annual Saraban Report Snapshots)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS annual_saraban_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_year INTEGER NOT NULL,
  report_type TEXT NOT NULL DEFAULT 'calendar_year' CHECK (report_type IN ('calendar_year', 'fiscal_year')),
  title TEXT NOT NULL,
  memo_cover_data JSONB NOT NULL DEFAULT '{}',
  workload_summary JSONB NOT NULL DEFAULT '[]',
  stats_summary JSONB NOT NULL DEFAULT '{}',
  created_by UUID,
  created_by_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'archived')),
  director_feedback TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- มอบสิทธิ์การใช้งาน
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON document_number_series TO authenticated;
GRANT ALL ON document_number_counters TO authenticated;
GRANT ALL ON document_number_allocations TO authenticated;
GRANT ALL ON annual_saraban_reports TO authenticated;
GRANT EXECUTE ON FUNCTION reserve_document_number TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_document_number TO authenticated;
GRANT EXECUTE ON FUNCTION void_document_number TO authenticated;
GRANT EXECUTE ON FUNCTION get_annual_saraban_overview TO authenticated;
GRANT EXECUTE ON FUNCTION get_staff_workload_summary TO authenticated;
