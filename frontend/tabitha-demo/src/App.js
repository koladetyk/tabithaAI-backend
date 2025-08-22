import React, { useState, useEffect } from 'react';

const TabithaAIDemoApp = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reports, setReports] = useState([]);
  const [uploadStatus, setUploadStatus] = useState('');

  // Configuration - Replace with actual values
  const CONFIG = {
    API_BASE_URL: 'https://web-production-877a.up.railway.app/api/v1',
    GOOGLE_CLIENT_ID: '469162824107-vgvkuuenlo5suk0cqantphh0csv4s73v.apps.googleusercontent.com'
  };

  // Initialize Google Sign-In
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    
    script.onload = () => {
      console.log('Google script loaded successfully');
      if (window.google) {
        console.log('Google object available:', typeof window.google);
        try {
          window.google.accounts.id.initialize({
            client_id: CONFIG.GOOGLE_CLIENT_ID,
            callback: handleGoogleSignIn,
            auto_select: false
          });
          console.log('Google Sign-In initialized successfully');
        } catch (error) {
          console.error('Error initializing Google Sign-In:', error);
          setError('Failed to initialize Google Sign-In');
        }
      } else {
        console.error('Google object not available after script load');
        setError('Google Sign-In not available');
      }
    };
    
    script.onerror = (error) => {
      console.error('Failed to load Google script:', error);
      setError('Failed to load Google Sign-In');
    };
    
    document.head.appendChild(script);
    
    // Don't check auth status immediately - wait for user action
    // checkAuthStatus();

    return () => {
      if (document.head.contains(script)) {
        document.head.removeChild(script);
      }
    };
  }, []);

  // Check if user is already authenticated
  const checkAuthStatus = async () => {
    try {
      const response = await apiRequest('/auth/me', 'GET');
      if (response.success && response.user) {
        setUser(response.user);
      }
    } catch (err) {
      console.log('Not authenticated');
    }
  };

  // Generic API request function
  const apiRequest = async (endpoint, method = 'GET', body = null, includeFile = false) => {
    const options = {
      method,
      credentials: 'include', // Important: sends cookies
      headers: {}
    };

    if (body && !includeFile) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    } else if (body && includeFile) {
      options.body = body; // FormData for file uploads
    }

    const response = await fetch(`${CONFIG.API_BASE_URL}${endpoint}`, options);
    
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
    
    return await response.json();
  };

  // Handle Google Sign-In
  const handleGoogleSignIn = async (credentialResponse) => {
    setLoading(true);
    setError('');

    try {
      const response = await apiRequest('/auth/google', 'POST', {
        token: credentialResponse.credential
      });

      if (response.success) {
        setUser(response.user);
        console.log('User signed in:', response.user);
      } else {
        setError(response.message || 'Sign-in failed');
      }
    } catch (err) {
      console.error('Sign-in error:', err);
      setError('Network error during sign-in');
    } finally {
      setLoading(false);
    }
  };

  // Trigger Google Sign-In
  const signInWithGoogle = () => {
    if (window.google) {
      window.google.accounts.id.prompt();
    } else {
      setError('Google Sign-In not loaded');
    }
  };

  // Logout
  const logout = async () => {
    setLoading(true);
    try {
      const response = await apiRequest('/auth/logout', 'GET');
      if (response.success) {
        setUser(null);
        setReports([]);
        if (window.google) {
          window.google.accounts.id.disableAutoSelect();
        }
      }
    } catch (err) {
      setError('Logout failed');
    } finally {
      setLoading(false);
    }
  };

  // Load user reports
  const loadReports = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      const response = await apiRequest(`/reports/user/${user.id}`);
      if (response.success) {
        setReports(response.data || []);
      }
    } catch (err) {
      setError('Failed to load reports');
    } finally {
      setLoading(false);
    }
  };

  // Create a new report
  const createReport = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('note', 'Sample report created from demo');
      formData.append('email', user.email);
      formData.append('phoneNumber', user.phone_number || '');
      
      const response = await apiRequest('/reports', 'POST', formData, true);
      if (response.success) {
        setUploadStatus('Report created successfully!');
        await loadReports(); // Refresh reports list
      }
    } catch (err) {
      setError('Failed to create report');
    } finally {
      setLoading(false);
    }
  };

  // Upload evidence to a report
  const uploadEvidence = async (reportId) => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*,audio/*,video/*,.pdf,.doc,.docx,.txt';
    
    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      setLoading(true);
      try {
        const formData = new FormData();
        formData.append('files', file);
        formData.append('evidenceType', file.type.startsWith('image/') ? 'image' : 'document');
        formData.append('description', `Evidence uploaded: ${file.name}`);
        
        const response = await apiRequest(`/evidence/reports/${reportId}/evidence`, 'POST', formData, true);
        if (response.success) {
          setUploadStatus(`Evidence uploaded: ${file.name}`);
          await loadReports(); // Refresh to show new evidence
        }
      } catch (err) {
        setError('Failed to upload evidence');
      } finally {
        setLoading(false);
      }
    };
    
    fileInput.click();
  };

  return (
    <div style={{ 
      maxWidth: '800px', 
      margin: '20px auto', 
      padding: '20px',
      fontFamily: 'Arial, sans-serif'
    }}>
      <div style={{
        backgroundColor: '#f8f9fa',
        padding: '30px',
        borderRadius: '8px',
        marginBottom: '20px',
        textAlign: 'center'
      }}>
        <h1 style={{ color: '#333', marginBottom: '10px' }}>Tabitha AI Demo</h1>
        <p style={{ color: '#666', margin: 0 }}>Sample React Frontend Integration</p>
      </div>

      {error && (
        <div style={{
          backgroundColor: '#f8d7da',
          color: '#721c24',
          padding: '12px',
          borderRadius: '4px',
          marginBottom: '20px',
          border: '1px solid #f5c6cb'
        }}>
          {error}
        </div>
      )}

      {uploadStatus && (
        <div style={{
          backgroundColor: '#d4edda',
          color: '#155724',
          padding: '12px',
          borderRadius: '4px',
          marginBottom: '20px',
          border: '1px solid #c3e6cb'
        }}>
          {uploadStatus}
        </div>
      )}

      {loading && (
        <div style={{
          backgroundColor: '#e2e3e5',
          padding: '12px',
          borderRadius: '4px',
          marginBottom: '20px',
          textAlign: 'center'
        }}>
          Loading...
        </div>
      )}

      {!user ? (
        <div style={{
          backgroundColor: 'white',
          padding: '40px',
          borderRadius: '8px',
          textAlign: 'center',
          border: '1px solid #dee2e6'
        }}>
          <h2>Sign In Required</h2>
          <p style={{ marginBottom: '30px', color: '#666' }}>
            Please sign in with Google to access Tabitha AI
          </p>
          <button 
            onClick={signInWithGoogle}
            disabled={loading}
            style={{
              backgroundColor: '#4285f4',
              color: 'white',
              border: 'none',
              padding: '12px 24px',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '16px',
              opacity: loading ? 0.6 : 1
            }}
          >
            Sign in with Google
          </button>
        </div>
      ) : (
        <div>
          {/* User Info */}
          <div style={{
            backgroundColor: 'white',
            padding: '20px',
            borderRadius: '8px',
            marginBottom: '20px',
            border: '1px solid #dee2e6'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: '0 0 10px 0' }}>Welcome, {user.full_name}!</h3>
                <p style={{ margin: '5px 0', color: '#666' }}>
                  <strong>Email:</strong> {user.email}
                </p>
                <p style={{ margin: '5px 0', color: '#666' }}>
                  <strong>User ID:</strong> {user.id}
                </p>
                {user.agency_info && (
                  <p style={{ margin: '5px 0', color: '#666' }}>
                    <strong>Agency:</strong> {user.agency_info.name}
                  </p>
                )}
              </div>
              <button 
                onClick={logout}
                disabled={loading}
                style={{
                  backgroundColor: '#dc3545',
                  color: 'white',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: loading ? 'not-allowed' : 'pointer'
                }}
              >
                Logout
              </button>
            </div>
          </div>

          {/* Actions */}
          <div style={{
            backgroundColor: 'white',
            padding: '20px',
            borderRadius: '8px',
            marginBottom: '20px',
            border: '1px solid #dee2e6'
          }}>
            <h3 style={{ marginTop: 0 }}>Actions</h3>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button 
                onClick={loadReports}
                disabled={loading}
                style={{
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  padding: '10px 20px',
                  borderRadius: '4px',
                  cursor: loading ? 'not-allowed' : 'pointer'
                }}
              >
                Load My Reports
              </button>
              <button 
                onClick={createReport}
                disabled={loading}
                style={{
                  backgroundColor: '#007bff',
                  color: 'white',
                  border: 'none',
                  padding: '10px 20px',
                  borderRadius: '4px',
                  cursor: loading ? 'not-allowed' : 'pointer'
                }}
              >
                Create Sample Report
              </button>
            </div>
          </div>

          {/* Reports List */}
          <div style={{
            backgroundColor: 'white',
            padding: '20px',
            borderRadius: '8px',
            border: '1px solid #dee2e6'
          }}>
            <h3 style={{ marginTop: 0 }}>My Reports ({reports.length})</h3>
            {reports.length === 0 ? (
              <p style={{ color: '#666' }}>No reports found. Click "Load My Reports" or create a sample report.</p>
            ) : (
              <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {reports.map((report) => (
                  <div 
                    key={report.id} 
                    style={{
                      padding: '15px',
                      margin: '10px 0',
                      backgroundColor: '#f8f9fa',
                      borderRadius: '4px',
                      border: '1px solid #e9ecef'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                      <div style={{ flex: 1 }}>
                        <h4 style={{ margin: '0 0 10px 0' }}>Report #{report.id}</h4>
                        <p style={{ margin: '5px 0', fontSize: '14px', color: '#666' }}>
                          <strong>Status:</strong> {report.status || 'pending'}
                        </p>
                        <p style={{ margin: '5px 0', fontSize: '14px', color: '#666' }}>
                          <strong>Created:</strong> {new Date(report.created_at).toLocaleDateString()}
                        </p>
                        {report.note && (
                          <p style={{ margin: '10px 0', fontSize: '14px' }}>
                            <strong>Note:</strong> {report.note}
                          </p>
                        )}
                        {report.evidence && report.evidence.length > 0 && (
                          <p style={{ margin: '5px 0', fontSize: '14px', color: '#666' }}>
                            <strong>Evidence:</strong> {report.evidence.length} files
                          </p>
                        )}
                      </div>
                      <button 
                        onClick={() => uploadEvidence(report.id)}
                        disabled={loading}
                        style={{
                          backgroundColor: '#17a2b8',
                          color: 'white',
                          border: 'none',
                          padding: '6px 12px',
                          borderRadius: '4px',
                          cursor: loading ? 'not-allowed' : 'pointer',
                          fontSize: '12px'
                        }}
                      >
                        Add Evidence
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Integration Notes */}
      <div style={{
        backgroundColor: '#e9ecef',
        padding: '20px',
        borderRadius: '8px',
        marginTop: '30px',
        fontSize: '14px'
      }}>
        <h4 style={{ marginTop: 0 }}>Integration Notes for Developer:</h4>
        <ul style={{ margin: '10px 0', paddingLeft: '20px' }}>
          <li>Replace <code>YOUR_GOOGLE_CLIENT_ID_HERE</code> with actual Google Client ID</li>
          <li>All API calls use <code>credentials: 'include'</code> for cookie-based auth</li>
          <li>File uploads use FormData with the optimized file upload middleware</li>
          <li>Error handling shows user-friendly messages</li>
          <li>Loading states prevent multiple simultaneous requests</li>
          <li>Google Sign-In automatically handles token verification</li>
        </ul>
      </div>
    </div>
  );
};

export default TabithaAIDemoApp;