import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// 화면 하나에서 오류가 나도 앱 전체가 빈 화면이 되지 않게
class Guard extends Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div style={{ padding: 24, fontFamily: 'sans-serif', color: '#15273E', background: '#FAFAF3', minHeight: '100vh' }}>
        <h2>잠시 문제가 생겼어요</h2>
        <p>다시 열면 대부분 해결돼요.</p>
        <button onClick={() => location.reload()} style={{ padding: '12px 18px', borderRadius: 12, border: 'none', background: '#15273E', color: '#DDF159', fontWeight: 800 }}>다시 열기</button>
        <pre style={{ marginTop: 16, fontSize: 11, whiteSpace: 'pre-wrap', opacity: 0.6 }}>{String(this.state.err?.message || this.state.err)}</pre>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Guard><App /></Guard>
  </StrictMode>,
)
