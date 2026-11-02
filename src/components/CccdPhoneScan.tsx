import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import type { CccdQrData } from '../lib/cccdQr';
import { CccdQrScanner } from './CccdQrScanner';

/**
 * Opened on a phone from the QR a computer shows: scans the CCCD here and hands the result to that
 * computer. No login is needed; the session id in the link is what lets the phone post.
 */
export default function CccdPhoneScan() {
  const { id = '' } = useParams();
  const [state, setState] = useState<'idle' | 'scan' | 'sending' | 'sent' | 'error'>('scan');
  const [error, setError] = useState('');

  const send = async (data: CccdQrData) => {
    setState('sending');
    try {
      const res = await apiFetch(`/api/cccd-handoff/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) throw new Error(body?.error || '');
      setState('sent');
    } catch (err: any) {
      setError(err?.message || 'Chưa gửi được sang máy tính. Vui lòng kiểm tra mạng rồi quét lại.');
      setState('error');
    }
  };

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#f7f8fa] p-4 dark:bg-[#101114]">
      <section className="liquid-panel w-full max-w-sm p-5 text-center">
        <h1 className="apple-title2 kit-text-primary font-semibold">Quét CCCD cho máy tính</h1>
        {state === 'sent' && <p role="status" className="apple-body kit-text-secondary mt-2">Đã gửi thông tin sang máy tính. Bạn có thể đóng trang này.</p>}
        {state === 'sending' && <p role="status" className="apple-body kit-text-secondary mt-2">Đang gửi sang máy tính...</p>}
        {state === 'error' && (
          <>
            <p role="alert" className="apple-body mt-2 text-red-700 dark:text-red-400">{error}</p>
            <button type="button" onClick={() => setState('scan')} className="primary-button mt-4 min-h-11 w-full px-4">Quét lại</button>
          </>
        )}
        {(state === 'idle' || state === 'scan') && (
          <>
            <p className="apple-body kit-text-secondary mt-2">Bấm nút dưới để mở camera và quét QR ở mặt trước CCCD.</p>
            <button type="button" onClick={() => setState('scan')} className="primary-button mt-4 min-h-11 w-full px-4">Mở camera</button>
          </>
        )}
      </section>
      {state === 'scan' && <CccdQrScanner phoneHandoff={false} onClose={() => setState('idle')} onResult={send} />}
    </main>
  );
}
