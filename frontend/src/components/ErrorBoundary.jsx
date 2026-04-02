import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:'#050505', color:'#f8fafc', flexDirection:'column', gap:'12px' }}>
          <div style={{ fontSize:'24px' }}>⚠ Something went wrong</div>
          <div style={{ fontSize:'13px', color:'#94a3b8', maxWidth:'420px', textAlign:'center', lineHeight:'1.6' }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop:'8px', padding:'8px 20px', borderRadius:'8px', border:'1px solid rgba(0,255,178,0.4)', background:'rgba(0,255,178,0.1)', color:'#00FFB2', cursor:'pointer', fontSize:'13px', fontFamily:'Inter,sans-serif' }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
