import React from 'react';
import { isChunkLoadError, reloadOnceForNewBuild } from '../lib/chunkRecovery';

interface State {
  failed: boolean;
  reloading: boolean;
}

/** Without this, any render or chunk error unmounts the whole app and leaves a blank page. */
export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { failed: false, reloading: false };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[AppErrorBoundary]', error);
    if (isChunkLoadError(error) && reloadOnceForNewBuild()) this.setState({ reloading: true });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    // Inline styles: the stylesheet itself may be what failed to load.
    return (
      <div role="alert" style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#f7f8fa', color: '#171717', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', textAlign: 'center' }}>
        {this.state.reloading ? <p>Đang tải phiên bản mới…</p> : (
          <div style={{ maxWidth: 360 }}>
            <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 8px' }}>Chưa mở được trang</h1>
            <p style={{ margin: '0 0 20px', lineHeight: 1.5, color: '#525252' }}>Vui lòng kiểm tra kết nối mạng rồi tải lại.</p>
            <button type="button" onClick={() => window.location.reload()} style={{ minHeight: 44, padding: '10px 20px', border: 0, borderRadius: 14, background: '#171717', color: '#fff', fontSize: 16, cursor: 'pointer' }}>Tải lại</button>
          </div>
        )}
      </div>
    );
  }
}
