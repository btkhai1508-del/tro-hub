import React, { useState, useRef } from 'react';
import { 
  X, 
  Download, 
  Printer, 
  FileText, 
  Calendar, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Building2, 
  User, 
  Phone, 
  CreditCard,
  Layers,
  ChevronDown
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { useApp, Invoice } from '../context/AppContext';
import { cn } from '../lib/utils';
import { IconContract3D } from './Icons3D';

interface PaymentHistoryExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PaymentHistoryExportModal({ isOpen, onClose }: PaymentHistoryExportModalProps) {
  const { invoices, profile } = useApp();
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'paid' | 'unpaid'>('all');
  const [isExporting, setIsExporting] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  if (!isOpen) return null;

  const fmt = (n: number) => Number(n || 0).toLocaleString('vi-VN');

  // Filter invoices
  const filteredInvoices = invoices.filter(inv => {
    if (selectedFilter === 'paid') return inv.status === 'paid';
    if (selectedFilter === 'unpaid') return inv.status === 'unpaid' || inv.status === 'pending';
    return true;
  });

  // Calculate totals
  const totalAmount = invoices.reduce((acc, curr) => acc + (curr.total || 0), 0);
  const totalPaid = invoices.filter(i => i.status === 'paid').reduce((acc, curr) => acc + (curr.total || 0), 0);
  const totalUnpaid = invoices.filter(i => i.status !== 'paid').reduce((acc, curr) => acc + (curr.total || 0), 0);
  const paidCount = invoices.filter(i => i.status === 'paid').length;

  const now = new Date();
  const exportDateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const handleDownloadPDF = async () => {
    if (!printRef.current) return;
    setIsExporting(true);

    try {
      // Temporary style adjustments for capture
      const element = printRef.current;
      
      const canvas = await html2canvas(element, {
        scale: 2, // 2x resolution for crystal clear text
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      
      const roomStr = profile.room?.roomNumber ? `_P${profile.room.roomNumber}` : '';
      pdf.save(`Lich_Su_Thanh_Toan_PhongLan${roomStr}_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}.pdf`);
    } catch (error) {
      console.error('Lỗi khi xuất file PDF:', error);
      // Fallback to print
      window.print();
    } finally {
      setIsExporting(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/65 backdrop-blur-md animate-in fade-in duration-200 select-none"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-4xl bg-white dark:bg-[#101726] rounded-[28px] border border-white/80 dark:border-slate-800 shadow-[0_25px_60px_-15px_rgba(15,23,42,0.4)] flex flex-col max-h-[92vh] overflow-hidden relative animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-white/95 dark:bg-[#101726]/95 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <IconContract3D size={40} className="shrink-0" />
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Xuất Lịch Sử Thanh Toán (PDF)
              </h2>
              <p className="text-xs text-slate-400">
                Tải về bảng kê hóa đơn và sao kê thanh toán định dạng chuẩn A4
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Filter */}
            <div className="hidden sm:flex items-center bg-slate-100 dark:bg-slate-800/80 rounded-xl p-0.5 text-xs font-bold">
              <button
                onClick={() => setSelectedFilter('all')}
                className={cn(
                  "px-3 py-1.5 rounded-lg transition-all cursor-pointer",
                  selectedFilter === 'all' ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs" : "text-slate-500"
                )}
              >
                Tất cả ({invoices.length})
              </button>
              <button
                onClick={() => setSelectedFilter('paid')}
                className={cn(
                  "px-3 py-1.5 rounded-lg transition-all cursor-pointer",
                  selectedFilter === 'paid' ? "bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-2xs" : "text-slate-500"
                )}
              >
                Đã thanh toán ({paidCount})
              </button>
              <button
                onClick={() => setSelectedFilter('unpaid')}
                className={cn(
                  "px-3 py-1.5 rounded-lg transition-all cursor-pointer",
                  selectedFilter === 'unpaid' ? "bg-white dark:bg-slate-700 text-rose-600 dark:text-rose-400 shadow-2xs" : "text-slate-500"
                )}
              >
                Chưa thanh toán ({invoices.length - paidCount})
              </button>
            </div>

            <button
              onClick={onClose}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Body: Scrollable Document Preview */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-100/70 dark:bg-slate-950/60">
          
          {/* Printable A4 Container */}
          <div 
            ref={printRef}
            className="bg-white text-slate-900 rounded-2xl p-6 sm:p-10 max-w-[780px] mx-auto shadow-sm border border-slate-200/90 font-sans print:p-0 print:border-none print:shadow-none print:m-0"
          >
            {/* Header Document */}
            <div className="flex items-start justify-between pb-6 border-b-2 border-slate-900 gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-bold">
                  <Building2 size={26} />
                </div>
                <div>
                  <h1 className="text-base sm:text-lg font-black tracking-tight text-slate-900 uppercase">
                    ECOSTAY RESIDENCE
                  </h1>
                  <p className="text-[11px] text-slate-500 font-medium">
                    Hệ sinh thái quản lý căn hộ & nhà trọ thông minh
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Địa chỉ: {profile.room?.building || '109/6 Lê Văn Chí, P. Linh Xuân, TP. Thủ Đức'}
                  </p>
                </div>
              </div>

              <div className="text-right text-[11px] space-y-0.5">
                <span className="inline-block px-2 py-0.5 bg-slate-100 text-slate-800 font-bold rounded text-[10px] uppercase">
                  Sao kê điện tử
                </span>
                <p className="text-slate-400 font-mono text-[10px]">Ngày xuất: {exportDateStr}</p>
                <p className="text-slate-500 font-medium">Hotline BQL: 0902 371 800</p>
              </div>
            </div>

            {/* Document Title */}
            <div className="text-center my-6">
              <h2 className="text-lg sm:text-xl font-black text-slate-900 uppercase tracking-tight">
                BẢNG KÊ LỊCH SỬ THANH TOÁN & HÓA ĐƠN
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Chứng nhận đối soát chi phí tiền phòng, điện, nước và dịch vụ
              </p>
            </div>

            {/* Resident & Room Information Box */}
            <div className="bg-slate-50/90 rounded-xl p-4 border border-slate-200/80 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-6">
              <div>
                <span className="text-[10px] uppercase text-slate-400 block font-semibold">Khách thuê:</span>
                <span className="font-bold text-slate-900 text-xs sm:text-sm">{profile.name}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase text-slate-400 block font-semibold">Số điện thoại:</span>
                <span className="font-bold font-mono text-slate-900">{profile.phone || '0902 371 800'}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase text-slate-400 block font-semibold">Căn hộ / Phòng:</span>
                <span className="font-black text-indigo-600 text-xs sm:text-sm">
                  {profile.room?.roomNumber ? `Phòng ${profile.room.roomNumber}` : 'Chưa phân phòng'}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase text-slate-400 block font-semibold">CCCD / ĐDCN:</span>
                <span className="font-bold font-mono text-slate-900">{profile.cccd || '0792 0501 9765'}</span>
              </div>
            </div>

            {/* Metric KPI Summary */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-center">
                <span className="text-[10px] text-slate-400 uppercase font-semibold block">Tổng chi phí phát sinh</span>
                <span className="text-sm sm:text-base font-black text-slate-900 font-num">{fmt(totalAmount)} ₫</span>
              </div>
              <div className="p-3 bg-emerald-50/70 rounded-xl border border-emerald-100 text-center">
                <span className="text-[10px] text-emerald-600 uppercase font-semibold block">Đã thanh toán ({paidCount} kỳ)</span>
                <span className="text-sm sm:text-base font-black text-emerald-600 font-num">{fmt(totalPaid)} ₫</span>
              </div>
              <div className="p-3 bg-rose-50/70 rounded-xl border border-rose-100 text-center">
                <span className="text-[10px] text-rose-600 uppercase font-semibold block">Còn phải thanh toán</span>
                <span className="text-sm sm:text-base font-black text-rose-600 font-num">{fmt(totalUnpaid)} ₫</span>
              </div>
            </div>

            {/* Invoices Breakdown Table */}
            <div className="overflow-x-auto mb-6">
              <table className="w-full text-left text-[11px] border-collapse border border-slate-200">
                <thead>
                  <tr className="bg-slate-900 text-white font-bold text-[10.5px]">
                    <th className="p-2.5 border border-slate-800 text-center w-10">STT</th>
                    <th className="p-2.5 border border-slate-800">Kỳ hóa đơn</th>
                    <th className="p-2.5 border border-slate-800">Mã hóa đơn</th>
                    <th className="p-2.5 border border-slate-800">Chi tiết các khoản mục</th>
                    <th className="p-2.5 border border-slate-800 text-right">Tổng tiền</th>
                    <th className="p-2.5 border border-slate-800 text-center w-28">Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-slate-400 italic">
                        Không có dữ liệu hóa đơn phù hợp với bộ lọc.
                      </td>
                    </tr>
                  ) : (
                    filteredInvoices.map((inv, idx) => {
                      const isPaid = inv.status === 'paid';
                      const isPending = inv.status === 'pending';

                      return (
                        <tr key={inv.id} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/60"}>
                          <td className="p-2.5 border border-slate-200 text-center font-bold text-slate-500">
                            {idx + 1}
                          </td>
                          <td className="p-2.5 border border-slate-200 font-bold text-slate-900">
                            Tháng {inv.month}
                          </td>
                          <td className="p-2.5 border border-slate-200 font-mono text-[10px] text-slate-600">
                            {inv.id}
                          </td>
                          <td className="p-2.5 border border-slate-200 text-slate-600 space-y-0.5">
                            {inv.details?.slice(0, 3).map((d, dIdx) => (
                              <div key={dIdx} className="flex justify-between gap-2 text-[10px]">
                                <span>• {d.name} {d.metric ? `(${d.metric})` : ''}</span>
                                <span className="font-mono">{fmt(d.amount)} đ</span>
                              </div>
                            ))}
                            {(inv.details?.length || 0) > 3 && (
                              <p className="text-[9.5px] text-slate-400 italic">+ {inv.details.length - 3} khoản phí khác</p>
                            )}
                          </td>
                          <td className="p-2.5 border border-slate-200 text-right font-black font-num text-slate-900 text-xs">
                            {fmt(inv.total)} ₫
                          </td>
                          <td className="p-2.5 border border-slate-200 text-center">
                            {isPaid ? (
                              <span className="inline-flex items-center gap-1 text-[9.5px] font-bold text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-md">
                                <CheckCircle2 size={10} /> ĐÃ NỘP
                              </span>
                            ) : isPending ? (
                              <span className="inline-flex items-center gap-1 text-[9.5px] font-bold text-amber-700 bg-amber-100/80 px-2 py-0.5 rounded-md">
                                <Clock size={10} /> CHỜ DUYỆT
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[9.5px] font-bold text-rose-700 bg-rose-100/80 px-2 py-0.5 rounded-md">
                                <AlertCircle size={10} /> CHƯA NỘP
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Verification Note & Signatures */}
            <div className="pt-4 border-t border-dashed border-slate-300">
              <p className="text-[10px] text-slate-500 italic text-justify leading-relaxed">
                * Ghi chú: Dữ liệu sao kê được trích xuất tự động từ hệ thống quản lý Nhà Trọ Phong Lan. Mọi thắc mắc về chỉ số điện nước hoặc các khoản khấu trừ, quý cư dân vui lòng liên hệ trực tiếp Ban Quản Lý trong vòng 03 ngày kể từ ngày phát hành hóa đơn.
              </p>

              <div className="grid grid-cols-2 gap-4 text-center text-xs mt-6 pt-2">
                <div>
                  <p className="font-bold text-slate-900">NGƯỜI NỘP TIỀN / CƯ DÂN</p>
                  <p className="text-[10px] text-slate-400 italic">(Ký, ghi rõ họ tên)</p>
                  <div className="h-16" />
                  <p className="font-bold text-slate-900">{profile.name}</p>
                </div>
                <div>
                  <p className="font-bold text-slate-900">ĐẠI DIỆN BAN QUẢN LÝ</p>
                  <p className="text-[10px] text-slate-400 italic">(Ký, đóng dấu xác nhận)</p>
                  <div className="h-16" />
                  <p className="font-bold text-slate-900">Bùi Trung Khải</p>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Modal Footer Controls */}
        <div className="shrink-0 flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-white/95 dark:bg-[#101726]/95 backdrop-blur-md">
          <p className="text-xs text-slate-400">
            Khổ in: <span className="font-bold text-slate-700 dark:text-slate-300">A4 tiêu chuẩn</span> • Độ phân giải cao (2x DPI)
          </p>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              type="button"
              onClick={handlePrint}
              className="flex-1 sm:flex-none soft-button py-2.5 px-4 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
            >
              <Printer size={15} />
              <span>In trực tiếp</span>
            </button>

            <button
              type="button"
              disabled={isExporting}
              onClick={handleDownloadPDF}
              className="flex-1 sm:flex-none primary-button py-2.5 px-6 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-md"
            >
              <Download size={15} className={isExporting ? "animate-bounce" : ""} />
              <span>{isExporting ? 'Đang tạo PDF...' : 'Tải tệp PDF về máy'}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
