import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { validateSSO } from '../services/api';

const SSOLogin = ({ onLogin }) => {
    const [searchParams] = useSearchParams();
    const [status, setStatus] = useState('verifying'); // verifying, error
    const [error, setError] = useState(null);
    const navigate = useNavigate();

    useEffect(() => {
        const token = searchParams.get('token');
        if (!token) {
            setStatus('error');
            setError('No SSO token provided.');
            return;
        }

        const performSSO = async () => {
            const result = await validateSSO(token);
            if (result.ok) {
                onLogin(result.user);
            } else {
                setStatus('error');
                setError(result.error);
            }
        };

        performSSO();
    }, [searchParams, onLogin]);

    return (
        <div style={{
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'radial-gradient(circle at center, #1a1c24 0%, #0f1117 100%)',
            color: '#fff',
            fontFamily: 'Inter, system-ui, sans-serif'
        }}>
            <div style={{
                background: 'rgba(22, 27, 34, 0.8)',
                backdropFilter: 'blur(10px)',
                padding: '48px',
                borderRadius: '24px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                textAlign: 'center',
                boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
                maxWidth: '440px',
                width: '90%',
                position: 'relative',
                overflow: 'hidden'
            }}>
                {/* Decorative background glow */}
                <div style={{
                    position: 'absolute',
                    top: '-50%',
                    left: '-50%',
                    width: '200%',
                    height: '200%',
                    background: 'radial-gradient(circle at center, rgba(99, 102, 241, 0.05) 0%, transparent 50%)',
                    pointerEvents: 'none'
                }}></div>

                <div style={{
                    fontSize: '28px',
                    fontWeight: 800,
                    marginBottom: '32px',
                    letterSpacing: '-0.02em',
                    background: 'linear-gradient(135deg, #fff 0%, #a855f7 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '12px'
                }}>
                    GrepSQL AI
                </div>

                {status === 'verifying' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div className="simple-loader" style={{
                            width: '32px',
                            height: '32px',
                            border: '3px solid rgba(255,255,255,0.1)',
                            borderTop: '3px solid #6366f1',
                            borderRadius: '50%',
                            animation: 'spin 0.8s linear infinite',
                            marginBottom: '20px'
                        }}></div>
                        <div style={{ fontSize: '15px', color: '#c9d1d9' }}>
                            Logging you in...
                        </div>
                    </div>
                ) : (
                    <div style={{ position: 'relative', zIndex: 1 }}>
                        <div style={{ color: '#ff7b72', marginBottom: '20px', fontSize: '14px' }}>
                            ⚠️ {error}
                        </div>
                        <button 
                            onClick={() => navigate('/login')}
                            style={{
                                background: '#21262d',
                                border: '1px solid #30363d',
                                color: '#c9d1d9',
                                padding: '10px 20px',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontSize: '14px'
                            }}
                        >
                            Back to Login
                        </button>
                    </div>
                )}
            </div>

            <style>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
};

export default SSOLogin;
