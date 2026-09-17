import { useState, useEffect } from 'react';
import { useAuth } from './contexts/AuthContext';
import { supabase, getSchoolProfiles, getActiveSchoolProfile } from './lib/supabase';
import Login from './pages/Login';
import SchoolSetup from './pages/SchoolSetup';
import IncomingDocs from './pages/IncomingDocs';
import OutgoingDocs from './pages/OutgoingDocs';
import Orders from './pages/Orders';
import Memos from './pages/Memos';
import Students from './pages/Students';
import Teachers from './pages/Teachers';
import TaskManagement from './pages/TaskManagement';
import Attendance from './pages/Attendance';
import AttendanceReport from './pages/AttendanceReport';
import LibraryModule from './pages/Library';
import WFHModule from './pages/WFH';
import LECReports from './pages/LECReports';
import Reports from './pages/Reports';
import CustomStudentPrint from './pages/CustomStudentPrint';
import SettingsPage from './pages/Settings';
import UsersManagement from './pages/Users';
import ProfilePage from './pages/Profile';
import Dashboard from './pages/Dashboard';
import Academic from './pages/Academic';
import Procurement from './pages/Procurement';
import FreeEducation from './pages/FreeEducation';
import Utilities from './pages/Utilities';
import AICowork from './pages/AICowork';
import ARLearning from './pages/ARLearning';
import ARAdmin from './pages/ARAdmin';
import ServiceArea from './pages/ServiceArea';
import Athletics from './pages/Athletics';
import KnowledgeBase from './pages/KnowledgeBase';
import StudentGradePortal from './pages/StudentGradePortal';
import AnnualSarabanReport from './pages/AnnualSarabanReport';
import IdentityFooter from './components/IdentityFooter';
import ResetPasswordModal from './components/ResetPasswordModal';
import ToastContainer from './components/ToastContainer';

import { 
  Loader2, 
  LayoutDashboard, 
  Users, 
  Clock, 
  Library, 
  Settings as SettingsIcon, 
  LogOut, 
  Book, 
  BookOpen,

  MessageSquare,
  ChevronRight,
  PieChart,
  Printer,
  UserCheck,
  ClipboardList,
  ShieldCheck,
  UserCircle,
  GraduationCap,
  Wallet,
  BarChart3,
  FileDown,
  FileUp,
  User,
  Bot,
  Coins,
  Droplets,
  Download,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Gamepad2,
  MapPin,
  Award
} from 'lucide-react';

const { ipcRenderer } = (window as any).require ? (window as any).require('electron') : { ipcRenderer: null };

type Tab = 'dashboard' | 'incoming' | 'outgoing' | 'orders' | 'memos' | 'students' | 'teachers' | 'tasks' | 'attendance' | 'attendance_report' | 'library' | 'wfh' | 'settings' | 'lec' | 'custom_print' | 'users' | 'academic' | 'finance' | 'reports' | 'profile' | 'ai_cowork' | 'knowledge_base' | 'free_education' | 'utilities' | 'ar_learning' | 'ar_admin' | 'service_area' | 'athletics' | 'grade_portal' | 'annual_saraban';


function App() {
  const { user, profile, loading, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [schoolName, setSchoolName] = useState(import.meta.env.VITE_SCHOOL_NAME || 'โรงเรียนบ้านควนโคกยา');
  const [schoolLogo, setSchoolLogo] = useState('');
  const [localGovName, setLocalGovName] = useState('');
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  
  // ตรวจจับ URL สำหรับผู้ปกครองเข้าดูผลการเรียนโดยตรง (?portal=grades หรือ ?tab=grades)
  const [showGradePortal, setShowGradePortal] = useState(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      return p.get('portal') === 'grades' || p.get('tab') === 'grades';
    }
    return false;
  });

  const [showSchoolSetup, setShowSchoolSetup] = useState(() => {
    return sessionStorage.getItem('open_school_setup_after_reload') === 'true';
  });

  useEffect(() => {
    if (showSchoolSetup) {
      sessionStorage.removeItem('open_school_setup_after_reload');
    }
  }, [showSchoolSetup]);

  const handleSwitchSchool = async () => {
    if (window.confirm('คุณครูต้องการสลับสถานศึกษาใช่หรือไม่?\nระบบจะทำการออกจากระบบของโรงเรียนนี้')) {
      await signOut();
      sessionStorage.setItem('open_school_setup_after_reload', 'true');
      window.location.reload();
    }
  };
  
  // Update State
  const [updateStatus, setUpdateStatus] = useState<{ type: string; message: string; version?: string } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);

  useEffect(() => {
    if (!ipcRenderer) return;

    ipcRenderer.on('update-status', (_event: any, status: any) => {
      setUpdateStatus(status);
      if (status.type === 'not-available' || status.type === 'error') {
        setTimeout(() => setUpdateStatus(null), 5000);
      }
    });

    ipcRenderer.on('update-progress', (_event: any, progress: any) => {
      setDownloadProgress(Math.floor(progress.percent));
    });

    return () => {
      ipcRenderer.removeAllListeners('update-status');
      ipcRenderer.removeAllListeners('update-progress');
    };
  }, []);

  useEffect(() => {
    const handleChangeTab = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail) {
        setActiveTab(customEvent.detail as Tab);
      }
    };
    window.addEventListener('change-tab', handleChangeTab);
    return () => window.removeEventListener('change-tab', handleChangeTab);
  }, []);

  // ===== ตรวจจับ Supabase PASSWORD_RECOVERY Event =====
  // เป็น useEffect แยกไม่กระทบ โค้ดเดิม
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setShowPasswordReset(true);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleRestart = () => {
    const confirmRestart = window.confirm('ระบบพร้อมอัปเดตแล้วค่ะ คุณครูต้องการเริ่มระบบใหม่ตอนนี้เลยไหมคะ? \n(กรุณาตรวจสอบว่าบันทึกข้อมูลที่ค้างไว้เรียบร้อยแล้วนะคะ)');
    
    if (confirmRestart) {
      // ล้าง Cache หรือ Session ที่อาจตกค้างก่อน Restart
      try {
        sessionStorage.clear();
        console.log('Session storage cleared before restart');
      } catch (e) {
        console.error('Failed to clear session storage:', e);
      }
      
      if (ipcRenderer) ipcRenderer.send('restart-app');
    }
  };

  useEffect(() => {
    async function fetchSchoolName() {
      const activeProfile = getActiveSchoolProfile();
      if (!activeProfile) {
        // หากยังไม่มีการตั้งค่าโปรไฟล์โรงเรียนจริง ให้ดึงค่าโรงเรียนตัวอย่างจาก env แทนการยิง API ไปหา placeholder URL
        setSchoolName(import.meta.env.VITE_SCHOOL_NAME || 'โรงเรียนบ้านควนโคกยา');
        setSchoolLogo('');
        setLocalGovName('');
        return;
      }

      try {
        const { data } = await supabase.from('settings').select('school_name, school_logo_url, local_gov_name').limit(1).maybeSingle();
        if (data?.school_name) setSchoolName(data.school_name);
        if (data?.school_logo_url) setSchoolLogo(data.school_logo_url);
        if (data?.local_gov_name) setLocalGovName(data.local_gov_name);
      } catch (err) {
        console.error('Error fetching school name/logo:', err);
      }
    }
    fetchSchoolName();
  }, [user]);


  const isAdmin = profile?.role === 'admin';
  const isDirector = profile?.role === 'director' || isAdmin;
  const isTeacher = profile?.role === 'teacher';
  const isGuest = profile?.role === 'guest' || !profile?.role;

  useEffect(() => {
    if (isGuest && activeTab !== 'dashboard') {
      setActiveTab('dashboard');
      return;
    }
    
    // ตรวจสอบสิทธิ์แบบละเอียดและดีดกลับหน้าแดชบอร์ด หากผู้ใช้ระดับครูไม่มีสิทธิ์ในหน้าดังกล่าว
    if (user && profile && !isAdmin && !isDirector) {
      const extraPerms = profile.extra_permissions || {};
      
      const isRestrictedDoc = activeTab === 'incoming' || activeTab === 'outgoing' || activeTab === 'orders';
      const isRestrictedStaff = activeTab === 'teachers' || activeTab === 'wfh';
      const isRestrictedReport = activeTab === 'reports' || activeTab === 'lec';
      const isRestrictedStudent = activeTab === 'students' || activeTab === 'attendance_report';
      const isRestrictedAcademic = activeTab === 'academic';
      const isRestrictedLibrary = activeTab === 'library';
      const isRestrictedFinance = activeTab === 'finance' || activeTab === 'utilities' || activeTab === 'free_education';
      const isRestrictedAdmin = activeTab === 'users' || activeTab === 'settings';
      const isRestrictedAthletics = activeTab === 'athletics';
      
      if (isRestrictedDoc && !extraPerms.access_administrative) {
        setActiveTab('dashboard');
      } else if (isRestrictedStaff && !extraPerms.access_hr) {
        setActiveTab('dashboard');
      } else if (isRestrictedReport && !extraPerms.access_reports) {
        setActiveTab('dashboard');
      } else if (isRestrictedStudent && !extraPerms.access_student_affairs) {
        setActiveTab('dashboard');
      } else if (isRestrictedAcademic && profile?.role !== 'teacher' && !extraPerms.access_academic) {
        setActiveTab('dashboard');
      } else if (isRestrictedLibrary && !extraPerms.access_academic) {
        setActiveTab('dashboard');
      } else if (isRestrictedFinance && !extraPerms.access_finance) {
        setActiveTab('dashboard');
      } else if (isRestrictedAthletics && !extraPerms.access_athletics) {
        setActiveTab('dashboard');
      } else if (isRestrictedAdmin && !isAdmin) {
        setActiveTab('dashboard');
      }
    }
  }, [user, profile, activeTab, isGuest, isAdmin, isDirector]);

  const hasProfiles = getSchoolProfiles().length > 0;

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-brand-primary" size={48} /></div>;
  
  if (showGradePortal) {
    return <StudentGradePortal onBack={() => setShowGradePortal(false)} />;
  }

  if (!user) {
    if (showSchoolSetup || !hasProfiles) {
      return (
        <SchoolSetup 
          onBackToLogin={hasProfiles ? () => setShowSchoolSetup(false) : undefined} 
        />
      );
    }
    return (
      <Login 
        onManageSchools={() => setShowSchoolSetup(true)} 
        onOpenGradePortal={() => setShowGradePortal(true)}
      />
    );
  }

  const extraPerms = profile?.extra_permissions || {};
  const canAccessRegistration = !isGuest && (isAdmin || isDirector || extraPerms.access_administrative);
  const canAccessStaff = !isGuest && (isAdmin || isDirector || extraPerms.access_hr);
  const canAccessReports = !isGuest && (isDirector || extraPerms.access_reports);
  const canAccessStudentAffairs = !isGuest && (isAdmin || isDirector || extraPerms.access_student_affairs);
  const canAccessAcademic = !isGuest && (isAdmin || isDirector || isTeacher || extraPerms.access_academic);
  const canAccessLibrary = !isGuest && (isAdmin || isDirector || extraPerms.access_academic);
  const canAccessFinance = !isGuest && (isAdmin || isDirector || extraPerms.access_finance);
  const canAccessAthletics = !isGuest && (isAdmin || isDirector || extraPerms.access_athletics);

  return (
    <div className="min-h-screen flex bg-slate-50 print:block print:bg-white print:p-0">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col sticky top-0 h-screen overflow-y-auto scrollbar-hide shrink-0 shadow-sm print:hidden print:!hidden">
        <div className="p-6 border-b border-slate-50 flex items-center gap-3 bg-white animate-in fade-in">
          <img src={schoolLogo || import.meta.env.VITE_SCHOOL_LOGO_PATH || "logo.png"} alt="School Logo" className="w-12 h-12 object-contain" />
          <div className="flex-1 min-w-0">
            <h1 className="font-black text-slate-800 text-xs tracking-tighter truncate">{schoolName}</h1>
            <button 
              onClick={handleSwitchSchool}
              className="text-[9px] text-brand-primary font-black uppercase tracking-widest hover:underline block text-left mt-0.5"
            >
              🔄 สลับโรงเรียน
            </button>
          </div>
        </div>

        <nav className="flex-1 py-6 px-4 space-y-1">
          <SidebarItem icon={<LayoutDashboard size={20} />} label="แดชบอร์ด" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
          
          {!isGuest && (
            <>
              <SidebarItem icon={<User size={20} />} label="ข้อมูลส่วนตัว" active={activeTab === 'profile'} onClick={() => setActiveTab('profile')} />
              {canAccessReports && <SidebarItem icon={<BarChart3 size={20} />} label="ระบบรายงานอัจฉริยะ" active={activeTab === 'reports'} onClick={() => setActiveTab('reports')} />}

              <div className="py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 mt-4 text-[9px]">งานสารบรรณ</div>
              {canAccessRegistration && <SidebarItem icon={<FileDown size={20} />} label="หนังสือรับ" active={activeTab === 'incoming'} onClick={() => setActiveTab('incoming')} />}
              {canAccessRegistration && <SidebarItem icon={<FileUp size={20} />} label="หนังสือส่ง" active={activeTab === 'outgoing'} onClick={() => setActiveTab('outgoing')} />}
              {canAccessRegistration && <SidebarItem icon={<Book size={20} />} label="คำสั่ง" active={activeTab === 'orders'} onClick={() => setActiveTab('orders')} />}
              <SidebarItem icon={<MessageSquare size={20} />} label="บันทึกข้อความ" active={activeTab === 'memos'} onClick={() => setActiveTab('memos')} />
              <SidebarItem icon={<ClipboardList size={20} />} label="ติดตามงาน/สั่งการ" active={activeTab === 'tasks'} onClick={() => setActiveTab('tasks')} />
              <SidebarItem icon={<Award size={20} />} label="สรุปสารบรรณประจำปี" active={activeTab === 'annual_saraban'} onClick={() => setActiveTab('annual_saraban')} />

              <div className="py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 mt-4 text-[9px]">นวัตกรรม AI</div>
              <SidebarItem icon={<Bot size={20} />} label="AI Cowork" active={activeTab === 'ai_cowork'} onClick={() => setActiveTab('ai_cowork')} />
              <SidebarItem icon={<BookOpen size={20} />} label="คลังคู่มือ (RAG)" active={activeTab === 'knowledge_base'} onClick={() => setActiveTab('knowledge_base')} />


              {canAccessAcademic && (
                <div className="py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 mt-4 text-[9px]">
                  {isTeacher && !extraPerms.access_academic ? "งานแผนการสอน" : "งานวิชาการ"}
                </div>
              )}
              {canAccessAcademic && (
                <SidebarItem 
                  icon={<GraduationCap size={20} />} 
                  label={isTeacher && !extraPerms.access_academic ? "ส่งแผนการสอน" : "ระบบวิชาการ"} 
                  active={activeTab === 'academic'} 
                  onClick={() => setActiveTab('academic')} 
                />
              )}
              {canAccessAcademic && (
                <SidebarItem 
                  icon={<BookOpen size={20} />} 
                  label="ประกาศผลการเรียน" 
                  active={activeTab === 'grade_portal'} 
                  onClick={() => setActiveTab('grade_portal')} 
                />
              )}
              {canAccessLibrary && <SidebarItem icon={<Library size={20} />} label="ระบบห้องสมุด" active={activeTab === 'library'} onClick={() => setActiveTab('library')} />}
              <div className="py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 mt-4 text-[9px]">สื่อการเรียนรู้ AR</div>
              <SidebarItem icon={<Gamepad2 size={20} />} label="น้องชบาพาพิชิต(AR)" active={activeTab === 'ar_learning'} onClick={() => setActiveTab('ar_learning')} />
              <SidebarItem icon={<SettingsIcon size={20} />} label="จัดการบทเรียน AR" active={activeTab === 'ar_admin'} onClick={() => setActiveTab('ar_admin')} />

              {canAccessFinance && <div className="py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 mt-4 text-[9px]">งานงบประมาณ</div>}
              {canAccessFinance && <SidebarItem icon={<Wallet size={20} />} label="การเงิน/พัสดุ" active={activeTab === 'finance'} onClick={() => setActiveTab('finance')} />}
              {canAccessFinance && <SidebarItem icon={<Droplets size={20} />} label="เบิกค่าสาธารณูปโภค" active={activeTab === 'utilities'} onClick={() => setActiveTab('utilities')} />}
              {canAccessFinance && <SidebarItem icon={<Coins size={20} />} label="จ่ายเงินเรียนฟรี" active={activeTab === 'free_education'} onClick={() => setActiveTab('free_education')} />}

              {canAccessStaff && <div className="py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 mt-4 text-[9px]">งานบุคคล</div>}
              {canAccessStaff && <SidebarItem icon={<UserCheck size={20} />} label="จัดการข้อมูลครู" active={activeTab === 'teachers'} onClick={() => setActiveTab('teachers')} />}
              {canAccessStaff && <SidebarItem icon={<Clock size={20} />} label="ลงเวลาปฏิบัติงาน" active={activeTab === 'wfh'} onClick={() => setActiveTab('wfh')} />}

              <div className="py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 mt-4 text-[9px]">งานบริหารทั่วไป</div>
              {canAccessStudentAffairs && <SidebarItem icon={<Users size={20} />} label="ข้อมูลนักเรียน" active={activeTab === 'students'} onClick={() => setActiveTab('students')} />}
              {canAccessAthletics && <SidebarItem icon={<Gamepad2 size={20} />} label="งานลงทะเบียนนักกีฬา" active={activeTab === 'athletics'} onClick={() => setActiveTab('athletics')} />}
              {canAccessStudentAffairs && <SidebarItem icon={<MapPin size={20} />} label="เด็กในเขตบริการ (ทร.14)" active={activeTab === 'service_area'} onClick={() => setActiveTab('service_area')} />}
              <SidebarItem icon={<Printer size={20} />} label="พิมพ์รายชื่อ" active={activeTab === 'custom_print'} onClick={() => setActiveTab('custom_print')} />
              {canAccessReports && <SidebarItem icon={<PieChart size={20} />} label="รายงาน LEC" active={activeTab === 'lec'} onClick={() => setActiveTab('lec')} />}
              <SidebarItem icon={<Clock size={20} />} label="บันทึกเวลาเรียน" active={activeTab === 'attendance'} onClick={() => setActiveTab('attendance')} />
              {canAccessStudentAffairs && <SidebarItem icon={<BarChart3 size={20} />} label="รายงานเวลาเรียน" active={activeTab === 'attendance_report'} onClick={() => setActiveTab('attendance_report')} />}
              
              {isAdmin && (
                <>
                  <div className="py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 mt-4 text-[9px]">ตั้งค่าและความปลอดภัย</div>
                  <SidebarItem icon={<ShieldCheck size={20} />} label="จัดการสิทธิ์" active={activeTab === 'users'} onClick={() => setActiveTab('users')} />
                  <SidebarItem icon={<SettingsIcon size={20} />} label="ตั้งค่าระบบ" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
                </>
              )}
            </>
          )}
        </nav>

        <div className="p-4 border-t border-slate-100 bg-white">
          <button onClick={() => signOut()} className="flex items-center gap-3 w-full px-4 py-3 text-red-500 hover:bg-red-50 rounded-xl transition-all font-bold text-sm mb-4">
            <LogOut size={20} /> ออกจากระบบ
          </button>
          
          <div className="px-4 py-2 border-t border-slate-50 mt-2">
            <p className="text-[8px] text-slate-400 font-bold uppercase tracking-tighter leading-tight">
              Smart School Admin © 2026<br/>
              <span className="text-brand-primary">Phairot Makkaew & Gemini AI</span><br/>
              {schoolName}<br/>
              <span className="text-slate-500 normal-case font-semibold">Version {import.meta.env.VITE_APP_VERSION || '1.2.0'}</span>
            </p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden print:h-auto print:overflow-visible print:block print:w-full print:p-0">
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0 shadow-xs print:hidden print:!hidden">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2 uppercase tracking-tight">
            {activeTab === 'dashboard' && 'แดชบอร์ด'}
            {activeTab === 'profile' && 'ข้อมูลส่วนตัวและลายเซ็น'}
            {activeTab === 'reports' && 'ระบบรายงานอัจฉริยะ'}
            {activeTab === 'incoming' && 'หนังสือรับ'}
            {activeTab === 'outgoing' && 'หนังสือส่ง'}
            {activeTab === 'orders' && 'คำสั่ง'}
            {activeTab === 'memos' && 'บันทึกข้อความ'}
            {activeTab === 'students' && 'ข้อมูลนักเรียน'}
            {activeTab === 'teachers' && 'จัดการข้อมูลครู (งานบุคคล)'}
            {activeTab === 'tasks' && 'ระบบติดตามงาน (งานสารบรรณ)'}
            {activeTab === 'custom_print' && 'พิมพ์รายชื่อ (บริหารทั่วไป)'}
            {activeTab === 'lec' && 'รายงาน LEC (บริหารทั่วไป)'}
            {activeTab === 'attendance' && 'บันทึกเวลาเรียน (บริหารทั่วไป)'}
            {activeTab === 'attendance_report' && 'รายงานเวลาเรียน (บริหารทั่วไป)'}
            {activeTab === 'library' && 'ระบบห้องสมุด (วิชาการ)'}
            {activeTab === 'wfh' && 'ลงเวลาปฏิบัติงาน (งานบุคคล)'}
            {activeTab === 'settings' && 'ตั้งค่าระบบ'}
            {activeTab === 'users' && 'จัดการสิทธิ์ผู้ใช้งาน'}
            {activeTab === 'academic' && (isTeacher && !extraPerms.access_academic ? 'ส่งแผนการสอน' : 'งานวิชาการ')}
            {activeTab === 'grade_portal' && 'ระบบประกาศผลการเรียนออนไลน์ (สำหรับนักเรียน/ผู้ปกครอง)'}
            {activeTab === 'finance' && 'งานงบประมาณ (การเงิน/พัสดุ)'}
            {activeTab === 'utilities' && 'ระบบเบิกค่าสาธารณูปโภค'}
            {activeTab === 'free_education' && 'ระบบจ่ายเงินเรียนฟรี (๑๕ ปี)'}
            {activeTab === 'ai_cowork' && 'AI Cowork'}
            {activeTab === 'knowledge_base' && 'คลังคู่มือปฏิบัติงาน (RAG Knowledge Base)'}
            {activeTab === 'ar_learning' && 'น้องชบาพาพิชิต (AR)'}
            {activeTab === 'ar_admin' && 'จัดการด่านบทเรียน น้องชบาพาพิชิต (AR)'}
            {activeTab === 'service_area' && 'เด็กในเขตพื้นที่บริการ (ทร.14)'}
            {activeTab === 'athletics' && 'งานลงทะเบียนนักกีฬา'}
            {activeTab === 'annual_saraban' && 'รายงานสรุปงานสารบรรณประจำปี พ.ศ.'}
          </h2>
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-bold text-slate-800 leading-none">{profile?.display_name || user.email}</p>
              <p className="text-[10px] font-bold text-brand-primary uppercase mt-1">
                {profile?.role === 'admin' && 'Administrator'}
                {profile?.role === 'director' && 'Director (ผอ.)'}
                {profile?.role === 'teacher' && 'Teacher (ครู)'}
                {profile?.role === 'guest' && 'Guest (รออนุมัติ)'}
                {!profile?.role && 'User'}
              </p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-300 shadow-inner overflow-hidden">
              <UserCircle size={32} />
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 bg-slate-50/50 custom-scrollbar print:p-0 print:overflow-visible print:bg-white print:block print:w-full print:m-0">
          <div className="max-w-7xl mx-auto print:max-w-none print:m-0 print:p-0 print:w-full">
            {activeTab === 'dashboard' && <Dashboard onNavigate={(tab) => setActiveTab(tab as Tab)} />}
            {activeTab === 'profile' && <ProfilePage />}
            {activeTab === 'reports' && <Reports />}
            {activeTab === 'incoming' && <IncomingDocs />}
            {activeTab === 'outgoing' && <OutgoingDocs />}
            {activeTab === 'orders' && <Orders />}
            {activeTab === 'memos' && <Memos />}
            {activeTab === 'students' && <Students />}
            {activeTab === 'teachers' && <Teachers />}
            {activeTab === 'tasks' && <TaskManagement />}
            {activeTab === 'custom_print' && <CustomStudentPrint />}
            {activeTab === 'lec' && <LECReports />}
            {activeTab === 'attendance' && <Attendance />}
            {activeTab === 'attendance_report' && <AttendanceReport />}
            {activeTab === 'library' && <LibraryModule />}
            {activeTab === 'wfh' && <WFHModule />}
            {activeTab === 'settings' && <SettingsPage />}
            {activeTab === 'users' && <UsersManagement />}
            {activeTab === 'academic' && <Academic />}
            {activeTab === 'grade_portal' && <StudentGradePortal />}
            {activeTab === 'finance' && <Procurement />}
            {activeTab === 'utilities' && <Utilities />}
            {activeTab === 'free_education' && <FreeEducation />}
            {activeTab === 'ai_cowork' && <AICowork />}
            {activeTab === 'knowledge_base' && <KnowledgeBase />}
            {activeTab === 'ar_learning' && <ARLearning onBack={() => setActiveTab('academic')} />}
            {activeTab === 'ar_admin' && <ARAdmin onBack={() => setActiveTab('academic')} />}
            {activeTab === 'service_area' && <ServiceArea />}
            {activeTab === 'athletics' && <Athletics />}
            {activeTab === 'annual_saraban' && <AnnualSarabanReport />}

            
            <IdentityFooter schoolName={schoolName} schoolLogo={schoolLogo} localGovName={localGovName} />
          </div>
        </div>

        {/* Update Notification Overlay */}
        {updateStatus && (
          <div className="fixed bottom-6 right-6 z-[9999] animate-in slide-in-from-bottom-10 duration-500 print:hidden">
            <div className="bg-white rounded-[32px] shadow-2xl border border-slate-100 p-6 w-[380px] overflow-hidden relative">
              <div className="flex items-start gap-4">
                <div className={`p-3 rounded-2xl shrink-0 ${
                  updateStatus.type === 'downloaded' ? 'bg-green-50 text-green-600' :
                  updateStatus.type === 'error' ? 'bg-red-50 text-red-600' :
                  'bg-blue-50 text-blue-600'
                }`}>
                  {updateStatus.type === 'available' && <Download size={24} className="animate-bounce" />}
                  {updateStatus.type === 'checking' && <RefreshCw size={24} className="animate-spin" />}
                  {updateStatus.type === 'downloaded' && <CheckCircle2 size={24} />}
                  {updateStatus.type === 'error' && <XCircle size={24} />}
                  {updateStatus.type === 'not-available' && <CheckCircle2 size={24} />}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-black text-slate-800 text-sm flex items-center gap-2">
                    {updateStatus.type === 'available' ? 'พบเวอร์ชันใหม่!' :
                     updateStatus.type === 'downloaded' ? 'ดาวน์โหลดเสร็จแล้ว' :
                     updateStatus.type === 'error' ? 'เกิดข้อผิดพลาด' :
                     'ระบบอัปเดตอัตโนมัติ'}
                    {updateStatus.version && <span className="bg-slate-100 px-2 py-0.5 rounded-lg text-[10px] text-slate-500">v{updateStatus.version}</span>}
                  </h4>
                  <p className="text-slate-500 text-xs mt-1 font-medium leading-relaxed truncate">{updateStatus.message}</p>
                  
                  {updateStatus.type === 'available' && (
                    <div className="mt-4 space-y-2">
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-brand-primary transition-all duration-300 ease-out"
                          style={{ width: `${downloadProgress}%` }}
                        ></div>
                      </div>
                      <div className="flex justify-between text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        <span>กำลังดาวน์โหลด...</span>
                        <span>{downloadProgress}%</span>
                      </div>
                    </div>
                  )}

                  {updateStatus.type === 'downloaded' && (
                    <button 
                      onClick={handleRestart}
                      className="mt-4 w-full bg-slate-800 hover:bg-slate-900 text-white py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-lg shadow-slate-200"
                    >
                      <RefreshCw size={14} /> เริ่มระบบใหม่เพื่อติดตั้ง
                    </button>
                  )}
                </div>
                {updateStatus.type === 'not-available' && (
                  <button onClick={() => setUpdateStatus(null)} className="text-slate-300 hover:text-slate-500 transition-colors">
                    <XCircle size={20} />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ===== Reset Password Modal (แสดงเมื่อคลิกลิงก์จากอีเมล) ===== */}
      {showPasswordReset && (
        <ResetPasswordModal onClose={() => setShowPasswordReset(false)} />
      )}

      {/* ===== Toast Notification Container ===== */}
      <ToastContainer />
    </div>
  );
}


interface SidebarItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

function SidebarItem({ icon, label, active, onClick }: SidebarItemProps) {
  return (
    <button onClick={onClick} className={`flex items-center justify-between w-full px-4 py-3.5 rounded-2xl transition-all group ${active ? 'bg-brand-primary text-white shadow-lg shadow-green-100 scale-[1.02]' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}>
      <div className="flex items-center gap-3">
        <span className={active ? 'text-white' : 'text-slate-400 group-hover:text-slate-600'}>{icon}</span>
        <span className="text-sm font-bold">{label}</span>
      </div>
      {active && <ChevronRight size={14} />}
    </button>
  );
}

export default App;
