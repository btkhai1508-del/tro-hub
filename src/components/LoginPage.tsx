import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  Phone, 
  Lock, 
  Eye, 
  EyeOff, 
  ArrowRight, 
  CheckCircle2, 
  AlertCircle, 
  KeyRound, 
  User, 
  Clock, 
  ShieldAlert, 
  PhoneCall
} from './AppIcons';
import { IconHome3D } from './Icons3D';
import { useApp } from '../context/AppContext';
import { Background } from './Background';
import { AppleCheckbox } from './AppleControls';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { loginUser, loginWithZalo, registerResident } = useApp();

  // Mode: 'login' | 'register' | 'forgot' | 'pending_approval'
  const [mode, setMode] = useState<'login' | 'register' | 'forgot' | 'pending_approval'>('login');

  // Login form state - clean inputs
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  // Register form state
  const [regName, setRegName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regRoom, setRegRoom] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPass, setRegConfirmPass] = useState('');
  const [registeredData, setRegisteredData] = useState<any>(null);

  // Status feedback
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Reset password state
  const [forgotInput, setForgotInput] = useState('');

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    setIsLoading(true);

    try {
      const res = await loginUser(phone, password);
      setIsLoading(false);
      if (res.success) {
        setSuccessMsg('Đăng nhập thành công! Đang chuyển hướng...');
        setTimeout(() => {
          const isAdmin = Boolean(res.isAdmin) || phone.trim().toLowerCase() === 'admin' || phone.replace(/\D/g, '').endsWith('902371800');
          const from = (location.state as any)?.from?.pathname;
          const target = isAdmin ? '/admin' : ((from && from !== '/login' && from !== '/' && from !== '/admin') ? from : '/');
          navigate(target, { replace: true });
        }, 400);
      } else {
        setErrorMsg(res.error || 'Số điện thoại hoặc mật khẩu không chính xác');
      }
    } catch (err: any) {
      setIsLoading(false);
      setErrorMsg('Không thể kiểm tra đăng nhập: ' + (err.message || 'Lỗi mạng'));
    }
  };

  const handleZaloLogin = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    setIsLoading(true);

    try {
      const res = await loginWithZalo();
      setIsLoading(false);
      if (res.success) {
        setSuccessMsg('Đăng nhập Zalo thành công! Đang chuyển hướng...');
        setTimeout(() => {
          const from = (location.state as any)?.from?.pathname;
          const target = res.isAdmin ? '/admin' : ((from && from !== '/login' && from !== '/' && from !== '/admin') ? from : '/');
          navigate(target, { replace: true });
        }, 400);
      } else {
        setErrorMsg(res.error || 'Không thể đăng nhập bằng Zalo. Vui lòng đăng nhập bằng Số điện thoại và Mật khẩu.');
      }
    } catch (err: any) {
      setIsLoading(false);
      let friendlyMsg = 'Tính năng đăng nhập nhanh Zalo 1-chạm chỉ hoạt động khi mở trong ứng dụng Zalo trên điện thoại. Trên trình duyệt web, vui lòng đăng nhập bằng Số điện thoại và Mật khẩu bên dưới.';
      if (err?.code !== -2000 && err?.message && !err.message.includes('-2000') && !err.message.includes('Unknown error')) {
        friendlyMsg = err.message;
      }
      setErrorMsg(friendlyMsg);
    }
  };

  const handleRegisterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (regPassword !== regConfirmPass) {
      setErrorMsg('Mật khẩu xác nhận không khớp');
      return;
    }

    setIsLoading(true);
    setTimeout(() => {
      const res = registerResident({
        name: regName,
        phone: regPhone,
        email: regEmail,
        roomNumber: regRoom,
        password: regPassword
      });
      setIsLoading(false);

      if (res.success && res.pendingApproval) {
        setRegisteredData({
          name: regName,
          phone: regPhone,
          roomNumber: regRoom
        });
        setMode('pending_approval');
        // Reset register fields
        setRegName('');
        setRegPhone('');
        setRegEmail('');
        setRegRoom('');
        setRegPassword('');
        setRegConfirmPass('');
      } else {
        setErrorMsg(res.error || 'Đăng ký không thành công');
      }
    }, 400);
  };

  return (
    <div className="kit-auth-shell relative isolate flex min-h-svh items-center justify-center px-3 py-6 sm:px-8 sm:py-10">
      <Background />
      <div className="kit-login-window liquid-panel auth-panel relative z-10 mx-auto w-full max-w-[464px] overflow-hidden">
        <div className="kit-window-toolbar flex min-h-[76px] items-center gap-3 px-5 py-4 sm:px-7">
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center">
            <IconHome3D size={56} />
          </span>
          <div className="min-w-0">
            <span className="block apple-title2 apple-strong kit-text-primary">Trọ-Hub</span>
            <span className="block apple-callout kit-text-secondary">Nhà trọ Phong Lan</span>
          </div>
        </div>

        <div className="px-5 pb-7 pt-6 sm:px-7 sm:pb-8 sm:pt-7">
          <div className="mb-6">
            <h1 className="apple-large-title apple-strong kit-text-primary">
              {mode === 'register' ? 'Bắt đầu với Trọ-Hub' : mode === 'forgot' ? 'Lấy lại quyền truy cập' : mode === 'pending_approval' ? 'Chào mừng bạn' : 'Chào bạn trở lại.'}
            </h1>
            <p className="mt-2 apple-body kit-text-secondary">
              {mode === 'register' ? 'Tạo tài khoản để kết nối với nơi bạn đang sống.' : mode === 'forgot' ? 'Chúng mình sẽ giúp bạn trở lại không gian của mình.' : mode === 'pending_approval' ? 'Thông tin đăng ký của bạn đã được ghi nhận.' : 'Đăng nhập để xem hóa đơn và quản lý tiện ích.'}
            </p>
          </div>

          {mode !== 'forgot' && mode !== 'pending_approval' && (
            <div className="kit-segmented mb-6 grid grid-cols-2 gap-1 p-1" aria-label="Chọn đăng nhập hoặc đăng ký">
              <button
                type="button"
                aria-pressed={mode === 'login'}
                onClick={() => {
                  setMode('login');
                  setErrorMsg('');
                  setSuccessMsg('');
                }}
                className={`kit-segment min-h-11 px-3 apple-body font-medium ${mode === 'login' ? 'kit-segment-active' : ''}`}
              >
                Đăng nhập
              </button>
              <button
                type="button"
                aria-pressed={mode === 'register'}
                onClick={() => {
                  setMode('register');
                  setErrorMsg('');
                  setSuccessMsg('');
                }}
                className={`kit-segment min-h-11 px-3 apple-body font-medium ${mode === 'register' ? 'kit-segment-active' : ''}`}
              >
                Đăng ký mới
              </button>
            </div>
          )}

          {errorMsg && (
            <div id="auth-error" role="alert" className="kit-feedback mb-4 flex items-start gap-2 rounded-2xl border border-rose-200/80 bg-rose-50/90 p-3.5 text-sm text-rose-800 dark:border-rose-500/20 dark:bg-rose-950/70 dark:text-rose-200 animate-in fade-in">
              <AlertCircle aria-hidden="true" size={17} className="mt-0.5 shrink-0" />
              <span className="leading-relaxed">{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div role="status" className="kit-feedback mb-4 flex items-start gap-2 rounded-2xl border border-emerald-200/80 bg-emerald-50/90 p-3.5 text-sm text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-950/70 dark:text-emerald-200 animate-in fade-in">
              <CheckCircle2 aria-hidden="true" size={17} className="mt-0.5 shrink-0" />
              <span className="leading-relaxed">{successMsg}</span>
            </div>
          )}

          {mode === 'login' && (
            <div className="space-y-4">
              <form onSubmit={handleLoginSubmit} aria-busy={isLoading} aria-describedby={errorMsg ? "auth-error" : undefined} className="space-y-4">
                <div>
                  <label htmlFor="login-phone" className="mb-2 block apple-headline kit-text-primary">Số điện thoại</label>
                  <div className="relative flex items-center">
                    <Phone aria-hidden="true" size={18} className="pointer-events-none absolute left-3.5 text-neutral-500 dark:text-neutral-400" />
                    <input
                      id="login-phone" name="username" enterKeyHint="next"
                      type="tel"
                      autoComplete="tel"
                      required
                      placeholder="Ví dụ: 0902 371 800"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="kit-field min-h-12 w-full pl-11 pr-3.5 font-num"
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3">
                    <label htmlFor="login-password" className="apple-headline kit-text-primary">Mật khẩu</label>
                    <button
                      type="button"
                      onClick={() => setMode('forgot')}
                      className="min-h-11 cursor-pointer text-[13px] font-medium text-neutral-700 underline-offset-4 hover:underline dark:text-neutral-200"
                    >
                      Quên mật khẩu?
                    </button>
                  </div>
                  <div className="relative flex items-center">
                    <Lock aria-hidden="true" size={18} className="pointer-events-none absolute left-3.5 text-neutral-500 dark:text-neutral-400" />
                    <input
                      id="login-password" name="password" enterKeyHint="go"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      placeholder="Nhập mật khẩu"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="kit-field min-h-12 w-full pl-11 pr-12"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-0.5 flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl text-neutral-600 hover:text-neutral-950 dark:text-neutral-300 dark:hover:text-white"
                      aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                      title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div className="flex min-h-10 items-center">
                  <AppleCheckbox checked={rememberMe} onChange={setRememberMe} label="Ghi nhớ đăng nhập" color="black" />
                </div>

                <button type="submit" disabled={isLoading} className="primary-button mt-1 min-h-12 w-full px-4 apple-control">
                  {isLoading && <span aria-hidden="true" className="ui-spinner h-4 w-4" />}
                  <span>{isLoading ? 'Đang đăng nhập...' : 'Đăng nhập'}</span>
                  {!isLoading && <ArrowRight aria-hidden="true" size={18} />}
                </button>
              </form>

              <div className="flex items-center justify-center gap-3 py-1" aria-hidden="true">
                <div className="h-px flex-1 bg-black/10 dark:bg-white/15" />
                <span className="shrink-0 apple-callout kit-text-secondary">hoặc tiếp tục với</span>
                <div className="h-px flex-1 bg-black/10 dark:bg-white/15" />
              </div>

              <button
                type="button"
                onClick={handleZaloLogin}
                disabled={isLoading}
                aria-busy={isLoading}
                className="soft-button group flex min-h-14 w-full items-center justify-center gap-2 px-4 sm:gap-3 py-2 apple-control font-medium disabled:cursor-wait"
              >
                <img src="/brand/zalo-logo.png" alt="" width={36} height={36} className="h-9 w-9 shrink-0 object-contain" />
                <span>{isLoading ? 'Đang kết nối với Zalo…' : 'Đăng nhập với Zalo'}</span>
                {isLoading ? <span aria-hidden="true" className="ui-spinner h-4 w-4 shrink-0" /> : <ArrowRight aria-hidden="true" size={17} className="hidden shrink-0 text-neutral-500 dark:text-neutral-400 sm:block" />}
              </button>
            </div>
          )}

          {mode === 'register' && (
            <form onSubmit={handleRegisterSubmit} aria-busy={isLoading} aria-describedby={errorMsg ? "auth-error" : undefined} className="space-y-4">
              <div className="flex items-start gap-2 rounded-2xl border border-amber-200/80 bg-amber-50/90 p-3.5 text-[13px] leading-relaxed text-amber-900 dark:border-amber-500/20 dark:bg-amber-950/60 dark:text-amber-200">
                <ShieldAlert aria-hidden="true" size={17} className="mt-0.5 shrink-0" />
                <span><strong>Yêu cầu xác nhận:</strong> Sau khi đăng ký, tài khoản cần được <strong>Chủ trọ / Ban quản lý</strong> xác nhận duyệt phòng trước khi có thể đăng nhập.</span>
              </div>

              <div>
                <label htmlFor="register-name" className="mb-2 block apple-headline kit-text-primary">Họ và tên cư dân</label>
                <div className="relative flex items-center">
                  <User aria-hidden="true" size={18} className="pointer-events-none absolute left-3.5 text-neutral-500 dark:text-neutral-400" />
                  <input id="register-name" type="text" autoComplete="name" required placeholder="Họ và tên của bạn" value={regName} onChange={(e) => setRegName(e.target.value)} className="kit-field min-h-12 w-full pl-11 pr-3.5" />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="min-w-0">
                  <label htmlFor="register-phone" className="mb-2 block apple-headline kit-text-primary">Số điện thoại</label>
                  <input id="register-phone" type="tel" autoComplete="tel" required placeholder="09xx xxx xxx" value={regPhone} onChange={(e) => setRegPhone(e.target.value)} className="kit-field min-h-12 w-full px-3.5 font-num" />
                </div>
                <div className="min-w-0">
                  <label htmlFor="register-room" className="mb-2 block apple-headline kit-text-primary">Số phòng thuê</label>
                  <input id="register-room" type="text" required placeholder="P. 203" value={regRoom} onChange={(e) => setRegRoom(e.target.value)} className="kit-field min-h-12 w-full px-3.5 font-num" />
                </div>
              </div>

              <div>
                <label htmlFor="register-email" className="mb-2 block apple-headline kit-text-primary">Email liên hệ (tùy chọn)</label>
                <input id="register-email" type="email" autoComplete="email" placeholder="ban@example.com" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} className="kit-field min-h-12 w-full px-3.5" />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="min-w-0">
                  <label htmlFor="register-password" className="mb-2 block apple-headline kit-text-primary">Mật khẩu</label>
                  <input id="register-password" minLength={6} type="password" autoComplete="new-password" required placeholder="Ít nhất 6 ký tự" value={regPassword} onChange={(e) => setRegPassword(e.target.value)} className="kit-field min-h-12 w-full px-3.5" />
                </div>
                <div className="min-w-0">
                  <label htmlFor="register-confirm" className="mb-2 block apple-headline kit-text-primary">Nhập lại mật khẩu</label>
                  <input id="register-confirm" type="password" autoComplete="new-password" required placeholder="Nhập lại mật khẩu" value={regConfirmPass} onChange={(e) => setRegConfirmPass(e.target.value)} className="kit-field min-h-12 w-full px-3.5" />
                </div>
              </div>

              <button type="submit" disabled={isLoading} className="primary-button min-h-12 w-full px-4 py-3 apple-control">
                {isLoading && <span aria-hidden="true" className="ui-spinner h-4 w-4 shrink-0" />}
                <span>{isLoading ? 'Đang gửi yêu cầu...' : 'Gửi yêu cầu đăng ký cho Chủ trọ'}</span>
                {!isLoading && <ArrowRight aria-hidden="true" size={17} className="shrink-0" />}
              </button>
            </form>
          )}

          {mode === 'pending_approval' && (
            <div className="space-y-5 py-1 text-center animate-in fade-in zoom-in-95">
              <div aria-hidden="true" className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-200/60 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-950/60 dark:text-amber-200 icon-plate">
                <Clock size={28} />
              </div>
              <div>
                <span className="mb-2 inline-block rounded-full bg-amber-100/80 px-3 py-1 text-[13px] font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">Đang chờ chủ trọ xác nhận</span>
                <h3 className="apple-title2 apple-strong kit-text-primary">Yêu cầu đăng ký đã được gửi!</h3>
              </div>

              {registeredData && (
                <dl className="liquid-panel-subtle space-y-3 rounded-2xl p-4 text-left apple-body">
                  <div className="flex flex-wrap justify-between gap-x-4 gap-y-1"><dt className="text-neutral-600 dark:text-neutral-300">Họ và tên</dt><dd className="break-all font-medium text-neutral-950 dark:text-white">{registeredData.name}</dd></div>
                  <div className="flex flex-wrap justify-between gap-x-4 gap-y-1"><dt className="text-neutral-600 dark:text-neutral-300">Số điện thoại</dt><dd className="font-num font-medium text-neutral-950 dark:text-white">{registeredData.phone}</dd></div>
                  <div className="flex flex-wrap justify-between gap-x-4 gap-y-1"><dt className="text-neutral-600 dark:text-neutral-300">Số phòng đăng ký</dt><dd className="break-all font-num font-medium text-neutral-950 dark:text-white">{registeredData.roomNumber}</dd></div>
                </dl>
              )}

              <p className="apple-callout kit-text-secondary">Chủ trọ sẽ đối chiếu hợp đồng thuê phòng và kích hoạt tài khoản của bạn. Sau khi được duyệt, bạn có thể đăng nhập bằng số điện thoại này.</p>

              <div className="space-y-3">
                <a href="tel:0902371800" className="soft-button min-h-12 w-full px-4 py-3 text-[13px]">
                  <PhoneCall aria-hidden="true" size={16} className="shrink-0" />
                  <span>Liên hệ BQL Bùi Trung Khải duyệt nhanh (0902 371 800)</span>
                </a>
                <button
                  type="button"
                  onClick={() => { setMode('login'); setErrorMsg(''); setSuccessMsg(''); }}
                  className="primary-button min-h-12 w-full px-4 py-3 apple-control"
                >
                  Quay lại màn hình đăng nhập
                </button>
              </div>
            </div>
          )}

          {mode === 'forgot' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2.5 text-neutral-800 dark:text-neutral-100">
                <KeyRound aria-hidden="true" size={20} className="text-amber-600 dark:text-amber-300" />
                <h3 className="apple-title2 apple-strong">Khôi phục mật khẩu tài khoản</h3>
              </div>
              <p className="apple-callout kit-text-secondary">Nhập số điện thoại đã đăng ký với Ban Quản Lý Nhà Trọ Phong Lan. Chúng tôi sẽ gửi mã OTP đặt lại mật khẩu cho bạn.</p>
              <div>
                <label htmlFor="forgot-phone" className="mb-2 block apple-headline kit-text-primary">Số điện thoại</label>
                <input id="forgot-phone" type="tel" autoComplete="tel" placeholder="Ví dụ: 0902 371 800" value={forgotInput} onChange={(e) => setForgotInput(e.target.value)} className="kit-field min-h-12 w-full px-3.5 font-num" />
              </div>
              <button
                type="button"
                onClick={() => {
                  setSuccessMsg('Đã gửi mã khôi phục tới số điện thoại của bạn. Vui lòng kiểm tra tin nhắn SMS.');
                  setTimeout(() => setMode('login'), 2500);
                }}
                className="primary-button min-h-12 w-full px-4 apple-control"
              >
                Gửi mã xác nhận OTP
              </button>
              <button type="button" onClick={() => { setMode('login'); setErrorMsg(''); setSuccessMsg(''); }} className="soft-button min-h-11 w-full px-4 apple-control">Quay lại đăng nhập</button>
            </div>
          )}
        </div>

        <div className="kit-login-footer flex flex-col items-center gap-1 px-5 py-3 text-center sm:px-7">
          <a
            href="https://zalo.me/0902371800"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[13px] font-semibold text-neutral-800 hover:text-blue-600 underline-offset-4 hover:underline dark:text-neutral-100 dark:hover:text-blue-400 transition-colors"
          >
            <PhoneCall aria-hidden="true" size={15} /> Cần hỗ trợ? Liên hệ quản lý
          </a>
        </div>
      </div>
    </div>
  );
}
